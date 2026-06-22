---
title: "[REDIS] Redis 1차 필터 + Optimistic Lock + UPSERT로 Oversell 0건 만든 타임딜 재고 차감 시스템 (Kotlin/Spring/PostgreSQL)"
description: 이 글의 목표는 DB를 보호하면서 타임딜 재고 오버셀과 이중 결제·중복 쿠폰 같은 사고를 막는 3중 방어선을 설계·검증하는 것이다.
pubDate: '2026-04-30T17:02:34+09:00'
dateSource: html-visible
slug: redis-1-optimistic-lock-upsert-oversell-0-kotlin-110
tags:
  - 동시성
  - 동시성제어
  - 분산락
  - upsert
  - 멱등성
  - Optimistic
  - Lock
  - 재고차감
  - lua
category: Infra/Redis
cover: /images/posts/redis-1-optimistic-lock-upsert-oversell-0-kotlin-110/img.png
draft: false
legacy:
  tistoryId: '110'
  sourceHtml: 110/110.html
  sourceHash: 'sha256:3b7723215a195a02db69c32fdb097df1cc05a0f8f8eb6af252ebad87e7dda2b8'
---

> ?  
> 먼저, 이 글은 실제로 운영 중인 특정 서비스를 그대로 옮긴 설계가 아니라, 학습과 설계 연습을 위한 글입니다. 예전에 참여했던 서비스 중 하나가 “락, 동시성 제어가 필요하니까 Redis를 쓰자”라는 전제 아래 이미 구현되어 있었습니다. 저는 그 구조 위에서 기능을 추가하고 운영을 함녀서, Redis 기반 락과 동시성 제어가 오히려 예상치 못한 문제를 일으키는 상황을 몇 번 경험했습니다. 그 경험을 바탕으로, “같은 문제를 다시 만난다면 어떤 가정 위에서 DB를 보호하는 설계를 할 수 있을까?”를 정리해 보고자 이 글을 쓰게 되었습니다.  
>   
> 그래서 이 글은 “굳이 Redis를 써야 한다”는 주장을 하려는 것이 아니라, Redis를 1차 필터로 두고 DB를 보호하는 식으로도 타임딜 재고 차감 문제를 설계해 볼 수 있고, 그 결과가 동시성과 정합성 측면에서 어느 정도까지 안전한지 실험해 본 기록에 가깝습니다.

이 글의 목표는 DB를 보호하면서 타임딜 재고 오버셀과 이중 결제·중복 쿠폰 같은 사고를 막는 3중 방어선을 설계·검증하는 것이다.  
  
단일 Redis + 단일 DB 환경에서, Redis를 락 서버가 아니라 1차 필터로 사용하고, DB를 진실의 원천(single source of truth)로 두는 구조를 실험했다.그 결과, 재고 100개에 2,000 동시 요청을 넣었을 때 Oversell 0건 · p95 271ms를 달성했다.

단순히 “락 범위만 잘 잡으면 된다”는 이상적인 전제 대신, Redis/네트워크 장애와 중복 요청까지 고려해 DB 쿼리 레벨 멱등성과 3중 방어를 최소 기준으로 잡고 설계한 기록이다.

![](/images/posts/redis-1-optimistic-lock-upsert-oversell-0-kotlin-110/img.png)

## 요약

-   타임딜 재고 100개에 2,000 동시 요청을 넣었을 때 **Oversell 0건, p95 271ms**를 달성했다.
-   Redis Lua 스크립트 + DB Optimistic Lock + PostgreSQL UPSERT WHERE로 **3중 방어**를 설계해 재고 오버셀과 1인 구매 한도를 동시에 보장했다.
-   과거 이중 결제/중복 쿠폰 사고 경험을 바탕으로, **트랜잭션 경계와 보상 트랜잭션**을 재설계하여 Redis–DB 정합성을 구조적으로 보장하도록 만들었다.
-   도메인 모델, 락 전략, 보상·복구 메커니즘, 정합성 복구까지 “DB를 진실의 원천으로 두는” 구조를 중심으로 설계·구현했다.
-   이 글은 성능 튜닝 자체보다, Redis와 DB 사이의 트랜잭션 경계·보상 트랜잭션·정합성 복구로 **DB를 어떻게 보호했는지**에 초점을 둔다. 성능 수치(oversell 0건, p95 271ms)는 이 구조가 “실제 트래픽에서도 버틸 수 있는지”를 검증하기 위한 결과일 뿐, 목적 그 자체는 아니다.

## 0\. 왜 이 프로젝트를 시작했는가

동시성 이슈가 나오면 거의 공식처럼 따라오는 답이 있다.

> "Redis 쓰면 됩니다."
> 
> "분산 환경이면 Redisson 쓰세요."

실제 운영 환경에서 이 답을 그대로 적용한 시스템에서, **이중 결제와 중복 쿠폰 발행 사고,** 두 가지 사고를 직접 경험했다.

당시 결제 처리 코드는 대략 이런 흐름이었다.

```kotlin
BEGIN TRANSACTION
  acquire redis lock
  process payment  -- DB INSERT/UPDATE
  release redis lock
COMMIT
```

문제의 원인은 정말 간단하게도 **락의 범위**였다.

