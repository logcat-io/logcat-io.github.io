---
title: "[SPRING] 커넥션 풀은 언제 늘려야 하나 — thread·connection·DB를 사슬로 보기"
description: >-
  면접에서 pool 질문에 "thread는 메모리 먹고, 부족하면 대기나 타임아웃" 이상을 답하지 못했다.
  Tomcat thread pool·Hikari connection pool·DB를 사슬로 놓고, 두 병목을 lab에서 직접 재현해
  metric으로 구분한 기록.
pubDate: '2026-07-02T15:30:00+09:00'
dateSource: manual
slug: pool-sizing-resource-chain
tags:
  - Spring
  - Tomcat
  - HikariCP
  - ConnectionPool
  - ThreadPool
category: Spring Framework/Spring & Spring Boot
draft: false
---

실무에서 thread pool이나 connection pool을 직접 만져볼 일이 없었다. 기본값으로 잘 돌았고, 고민할
상황 자체가 없었다. 그러다 면접에서 pool 질문을 받았고, 내 답은 "thread는 메모리를 잡아먹고,
부족하면 기다리거나 타임아웃이 난다"에서 멈췄다. 아무리 생각해도 그 다음의 내용은 정리가 되지 않았고, 대답할 수 있는 전부였다 — 언제
늘려야 하는지, 뭘 보고 판단하는지는 한 번도 생각해본 적이 없었다.

이 글은 그 구멍을 메우기 위한 기록이다. 개념을 잡고, 로컬에 lab을 만들어 thread 병목과 connection
병목을 직접 metric으로 재현했다. DB 상한(`max_connections`) 쪽은 메커니즘까지 다루어 본다.

## "느리면 늘리면 되죠"가 왜 나쁜 답인가

이 답이 나쁜 건 틀려서가 아니라, **어디가 느린지 안 보고 늘리기 때문이다.** pool을 늘려서 풀리는
느림도 있고, 늘리면 오히려 악화되는 느림도 있다. 그 둘을 구분 안 한 답이라 위험하다.

느림에는 최소 두 종류가 있다.

하나는 **요청을 처리할 일꾼(thread)이 부족한 경우**다. Tomcat은 HTTP 요청 하나를 worker thread
하나에 배정한다. 그 요청이 끝날 때까지 그 thread는 다른 요청을 못 받는다. `Thread.sleep`, 느린
쿼리, 외부 API 호출처럼 thread가 오래 묶이는 작업이 많으면 thread가 동난다. 이땐 connection을
아무리 늘려도 소용없다. 요청을 받을 일꾼 자체가 없으니까.

다른 하나는 **DB로 들어가는 통로(connection)가 부족한 경우**다. thread는 요청을 받았는데, 정작
DB를 쓰려고 connection을 빌리려니 남는 게 없어서 줄을 선다. 이땐 thread를 늘리는 게 오히려 독이다.
더 많은 요청이 DB 앞에 줄만 길게 서서 대기가 쌓인다.

증상은 둘 다 "느림"으로 똑같아 보인다. 원인과 처방은 정반대다.

## 직접 재현해본 것 — thread 병목

개념만으론 부족해서 로컬에 lab을 만들었다. Spring Boot에 `tomcat.threads.max=8`,
`hikari.maximum-pool-size=2`로 일부러 작게 잡고, **DB를 전혀 쓰지 않는** sleep endpoint 하나를 뒀다.

```kotlin
@GetMapping("/thread-sleep")
fun threadSleep(
    @RequestParam(defaultValue = "3000") millis: Long,
): Map<String, Any> {
    Thread.sleep(millis)   // DB 없이 worker thread만 점유한다
    return mapOf("thread" to Thread.currentThread().name)
}
```

여기에 동시 12로 부하를 넣었다(k6, VU 12). max(8)보다 살짝 크게 줘서 8개는 처리되고 나머지는
큐에서 대기하도록. 결과가 이거다.

<img src="/images/posts/pool-sizing-resource-chain/tomcat-threads-busy.png"
  alt="tomcat_threads_busy_threads가 8에 붙었다가 부하 종료 시 떨어지는 그래프"
  style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#1d1d1d;margin:32px auto;border-radius:8px;" loading="lazy" />

`tomcat_threads_busy_threads`가 **8에 붙어 유지되다가**, 부하가 끝나자 뚝 떨어진다. worker thread
8개가 전부 `Thread.sleep`에 묶여 있는 것이다. 같은 시간 `hikaricp_connections_active`는 **0**이었다 —
DB를 안 쓰니 connection은 하나도 안 움직인다.

