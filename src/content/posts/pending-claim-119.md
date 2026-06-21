---
title: 워커가 PENDING을 집어 보낸다 — claim과 재시도
description: 1편에서 outbox에 PENDING이 쌓이는 데까지 만들었다. 집어서 보내는 주체는 없었다. 이번 편이 그 worker다.
pubDate: '2026-06-11T18:24:14+09:00'
dateSource: html-visible
slug: pending-claim-119
tags:
  - Worker
  - Concurrency
  - golang
  - retry
  - distributed-systems
  - idempotency
  - outbox-pattern
category: Project/Reliable webhook dispatcher
draft: false
legacy:
  tistoryId: '119'
  sourceHtml: '119/119-[2편]-워커가-PENDING을-집어-보낸다-—-claim과-재시도.html'
  sourceHash: 'sha256:3d665652329f3df119f17c624a9108c7a652d7976d93c21b96921cbff30cef18'
---

1편에서 outbox에 PENDING이 쌓이는 데까지 만들었다. 집어서 보내는 주체는 없었다. 이번 편이 그 worker다.

## claim — 고르는 순간 내 것으로 표시한다

worker가 할 일은 단순하다. PENDING 하나를 골라 webhook으로 보낸다. 문제는 _어떻게 고르느냐_ 다.

순진하게 짜면 두 단계가 된다.

```
SELECT id FROM outbox_events WHERE status='PENDING' LIMIT 1;  -- 1. 고른다
UPDATE outbox_events SET status='PROCESSING' WHERE id = ?;    -- 2. 표시한다
```

두 문장 사이에 그 행은 _아직 PENDING_ 이다. 골라놓고 아직 표시 못 한 이 틈에서 사고가 난다. worker가 둘이면 그 찰나에 같은 행을 둘이 고르고, worker가 하나여도 그 틈에서 죽으면 그 행은 "골라졌지만 아무도 표시 안 한" 상태로 붕 뜬다.

골랐으면 바로 바꾸면 되지 않나? 그 "바로"가 안 된다 — 고르기(SELECT)와 바꾸기(UPDATE)가 _다른 문장_인 한, 사이에는 늘 틈이 있다.

그래서 _읽기_ 가 아니라 _claim_ 이다. 고르기와 표시를 한 문장으로 합친다.

```go
UPDATE outbox_events
   SET status = 'PROCESSING'
 WHERE id = (SELECT id FROM outbox_events
              WHERE status = 'PENDING'
              ORDER BY created_at LIMIT 1)
 RETURNING id, payload, attempt_count;   -- 집은 행을 그대로 돌려받는다
```

UPDATE가 행을 고르고, PROCESSING으로 바꾸고, payload까지 한 번에 돌려준다. "골라졌지만 표시 안 됨"이라는 중간 상태가 아예 생기지 않는다. claim은 그냥 읽는 SELECT가 아니라 _고르면서 동시에 내 것으로 잠그는_ 원자적 쓰기다.

```
PENDING → (claim) PROCESSING → webhook 전송 → SENT
```

PROCESSING은 "누가 집어갔다"는 표식이다. 다른 worker는 PENDING만 고르니 PROCESSING은 거들떠보지 않는다.

이걸로 한 worker 안의 틈은 닫혔다. worker _여럿_이 정확히 같은 순간 같은 PENDING을 노리는 건 이 한 문장만으론 못 막는다. 그건 `SKIP LOCKED`의 몫이다. SKIP LOCKED 는 이미 잠긴 행을 건너뛰는 PostgreSQL 옵션이다. 3편에서 자세히 본다.

## 전송 결과를 셋으로 나눈다

webhook 응답이 다 같지 않다. 결과에 따라 다음 상태가 갈린다.

| 응답 | 의미 | 다음 |
| --- | --- | --- |
| 2xx | 성공 | `SENT` |
| 5xx / timeout / 연결 실패 | 받는 쪽 일시 장애 | `PENDING`으로 되돌림 → 재시도 |
| 4xx | 요청 자체가 잘못됨(고쳐도 또 실패) | `FAILED` |

5xx와 4xx를 가르는 게 핵심이다. 5xx는 기다리면 나아질 수 있으니 재시도, 4xx는 payload가 틀린 거라 백 번 보내도 똑같으니 재시도하지 않는다.

```
func classify(code int, callErr error, attemptNo, max int) Outcome {
    switch {
    case callErr == nil && 200 <= code && code < 300:
        return Sent     // 2xx
    case callErr == nil && 400 <= code && code < 500:
        return Failed   // 4xx — 고쳐도 또 실패
    default:
        if attemptNo < max {
            return Retry // 5xx·timeout·연결 실패
        }
        return Failed    // 상한을 넘으면 포기
    }
}
```

switch 하나가 재시도 정책의 전부다. 외부 호출(`callErr`, `code`)은 이 함수 밖, 트랜잭션 바깥에서 끝내고 결과만 넘긴다.

## @Retry를 펼친다

0편에서 막연한 `@Retry` 한 줄이 _기록을 안 남겨서_ 통제가 안 됐다고 했다. 여기서 그걸 펼친다. 재시도를 어노테이션에 맡기지 않고 상태로 들고 있는다.

```
outbox_events : status, attempt_count, next_retry_at
delivery_attempts : 시도마다 한 행 (응답코드, 에러, 시각)
```

-   `attempt_count` — 몇 번 시도했는지 센다. 상한을 넘으면 `FAILED`. 무한 재시도는 없다.
-   `next_retry_at` — _언제_ 다시 보낼지. 즉시 다시 보내지 않고 backoff를 둔다(10초, 30초, …). 받는 쪽이 죽었는데 즉시 몰아치면 회복을 방해하니까.
-   `delivery_attempts` — 모든 시도를 한 행씩 남긴다. 왜 실패했고 몇 번째였는지가 테이블에 박힌다.

0편의 "발행은 로그를 봐야 안다"가, 여기서 "테이블을 보면 안다"로 바뀐다.

## 회고

|   |   |
| --- | --- |
| 한 일 | PENDING을 claim해 보내고, 결과를 셋으로 갈라 상태·기록으로 남김 |
| 펼친 것 | `@Retry`가 숨기던 재시도를 `attempt_count`·`next_retry_at`·`delivery_attempts`로 |
| 안 한 것 | worker는 아직 하나 |

worker 하나의 처리량은 곧 한계에 닿는다.

여러 개로 늘리는 순간 같은 PENDING을 두 워커가 노리는 문제가 생긴다 — 다음 글에서.