트랜잭션이 완전히 끝나기 전에 Redis 락을 먼저 풀어버렸고, 그 사이에 들어온 나머지 요청들이 모두 “락이 없는 상태”로 동일 결제/쿠폰 로직을 다시 실행했다. 결과적으로 하나의 논리적 결제에 대해 DB에는 두 번 이상 INSERT/UPDATE가 들어가면서, 실제로 이중 결제·이중 쿠폰 발행이 발생했다.

겉으로 보기엔 모든 요청이 정상적인 결제 요청이었다. 다만 프론트 쪽 일시적인 네트워크 지연·재시도 때문에, 사용자는 버튼을 한 번 눌렀지만 서버에는 거의 동시에 여러 번의 요청이 도착하는 상황이었다.

정리하면

-   프론트에서 들어오는 중복/폭주 요청을 막을 **멱등성 처리**가 전혀 없었고,
-   서버 내부에서는 락의 수명과 트랜잭션 경계를 잘못 잡아서, DB 상태가 완전히 확정되기 전에 락이 먼저 풀려버린 것이 근본 원인이었다.

즉, "Redis 쓰면 끝"이라는 통념의 빈틈이 그대로 노출된 사례였다.

그리고 문득 Redisson에 대한 의문이 생겼다.

분산 락이 필요해 보이는 케이스마다 “분산 환경 = Redisson”으로 거의 자동 결론을 내렸지만, 정말로 이 시스템 특성에 Redisson이 맞는지, 다른 선택지는 없는지 검토하는 과정이 없었다.

이 두 경험이 이 프로젝트의 출발점이었다.

-   Redis와 트랜잭션의 **순서**를 어떻게 잡아야 하는가
-   시스템 특성에 맞는 **락 전략**은 무엇인가
-   멱등성과 중복 방어를 어느 **레이어**에서 어떻게 구현해야 하는가

나는 타임딜 — 정해진 시각에 수천 명이 동시에 몰리는 스파이크 트래픽 시나리오 — 을 직접 구현하면서 이 질문들에 답해보기로 했다.

이 글은 무엇을 만들었는가보다, **왜 DB를 기준으로 락·멱등성**·보상 구조를** 설계했는가**, 그리고 그 결과가 **사고 방지와 수치로 어떻게 검증됐는가**에 더 초점을 맞춘 기록이다.

### 1\. 프로젝트 개요

2,000 req/s 스파이크 트래픽 환경에서 Oversell 0건과 1인 구매 한도를 동시에 보장하는 타임딜 재고 차감 파이프라인이다.

#### 1-1. 기본 정보

항목 내용

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td>프로젝트 기간</td><td>2026-04 (약 1주일)</td></tr><tr><td>역할</td><td>백엔드 전반 설계·구현 단독 수행 (도메인 모델, 동시성 제어, 부하 테스트)</td></tr><tr><td>백엔드</td><td>Kotlin 2.2 / JDK 21 Virtual Thread / Spring Boot 4.0 / jOOQ 3.19</td></tr><tr><td>인프라</td><td>PostgreSQL 16 / Redis 7 (Lua scripting) / Flyway</td></tr><tr><td>테스트</td><td>JUnit (Testcontainers 동시성 통합) / k6 (스파이크 부하)</td></tr><tr><td>AI</td><td>Claude, Perplexity</td></tr></tbody></table>

#### 1-2. 이 프로젝트에서 내가 한 일

-   동시성 전략 선정 (Optimistic Lock vs Redisson 등)과 3중 방어 구조 설계
-   Redis Lua 스크립트, DB Optimistic Lock 쿼리, UPSERT WHERE 쿼리 직접 설계·구현
-   StockRollbackHandler / StockReconciler 보상·복구 메커니즘 설계 및 구현
-   k6 부하 테스트 시나리오 작성, 실행, 결과 분석 및 회고 작성

### 2\. 비즈니스 문제 정의

#### 2-1. 타임딜이 어려운 이유

타임딜은 일반 쇼핑몰과 트래픽 패턴 자체가 다르다.

<table style="border-collapse: collapse; width: 100%; height: 80px;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr style="height: 20px;"><td style="height: 20px;">항목</td><td style="height: 20px;">일반</td><td style="height: 20px;">쇼핑몰 타임딜</td></tr><tr style="height: 20px;"><td style="height: 20px;">트래픽</td><td style="height: 20px;">분산, 간헐적</td><td style="height: 20px;">오픈 순간 스파이크 (수천 req/s)</td></tr><tr style="height: 20px;"><td style="height: 20px;">동일 row 경합</td><td style="height: 20px;">거의 없음</td><td style="height: 20px;">단일 row에 동시 쓰기 집중</td></tr><tr style="height: 20px;"><td style="height: 20px;">정합성 요구</td><td style="height: 20px;">일반 수준</td><td style="height: 20px;">Oversell 0 + 1인 한도 정확</td></tr></tbody></table>

DB 관점에서 타임딜 구매는 **단 하나의 row에 대한 동시 쓰기 경합**이다.