이 그림이 앞 절의 "두 병목은 다르다"를 눈으로 보여준다. thread는 꽉 찼는데 connection은 놀고 있으니,
여기서 connection pool을 늘리는 건 아무 의미가 없다. busy thread만 보고 "느리다 → pool 늘리자"고
했으면 엉뚱한 데를 건드린 셈이다.

추가로 하나 더 배웠다. `tomcat.threads.*` metric은 `server.tomcat.mbeanregistry.enabled=true`를 켜야
나온다. 기본이 꺼져 있어서, 모르고 `tomcat.threads.busy`를 조회하면 값이 안 잡혀 한참 헤맸다.

## 직접 재현해본 것 — connection 병목

이번엔 정반대다. `@Transactional` 안에서 쿼리를 한 번 날려 connection을 잡고, 그 상태로 sleep 하는
endpoint를 뒀다.

```kotlin
@Transactional
fun holdConnection(millis: Long): String {
    entityManager.createNativeQuery("select 1").singleResult
    Thread.sleep(millis)   // connection을 잡은 채로 붙잡는다
    return Thread.currentThread().name
}
```

같은 lab에 VU 15로 부하를 넣었다. connection max(2)보다 훨씬 크게.

`hikaricp_connections_active`는 **2(max)에 붙는다** — connection 2개가 전부 물려 있다.

<img src="/images/posts/pool-sizing-resource-chain/connection-active.png"
  alt="hikaricp_connections_active가 2에 붙은 그래프"
  style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#1d1d1d;margin:32px auto;border-radius:8px;" loading="lazy" />

`hikaricp_connections_pending`은 **5로 차 있다** — connection을 못 얻어 대기하는 thread가 5개다.

<img src="/images/posts/pool-sizing-resource-chain/connection-pending.png"
  alt="hikaricp_connections_pending이 5인 그래프"
  style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#1d1d1d;margin:32px auto;border-radius:8px;" loading="lazy" />

그리고 `hikaricp_connections_timeout_total`은 부하를 도는 동안 **745까지** 쌓였다. 2초
(connection-timeout) 안에 connection을 못 얻어 실패한 획득 시도가 그만큼 누적된 것이다.
사용자에겐 이게 에러로 보인다.

<img src="/images/posts/pool-sizing-resource-chain/connection-timeout.png"
  alt="hikaricp_connections_timeout_total이 745인 그래프"
  style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#1d1d1d;margin:32px auto;border-radius:8px;" loading="lazy" />

그런데 이때도 `tomcat_threads_busy_threads`는 **8**이었다. 여기가 핵심이다 — **thread 8개가 전부
바쁜데, 실제 DB 작업은 2개뿐이고 5개는 connection을 기다리며 묶여 있다.** (2+5에서 빠진 1개는 이
지표를 긁으러 온 Prometheus 요청 몫이다.) 이 상황에서 thread를 늘리면 pending 줄만 더 길어져
timeout이 늘 뿐이다. connection 2개가 병목인데 thread를 건드리는 건 헛수고다.

두 재현을 나란히 두면 병목 구분이 지표로 딱 떨어진다.

| 부하 | busy | active | pending | timeout | 병목 |
|---|---|---|---|---|---|
| thread-sleep | 8 | 0 | 0 | 0 | thread |
| connection-hold | 8 | 2 | 5 | 745 | connection |

**둘 다 busy가 8이다.** 응답 지연만 보면 똑같아 보이지만, `active`와 `pending`이 병목을 갈라준다.
active 0이면 thread 문제, active가 max에 붙고 pending이 솟으면 connection 문제다.

## 자원은 사슬이다

여기까지는 "두 병목이 다르다"는 이야기다. 한 걸음 더 가면, 이 자원들이 **순서대로 연결된 사슬**
이라는 게 보인다.

```text
[요청]
  → [Tomcat thread pool]      최대 threads.max 개
  → [Hikari connection pool]  최대 maximum-pool-size 개
  → [DB max_connections]      DB가 받는 총 연결 수
                              (모든 인스턴스 합산)
```

요청은 이 세 관문을 순서대로 통과한다. 그리고 사슬은 **가장 좁은 관문이 전체 처리량을 결정한다.**
넓은 관문을 더 넓혀도 좁은 관문이 그대로면 처리량은 안 늘어난다. "어디가 제일 좁은가"를 먼저 찾는
게 pool sizing의 시작이라고 생각한다.

