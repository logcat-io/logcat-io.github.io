---
title: chunk size를 키우면 MySQL buffer pool이 흔들릴까?
description: 면접에서 이런 질문을 받은 적이 있다.
pubDate: '2026-06-03T02:23:50+09:00'
dateSource: html-visible
slug: chunk-size-my-sql-buffer-pool-116
tags:
  - mysql
  - chunk
  - innodb
  - 배치처리
  - buffer
  - pool
  - size
  - 배치
  - 실험
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '116'
  sourceHtml: 116/116.html
  sourceHash: 'sha256:656e1f30953016f3129a2695a03d219ed8dc0ea84c60c430d40e44aac9ba6d99'
---

면접에서 이런 질문을 받은 적이 있다.

> 배치 chunk size는 어떻게 잡으세요?

예전에는 꽤 단순하게 답했다.

로컬에 비슷한 환경을 만들고, 부하 테스트를 돌려보면서 처리량과 latency가 괜찮은 값을 잡는다고.

틀린 답은 아니라고 생각한다.

그런데 MySQL을 다시 공부하면서 이 답이 조금 얕게 느껴졌다.

계기가 된 부분은 InnoDB buffer pool의 LRU 관리 방식이었다. InnoDB는 strict LRU를 그대로 쓰지 않고, 새로 읽은 page를 LRU list의 midpoint 근처에 넣는다. 대량 scan이 buffer pool을 한 번에 오염시키지 않도록 막기 위한 장치다. MySQL 공식 문서에서는 이 동작을 buffer pool을 scan resistant하게 만들기 위한 전략으로 설명한다.

그 설명을 보고 나니 chunk size가 다시 보였다.

주간 자동 결제 배치는 혼자 도는 작업이 아니다. 사용자는 계속 구독 정보를 조회하고, 결제 상태를 확인하고, 구독을 변경한다. 이미 buffer pool 안에는 사용자가 자주 건드리는 hot page들이 올라와 있을 것이다.

그 상태에서 batch chunk를 크게 잡으면 어떻게 될까?

-   많은 page를 한 번에 읽으면서 hot page를 밀어내지는 않을까?
-   대량 update로 dirty page와 redo log를 늘려 flush pressure를 키우지는 않을까?
-   transaction이 길어지면서 lock hold time이나 rollback 비용이 커지지는 않을까?

처음 가설은 이랬다.

> chunk size가 커질수록 buffer pool churn이 커지고, 주간 OLTP latency가 튈 것이다.

직접 확인해보기로 했다.

### 1\. 실험 목표

목표는 "정답 chunk size"를 찾는 것이 아니었다.

운영 DB에서 직접 stress test를 할 수는 없다. 로컬 테스트 결과의 절대값을 운영에 그대로 가져가는 것도 위험하다. 로컬은 DB와 client가 가깝고, 디스크도 빠르고, 데이터도 생각보다 쉽게 memory에 올라간다.

그래서 이번 실험에서는 절대값보다 이 질문에 집중했다.

> chunk size를 바꿨을 때 어떤 지표가 먼저 흔들리는가?

특히 아래 지표를 같이 봤다.

-   batch 총 실행 시간
-   chunk 하나의 평균/최대 실행 시간
-   OLTP read/update p95, p99
-   `Innodb_buffer_pool_reads`
-   `Innodb_row_lock_waits`
-   `Innodb_os_log_written`

중요한 점은 batch만 단독으로 돌리지 않았다는 것이다.

먼저 사용자 조회/수정 쿼리를 반복 실행해서 buffer pool을 데웠다. 그 다음에도 사용자 workload를 계속 흘려둔 상태에서 batch를 실행했다.

로컬에서라도 "주간 운영 중 이미 사용자가 DB를 쓰고 있는 상태"를 흉내 내고 싶었다.

### 2\. 실험 구조

도메인은 주간 자동 결제 배치로 잡았고, 테이블은 단순하게 구성했다.