#### 2-2. 핵심 제약 조건

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>제약</td><td>내용</td></tr><tr><td>Oversell 방지</td><td>재고 100개에 2,000건이 몰려도 정확히 100건만 성공</td></tr><tr><td>1인 한도</td><td>동일 사용자 동시 요청 시에도 maxPerUser 초과 불가</td></tr><tr><td>응답 성능</td><td>p95 &lt; 300ms (사용자는 결과를 거의 즉시 받아야 함)</td></tr><tr><td>가용성</td><td>DB 커넥션 풀이 막히면 다른 도메인 API까지 영향, 격리 필수</td></tr><tr><td>장애 복구</td><td>Redis 장애나 프로세스 크래시 후에도 DB 정합성을 기준으로 자가 복구</td></tr></tbody></table>

#### 2-3. 비즈니스 가치: "신뢰할 수 있는 한정 판매"

타임딜의 본질은 **희소성에 대한 신뢰**이다.

"100개 한정"이라고 했는데 101개가 팔리면 가격 정책 자체가 무너진다. 또한 사용자가 "구매 버튼을 눌렀는데 응답이 없는" 경험을 반복적으로 받으면 브랜드 신뢰가 크게 떨어진다.

특히 타임딜 트래픽이 몰릴 때도 DB 커넥션 풀과 row lock 경합을 통제해, 다른 도메인까지 같이 무너지는 일을 막는 것이 가장 중요한 목표였다. 재고 oversell을 막는 것도 결국 “DB에 불필요한 쓰기·락 경쟁을 보내지 않는 것”의 결과물이라고 보는 관점이다.

### 3\. 시스템 아키텍처

#### 3-1. 4-Layer Hexagonal Architecture

![](/images/posts/redis-1-optimistic-lock-upsert-oversell-0-kotlin-110/img-1.png)

#### 3-2. 설계 원칙

-   **도메인 순수성**
    -   StockDecreaser, StockRollbackHandler, TimeDealValidator는 순수 Kotlin 코드로, Spring/JPA/jOOQ 의존이 없습니다. JUnit 단독으로 매우 빠른 테스트가 가능하다.
-   **Port-Adapter 패턴**
    -   StockPort로 Redis 의존을 캡슐화해서, 향후 Hazelcast/Memcached 등으로 교체해도 도메인 코드는 수정이 필요 없다.
-   **UseCase 1:1 매핑**
    -   PurchaseTimeDealUseCase는 4단계 흐름만 오케스트레이션하고, 비즈니스 로직은 도메인 서비스가 담당한다.
-   **단일 책임 보상 핸들러**
    -   Redis 롤백을 StockRollbackHandler 한 곳에서만 수행하도록 강제해, 롤백 누락을 구조적으로 막는다.

#### 3-3. 구매 요청 플로우

```kotlin
Client ──→ TimeDealController
                ↓
	         PurchaseTimeDealUseCase.execute()
	              ↓
		       Step 1. TimeDealValidator (딜 활성 검증)
		       Step 2. getPurchasedQuantity (1인 한도 선검사)
		       Step 3. StockDecreaser ─ Redis 1차 ─ DB Optimistic Lock 2차
		       Step 4. savePurchaseRecord (UPSERT WHERE — 3차)
	              ↓
	         실패 경로 → StockRollbackHandler.rollback()
	              ↓
	         Response (201 / 409)
```

### 4\. 핵심 기술 의사결정

## 4-1. DB 락 전략 — 5개 후보 비교

타임딜은 단일 row에 대한 쓰기 경합이 핵심이다. 여러 전략을 비교했다.

<table style="border-collapse: collapse; width: 100%; height: 120px;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr style="height: 20px;"><td style="height: 20px;">전략</td><td style="height: 20px;">동작 방식</td><td style="height: 20px;">이 시스템에서의 문제</td></tr><tr style="height: 20px;"><td style="height: 20px;">테이블 락 (LOCK TABLE)</td><td style="height: 20px;">테이블 전체 잠금</td><td style="height: 20px;">동시 처리량이 1 수준으로 떨어져 실사용 불가</td></tr><tr style="height: 20px;"><td style="height: 20px;">비관적 락 (FOR UPDATE)</td><td style="height: 20px;">row-level lock + wait queue</td><td style="height: 20px;">lock wait가 누적되면 커넥션 풀 고갈 위험</td></tr><tr style="height: 20px;"><td style="height: 20px;">SERIALIZABLE 격리</td><td style="height: 20px;">팬텀 읽기까지 감지, 충돌 시 롤백</td><td style="height: 20px;">false-positive 롤백 및 성능 오버헤드</td></tr><tr style="height: 20px;"><td style="height: 20px;">Redisson (분산 락)</td><td style="height: 20px;">Redis 기반 단일 락 포인트</td><td style="height: 20px;">Redis SPOF, DB 정합성은 별도 보장 필요</td></tr><tr style="height: 20px;"><td style="height: 20px;"><b>Optimistic Lock (version)</b></td><td style="height: 20px;">CAS 방식, 락 미획득</td><td style="height: 20px;"><b>단일 row 경합 + Redis 필터 조합에 적합</b></td></tr></tbody></table>

**Redisson을 선택하지 않은 이유**

1.  **Redis SPOF**
    -   Redisson은 Redis를 락 서버로 사용하기 때문에, Redis 장애 시 락 획득 자체가 불가능해진다. 락 서버가 서비스 가용성의 단일 장애점이 된다.
2.  **DB 정합성 미보장**
    -   Redisson이 락을 잡아도 DB와 별도의 정합성 보장은 없다. 결국 Redis 데이터 유실이나 TTL 만료 시 기준이 되는 건 DB라, DB 쪽에서 정합성을 보장하는 편이 더 단순하다.

