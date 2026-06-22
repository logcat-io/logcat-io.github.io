---
title: "[PROJECT] 신뢰성을 증명하다 — 동시성 테스트와 benchmark"
description: >-
  6편까지 뼈대를 다 세웠다. outbox로 안 잃고, SKIP LOCKED로 안 겹치고, recovery로 복구하고, 멱등으로 중복을
  흡수한다. 그런데 여기까지는 전부 주장 이다.
pubDate: '2026-06-11T18:24:43+09:00'
dateSource: html-visible
slug: benchmark-124
tags:
  - golang
  - outbox
  - pattern
  - idempotency
category: Project/Reliable webhook dispatcher
cover: /images/posts/benchmark-124/grafana-backlog-load.png
draft: false
legacy:
  tistoryId: '124'
  sourceHtml: '124/124-[7편]-신뢰성을-증명하다-—-동시성-테스트와-benchmark.html'
  sourceHash: 'sha256:8d643c9c2bd62a2cdabfb66346f2b417e861d976f97477ed2f9de341dbed1df8'
---

6편까지 뼈대를 다 세웠다. outbox로 안 잃고, SKIP LOCKED로 안 겹치고, recovery로 복구하고, 멱등으로 중복을 흡수한다. 그런데 여기까지는 전부 _주장_ 이다.

"안 겹친다"를 어떻게 증명하나.

## 증명할 수 있는 것과 없는 것을 가른다

먼저 선을 긋는다.

| 종류 | 예 | 증명 |
| --- | --- | --- |
| 구조적 사실 | 동시성에서 중복 claim 0 | 테스트로 **단언 가능** |
| 환경 의존 수치 | 초당 처리량 | 측정만, 절대치 단언 X |

"중복 claim 0"은 SKIP LOCKED의 구조에서 나오는 사실이라 재현하면 증명된다. "초당 N건"은 머신·PG 버전·데이터 양에 따라 달라지니 "측정했다"까지가 정직한 선이다. 둘을 같은 무게로 말하면 안 된다.

## 중복 0은 mock으로 증명 못 한다

3편에서 SKIP LOCKED는 PostgreSQL의 행위라고 했다. 그러니 mock DB로는 검증이 안 된다. 진짜 PostgreSQL을 띄우고, 진짜 worker를 동시에 돌려야 한다.

테스트는 단순하다. PENDING 50개를 깔고, worker 5개가 동시에 `ClaimPending`을 반복하게 한 뒤, 같은 이벤트가 두 번 잡혔는지 센다.

```
var mu sync.Mutex
claimed := map[string]bool{}
dup := 0

// worker 5개 동시
for w := 0; w < 5; w++ {
    go func() {
        for {
            evs, _ := ob.ClaimPending(ctx, 10)
            if len(evs) == 0 { return }
            mu.Lock()
            for _, e := range evs {
                if claimed[e.ID] { dup++ } // 이미 누가 잡았다 = 중복
                claimed[e.ID] = true
            }
            mu.Unlock()
        }
    }()
}
// ...
if dup != 0 { t.Fatalf("중복 claim %d건", dup) }
```

`dup`이 0이면 5개 worker가 50개를 나눠 가지면서 한 번도 안 겹쳤다는 뜻이다. 이게 "동시 안전"의 증거다. `-race`까지 붙여 데이터 레이스도 같이 본다.

## 통합 테스트는 켤 수 있게 둔다

DB가 필요한 테스트를 항상 돌리면, DB 없는 환경에서 `go test`가 깨진다. 그래서 환경변수로 켠다.

```
if os.Getenv("RUN_DB_TESTS") != "1" {
    t.Skip("set RUN_DB_TESTS=1 to run PostgreSQL integration tests")
}
url := os.Getenv("TEST_DATABASE_URL")
```

이러면 `go test ./...`는 어디서나 돌고(통합은 skip), DB 검증은 변수를 줄 때만 켜진다. CI에선 PostgreSQL 서비스를 띄우고 변수를 넣어 통합까지 돌린다.

## benchmark — 수치를 단언하지 않는다