-   `subscriptions`: 구독 정보
-   `payments`: 결제 요청 row
-   `batch_chunk_log`: chunk별 batch 실행 시간
-   `oltp_probe_log`: 사용자 workload latency
-   `status_snapshots`: InnoDB counter snapshot

batch는 다음 일을 한다.

1.  오늘 결제 대상 subscription을 PK range로 읽는다.
2.  `payments`에 결제 요청 row를 만든다.
3.  `subscriptions.next_billing_date`를 한 달 뒤로 미룬다.

외부 PG 호출은 붙이지 않았다.

이번 실험은 결제 도메인 전체 구현이 아니라 DB 부담을 보기 위한 실험이기 때문이다.

대신 중복 결제 row를 만들지 않도록 `payments(subscription_id, billing_date)`에는 unique key를 뒀다. 실험이라도 이 부분을 빼면 나쁜 습관이 된다.

### 3\. 왼쪽 세션과 오른쪽 세션

실험은 MySQL 세션 두 개로 돌렸다. (편의상 왼쪽과 오른쪽 세션으로 부르겠다.)

왼쪽 세션 A는 batch와 측정을 담당한다.

```sql
-- 왼쪽 세션
CALL snapshot_metrics('before_chunk_2000');
CALL run_payment_batch('chunk_2000', 2000, 100000);
CALL snapshot_metrics('after_chunk_2000');
```

오른쪽 세션 B는 batch가 도는 동안 사용자 트래픽을 계속 흘린다.

```
-- 오른쪽 세션
CALL run_hot_oltp('chunk_2000', 30000, 0.003);
```

순서는 이렇다.

```
왼쪽: warm-up
오른쪽: 사용자 트래픽 시작
왼쪽: before snapshot
왼쪽: batch 실행
왼쪽: after snapshot
오른쪽: 사용자 트래픽 중지
왼쪽: 결과 조회
```

여기서 `warm-up`은 별다른 게 아니다.

배치를 돌리기 전에 사용자 쿼리를 먼저 여러 번 실행해서 buffer pool에 hot page를 올려두는 과정이다.

### 4\. 1차 실험: 50만 건

처음에는 50만 건으로 시작했다.

조건은 아래와 같았다.

```
MySQL: 8.4.9
buffer pool: 256MB
subscriptions: 500,000건
결제 대상: 67,857건
subscriptions table: 68.7MB
```

결과부터 말하면, 이 조건에서는 가설을 검증할 수 없었다. Innodb\_buffer\_pool\_reads가 chunk별로 0~2에 불과했고, working set 전체가 256MB buffer pool 안에서 처리됐다.

| chunk | chunks | updated | total batch | avg chunk | max chunk |
| --- | --- | --- | --- | --- | --- |
| 500 | 1,000 | 67,857 | 1.48s | 1.48ms | 33.33ms |
| 2,000 | 250 | 67,857 | 1.12s | 4.47ms | 15.51ms |
| 8,000 | 63 | 67,857 | 1.19s | 18.93ms | 38.28ms |

OLTP latency도 큰 차이가 없었다.

| chunk | op | p95 | p99 |
| --- | --- | --- | --- |
| 500 | read | 0.082ms | 0.099ms |
| 2,000 | read | 0.084ms | 0.104ms |
| 8,000 | read | 0.082ms | 0.103ms |
| 500 | update | 0.302ms | 1.707ms |
| 2,000 | update | 0.619ms | 2.789ms |
| 8,000 | update | 0.737ms | 3.946ms |

가장 결정적인 지표는 `Innodb_buffer_pool_reads`였다.

```
chunk_500  = 2
chunk_2000 = 0
chunk_8000 = 0
```

physical read가 거의 없었다.

이 조건에서는 buffer pool churn을 말하기 어렵다. 데이터와 인덱스 working set이 buffer pool 안에서 대부분 처리됐거나, 적어도 실험 중에는 disk read로 이어질 만큼 밀려나지 않았다.

이 결과만 놓고 "chunk size가 buffer pool을 흔든다"라고 쓰면 과장이다.