단일 row 쓰기 경합처럼 단순한 케이스에서 Redis SPOF를 감수하고 Redisson을 도입할 이유가 없다고 판단했다. 이 시스템에서는 “락이 잘 잡히느냐”보다 “DB가 언제나 기준이 되는 상태로 남느냐”가 더 중요했기 때문에, Redis를 락 서버가 아니라 1차 필터로 두고 DB에서 Optimistic Lock으로 충돌을 처리하는 편이 더 단순하고 안전하다고 결론냈다.

**Optimistic Lock 선택 근거**

```
UPDATE time_deals
	 SET remaining_stock = remaining_stock - :quantity,
	     version         = version + 1
 WHERE id      = :id
   AND version = :expectedVersion
   AND remaining_stock >= :quantity;
```

-   별도의 DB 락을 잡지 않고, WHERE 조건이 실패하면 바로 실패로 끝나는 **CAS 패턴이**다.
-   DB 커넥션 점유 시간은 UPDATE 쿼리 실행 시간 정도라 lock wait가 없다.
-   Optimistic Lock의 약점인 "충돌 시 재시도" 비용은 Redis 1차 필터로 완화한다.

### 4-2. Redis 차감 방식 — Lua 스크립트

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>선택지</td><td>장점</td><td>단점</td></tr><tr><td>INCRBY/DECRBY 단독</td><td>단일 명령 자체는 원자적</td><td>"재고 확인 → 차감"이 두 단계로 분리되어 race 가능</td></tr><tr><td><b>Lua 스크립트</b></td><td><b>확인 + 차감을 단일 원자 연산으로 보장</b></td><td><b>스크립트 배포/캐싱 관리 필요</b></td></tr></tbody></table>

단순 GET → 비교 → DECRBY 구조에서는 다음과 같은 race condition이 가능해진다.

```
요청 A: GET → 1
요청 B: GET → 1
요청 A: DECRBY → 0
요청 B: DECRBY → -1   ← Oversell
```

Lua 스크립트는 Redis 서버에서 단일 명령처럼 실행되어, 확인과 차감 사이에 다른 요청이 끼어들 수 없다.

## 4-3. 트랜잭션 경계 — Redis와 DB 분리

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>선택지</td><td>장점</td><td>단점</td></tr><tr><td>Redis 차감을 DB 트랜잭션 내부에 포함</td><td>코드 상으로는 단순</td><td>XA 트랜잭션 불가, 부분 실패 시 일관성 깨짐</td></tr><tr><td><b>Redis는 트랜잭션 밖, 보상으로 일관성 유지</b></td><td><b>DB 결과에 따라 Redis 보상 가능</b></td><td><b>롤백 핸들러 필요</b></td></tr></tbody></table>

RDBMS와 Redis는 하나의 분산 트랜잭션으로 묶기 어렵다. 따라서 다음과 같이 경계를 명확하게 나눴다.

```
@Transactional 범위:
    decreaseStockWithVersion (DB UPDATE)
    savePurchaseRecord       (DB UPSERT)

Redis 연산은 트랜잭션 밖:
    tryDecrease  ← 트랜잭션 시작 전
    rollback     ← DB 실패 후 수동 보상
```

이 구조 덕분에, DB가 실패했을 때도 Redis를 **보상 트랜잭션**으로 원상복구할 수 있다. Redis와 DB를 한 트랜잭션으로 묶을 수 없기 때문에, 처음부터 "DB 기준으로 Redis를 보상·복구한다"는 관점을 택했다.

### 4-4. 1인 한도 검증 — UPSERT WHERE 조건부 원자 검증

멱등성과 1인 한도는 SQL 레벨에서 닫았다.

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td>선택지</td><td>장점</td><td>단점</td></tr><tr><td>애플리케이션 레벨 SELECT → if → INSERT</td><td>코드상 이해하기 쉬움</td><td>SELECT–INSERT 사이 race condition</td></tr><tr><td>트랜잭션 격리 수준 격상</td><td>일관성 강화</td><td>SERIALIZABLE 오버헤드</td></tr><tr><td><b>UPSERT + WHERE 조건</b></td><td><b>단일 SQL 원자 처리, 추가 락 없음</b></td><td><b>PostgreSQL 문법 의존</b></td></tr></tbody></table>

PostgreSQL의 INSERT ... ON CONFLICT DO UPDATE ... WHERE를 사용해, DB가 check-and-increment를 원자적으로 처리하도록 만들었다.

```
INSERT INTO time_deal_purchases (...)
VALUES (...)

ON CONFLICT (time_deal_id, user_id)
DO UPDATE

SET quantity = time_deal_purchases.quantity + :quantity
WHERE time_deal_purchases.quantity + :quantity <= :maxPerUser;
```

-   affected = 0이면 한도 초과 → Redis 롤백 후 거부 응답.
-   동일 사용자의 여러 동시 요청 중 하나만 성공 가능한 구조가 된다.

멱등성과 1인 한도는 애플리케이션 로직이 아니라 SQL 한 줄이 닫아줘야 한다고 본다.

### 4-5. 보상 트랜잭션 단일 진입점

보상 트랜잭션 코드를 여러 곳에 흩어두면 **누락**이 발생하기 쉽다.

