---
title: 유실은 어디서 생기나 — outbox로 잃을 틈을 없애기
description: 0편에서 전송이 "한 번 호출하고 끝이라 실패하면 증발"이라고 적었다. 정확히 어디서 사라지는지를 이 글에서 본다.
pubDate: '2026-06-10T20:58:38+09:00'
dateSource: html-visible
slug: outbox-118
tags:
  - transaction
  - golang
  - 멱등성
  - At-Least-Once
  - outbox
  - pattern
  - idempotency
  - dual
  - write
category: Project/Reliable webhook dispatcher
draft: false
legacy:
  tistoryId: '118'
  sourceHtml: '118/118-[1편]-유실은-어디서-생기나-—-outbox로-잃을-틈을-없애기.html'
  sourceHash: 'sha256:a9e65bd34b49476f43ef288485dd777a1eec20c78b7e76cff15edcbf736b10f9'
---

0편에서 전송이 "한 번 호출하고 끝이라 실패하면 증발"이라고 적었다. 정확히 어디서 사라지는지를 이 글에서 본다.

## 문제: 두 번의 쓰기가 묶이지 않는다

주문이 생기면 알림을 보낸다. 보통은 아래와 같이 된다.

```
db.save(order)                     // 1. DB에 저장
webhook.send(orderCreatedEvent)    // 2. 외부로 전송
```

이 두 줄은 _서로 다른 시스템에 대한 두 번의 쓰기_ 다. 하나는 우리 DB, 하나는 외부. 둘을 묶는 건 없다. 그래서 두 줄 사이에서 프로세스가 죽으면:

```
t0  db.save(order)        커밋 ✅
t1  ── 배포 재시작 / GC / OOM kill ──
t2  webhook.send(event)   실행 안 됨 ❌
```

주문은 남고 알림은 안 나간다. 안 나갔다는 기록조차 없다. 0편의 "발송 여부는 로그를 봐야 안다"가 여기서 나온다.

순서를 뒤집으면 반대 사고가 난다. 외부를 먼저 호출하고 DB를 나중에 커밋하면, 알림은 나갔는데 주문은 롤백되는 _유령 알림_ 이다. 두 쓰기를 한 줄씩 늘어놓는 한 사이에는 틈이 있다. 이게 dual-write 문제다.

## 한 트랜잭션으로 묶지 못하나?

트랜잭션은 한 DB 안의 변경을 묶는다. 외부 HTTP는 그 바깥이라 포함되지 않는다. 원자성을 외부까지 늘리려면 분산 트랜잭션이 필요한데, 2PC는 두 가지로 막힌다.

-   coordinator가 죽으면 참여자가 락을 쥔 채 멈춘다(blocking).
-   외부 SaaS(Notifly·Mixpanel)는 2PC 프로토콜(XA)을 지원하지 않는다.

요즘 분산 환경은 강한 원자성 대신 최종 일관성으로 간다. Saga가 대표지만 이 문제의 답은 아니다. Saga는 여러 서비스 단계(주문 → 결제 → 재고)를 보상 트랜잭션으로 되돌리는 패턴이고, 알림은 "취소"로 보상할 게 아니라 안 잃고 한 번 보내면 되는 일이다. (Saga를 써도 각 단계 이벤트 발행 토대는 결국 outbox다.)

결론: 외부까지 묶으려 하지 말고, 문제를 DB 안에서 끝나는 일로 바꾼다.

## outbox: 보내는 대신 보낼 의도를 같이 커밋한다

외부로 보내는 대신, "보낼 것"이라는 사실을 주문과 같은 트랜잭션에 기록한다.

```
BEGIN;
  INSERT INTO orders (id, customer_id, amount) VALUES (...);
  INSERT INTO outbox_events (event_type, payload, status)
       VALUES ('order.created', '{...}', 'PENDING');
COMMIT;
```

같은 DB라 둘은 한 트랜잭션으로 묶인다. 같이 커밋되거나 같이 롤백된다. 주문만 저장되고 발행 의도가 사라지는 일은 구조적으로 불가능하다.

실제 코드도 이 두 INSERT를 같은 tx 하나로 받는다.

```go
// 주문과 outbox를 한 tx로 함께 쓴다 (에러 처리는 생략)
func insertOrderAndOutbox(ctx context.Context, tx *sql.Tx, customerID, amount string) (orderID, eventID string, err error) {
    tx.QueryRowContext(ctx,
        `INSERT INTO orders (customer_id, amount) VALUES ($1, $2) RETURNING id`,
        customerID, amount).Scan(&orderID)

    payload, _ := json.Marshal(map[string]string{"event_type": "order.created", "order_id": orderID})
    tx.QueryRowContext(ctx,
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
         VALUES ('order', $1, 'order.created', $2, 'PENDING') RETURNING id`,
        orderID, payload).Scan(&eventID)
    return
}
```

외부 HTTP는 이 트랜잭션에 넣지 않는다. 수 초짜리 외부 호출이 커넥션을 잡으면 풀이 마르고, 외부 지연이 우리 DB로 번진다. 발송은 트랜잭션 밖에서 따로 한다.

크래시 시나리오를 다시 그리면:

```
t0  BEGIN  orders + outbox_events(PENDING)  COMMIT ✅
t1  ── 크래시 ──
t2  재기동 후 worker가 PENDING을 발견해 전송
```

죽어도 PENDING 행이 남는다. 유실이 "아직 안 보낸 상태"로 바뀐다.

## outbox로 끝이 아니다

outbox는 at-least-once지 exactly-once가 아니다.

worker가 PENDING을 보내고 응답을 받기 직전에 죽으면, 이벤트는 외부에 도착했는데 우리는 모른다.

재기동 후 다시 보낸다 → 중복 발송.

보내는 쪽에서 막으면 되지 않나 싶지만, 보내는 쪽은 중복을 _줄일_ 뿐 없애지 못한다. "전송"과 "전송했음 기록(SENT)"이 또 다른 dual-write라, 그 사이에 죽으면 똑같이 중복이 난다. 보내는 쪽이 할 수 있는 건 (1) 같은 이벤트를 두 워커가 동시에 잡지 않게 하고, (2) 각 이벤트에 고정된 `event_id`를 붙여 `Idempotency-Key` 헤더로 보내는 것까지다. 그 키로 최종 중복을 거르는 건 받는 쪽이다.

**at-least-once 전송 + 받는 쪽 dedup = exactly-once 효과** — 멱등은 뒤에서 따로 다룬다.

그리고 t2의 worker가 아직 없다. 지금 만든 건 발행 의도를 안전하게 쌓는 통까지다.

## 정리

|   | 내용 |
| --- | --- |
| outbox가 한 일 | 보내기를 "보낼 의도 남기기"로 바꿔 잃을 틈을 트랜잭션 안에 넣음 |
| 얻은 것 | 크래시에도 의도 보존 → 복구 가능 |
| 댓가 | 즉시성. 발송은 worker가 집어갈 때까지 지연. 동기 응답이 필요한 곳엔 부적합 |
| 안 푼 것 | 중복(at-least-once) → 멱등 필요. 발송 주체(worker) 없음 |

**outbox는 "보냈다"가 아니라 "보내기로 한 걸 잊지 않는다"를 보장한다.**

그 의도를 실제 발송으로 바꾸는 worker는 다음 글에서 만든다.