### 5\. 2차 실험: 500만 건

그래서 데이터를 10배로 늘렸다.

```
MySQL: 8.4.9
buffer pool: 256MB
subscriptions: 5,000,000건
결제 대상: 678,571건
subscriptions table: 712.8MB
Docker memory: 881MB / 7.67GB
```

이제 `subscriptions` 테이블 크기가 buffer pool보다 확실히 커졌다.

batch 결과는 다음과 같았다.

| chunk | chunks | updated | total batch | avg chunk | max chunk |
| --: | --: | --: | --: | --: | --: |
| 500 | 10,000 | 678,571 | 14.49s | 1.45ms | 88.04ms |
| 2,000 | 2,500 | 678,571 | 12.67s | 5.07ms | 105.44ms |
| 8,000 | 625 | 678,571 | 12.20s | 19.51ms | 235.17ms |

batch 총 시간만 보면 `chunk_8000`이 가장 빨랐다. chunk 수가 적으니 round-trip과 commit 횟수도 줄어든다.

하지만 max chunk time은 `chunk_8000`이 가장 컸다.

```
chunk_500  max chunk = 88.04ms
chunk_2000 max chunk = 105.44ms
chunk_8000 max chunk = 235.17ms
```

큰 chunk는 평균 처리량에는 유리하지만, chunk 하나가 오래 잡히는 tail risk가 생긴다.

OLTP latency는 이랬다.

| chunk | op | p95 | p99 | max |
| --- | --- | --- | --- | --- |
| 500 | read | 0.587ms | 0.758ms | 14.623ms |
| 2,000 | read | 0.580ms | 0.745ms | 1.733ms |
| 8,000 | read | 0.597ms | 0.785ms | 2.791ms |
| 500 | update | 0.307ms | 2.167ms | 124.131ms |
| 2,000 | update | 0.377ms | 2.279ms | 102.921ms |
| 8,000 | update | 0.482ms | 2.681ms | 28.043ms |

read p99는 거의 비슷했다. update p99는 chunk가 커질수록 조금 나빠졌다.

```
chunk_500  update p99 = 2.167ms
chunk_2000 update p99 = 2.279ms
chunk_8000 update p99 = 2.681ms
```

차이가 아주 크지는 않다.

그래도 update 쪽 tail latency가 조금씩 나빠지는 흐름은 보인다.

InnoDB counter는 이랬다.

```
Innodb_buffer_pool_reads
chunk_500  = 1477
chunk_2000 = 1411
chunk_8000 = 1503

Innodb_row_lock_waits
chunk_500  = 0
chunk_2000 = 0
chunk_8000 = 6
```

500만 건으로 키우니 physical read는 확실히 생겼다.

그런데 chunk별 차이는 크지 않았다.

처음 기대했던 그림은 이랬다.

```
chunk_500  -> buffer pool reads 작음
chunk_2000 -> 중간
chunk_8000 -> 크게 증가
```

실제 결과는 아니었다.

### 6\. 왜 예상과 달랐을까

가장 큰 이유는 접근 패턴이라고 본다.

이번 batch는 PK range로 훑었다.

```
WHERE id BETWEEN cur_id AND end_id
  AND next_billing_date = DATE('2026-06-01')
  AND status = 'ACTIVE'
```

그리고 실험에서는 `FORCE INDEX (PRIMARY)`로 PK range 접근을 강제했다.

PK range는 page locality가 좋다. chunk를 500으로 자르든 8,000으로 자르든, 결국 같은 500만 id 범위를 순서대로 훑는다. 전체적으로 읽는 page의 총량은 크게 달라지지 않는다.

그래서 `Innodb_buffer_pool_reads`도 chunk별로 큰 차이가 나지 않았다.

이 실험에서 buffer pool 관점으로 더 차이를 보고 싶다면 chunk size보다 접근 패턴을 바꿔야 한다.

-   PK range batch
-   random id batch
-   secondary index range batch
-   covering index 여부
-   read-ahead 설정
-   buffer pool size