처음에는 실패 경로마다 인라인으로 Redis 롤백을 호출했는데, 새 실패 케이스를 추가하면서 한 군데를 빼먹은 걸 통합 테스트에서 발견했다.

그래서 StockRollbackHandler라는 단일 진입점을 도입했다.

-   모든 실패 경로는 이 핸들러를 한 번 거치도록 강제
-   보상 로직 변경 시에도 한 곳에서만 수정
-   “누락을 개발자 책임으로 남기지 않고, 구조에 책임을 지게 만든다”는 설계 의도

### 4-6. Redis–DB 정합성 복구 — 스케줄러

Redis와 DB는 결국 분리된 시스템이라, 프로세스 크래시 등 예외 상황에서 잠깐 불일치가 생길 수 있다.

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td>선택지</td><td>장점</td><td>단점</td></tr><tr><td>매 구매마다 Redis–DB 비교</td><td>즉시 감지 가능</td><td>모든 요청에 추가 쿼리, 성능 저하</td></tr><tr><td><b>주기적 스케줄러 (60초)</b></td><td><b>정상 시 부하 0, 예외 케이스 자가 복구</b></td><td><b>최대 60초 지연 허용</b></td></tr></tbody></table>

DB를 **진실의 원천**으로 두고, Redis < DB인 경우에만 Redis를 DB 기준으로 되돌린다. Redis > DB는 설계상 거의 나와서는 안 되는 상황으로, 알람으로 처리하도록 했다.

### 5\. 3중 방어 설계

#### 5-1. 전체 방어선 구조

```
구매 요청
    │
    ▼ [1차] Redis Lua 원자 차감
  재고 있음 → 통과
  재고 없음 → 즉시 409 (DB 접근 0)
    │
    ▼ [2차] DB Optimistic Lock UPDATE
  WHERE version = ? AND remaining_stock >= quantity
  affected = 1 → 성공
  affected = 0 → Redis rollback → 409
    │
    ▼ [3차] UPSERT WHERE quantity + ? <= maxPerUser
  한도 내 → 구매 확정
  한도 초과 → Redis rollback → 409
```

## 5-2. 각 방어선 역할

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>방어선</td><td>역할</td><td>실패 시</td></tr><tr><td>Redis Lua</td><td>초과 요청 대부분을 빠르게 차단, DB 부하 격리</td><td>즉시 409, DB 미접근</td></tr><tr><td>DB Optimistic Lock</td><td>재고 음수 방지, Redis–DB 불일치 방지</td><td>Redis 롤백 + 409</td></tr><tr><td>UPSERT WHERE</td><td>maxPerUser 1인 한도 최종 검증</td><td>Redis 롤백 + 409</td></tr></tbody></table>

단일 방어선에 기대지 않고, 각 레이어가 실패했을 때도 다른 레이어가 다시 잡아줄 수 있게 쌓는 것이 "안전한 할인/결제 시스템"의 기준으로 생각하기 때문이다. 이 3중 방어선의 중심에는 항상 DB가 있고, Redis는 어디까지나 그 DB를 보호하기 위한 필터·캐시·보조 도구라는 점을 끝까지 유지하려 했다.

### 6\. 핵심 구현

#### 6-1. PurchaseTimeDealUseCase — 4단계 흐름

```
@Transactional
fun execute(command: PurchaseTimeDealCommand): PurchaseTimeDealResult {
    // Step 1. 타임딜 활성 검증
    val deal = timeDealQueryPort.findById(command.timeDealId)
        ?: throw TimeDealNotActiveException("not found")
    when (validator.check(deal, command.quantity, now)) { ... }

    // Step 2. maxPerUser 선검사 (대부분 여기서 차단)
    val purchased = timeDealQueryPort.getPurchasedQuantity(deal.id, command.userId)
    if (purchased + command.quantity > deal.maxPerUser) {
        throw PurchaseLimitExceededException()
    }

    // Step 3. 재고 차감 (Redis 원자 + DB Optimistic Lock)
    when (stockDecreaser.decrease(deal.id, command.quantity)) {
        Result.Success -> Unit
        Result.StockExhausted, Result.VersionConflict -> throw StockExhaustedException()
    }

    // Step 4. 구매 이력 UPSERT (maxPerUser 원자 최종 방어선)
    val recorded = timeDealCommandPort.savePurchaseRecord(...)
    if (!recorded) {
        rollbackHandler.rollback(deal.id, command.quantity)
        throw PurchaseLimitExceededException()
    }

    return PurchaseTimeDealResult(...)
}
```

UseCase는 흐름 orchestration에만 집중하고, 동시성/정합성 로직은 도메인 서비스가 담당하도록 분리했다.

#### 6-2. Redis Lua 원자 차감

```
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local quantity = tonumber(ARGV[1])

if current < quantity then
    return -1   -- 재고 부족 → 어떤 쓰기도 수행하지 않음
end

return redis.call('DECRBY', KEYS[1], quantity)
```

-   확인과 차감을 하나의 Lua 스크립트로 묶어 Redis 서버에서 **원자적으로** 실행한다.
-   클라이언트–서버 왕복도 줄어들어, Latency 측면에서도 이점이 있다.

#### 6-3. StockDecreaser — Redis + DB 오케스트레이션

