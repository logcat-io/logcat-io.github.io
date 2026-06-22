---
title: "[PROJECT] 두 번 보내도 한 번 — 멱등 두 레이어"
description: 지금까지 안 잃으려고 재시도하고 회수했다. 그 대가가 중복이다. 같은 이벤트가 두 번 나갈 수 있다. 이번 편은 중복을 다룬다.
pubDate: '2026-06-11T18:24:31+09:00'
dateSource: html-visible
slug: post-122
tags:
  - 분산시스템
  - golang
  - 멱등성
  - outbox
  - pattern
  - idempotency
category: Project/Reliable webhook dispatcher
draft: false
legacy:
  tistoryId: '122'
  sourceHtml: '122/122-[5편]-두-번-보내도-한-번-—-멱등-두-레이어.html'
  sourceHash: 'sha256:f3e45e672bb5825e09e91d9abc757730d00e67ef0188d90f750113ac0257c58f'
---

지금까지 안 잃으려고 재시도하고 회수했다. 그 대가가 중복이다. 같은 이벤트가 두 번 나갈 수 있다. 이번 편은 중복을 다룬다.

## 중복은 버그가 아니라 전제다

재시도와 recovery가 있는 한 중복은 _정상_ 이다. worker가 보내고 응답을 못 본 채 죽으면, 이벤트는 외부에 도착했어도 우리는 모른다. 재기동 후 다시 보낸다. 받는 쪽은 같은 걸 두 번 받는다.

이걸 없애려 하지 않는다. 두 번 와도 _효과는 한 번_ 이 되게 만든다. 멱등이다. 그리고 멱등은 두 곳에 박는다 — 들어오는 쪽과 나가는 쪽.

## inbound — 우리 API가 요청을 받을 때 (`POST /orders`)

클라이언트가`POST /orders`를 네트워크 불안으로 두 번 보낼 수 있다. 그대로 두면 주문이 두 개 생긴다. 이를 막기 위해 클라이언트가 요청에 임의의 고유 키(`Idempotency-Key`)를 싣고, 우리는 그 키를 테이블에 저장한다.

```
CREATE TABLE idempotency_keys (
  key TEXT, endpoint TEXT, request_hash TEXT,
  response_status INT, response_body JSONB,
  UNIQUE (endpoint, key)
);
```

`UNIQUE(endpoint, key)`가 방어다. 같은 키로 동시에 N개가 와도 INSERT는 하나만 성공한다. 나머지는 저장된 첫 응답을 그대로 돌려준다. 같은 키인데 본문이 다르면 키 오용이니 409.

```
// INSERT가 성공하면 이 요청이 첫 번째다 (reserved)
res, _ := tx.ExecContext(ctx, `
    INSERT INTO idempotency_keys (key, endpoint, request_hash, response_status, response_body)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint, key) DO NOTHING`,
    key, endpoint, reqHash, status, body)

n, _ := res.RowsAffected()
reserved := n == 1 // 0이면 이미 누가 선점 → 저장된 첫 응답을 돌려준다
```

동시성 제어를 코드로 푸는 게 아니라 `UNIQUE` 제약과 `ON CONFLICT`에 넘긴다. 경쟁은 DB가 정리한다.

## outbound — 우리가 외부로 보낼 때 (webhook)

이건 4편까지 만든 그 전송이다. worker가 webhook을 보낼 때 이벤트의 `event_id`를 `Idempotency-Key` 헤더에 싣는다.

```
req.Header.Set("Idempotency-Key", event_id)
```

여기서 경계가 갈린다. **보내는 쪽은 중복을 없애지 못한다.** '전송'과 '전송했음 기록(SENT)'이 또 dual-write라(1편), 그 사이 죽으면 또 중복이다. 보내는 쪽이 할 수 있는 건 둘이다.

-   `claim_token`으로 _동시·늦은_ 중복을 막는다(3편). 이건 우리 DB의 정합이지 발송 멱등이 아니다.
-   각 이벤트에 고정된 `event_id`를 키로 실어, 받는 쪽이 dedup할 _재료_를 준다.

최종 중복 제거는 받는 쪽이 그 키로 한다. "이 키 본 적 있으면 처리하지 않는다." **at-least-once 전송 + 받는 쪽 dedup = exactly-once 효과** — 분산 전송의 정석이다. 받는 쪽이 외부 시스템이면 그쪽 몫이라 우리는 키까지만 책임지고, 우리가 받는 쪽이면 위의 `idempotency_keys`가 그 dedup 저장소다. 운영 receiver의 dedup은 그쪽 책임으로 _가정_ 한다 — 통제 밖이라 이 프로젝트는 mock으로 그 가정을 관측만 한다.

## 실패를 버리지 않는다 — dead-letter와 replay

재시도 상한을 넘은 이벤트는 `FAILED`다. 이게 dead-letter다. 별도 테이블이나 새 상태를 만들지 않는다 — `FAILED` 자체가 "자동 전송을 멈춘" 격리 상태다.

버리지는 않는다. 원인(받는 쪽 장애, payload 오류)을 고친 뒤 운영자가 다시 보낸다.

```sql
// FAILED → (replay) PENDING

UPDATE outbox_events SET status='PENDING' WHERE id=$1 AND status='FAILED'
```

replay도 멱등하게 만든다. `WHERE status='FAILED'` 가드를 둬서, 이미 다른 상태면 0 rows로 조용히 넘어간다. 같은 걸 두 번 replay해도 이중 enqueue가 안 된다.

## 회고

|   |   |
| --- | --- |
| inbound 멱등 | 같은 요청 재전송 → 주문 하나 (`idempotency_keys` + UNIQUE) |
| outbound 멱등 | 보내는 쪽은 키 제공, 받는 쪽이 최종 dedup |
| dead-letter | FAILED를 버리지 않고 운영자가 replay |
| 경계 | `claim_token` = 내부 정합, dedup = 발송 멱등. 다른 레이어 |

이제 안 잃고, 안 겹치고, 실패도 되살린다. 신뢰성의 뼈대는 다 섰다. 그런데 이게 잘 돌고 있는지 _어떻게 아나_ — 0편의 그 질문으로 돌아간다.