이 변수들이 chunk size보다 더 크게 작용할 수 있다. 이번 실험에서 가장 크게 배운 부분도 이 지점이었다.

#### 그렇다면 읽기 부담과 쓰기 부담은 어떻게 나눠서 볼까

처음에는 midpoint insertion strategy를 보다가 "midpoint strategy 때문에 checkpoint가 늘어난다"고 연결 짓고 싶었다. 그런데 정리하면서 보니 둘은 나눠서 봐야했다.

읽기 page 유입은 hot page eviction과 관련이 깊다.

```
큰 chunk가 많은 page를 읽는다
→ buffer pool에 새 page가 들어온다
→ 기존 hot page가 밀릴 수 있다
→ OLTP가 다시 그 page를 찾으면 physical read가 늘 수 있다
```

반면 checkpoint pressure는 update 쪽 문제에 더 가깝다.

```
큰 chunk가 많은 row를 수정한다
→ dirty page가 늘어난다
→ redo log가 쌓인다
→ flush/checkpoint pressure가 커질 수 있다
```

"midpoint strategy 때문에 checkpoint가 늘어난다"라고 말하면 부정확하다.

정확히는 이렇다.

-   읽기 부담: buffer pool LRU, hot page eviction, read-ahead, physical read
-   쓰기 부담: dirty page, redo log, flush, checkpoint
-   transaction 부담: lock hold time, undo, rollback, replica apply lag

chunk size는 이 세 영역을 동시에 건드릴 수 있다. 그래서 batch 처리량 하나만 보고 정하면 위험하다.

#### 그래도 chunk size가 의미 없다는 뜻은 아니다

buffer pool reads 차이가 크지 않았다고 해서 chunk size가 의미 없다는 뜻은 아니다. 다만 이번 실험에서는 chunk size의 영향이 buffer pool보다 다른 곳에서 더 잘 보였다.

#### 1\. batch 총 시간

작은 chunk는 chunk 수가 많다.

```
chunk_500  = 10,000 chunks
chunk_8000 = 625 chunks
```

chunk 수가 많으면 loop, statement, commit 횟수가 늘어난다.  
로컬에서도 `chunk_500`은 총 batch 시간이 가장 길었다.

운영에서는 app과 DB가 네트워크를 타기 때문에 이 차이가 더 커질 수 있다. round-trip 비용이 붙기 때문이다.

#### 2\. max chunk time

큰 chunk는 chunk 하나가 오래 걸릴 수 있다.

```
chunk_8000 max chunk = 235.17ms
```

평균 처리량은 좋아도, 하나의 transaction이 길어지면 lock hold time과 rollback 비용이 커진다. 장애가 났을 때 되돌려야 할 작업 단위도 커진다.

#### 3\. lock wait

이번 clean run에서는 `chunk_8000`에서만 lock wait가 잡혔다.

```
Innodb_row_lock_waits
chunk_500  = 0
chunk_2000 = 0
chunk_8000 = 6
```

수치 자체가 크지는 않다. 그래도 방향은 봐야 한다.

주간 배치라면 사용자 update와 같은 row를 건드릴 수 있고, chunk가 커질수록 transaction이 잡는 범위와 시간이 길어진다.

### 7\. 그럼 chunk size는 어떻게 잡아야 할까

이번 실험만 놓고 보면 `chunk_2000`이 가장 균형이 좋아 보였다.

`chunk_8000`은 총 batch 시간은 가장 짧았다.  
하지만 max chunk time이 컸고, lock wait도 유일하게 발생했다.

`chunk_500`은 안정적으로 보이지만 chunk 수가 너무 많다.  
운영에서 app-DB round-trip이 붙으면 오히려 불리할 수 있다.

그래서 나라면 기본값을 이렇게 잡을 것 같다.

```sql
주간 기본값: 2,000
모니터링 후 문제가 생기면: 1,000 또는 500으로 하향
야간/저부하 시간대: 별도 실험 후 상향 가능
```

물론 이 값 자체가 정답은 아니다.