```
fun decrease(timeDealId: UUID, quantity: Int): Result {
    // 1단계: Redis 원자 차감
    val redisOk = stockPort.tryDecrease(timeDealId, quantity)
    if (!redisOk) return Result.StockExhausted

    // 2단계: DB Optimistic Lock
    repeat(MAX_RETRY_COUNT) {
        val currentVersion = timeDealQueryPort.findCurrentVersion(timeDealId)
            ?: run {
                rollbackHandler.rollback(timeDealId, quantity)
                return Result.VersionConflict
            }

        val dbOk = try {
            timeDealCommandPort.decreaseStockWithVersion(timeDealId, quantity, currentVersion)
        } catch (e: Exception) {
            rollbackHandler.rollback(timeDealId, quantity)  // 예외 시 반드시 복구
            throw e
        }

        if (dbOk) return Result.Success
    }

    rollbackHandler.rollback(timeDealId, quantity)
    return Result.VersionConflict
}
```

-   모든 실패 경로에서 rollbackHandler.rollback을 호출하도록 강제했다.
-   예외, version 충돌, 재시도 소진 등 어떤 경우에도 Redis가 원상복구된다.

#### 6-4. Optimistic Lock 핵심 쿼리 (jOOQ)

```
override fun decreaseStockWithVersion(
    id: UUID, 
    quantity: Int,
    expectedVersion: Long
): Boolean {
    val updated = dsl.update(TIME_DEALS)
        .set(TIME_DEALS.REMAINING_STOCK, TIME_DEALS.REMAINING_STOCK.minus(quantity))
        .set(TIME_DEALS.VERSION, TIME_DEALS.VERSION.plus(1))
        .where(TIME_DEALS.ID.eq(id))
        .and(TIME_DEALS.VERSION.eq(expectedVersion))      // CAS
        .and(TIME_DEALS.REMAINING_STOCK.ge(quantity))     // 음수 방지
        .execute()

    return updated == 1
}
```

-   id, version, remaining\_stock >= quantity 세 조건이 모두 만족해야만 업데이트가 일어난다.
-   하나라도 어긋나면 updated = 0 → race에서 진 요청으로 처리한다.

#### 6-5. UPSERT WHERE — 1인 한도 원자 검증

```
override fun savePurchaseRecord(
    timeDealId: UUID,
    userId: UUID,
    quantity: Int, 
    maxPerUser: Int
): Boolean {
    val affected = dsl.insertInto(TIME_DEAL_PURCHASES)
        // INSERT fields...
        .onConflict(TIME_DEAL_PURCHASES.TIME_DEAL_ID, TIME_DEAL_PURCHASES.USER_ID)
        .doUpdate()
        .set(TIME_DEAL_PURCHASES.QUANTITY, TIME_DEAL_PURCHASES.QUANTITY.plus(quantity))
        .where(TIME_DEAL_PURCHASES.QUANTITY.plus(quantity).le(maxPerUser))
        .execute()

    return affected == 1
}
```

WHERE quantity + :quantity <= maxPerUser 한 줄이 1인 한도의 최종 방어선입니다.

#### 6-6. StockReconciler — 정합성 자가 복구

```
@Scheduled(fixedDelay = 60_000)
fun reconcile() {
    for (deal in timeDealQueryPort.findAllActive()) {
        val redisStock = stockPort.getRemaining(deal.id)
        val dbStock = deal.remainingStock

        when {
            redisStock < dbStock -> {
                stockPort.increase(deal.id, dbStock - redisStock)
                log.warn("Redis < DB 불일치 복구: deal=${deal.id}")
            }
            redisStock > dbStock -> {
                log.error("Redis > DB 비정상: deal=${deal.id} - 운영자 확인 필요")
            }
        }
    }
}
```

-   DB를 기준으로 Redis를 주기적으로 교정한다.
-   “Redis가 잠깐 틀릴 수는 있지만, 결국 DB 기준으로 회복된다”는 신뢰를 주는 역할이다.

### 7\. 실제로 부딪힌 문제와 해결

#### 7-1. Optimistic Lock의 역설

초기 구현에서 k6 부하 테스트를 돌렸을 때, 이상한 패턴을 확인했다.

-   재고 100, 동시 요청 200
    -   Redis Lua: 100명 통과 (정상)
    -   DB Optimistic Lock: 1명만 성공, 99명은 version 충돌로 실패

모두 같은 version=0을 읽고 동시에 UPDATE를 시도했기 때문이었다. 한 명만 성공하고 나머지 99명은 affected = 0으로 떨어져 모두 실패했다.

이를 완화하기 위해 **재시도 로직**을 추가했다.

-   MAX\_RETRY\_COUNT = 3
-   실패 시 최신 version을 다시 조회 후 재시도, 그래도 안 되면 Redis 롤백 후 실패로 처리

근본적으로는 Kafka 단일 파티션 + Consumer 1 방식으로 순서를 강제하면 version 경합 자체를 제거할 수 있었다. 이 부분은 Kafka 비동기 설계 (아이디어 단계)로 분리해, 이번 구현 범위에서는 다루지 않았다. 추후에 다룰 예정이다.

#### 7-2. 보상 트랜잭션 누락 — 단일 진입점 도입 전

