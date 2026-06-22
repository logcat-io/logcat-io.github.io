---
title: "[PROJECT] 안 보이면 못 고친다 — 관측과 한 명령 재현"
description: 0편의 시작이 "발행 잘 되고 있나요? → 로그를 봐야 알아요"였다. 신뢰성을 다 만들어도 보이지 않으면 그 질문에 또 답을 못 한다.
pubDate: '2026-06-11T18:24:36+09:00'
dateSource: html-visible
slug: post-123
tags:
  - 모니터링
  - prometheus
  - golang
  - Observability
  - outbox
  - pattern
category: Project/Reliable webhook dispatcher
cover: /images/posts/post-123/ci-pass.png
draft: false
legacy:
  tistoryId: '123'
  sourceHtml: '123/123-[6편]-안-보이면-못-고친다-—-관측과-한-명령-재현.html'
  sourceHash: 'sha256:22d895dd1ed274bdd68923b10fbfe4c6b3253d5dcca9392f5e6bf6113d8a7e12'
---

0편의 시작이 "발행 잘 되고 있나요? → 로그를 봐야 알아요"였다. 신뢰성을 다 만들어도 _보이지 않으면_ 그 질문에 또 답을 못 한다.

이번 편은 관측이다.

## 무엇을 보면 상태를 아나

전송 시스템의 건강은 몇 개 숫자로 드러난다.

| 신호 | 의미 |
| --- | --- |
| pending 수 | worker가 못 따라가면 쌓인다 |
| processing 수 | 오래 높으면 stuck 또는 느린 전송 |
| failed 수 | 받는 쪽 장애 또는 payload 문제 |
| 결과 비율(2xx/4xx/5xx) | 어디서 깨지는지 |
| 전송 소요 시간 | 외부 지연 |

이걸 Prometheus 메트릭으로 노출한다.

```
webhook_outbox_backlog{status="pending"}        gauge
webhook_delivery_attempts_total{result="5xx"}   counter
webhook_delivery_duration_seconds               histogram
```

상태별 적체는 gauge, 시도는 counter, 소요는 histogram. `GET /metrics`로 긁어간다. 그리고 label에 고유값을 넣지 않는다. 메트릭에 `event_id`나 `claim_token`을 label로 붙이고 싶어진다. 넣으면 안 된다. label 조합마다 시계열이 하나씩 생기는데, 고유값을 넣으면 시계열이 무한히 늘어 메트릭 저장소가 터진다(cardinality 폭발).

label은 `status`, `result`처럼 값이 몇 개로 한정된 것만. 개별 이벤트를 추적하고 싶으면 그건 메트릭이 아니라 로그의 일이다.

## 로그는 구조화 + request\_id

`println`으로 문장을 흘리면 0편의 "로그를 다 봐야" 상태로 돌아간다. JSON으로 찍고, 요청마다 `request_id`를 붙인다.

```
{"level":"info","request_id":"a1b2","method":"POST","path":"/orders","status":201,"dur_ms":12}
```

이 한 줄은 미들웨어가 찍는다. 요청마다 id를 만들어 context에 싣고, 응답 헤더에도 같은 값을 박는다.

```go
func RequestLogger(logger *slog.Logger, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := newRequestID()
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        w.Header().Set("X-Request-ID", id) // 응답에도 실어 클라이언트가 같은 키로 추적

        sw := &statusWriter{ResponseWriter: w, status: 200}
        start := time.Now()
        next.ServeHTTP(sw, r.WithContext(ctx))

        logger.Info("http", "request_id", id, "method", r.Method,
            "path", r.URL.Path, "status", sw.status, "dur_ms", time.Since(start).Milliseconds())
    })
}
```

이러면 한 요청이 핸들러부터 worker까지 어디를 지났는지 키 하나로 따라간다. 메트릭이 "어디가 아픈지"를 보여주면, 로그는 "그 한 건이 무슨 일을 겪었는지"를 보여준다. 둘은 역할이 다르다.

## 한 명령으로 재현한다

남이(또는 미래의 내가) 이걸 돌려보려면 절차가 짧아야 한다. Docker Compose 하나로 전부 띄운다.

```go
docker compose up

	→ postgres → migrate → app → prometheus
```

주문을 하나 넣고, `/metrics`에서 숫자가 오르는 걸 보고, Prometheus UI에서 그래프를 본다. 푸시할 때마다 GitHub Actions가 `go test -race`와 통합 테스트를 돌려, 깨진 채로 합쳐지는 걸 막는다.

![](/images/posts/post-123/ci-pass.png)

`unit`은 빌드·`gofmt`·`vet`·`-race` 테스트를, `integration`은 PostgreSQL service를 띄워 통합 테스트를 돌린다. 둘 다 초록이어야 머지된다 — 신뢰성을 사람이 매번 확인하지 않고 파이프라인이 대신 지킨다.

## 회고 — 0편으로 돌아오기

|   |   |
| --- | --- |
| 메트릭 | pending·processing·failed·결과·지연을 숫자로 |
| 로그 | 구조화 + `request_id`로 한 건 추적 |
| 재현 | compose 한 명령 + CI |

0편에서 "발행 잘 되나요?"에 "로그를 봐야 안다"가 답이었다. 이제 대시보드에서 pending이 떨어지는 걸 보고, failed가 튀면 알림이 오고, 한 건이 궁금하면 `request_id`로 따라간다. 같은 질문에 이제 _데이터__로_ 답한다. 신뢰성의 뼈대 — outbox·worker·재시도·동시성·복구·멱등·관측 — 가 여기서 한 바퀴 돌았다.

남은 건 이 신뢰성이 _진짜인지_ 테스트로 증명하는 것이다. 동시성 중복 0과 처리량 측정은 다음 글에서.