기준은 숫자 하나가 아니라 지표다.

-   API p95/p99
-   lock wait
-   deadlock
-   `Innodb_buffer_pool_reads`
-   redo log written
-   replica lag
-   rollback 시간
-   connection pool 대기

이 지표를 보면서 시스템마다 값을 정해야 한다.

### 8\. 면접 답변으로 정리하면

이제 같은 질문을 받으면 예전처럼 "부하 테스트로 잡습니다"에서 멈추지 않고, 아래 지표를 근거로 풀어낼 것 같다.

| 지표 | 보는 이유 |
| --- | --- |
| batch throughput | 전체 배치가 제한 시간 안에 끝나는지 본다.  
chunk가 너무 작으면 statement/commit 횟수가 늘어 느려질 수 있다. |
| API p95/p99 | 배치가 도는 동안 사용자 요청 tail latency가 튀는지 본다.  
주간 배치에서는 평균보다 p95/p99가 더 중요하다. |
| lock wait / deadlock | 사용자 update와 배치 update가 같은 row를 두고 충돌하는지 본다.  
chunk가 커질수록 lock을 잡는 시간이 길어질 수 있다. |
| rollback 비용 | 실패 시 되돌려야 할 작업 단위가 얼마나 큰지 본다.  
큰 chunk는 실패했을 때 재시도와 복구 부담이 커진다. |
| replica lag | 큰 transaction이 replica apply를 지연시키는지 본다.  
읽기 트래픽을 replica로 보내는 구조라면 특히 중요하다. |
| buffer pool reads | batch가 hot working set을 밀어내고 disk read를 늘리는지 본다.  
단, PK-range처럼 locality가 좋은 접근에서는 chunk별 차이가 작을 수 있다. |
| redo log written | update batch가 쓰기 I/O와 checkpoint/flush pressure를 얼마나 키우는지 본다. |

### 9\. 정리

처음 가설은 이랬다.

> chunk size가 커지면 buffer pool의 hot page를 밀어내서 OLTP latency가 튈 것이다.

실험 결과는 조금 달랐다.

500만 건까지 키우니 physical read는 생겼다.

하지만 PK-range batch에서는 chunk별 `Innodb_buffer_pool_reads` 차이가 크지 않았다. 같은 범위를 순서대로 훑기 때문에, chunk size보다 접근 패턴이 더 큰 변수였다.

대신 chunk size는 다른 곳에서 의미가 있었다.

-   작은 chunk는 commit/statement 횟수가 많아 batch 총 시간이 길어진다.
-   큰 chunk는 max chunk time, lock hold time, rollback 비용이 커질 수 있다.
-   운영에서는 network round-trip, connection pool, replica lag까지 같이 봐야 한다.

chunk size는 buffer pool만의 문제가 아니다.

접근 패턴, transaction 길이, lock, redo, 운영 SLO를 같이 보는 값이다.

### Appendix. batch sleep 보완 실험

초안 공개 후에 “배치 chunk 사이 sleep은 어떻게 되는지 같이 보면 좋겠다”는 피드백을 받았다.

본문에서는 OLTP workload 쪽에는 sleep을 넣어두고, batch chunk 사이 sleep은 아예 변수에서 제외한 상태였다. 그래서 기존 결과는 정확히 말하면 batch\_sleep = 0인 조건으로 보는 게 맞다.

이번에는 같은 500만 건 조건에서 chunk 사이에 10ms sleep을 넣어서 다시 돌렸다.

-   OLTP sleep: 1ms
-   batch chunk sleep: 10ms
-   chunk: 500 / 2,000 / 8,000

실행 쪽은 기존 프로시저를 건드리지 않고, sleep 파라미터를 받는 프로시저를 새로 추가했다.

```sql
CREATE PROCEDURE run_payment_batch_throttled(
  IN scenario_name VARCHAR(64),
  IN chunk_size INT,
  IN max_id_to_scan BIGINT UNSIGNED,
  IN chunk_sleep_seconds DECIMAL(8,3)
)
```