그렇기 때문에 "pool size 언제 조정하나요"가 어려운 이유가 여기 있다. **하나의 값을 정하는 문제가 아니라, 세
관문의 상대적 크기를 맞추는 문제**이기 때문이다.

## thread와 connection의 크기 관계

thread 8개, connection 2개 — 위 재현이 정확히 이 조합이다. thread가 connection보다 훨씬 많으면
DB를 쓰는 요청은 connection 수만큼만 통과하고, 나머지는 connection을 기다리며 줄을 선다. 위 표의
pending 5가 그 줄이다. connection이 병목이다. 이 상태에서 thread를 16개로 늘리면? 요청을 더
받아들여서 대기 줄만 더 길어진다. latency와 timeout이 오히려 나빠진다.

반대로 thread 4개, connection 20개라면 어떨까.

connection은 20개나 놀고 있는데 요청을 받을 thread가 4개뿐이다. thread가 병목이다. connection을
늘려도 요청 자체가 안 들어온다. 남는 connection은 DB에 놀고 있는 연결을 유지하는 비용만 낸다.

그래서 기본 기준은 `threads.max ≥ maximum-pool-size` 다. 모든 connection을 부릴 만큼의 thread는
있어야 하니까. 이 부등식은 공식 문서에 나오는 규칙이 아니라 사슬 관점에서 정리한 기준인데, 방향은
HikariCP 위키 [About Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing)의
권고와 같다. "You want a small pool, saturated with threads waiting for connections" — pool은 작게
두고, thread들은 그 앞에서 connection을 기다리게 하라는 뜻이다. thread가 connection보다 많은 게
정상 형태다.
다만 이건 출발점이지 정답 비율은 아니다. 실제 비율은 전체 요청 중 DB를 쓰는 비율, 쿼리가 걸리는
시간에 달려 있다. 그래서 측정이 필요하다.

## app pool과 DB max_connections의 관계

여기서 놓치기 쉬운 함정이 하나 있다. **connection pool 상한은 app 쪽 설정이고, DB에도 별도 상한이
있다는 것.** MySQL이면 `max_connections`다. 그리고 app 인스턴스가 여러 대면 그 합이 DB를 친다.

app 인스턴스 3대, 각각 pool 20으로 잡으면 최대 60개의 연결을 DB에 요청한다. DB `max_connections`
가 50이면? 51번째 연결부터 DB가 거절한다. MySQL이면 `Too many connections` 에러가 뜨고, app은
connection을 못 얻어 요청이 실패한다.

실무에서 인스턴스를 스케일 아웃할 때 고려해야 할 지점이 바로 여기라고 생각한다. **로컬에서 단일
인스턴스로 pool 20을 돌릴 땐 멀쩡하다.** DB max가
151(MySQL 기본값)이면 20개는 여유롭다. 그런데 운영에서 오토스케일로 인스턴스가 8대까지 뜨면
8 × 20 = 160으로 DB 상한을 넘는다. 단일 인스턴스만 보고 정한 pool size가 인스턴스 수 앞에서
무너진다.

실패의 성격도 앞의 두 관문과 다르다. thread가 부족하면 accept 큐에서 기다리고, connection이
부족하면 pending으로 기다린다 — 둘 다 "줄을 서는" 문제다. 그런데 DB `max_connections` 초과는 줄
자체가 없다. 신규 연결 시도가 즉시 거절된다. 병목이 아니라 문전박대다.

더 고약한 건 이게 부분 장애로 나타난다는 점이다. 이미 열려 있는 connection은 멀쩡히 동작하고,
거절당하는 건 신규 연결뿐이다. 그래서 먼저 떠 있던 인스턴스는 정상인데 새로 뜬 인스턴스만
connection을 못 얻는다. 시간이 지나면 기존 인스턴스도 connection 교체 시점(Hikari `maxLifetime`
순환)에 거절당해 장애가 서서히 번진다. 전면 장애가 아니라 "일부 요청만 이상하다"로 보이니, 그만큼
원인 잡기가 어렵다.

반대로 app 총 연결이 DB max보다 한참 작으면(예: 총 30, DB max 200) DB 쪽은 안전하다. 이게 정상
목표 상태다. 단, "DB에 여유가 있다"와 "app이 충분하다"는 다른 축이다. DB가 200을 받을 수 있어도
app pool이 워크로드 대비 작으면 여전히 app 쪽에서 connection 병목이 난다. DB 여유는 "pool을 늘릴
여지가 있다"는 뜻일 뿐, pool을 자동으로 키워주지 않는다.