초기 코드에서는 Redis 롤백을 4군데에서 인라인으로 호출하고 있었다. 새 실패 경로(예: version 충돌 재시도 실패)를 추가하면서 한 곳에 롤백 호출을 빼먹었고, 통합 테스트에서 Redis 재고가 DB와 일치하지 않는 것을 발견했다. 이후 StockRollbackHandler를 도입해 **모든 실패 경로를 이 핸들러 하나로 수렴**시키면서, 롤백 누락을 구조적으로 방지했다.

#### 7-3. SELECT–INSERT race — 1인 한도 통과

동일 사용자가 0.1초 간격으로 2건의 요청을 보내면, 두 건 모두 성공하는 경우가 있었다.

```
요청 A: SELECT quantity → 0 → 한도 통과
요청 B: SELECT quantity → 0 → 한도 통과 (A 트랜잭션 미커밋)
요청 A: INSERT quantity=1 → 성공
요청 B: INSERT quantity=1 → 성공 → 한도 초과
```

이 패턴을 막기 위해, UPSERT WHERE로 1인 한도를 SQL 레벨에서 원자적으로 검증하는 방식으로 변경했다. 그 결과 동일 사용자의 여러 동시 요청 중 하나만 성공할 수 있는 구조가 되었다.

### 8\. 데이터 흐름 시나리오

#### 8-1. 정상 시나리오

```
1. Client → POST /api/v1/time-deals/{id}/purchase
2. Validator: 딜 활성 검증 통과
3. Query: getPurchasedQuantity → 0 (한도 1)
4. Redis Lua: GET 100 → DECRBY → 99 (성공)
5. DB Optimistic Lock: WHERE version=0 → SET version=1, stock=99
6. UPSERT: INSERT quantity=1 (한도 통과)
7. COMMIT
8. Response: 201 Created (deal_price, purchasedAt)
```

#### 8-2. Redis 통과 후 DB 충돌

```
1~4. 동일
5. DB UPDATE: WHERE version=0 → affected=0 (다른 요청이 먼저 갱신)
6. Retry: 최신 version 재조회 후 UPDATE → 성공
7~8. 정상 진행
```

#### 8-3. Redis 통과 후 한도 초과

```
1~5. 동일 (Redis 차감, DB stock 감소)
6. UPSERT: WHERE quantity + 1 <= maxPerUser → affected=0 (한도 초과)
7. rollbackHandler.rollback(): Redis INCRBY 복구
8. throw PurchaseLimitExceededException → 409
9. @Transactional 롤백 → DB stock 원복
```

#### 8-4. 프로세스 크래시 후 자가 복구

```
T+0: Redis 차감 성공, DB UPDATE 실행 직전 프로세스 크래시
      상태 — Redis 99, DB 100 (불일치)
T+60s: StockReconciler 실행
       redisStock=99 < dbStock=100 → INCRBY 1
       상태 — Redis 100, DB 100 (복구)
```

### 9\. 정량적 결과

#### 9-1. 정합성

k6를 이용해 재고 100, 동시 요청 2,000 시나리오를 반복 검증했다.

```
=== Oversell Detection Report ===
Purchase Success: 100   ← 재고와 정확히 일치
Purchase Failed:  1900
Oversell:         NO ✅
1인 한도 초과:    0건 ✅
```

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>지표</td><td>목표</td><td>결과</td></tr><tr><td>Oversell</td><td>0건</td><td><b>0건</b></td></tr><tr><td>성공 건수</td><td>== 재고 수 (100)</td><td><b>100건</b></td></tr><tr><td>1인 한도 초과</td><td>0건</td><td><b>0건</b></td></tr><tr><td>Redis–DB 정합</td><td>일치</td><td><b>테스트 종료 시 항상 일치</b></td></tr></tbody></table>

#### 9-2. 성능

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td>지표</td><td>목표</td><td>결과</td></tr><tr><td>p95 응답 시간</td><td>&lt; 300ms</td><td><b>271ms</b></td></tr><tr><td>Redis 1차 차단율</td><td>재고/요청 외 거부 비율</td><td><b>약 95% (1,900/2,000)</b></td></tr><tr><td>DB 도달 요청</td><td>재고 ± 재시도 범위</td><td><b>약 100건 수준 유지</b></td></tr><tr><td>DB 커넥션 풀 고갈</td><td>없음</td><td><b>없음</b></td></tr></tbody></table>

Redis 1차 필터 덕분에 DB는 재고량에 비례하는 소수의 요청만 처리하면 되도록 설계되었다. 덕분에 타임딜 트래픽이 몰려도 DB 커넥션 풀과 row lock 경합은 재고 수에 가깝게 제한되며, 다른 도메인용 쿼리까지 가이 막히는 상황을 피할 수 있었다.

#### 9-3. 설계 품질

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft" data-ke-style="style8"><tbody><tr><td>항목</td><td>결과</td></tr><tr><td>도메인 단위 테스트</td><td>프레임워크 0 의존, JUnit 단독 실행 ~ms 수준</td></tr><tr><td>동시성 통합 테스트</td><td>Testcontainers로 200 동시 요청에서 정합성 검증</td></tr><tr><td>Port-Adapter 분리</td><td>Redis 어댑터 교체 시 도메인 코드 무수정</td></tr><tr><td>보상 트랜잭션 누락</td><td>단일 진입점으로 구조적으로 차단</td></tr></tbody></table>

### 10\. 회고 — 배운 점과 남겨둔 것