다만 chunk\_500은 500만 id 기준으로 10,000 chunks다.

chunk 사이에 10ms만 넣어도 sleep 누적 시간이 대략 100초 정도 붙는다. 50ms까지 올리면 500초에 가깝게 늘어난다. 큰 sleep 값을 실험할 때는 MAX\_ID를 줄이거나, 아예 chunk\_500을 제외하고 보는 편이 낫다.

#### batch 결과

결과는 다음과 같다.

-   chunk 500
    -   chunks: 10,000
    -   updated: 678,571
    -   wall batch: 121.78s
    -   db work: 16.19s
    -   avg chunk: 1.62ms
    -   max chunk: 56.96ms
-   chunk 2,000
    -   chunks: 2,500
    -   updated: 678,571
    -   wall batch: 38.04s
    -   db work: 11.97s
    -   avg chunk: 4.79ms
    -   max chunk: 106.69ms
-   chunk 8,000
    -   chunks: 625
    -   updated: 678,571
    -   wall batch: 17.78s
    -   db work: 11.25s
    -   avg chunk: 18.01ms
    -   max chunk: 109.60ms

여기서 db work는 각 chunk 트랜잭션에 실제로 걸린 시간의 합이고, wall batch는 sleep까지 포함한 전체 경과 시간이다.

#### OLTP latency

같은 조건에서 본 OLTP latency는 다음과 같다.

-   read
    -   chunk 500: p95 0.569ms, p99 0.651ms, max 19.063ms
    -   chunk 2,000: p95 0.573ms, p99 0.647ms, max 13.546ms
    -   chunk 8,000: p95 0.583ms, p99 0.761ms, max 11.817ms
-   update
    -   chunk 500: p95 0.450ms, p99 1.646ms, max 41.066ms
    -   chunk 2,000: p95 0.282ms, p99 0.908ms, max 114.115ms
    -   chunk 8,000: p95 0.339ms, p99 2.219ms, max 44.625ms

기존 throttle 없이 돌렸던 실험과 비교하면 update p99는 전반적으로 내려간 편이다.

-   no sleep
    -   chunk\_500 update p99 = 2.167ms
    -   chunk\_2000 update p99 = 2.279ms
    -   chunk\_8000 update p99 = 2.681ms
-   sleep 10ms
    -   chunk\_500 update p99 = 1.646ms
    -   chunk\_2000 update p99 = 0.908ms
    -   chunk\_8000 update p99 = 2.219ms

#### 보완 정리

이번 보완 실험으로 전체 결론이 크게 바뀌지는 않았다.

-   Innodb\_buffer\_pool\_reads는 여전히 chunk 크기에 대해 뚜렷한 방향성을 보여주지 못했다.
    -   chunk\_500 = 1794
    -   chunk\_2000 = 1631
    -   chunk\_8000 = 1430
-   Innodb\_row\_lock\_waits는 여전히 큰 chunk 쪽에서 더 잘 튀어나온다.
    -   chunk\_500 = 0
    -   chunk\_2000 = 1
    -   chunk\_8000 = 7

sleep을 넣으면 OLTP tail latency는 어느 정도 완화될 수 있다.

하지만 작은 chunk에서는 wall time이 급격히 늘어난다. 반대로 chunk를 크게 가져가면 wall time에는 유리하지만, lock wait와 transaction tail risk는 여전히 남는다.

그래서 본문에서 잡은 결론은 그대로 유지하는 게 맞다. chunk size는 단독 숫자가 아니라, chunk 사이 sleep과 "배치에 허용할 수 있는 운영 시간"을 같이 두고 조정해야 하는 값이다.

사실 아직도 “chunk size는 몇 개가 정답이다” 수준의 공식은 잘 모르겠다.

다만 이번 실험을 통해, chunk size는 메모리 튜닝값이라기보다,

배치에 얼마만큼의 시간을 빌려줄지, 그리고 OLTP·replica에 얼마나 양보할지를 조정하는 레버에 더 가깝다는 건 알게 됐다.