## 결국 부등식 두 개

세 관문을 사슬로 보면 감을 잡는 뼈대는 부등식 두 개로 압축된다.

```text
threads.max ≥ hikari maximum-pool-size
  (thread가 connection을 다 부릴 수 있게)

Σ(인스턴스 수 × pool max) ≤ DB max_connections
  (app 총 연결이 DB를 안 넘게 — 여유를 두고)
```

첫 번째를 어기면 connection이 놀고, 두 번째를 어기면 DB가 연결을 거절한다. 단, 첫 번째 부등식은
web 요청이 connection을 쓰는 구조 기준이다. 스케줄러나 `@Async`처럼 Tomcat thread 밖에서
connection을 쓰는 작업이 있으면 그 몫은 따로 계산해야 한다.

다만 이건 **정답이 아니라 출발점**이다. 같은 위키에 실린 경험식
`connections = (core_count × 2) + effective_spindle_count` 도 마찬가지다. 이 공식조차 HikariCP가
만든 게 아니라 PostgreSQL 프로젝트가 시작점으로 제시한 걸 가져온 것이라고 문서 스스로 밝힌다.
워크로드마다 DB를 쓰는 비율이 다르고, 쿼리 시간이 다르고, DB 성능이 다르다. 그래서 부등식으로
범위를 좁힌 뒤엔 부하 테스트로 확인하는 수밖에 없다.

## 사슬의 끝 — connection을 늘려도 안 풀릴 때

한 가지 더. connection은 "DB로 들어가는 문"이다. 문을 넓혀도(pool 확대) DB 안이 좁으면 소용없다.

connection 병목이라고 pool을 늘렸는데 더 느려지는 경우가 있다. slow query, lock contention, DB CPU
포화가 원인이면, connection을 늘리는 건 더 많은 요청이 동시에 병든 DB를 두드리게 만드는 것뿐이다.
이럴 땐 pool을 늘리는 게 아니라 쿼리를 빠르게 하거나 트랜잭션을 짧게 해서 connection 회전율을
높이는 게 답이다. `@Transactional` 범위가 넓으면 connection을 오래 잡고 있어서 pool이 빨리 마르는데,
범위를 줄이는 것만으로 풀릴 수도 있다.

그래서 pool을 늘리기 전에 항상 DB 상태(CPU / slow query / lock wait)를 같이 봐야 한다. connection 병목의
처방이 언제나 "pool 늘리기"인 게 아니다.

## 그래서 답은

처음의 면접 질문으로 돌아오면, 좋은 답은 이렇게 바뀐다. "트래픽 늘면 늘립니다"가 아니라:

지표부터 나눈다. busy thread가 max에 붙으면 thread 병목, Hikari active가 max에 붙고 pending이 늘면
connection 병목이다. connection 병목이면 DB가 감당 가능한지(CPU/slow query/lock, 그리고 인스턴스
수 × pool이 DB max를 넘지 않는지) 확인하고, 작은 폭으로 올린 뒤 부하 테스트와 롤백 기준을 둔다.
반대로 DB를 안 쓰는 요청에서도 busy thread가 꽉 차면 connection 문제가 아니라 thread나 blocking
작업 문제로 본다.

"설정값"이 아니라 "판단 절차"가 답이라는 걸, 개념을 파고 나서야 알았다.

## 남겨둔 것

- thread와 connection 병목은 재현했지만, DB `max_connections` 초과(`Too many connections`)는
  메커니즘 서술까지만 하고 직접 재현은 숙제로 남겼다. 로컬에서 DB `max_connections`를 pool보다
  낮추면 거절의 순간을 볼 수 있다. 이 글의 DB 관련 시나리오 숫자(3대×20 vs 50 등)는 개념 예시지
  측정값이 아니다.
- 처음엔 "pool은 크게 잡을수록 안전하다"고 막연히 생각했다. 사슬로 보고 나니 정반대였다. 크게 잡으면
  DB를 치고, thread와 안 맞으면 놀고, DB 안이 좁으면 오히려 독이 된다.
- 인스턴스 수 × pool을 DB max와 같이 보는 습관이 제일 약했다. 단일 인스턴스 기준으로만 생각하고
  있었다. 오토스케일 환경이면 이게 사고의 첫 원인이 될 수 있다.
- 같은 문제를 다르게 정리한 분이 있으면 듣고 싶다. 특히 실측 기준으로 pool 비율을 잡아본 경험이 있다면.
