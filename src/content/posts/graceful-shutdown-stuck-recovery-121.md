---
title: 워커가 죽으면 — graceful shutdown과 stuck recovery
description: 3편의 숙제가 끝난 여기서 고려해야 할 점이 있다. 바로 worker가 PROCESSING으로 잡아둔 채 죽으면 그 이벤트는 누가 푸는지다.
pubDate: '2026-06-11T18:24:24+09:00'
dateSource: html-visible
slug: graceful-shutdown-stuck-recovery-121
tags:
  - Graceful
  - shutdown
  - golang
  - sigterm
  - outbox
  - pattern
  - lease
  - time
category: Project/Reliable webhook dispatcher
draft: false
legacy:
  tistoryId: '121'
  sourceHtml: 121/121.html
  sourceHash: 'sha256:3d02b859fa73f29dbd93aa86006ceaaf78d6c3539a7d1447d9f2d69ba9d2ac65'
---

3편 끝의 숙제.

3편의 숙제가 끝난 여기서 고려해야 할 점이 있다. 바로 worker가 PROCESSING으로 잡아둔 채 죽으면 그 이벤트는 누가 푸는지다.

### 두 가지 죽음

worker가 멈추는 방식은 둘이다.

-   **예고된 종료**: 배포, 스케일 다운. SIGTERM이 온다.
-   **갑작스런 죽음**: OOM kill, 패닉, 전원 차단. 예고가 없다.

둘을 다르게 다룬다.

### 예고된 종료 — graceful shutdown

SIGTERM이 오면 즉시 멈추지 않는다. 잡고 있던 이벤트는 마무리하고, 새로 집는 것만 멈춘다.

```
SIGTERM 수신
 → context cancel (새 claim 중단)
 → 진행 중 전송은 끝까지
 → 다 빠지면 종료
```

Go에서는 `signal.NotifyContext`로 신호를 받아 context를 끊고, `WaitGroup`으로 진행 중인 worker가 다 빠질 때까지 기다린다. 이러면 배포할 때마다 멀쩡히 보내던 이벤트가 중간에 잘리지 않는다.

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); dispatcher.Run(ctx) }() // ctx가 끊기면 새 claim 중단

<-ctx.Done()              // SIGTERM 대기
srv.Shutdown(shutdownCtx) // HTTP는 받던 요청까지 끝내고 닫는다
wg.Wait()                 // 진행 중 전송이 다 빠질 때까지 기다린다
```

### 갑작스런 죽음 — recovery가 받는다

SIGKILL이나 크래시는 마무리할 틈을 안 준다. PROCESSING인 채로 이벤트가 남는다. graceful로는 못 막는다.

그래서 별도 장치가 청소한다. PROCESSING인데 오래 멈춰 있는 이벤트를 주기적으로 찾아 PENDING으로 되돌린다.

```
UPDATE outbox_events
   SET status='PENDING', claim_token=NULL
 WHERE status='PROCESSING'
   AND processing_started_at < now() - interval '5 minutes';
```

`processing_started_at`이 임계(lease timeout)를 넘으면 "이 worker는 죽었다"로 보고 회수한다. `claim_token`을 NULL로 비우는 게 핵심이다 — 3편의 fencing이 여기서 작동한다. 회수된 뒤 원래 worker가 살아 돌아와도, 토큰이 안 맞아 아무것도 못 쓴다.

### lease timeout을 얼마로

너무 짧으면 멀쩡히 처리 중인 worker를 죽은 걸로 오해해 회수한다(같은 이벤트가 둘에게 간다). 너무 길면 진짜 죽은 이벤트가 오래 묶여 있다. 전송 타임아웃보다 넉넉히 길게 잡는다. 정답은 환경마다 다르고, 여기선 학습 기본값으로 둔다. 전송 타임아웃의 2~3배를 기준으로 시작해보면 어떨까 생각한다.

### 회고

|   |   |
| --- | --- |
| graceful shutdown | 예고된 종료에서 진행 중 전송을 안 끊음 |
| recovery | 크래시로 PROCESSING에 갇힌 이벤트를 PENDING으로 회수 |
| fencing과 짝 | 회수가 `claim_token`을 비워, 돌아온 좀비 worker를 무력화 |

여기까지 오면 안 잃고(outbox), 동시 안전하게(SKIP LOCKED), 죽어도 복구하며(recovery) 보낸다. 그런데 재시도와 복구는 같은 이벤트를 두 번 보낼 수 있다.

중복을 어떻게 다루나는 다음 글에서.