#### 10-1. "Redis 쓰면 됩니다"가 답이 아닌 이유

이 프로젝트를 하면서 가장 크게 확인한 건, Redis는 동시성의 만능열쇠가 아니라는 점이다.

Redis 자체는 빠르고 편리하지만, Redis와 DB 사이의 정합성은 결국 애플리케이션 설계의 몫이다. Redis에서 차감이 끝난 뒤 DB가 실패했을 때, 프로세스가 중간에 죽었을 때, 네트워크가 순간적으로 끊겼을 때를 먼저 설계하지 않으면, 이중 결제나 재고 오차는 언젠가 운영 중에 다시 나타난다.

이전 회사에서는 “지금은 한두 건밖에 안 터지니까 괜찮다”는 분위기가 강했다. 하지만 나는 그걸 “운이 좋아서 겨우 버티고 있는 상태”로 보는 쪽에 더 가깝다는 걸 알게 됐다.

이 글은 Redis를 쓰지 말자는 얘기가 아니라, Redis만 믿는 설계가 왜 위험한지, 그리고 그 빈틈을 어떻게 메울 수 있는지를 코드와 수치로 정리한 기록이다.

#### 10-2. 락 전략의 핵심은 "충돌 패턴"

“분산 환경이니까 일단 Redisson”이 아니라, “이 시스템에서 어떤 방식으로 충돌이 발생하는가”가 먼저였다.

타임딜의 패턴은:

-   단일 row에 쓰기 경합이 몰림
-   DB가 진실의 원천이어야 함
-   Redis는 1차 필터 역할이면 충분함

이런 패턴에는 Redis를 락 서버로 만드는 Redisson보다, Optimistic Lock + Redis 1차 필터가 더 자연스럽고 단순하다. “툴을 먼저 고르고 거기에 문제를 끼워 맞추는 것”이 아니라, 충돌 패턴을 먼저 이해한 뒤에 거기에 맞는 도구를 고르는 게 맞다는 걸 다시 한 번 체감했다.

#### 10-3. 멱등성은 SQL 레벨에서 닫아야 한다

이전 사고들에서 공통적으로 빠져 있었던 건 멱등성이다.

프론트의 재시도, 네트워크 지연, 사용자의 연타를 모두 “비정상 상황”으로 보고, SELECT → if → INSERT 같은 애플리케이션 레벨 로직으로만 막으려다 보니 레이스를 완전히 없앨 수 없었다.

이번에는 UPSERT WHERE 한 줄로 1인 한도와 멱등성을 SQL 레벨에서 닫았다.

동일 사용자의 여러 동시 요청이 들어와도, DB가 원자적으로 check-and-increment를 수행하기 때문에 결국 하나의 결과만 인정된다. “멱등성은 최대한 DB가 보장하게 만들고, 애플리케이션은 그 실패/성공을 해석하는 쪽에 집중한다”는 게 앞으로 가져갈 내 기본 원칙이 될 것 같다.

#### 10-4. 부하 테스트는 설계 검증 도구

Optimistic Lock의 역설, 즉 재고는 100인데 성공 건수는 1건만 나오는 현상은 코드만 보고 있을 때는 눈에 잘 들어오지 않았다. k6로 스파이크 트래픽을 실제로 때려보니 “숫자는 맞는데 느낌이 이상한” 지점이 드러났고, 그게 설계를 다시 뜯어보는 계기가 됐다.

이 경험 이후로 부하 테스트를 “성능을 재는 도구”라기보다 “설계의 모서리를 드러내는 도구”에 가깝게 보게 됐다. 특히 동시성, 락, 멱등성이 얽힌 도메인에서는, 테스트 코드와 k6 스크립트가 설계 문서만큼이나 중요한 아티팩트라는 걸 느꼈다.

#### 10-5. "유난"이 아니라 내가 가져갈 기준

이 프로젝트를 시작하게 만든 사고들 때문에, 한동안은 “나만 문제를 너무 크게 보는 게 아닐까?”라는 생각을 많이 했다.

하지만 Redis 1차 필터, Optimistic Lock, UPSERT, 보상 트랜잭션, 정합성 복구까지 실제로 설계·구현·검증해보면서, 적어도 결제/쿠폰/재고 같은 도메인에서는 이 정도 기준을 요구하는 게 과한 게 아니라는 확신이 생겼다. 일반적인 기능에는 오버엔지니어링을 항상 경계하지만, 고객에게 크리티컬하고 신뢰의 문제가 중요한 부분은 어느정도 방어선을 두껍게 가져가는 편이 안전하다고 판단했다. 이상적인 상황이 깨지는 순간, 그대로 위험에 노출될 수 있기 때문이다.

이 글은 “이렇게 안 하면 다 잘못이다”라는 선언이 아니다.

다만 나는 이중 결제와 재고 오버셀을 “가끔 생길 수 있는 버그”가 아니라, 사용자의 신뢰와 바로 연결된 비즈니스 리스크로 본다는 것을 분명히 해두고 싶었다.

앞으로 어디에서 일하든, Redis를 포함한 어떤 기술을 쓰더라도 트랜잭션 경계, 멱등성, 보상 구조까지 고민하는 엔지니어이고 싶다. 그리고 그 출발점은 “DB를 어떻게 보호할 것인가”라는 질문에서 시작하려고 한다.