처리량은 측정 하니스까지만 만든다.

```
func BenchmarkClaimPending(b *testing.B) {
    for i := 0; i < b.N; i++ {
        if _, err := ob.ClaimPending(ctx, 10); err != nil {
            b.Fatal(err)
        }
    }
}
```

`go test -bench`로 돌리면 숫자가 나온다. 그런데 그 숫자는 내 노트북 기준이다. 그래서 결과를 적을 때 환경을 같이 박는다.

```
| 측정 | 환경 | 값 |
| ClaimPending 처리량 | (머신/PG 버전 명시) | (측정값) |
| 동시성 중복 claim | 5 worker × 50 events | 0 |
```

처리량은 "이 환경에서 이만큼"이고, 중복 0은 환경과 무관한 구조적 사실이다. 표에서도 둘의 무게가 다르다.

## 가정을 전부 통과했다

이 시리즈를 시작할 때 건 가정은 셋이었다 — 유실 0, 중복 0, 장애에도 수렴. 통합 테스트로 구조를, 부하·스트레스 테스트로 실제 동작을 측정했다.

| 가정 | 검증 | 결과 |
| --- | --- | --- |
| 유실 0 | 정상 300 / 5xx 50 / 4xx 20건 부하 | 던진 주문이 전부 최종 수렴 — 한 건도 잃지 않음 |
| 중복 0 | 동시성 통합 테스트 + 정상 부하 | N워커 동시 claim 중복 0, 받은 쪽 distinct == 던진 수 |
| 장애 복구 | 5xx / 4xx 주입 | 5xx는 자동 재시도로 수렴, 4xx는 dead-letter → replay로 복구 |

`go test -race`는 데이터 레이스 0으로 통과했다. 5xx 50건을 던졌을 때 그 50건은 사라지는 대신 `PENDING`으로 남았다가, 외부가 정상으로 돌아오자 손대지 않아도 전부 나갔다. 0편의 "외부가 죽으면 유실됐다"가 여기서 정확히 뒤집힌다.

![](/images/posts/benchmark-124/grafana-backlog-load.png)

부하를 버스트로 넣으면 Outbox Backlog(pending)가 솟았다가 worker가 소비하며 0으로 빠지는 톱니가 그려진다. 같은 시각 상태 전이율의 `sent`가 올라가고, `failed`는 0에 머문다 — 들어온 만큼 잃지 않고 전부 처리됐다는 뜻이다. 0편에서 "발행 잘 되나요?"에 "로그를 봐야 알아요"였던 질문이, 이제 이 한 장으로 답해진다.

## 회고 — 증명할 수 있는 것만 증명한다

신뢰성은 "잘 만들었다"는 말이 아니라, _무엇을 보장하고 무엇은 못 하는지_ 선을 긋는 일이다.

-   단언하는 것: 동시성 중복 claim 0, 크래시 후 유실 0(outbox), 재시도 상한(FAILED 격리)
-   단언하지 않는 것: 처리량 절대치, exactly-once delivery(at-least-once + 멱등으로 근사할 뿐)

이게 다 옳은 설계라는 뜻은 아니다. lease timeout도 backoff도 worker 수도 전부 환경이 정하는 값이고, 여기선 학습 기본값을 썼다. 다만 그 값들을 _어디서 봐야 하는지_는 이제 안다.

## 한 바퀴 돌아서

0편은 "이 알림 발행 잘 되고 있나요?"라는 질문에서 시작했다. 답이 "로그를 봐야 알아요"였고, 그게 불편해서 만든 게 이 시스템이다.

일곱 편을 지나 같은 질문에 이렇게 답한다. 안 잃고(outbox), 안 겹치고(SKIP LOCKED + claim\_token), 죽어도 복구하고(recovery), 두 번 와도 한 번 처리하고(멱등), 무슨 일이 있었는지 메트릭과 로그로 보고, 그게 진짜인지 테스트로 증명한다. "로그를 봐야 안다"가 "데이터로 답한다"가 됐다.

이번 시리즈는 여기서 마무리한다.

읽어주신 분 모두 감사합니다.
