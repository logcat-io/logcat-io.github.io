---
title: "[PROJECT] 워커 여럿과 SKIP LOCKED, 그리고 claim_token"
description: worker 하나의 처리량은 곧 한계다. 여러 개 돌리면 된다 — 그 순간 같은 PENDING을 둘이 집는 문제가 생긴다.
pubDate: '2026-06-11T18:24:20+09:00'
dateSource: html-visible
slug: skip-locked-claim-token-120
tags:
  - PostgreSQL
  - fencing
  - golang
  - outbox
  - wehook
  - skip
  - locked
  - claim_token
category: Project/Reliable webhook dispatcher
draft: false
legacy:
  tistoryId: '120'
  sourceHtml: '120/120-[3편]-워커-여럿과-SKIP-LOCKED,-그리고-claim_token.html'
  sourceHash: 'sha256:385f6b82bdd402fbe33a1a2e8821c1ddeb5acca028ce2d4ad9ef6fb4567274ef'
---

worker 하나의 처리량은 곧 한계다. 여러 개 돌리면 된다 — 그 순간 같은 PENDING을 둘이 집는 문제가 생긴다.

## 둘이 같은 행을 집는다

worker A와 B가 거의 동시에 PENDING을 읽는다.

```
A: SELECT ... WHERE status='PENDING' LIMIT 1   → event 42
B: SELECT ... WHERE status='PENDING' LIMIT 1   → event 42   ← 같은 거
```

둘 다 42를 PROCESSING으로 바꾸고 둘 다 보낸다. 중복 발송이다.

## FOR UPDATE는 막지만 느리다

FOR UPDATE 는 한 행을 한 세셔만 잡도록 보장해 주지만, 이미 다른 세션이 잡고 있는 행에 대해서는 기다리게 된다. 여러 워커가 동시에 돌아가는 상황에서는 '서로 기다리면서 병렬성이 떨어지는' 쪽으로 작동할 수 있다.

```
SELECT ... WHERE status='PENDING' LIMIT 1 FOR UPDATE;
```

A가 42에 락을 잡으면 B는 같은 행에서 _기다린다_. A가 끝나야 B가 다음으로 간다. 안전하지만, B가 멀쩡한 다른 행을 두고 줄을 서는 게 낭비다. worker를 늘린 의미가 없어진다.

## SKIP LOCKED — 잠긴 건 건너뛴다

```go
SELECT ... 
WHERE status='PENDING'
ORDER BY created_at LIMIT 10
FOR UPDATE SKIP LOCKED;
```

`SKIP LOCKED`는 이미 잠긴 행을 기다리지 않고 _건너뛴다_. A가 42를 잡으면 B는 42를 지나쳐 43을 잡는다. 둘이 겹치지 않고 줄도 안 선다. 동시 claim 충돌이 0이 된다.

실제 claim은 SELECT와 UPDATE를 CTE 하나로 묶는다. 고르기·PROCESSING 전환·토큰 발급이 한 문장에서 원자적으로 일어난다.

```go
WITH picked AS (
    SELECT id FROM outbox_events
    WHERE status = 'PENDING'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED              -- 잠긴 행은 건너뛴다
    LIMIT 1
)
UPDATE outbox_events
   SET status = 'PROCESSING',
       claim_token = gen_random_uuid(), -- claim마다 고유 토큰 발급
       processing_started_at = now()
 WHERE id IN (SELECT id FROM picked)
 RETURNING id, event_type, payload, claim_token, attempt_count;
```

claim 트랜잭션은 짧게 둔다. 행을 잡고 PROCESSING으로 바꾸고 바로 commit. 그래야 락 보유가 짧다.

## 락이 풀린 뒤가 문제다

claim 트랜잭션은 짧게 끝난다. 그런데 webhook 전송은 그 _바깥_ 에서 수 초간 일어난다(1편: 외부 호출은 트랜잭션 안에 안 넣는다). 즉 전송 중엔 락이 이미 없다. 이 공백에서 사고가 난다.

```go
t0  A가 42 claim → PROCESSING, token=TA, 락 해제
t1  A가 webhook 전송 중 (GC로 멈춤)
t2  timeout → 시스템이 42 회수, claim_token=NULL
t3  B가 42 재claim → token=TB, 전송 → SENT
t4  A가 깨어나 UPDATE SET status='SENT' WHERE claim_token=TA → 0 rows
```

worker A가 42를 전송하다 멈췄다(GC, 지연). 시스템은 A가 죽은 줄 알고 42를 회수해 B에게 넘긴다. B가 처리하고 SENT를 찍는다. 그때 A가 깨어나 _자기도_ 결과를 쓴다. 이미 끝난 걸 A가 덮어쓴다.

## claim\_token — 무효해진 워커의 쓰기를 막는다

claim할 때 worker마다 고유한 토큰을 발급한다. 결과를 쓸 때 항상 그 토큰을 조건으로 건다.

```go
A claim → claim_token = TA
회수     → claim_token = NULL
B claim → claim_token = TB

A가 뒤늦게: UPDATE ... SET status='SENT'
           WHERE id=42 AND claim_token = TA
                 → 현재 토큰은 TB → 0 rows → 거부
```

A의 토큰은 회수 시점에 무효가 됐다. `WHERE claim_token = TA`가 한 행도 못 맞춰 쓰기가 조용히 거부된다. 유효한 토큰을 든 worker만 결과를 남긴다. 이게 무효해진 주체의 쓰기를 토큰으로 차단하는 기법인 fencing 이다.

SKIP LOCKED가 _동시_ 충돌을 막고, claim\_token이 _락 공백의 늦은 덮어쓰기_ 를 막는다. 둘은 다른 문제를 푼다.

## 회고

|   |   |
| --- | --- |
| SKIP LOCKED | 여러 worker가 같은 행을 동시에 집지 않음 |
| claim\_token | 회수된 worker가 뒤늦게 상태를 덮어쓰지 않음 |
| 남은 것 | worker가 전송 도중 죽으면 PROCESSING이 안 풀린다 |

claim\_token으로 _늦게 돌아온_ worker는 막았다.

그런데 아예 _안 돌아오는_ worker가 잡아둔 이벤트는 누가 푸나 — 다음 글에서.
