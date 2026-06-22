---
title: "[DATABASE] InnoDB와 PostgreSQL은 같은 RDBMS지만 다른 곳을 봐야 한다"
description: MySQL/InnoDB와 PostgreSQL을 같이 공부하다 보면 같은 단어가 계속 나온다.
pubDate: '2026-06-20T15:18:39+09:00'
dateSource: html-visible
slug: inno-db-postgre-sql-rdbms-125
tags:
  - PostgreSQL
  - mysql
  - Explain
  - innodb
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '125'
  sourceHtml: 125/125.html
  sourceHash: 'sha256:a5a8de63745e12f076b14c372a21a46e13a028b1ec7ae53ba8221cfaaa466351'
---

MySQL/InnoDB와 PostgreSQL을 같이 공부하다 보면 같은 단어가 계속 나온다.

`page`, `buffer`, `B-tree`, `MVCC`, `checkpoint`, `WAL`, `index scan`.

처음에는 이 단어들을 같은 의미로 받아들이기 쉽다. 둘 다 관계형 데이터베이스고, 둘 다 트랜잭션을 지원하고, 둘 다 인덱스를 타면 빨라질 수 있다. 그런데 내부 구조를 조금만 더 보면 운영에서 봐야 할 지점이 달라진다.

이 글의 결론은 간단하다.

> InnoDB는 clustered index와 buffer pool을 중심으로 보고,  
> PostgreSQL은 heap, visibility, vacuum, OS page cache까지 함께 봐야 한다.

어느 쪽이 더 좋다는 이야기가 아니다. 같은 증상이라도 원인을 좁히는 질문이 달라진다는 이야기다.

## 저장 단위는 둘 다 page지만, 해석은 다르다

두 엔진 모두 디스크와 메모리 사이에서 데이터를 row 하나씩만 옮기지는 않는다. 기본 단위는 page 또는 block이다. InnoDB page size는 기본 16KB다. `innodb_page_size`로 확인할 수 있고, 인스턴스 초기화 시점의 중요한 설정이다.

```
SHOW VARIABLES LIKE 'innodb_page_size';
```

PostgreSQL은 보통 8KB block을 쓴다. 다만 compile-time 설정이므로 실제 값은 직접 확인하는 편이 맞다.

```
SHOW block_size;
```

page 크기는 단순한 숫자가 아니다. 한 번에 메모리로 올라오는 단위이고, buffer에 머무는 단위이며, page split이나 bloat를 해석하는 기준이다.

SQL에서는 row를 읽는 것처럼 보인다.

```
SELECT *
FROM orders
WHERE id = 1;
```

하지만 엔진 내부에서는 결국 어떤 page를 찾고, 그 page가 메모리에 있는지 확인하고, page 안의 record나 tuple을 읽는다.

여기까지는 비슷하다. 차이는 그 page가 어떤 구조 안에 놓이는지에서 시작된다.

## InnoDB는 primary key B-tree가 table data다

InnoDB에서 table을 볼 때 가장 먼저 잡아야 할 문장은 이것이다.

> InnoDB table은 primary key clustered index다.

InnoDB clustered index leaf page에는 primary key 값과 row의 모든 column이 들어 있다. 이 leaf page들이 곧 table data의 물리 배치다.

```
PRIMARY KEY(id)

clustered index B-tree
  root/internal page
    -> leaf page
       - id = 1, row 전체 column
       - id = 2, row 전체 column
       - id = 3, row 전체 column
```

그래서 InnoDB에서 primary key는 단순한 unique constraint가 아니다. table data가 어떤 순서로 배치되는지에 관여한다.

primary key가 순차적으로 증가하면 보통 clustered index 오른쪽 끝 근처에 insert가 모인다. write locality가 비교적 좋다. 반대로 random UUID 같은 값을 primary key로 쓰면 B-tree 전반에 insert가 흩어진다. page split, dirty page, buffer pool churn이 늘 수 있다.

물론 UUID primary key가 항상 나쁘다는 뜻은 아니다. 분산 ID 생성, merge 편의성, 추측 방지 같은 이유로 필요할 수 있다. 다만 InnoDB에서는 그 선택이 물리 배치와 secondary index 비용까지 흔든다는 점을 알고 써야 한다.

## InnoDB secondary index에는 primary key가 같이 들어간다

InnoDB에서 primary key 외의 index는 secondary index다. secondary index도 별도의 B-tree로 존재한다.

secondary index leaf에는 row 전체가 없다. leaf entry는 대략 이런 형태다.

```
secondary index key columns + primary key columns
```

예를 들어 이런 테이블이 있다고 해보자.

```
CREATE TABLE users (
  id BIGINT NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_email (email),
  INDEX idx_email_created_at (email, created_at)
);
```

`idx_email`의 leaf entry는 논리적으로 이렇게 볼 수 있다.

```
(email, id)
```

`idx_email_created_at`은 이렇게 볼 수 있다.

```
(email, created_at, id)
```

그래서 흔히 "InnoDB secondary index에는 PK가 오른쪽 끝에 붙는다"고 말한다. B-tree 정렬 기준은 사용자가 정의한 index column 순서가 먼저다. PK는 같은 secondary key 안에서 entry를 구분하고, clustered index row를 찾기 위한 locator로 뒤에 붙는다.

이 구조 때문에 secondary index lookup은 clustered index lookup으로 이어질 수 있다.

```
1. secondary index에서 email 탐색
2. leaf에서 primary key 획득
3. primary key로 clustered index 재탐색
4. clustered index leaf에서 row 전체 읽기
```

쿼리에 필요한 column이 secondary index 안에 모두 있으면 clustered lookup을 줄일 수 있다. MySQL `EXPLAIN`의 `Extra`에 `Using index`가 나오는 covering index 상황이 여기에 가깝다.

하지만 covering index도 공짜는 아니다. index에 column을 많이 넣으면 secondary index B-tree가 커지고, leaf page 수가 늘고, buffer pool에 더 많은 page가 필요하다. 쓰기 때 유지해야 할 index page도 늘어난다.

특히 primary key가 크면 모든 secondary index leaf가 같이 커진다.

```
큰 primary key
  -> clustered index key가 커짐
  -> 모든 secondary index leaf entry가 커짐
  -> index page 수 증가
  -> buffer pool 효율 저하 가능
  -> disk I/O 증가 가능
  -> write maintenance 비용 증가
```

그래서 InnoDB에서는 primary key를 작고, 고정 길이에 가깝고, 가능하면 순차적인 column으로 잡으라는 말이 나온다. 취향이 아니라 구조에서 나온 기준이다.

## PostgreSQL은 table이 heap이고 index는 heap을 가리킨다

PostgreSQL은 다르다.

PostgreSQL table은 heap이다. 실제 row version, 더 정확히는 heap tuple version이 heap page에 저장된다. primary key는 unique index와 constraint를 만들지만, InnoDB처럼 table data 자체가 primary key B-tree leaf에 들어가는 구조는 아니다.

PostgreSQL B-tree index leaf에는 row 전체가 없다. index key와 heap tuple 위치를 가리키는 TID가 있다.

```
TID(ctid) = (heap block number, line pointer offset)
```

PostgreSQL index scan을 단순화하면 이렇다.

```
1. B-tree index에서 key 탐색
2. index leaf에서 TID 획득
3. TID가 가리키는 heap page 접근
4. heap tuple 확인
5. xmin/xmax와 snapshot으로 visibility 판단
6. visible한 tuple을 row로 반환
```

모든 index가 heap으로 가는 접근 경로에 가깝다. InnoDB처럼 "table = PK B-tree"가 아니다.

그래서 PostgreSQL에서 primary key가 중요하지 않다는 뜻은 아니다. primary key는 여전히 constraint, join, foreign key, index size에 영향을 준다. 다만 InnoDB처럼 table data의 물리 배치와 모든 secondary index leaf locator 구조를 직접 흔드는 방식은 아니다.

PostgreSQL에서 더 중심이 되는 관찰 포인트는 heap과 MVCC다.

-   UPDATE로 새 tuple version이 생기는가?
-   dead tuple이 얼마나 쌓이는가?
-   autovacuum이 제때 정리하는가?
-   bloat가 커지고 있는가?
-   index scan 뒤 heap fetch가 얼마나 발생하는가?
-   index-only scan에서 visibility map 상태가 좋은가?

InnoDB에서는 primary key와 secondary index leaf 구조를 먼저 떠올리게 된다. PostgreSQL에서는 heap, tuple version, visibility, vacuum을 먼저 보게 된다.

## MVCC도 old version을 어디에 두는지가 다르다

두 엔진 모두 MVCC를 제공한다. 하지만 old version을 관리하는 방식이 다르다.

InnoDB는 undo log를 기반으로 이전 version을 재구성한다. 오래 열린 transaction이 있으면 purge가 old version을 정리하지 못하고 history가 쌓일 수 있다.

```
InnoDB
  current clustered record
  undo log로 이전 version 재구성
  purge가 cleanup
```

PostgreSQL은 heap에 여러 tuple version이 남는다. UPDATE는 보통 기존 tuple을 제자리에서 덮어쓰는 방식이 아니라 새 tuple version을 만들고, old tuple에는 더 이상 현재 version이 아니라는 정보를 남긴다.

```
PostgreSQL
  heap에 여러 tuple version 존재
  snapshot으로 visible version 판단
  vacuum/autovacuum이 cleanup
```

공통 결론은 같다.

오래 열린 transaction은 위험하다.

InnoDB에서는 undo/history 증가와 purge 지연으로 나타난다. PostgreSQL에서는 dead tuple 증가와 vacuum 지연으로 나타난다. 증상은 다르지만 "old version cleanup이 밀린다"는 본질은 같다.

## Cache 구조도 출발점이 다르다

InnoDB는 buffer pool을 1차 cache로 쓴다. table page와 index page를 buffer pool에 올려두고, 가능하면 그 안에서 읽고 쓴다.

운영에서는 buffer pool 상태가 핵심이다.

```
SHOW ENGINE INNODB STATUS\G

SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages%';
```

또 `innodb_flush_method=O_DIRECT` 같은 설정을 사용하면 data file I/O가 OS page cache를 거의 거치지 않도록 만들 수 있다. 이렇게 하면 InnoDB buffer pool과 OS page cache에 같은 data page가 동시에 올라가는 double buffering을 줄일 수 있다.

단정하면 안 되는 부분도 있다. MySQL도 OS cache의 영향을 완전히 안 받는 것은 아니다. 파일 시스템 metadata, redo log, temporary file, storage device cache, OS I/O scheduler 같은 요소는 여전히 남아 있다. `O_DIRECT`의 실제 효과도 OS, storage, workload에 따라 다르다.

그래도 큰 방향은 이렇다.

> InnoDB는 cache의 중심을 buffer pool에 두고, OS page cache 개입을 줄이는 방향으로 튜닝할 수 있다.

PostgreSQL은 다르게 봐야 한다.

PostgreSQL에도 `shared_buffers`가 있지만, 일반적인 운영 흐름에서는 파일 시스템 I/O와 OS page cache가 강하게 엮인다.

```
PostgreSQL backend
  -> shared_buffers
  -> OS page cache
  -> disk
```

같은 block이 `shared_buffers`와 OS page cache에 동시에 있을 수 있다. `shared_buffers`를 크게 잡는다고 OS page cache와의 관계가 사라지지 않는다. PostgreSQL 공식 튜닝 가이드에서 `shared_buffers`를 무작정 크게 잡지 말고 OS cache 여지를 남기라고 말하는 것도 이 흐름과 연결된다.

그래서 PostgreSQL에서는 DB 내부 지표와 OS 지표를 같이 봐야 한다.

```
SHOW shared_buffers;
SHOW block_size;

SELECT *
FROM pg_stat_bgwriter;
```

쿼리 단위로는 `EXPLAIN (ANALYZE, BUFFERS)`가 중요하다.

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM orders
WHERE customer_id = 10;
```

여기서 `shared hit`, `read`, `dirtied`, `written`을 보면서 PostgreSQL buffer 관점의 움직임을 읽는다. 동시에 OS page cache, I/O wait, read/write throughput도 같이 봐야 한다.

## Log도 같은 "로그"가 아니다

MySQL/InnoDB와 PostgreSQL 모두 crash recovery를 위해 log를 쓴다.

하지만 이름과 역할을 섞으면 안 된다.

InnoDB에는 redo log가 있다. InnoDB data page 변경을 crash recovery할 수 있게 만든다. MySQL server layer에는 binary log도 있다. binlog는 replication과 point-in-time recovery 흐름에서 중요하다.

```
MySQL/InnoDB
  redo log: InnoDB crash recovery
  binlog  : replication, PITR
```

PostgreSQL은 WAL이 crash recovery와 physical replication의 중심이다. logical decoding/replication도 WAL 흐름과 연결된다.

```
PostgreSQL
  WAL: crash recovery, physical replication, logical decoding 기반
```

그래서 "로그가 쌓인다"는 말을 들었을 때 MySQL에서는 redo log인지 binlog인지부터 나눠야 한다. PostgreSQL에서는 WAL 생성량, checkpoint, replication slot, archiving 상태까지 같이 본다.

commit durability 설정도 다르다.

MySQL에서는 `innodb_flush_log_at_trx_commit`, `sync_binlog` 같은 설정을 봐야 한다. PostgreSQL에서는 `synchronous_commit`, WAL flush, checkpoint 관련 설정을 본다.

## Torn page 방지도 다른 장치를 쓴다

storage가 page 단위 atomic write를 항상 보장한다고 가정하면 안 된다. 쓰기 중 전원이 나가거나 OS/storage 계층에서 partial page write가 발생하면 page가 깨질 수 있다.

InnoDB는 대표적으로 doublewrite buffer를 쓴다. PostgreSQL은 full page writes를 쓴다.

둘 다 성능 튜닝 스위치처럼 보일 수 있지만, 본질은 장애 복구 정책이다. 이 설정을 바꾸려면 storage 보장, data checksum, backup/restore 훈련, 장애 허용 범위를 같이 봐야 한다.

운영에서 위험한 접근은 이렇다.

```
"쓰기량이 많으니 doublewrite/full_page_writes를 꺼볼까?"
```

그 전에 물어야 할 질문이 있다.

-   storage가 어떤 atomicity를 보장하는가?
-   backup과 replica가 같은 손상을 같이 복제하지 않는가?
-   성능 이득이 durability 리스크를 감수할 만큼 큰가?

## UPDATE 비용도 다른 곳에서 터진다

InnoDB UPDATE를 단순화하면 이런 흐름이다.

```
clustered index record 변경
undo 생성
redo 생성
secondary index 변경 필요 시 처리
purge가 old version cleanup
```

PostgreSQL UPDATE는 보통 이런 흐름으로 본다.

```
old tuple xmax 설정
new tuple version 생성
index 변경 필요 시 처리
WAL 생성
vacuum이 old tuple cleanup
```

둘 다 UPDATE는 공짜가 아니다. 하지만 관찰 포인트가 다르다.

InnoDB에서는 undo/history list, purge lag, secondary index maintenance, row lock/gap lock을 본다. PostgreSQL에서는 dead tuple, bloat, HOT update 여부, autovacuum, visibility map을 본다.

같은 update-heavy workload라도 MySQL에서는 purge가 밀리는지, PostgreSQL에서는 vacuum이 따라가는지부터 질문이 갈린다.

## Covering index와 Index Only Scan도 같은 말이 아니다

InnoDB에서 covering index는 비교적 직관적이다.

secondary index leaf에 쿼리가 필요한 column이 모두 있으면 clustered index lookup을 줄일 수 있다.

```
InnoDB covering index
  -> secondary index leaf에서 필요한 값을 얻음
  -> clustered index lookup 감소
```

PostgreSQL의 `Index Only Scan`은 조건이 하나 더 있다.

index에 필요한 column이 있어야 하고, heap page의 visibility 확인을 생략할 수 있어야 한다. 이때 visibility map의 all-visible bit가 중요하다.

```
PostgreSQL Index Only Scan
  1. 필요한 column이 index에 있음
  2. visibility map상 heap page가 all-visible임
  3. heap fetch를 생략할 수 있음
```

그래서 PostgreSQL 실행 계획에 `Index Only Scan`이 나와도 `Heap Fetches`를 같이 봐야 한다. `Heap Fetches`가 많으면 이름은 index-only지만 실제로는 heap 접근이 섞이고 있다는 뜻이다.

MySQL의 `Using index`와 PostgreSQL의 `Index Only Scan`을 같은 말처럼 외우면 안 된다.

## 대형 로그 테이블도 선택지가 다르다

대형 로그 테이블을 다룰 때 두 엔진의 선택지도 조금 다르다.

MySQL/InnoDB에서는 보통 다음 조합을 본다.

-   B-tree index
-   range partitioning
-   summary table
-   archive table

PostgreSQL에서는 여기에 BRIN index와 materialized view가 자연스럽게 후보에 들어간다.

-   B-tree index
-   BRIN index
-   partitioning
-   summary table
-   materialized view

PostgreSQL의 BRIN은 append-only 성격의 시간 컬럼에서 유용할 수 있다. 반면 MySQL에는 PostgreSQL BRIN과 같은 일반 목적 BRIN index가 없다. 그래서 MySQL에서는 range partition과 B-tree 설계를 더 신중하게 같이 본다.

두 엔진 모두 대량 DELETE는 조심해야 한다.

InnoDB에서는 undo, purge, binlog, replica delay가 같이 커질 수 있다. PostgreSQL에서는 dead tuple, vacuum, WAL, bloat가 문제로 이어질 수 있다. 오래된 데이터를 제거해야 한다면 row 단위 DELETE보다 partition drop/truncate, archive table, summary table 전략을 먼저 검토하는 편이 안전할 때가 많다.

## 장애 분석에서 먼저 보는 질문도 다르다

여기서는 매뉴얼과 여러 운영 사례에서 흔히 언급되는 “먼저 확인하는 지표들”을 적어 본다. 실제 환경마다 다를 수 있지만, 대략 이런 흐름으로 생각하면 정리가 된다.

MySQL/InnoDB에서 먼저 볼 것:

-   `SHOW ENGINE INNODB STATUS`
-   buffer pool dirty page 관련 지표
-   history list length
-   row lock wait
-   deadlock
-   redo log/checkpoint
-   binlog와 replica lag
-   slow query와 execution plan

PostgreSQL에서 먼저 볼 것:

-   `pg_stat_activity`
-   `pg_locks`
-   `pg_stat_bgwriter` 또는 checkpoint 통계
-   `pg_stat_user_tables.n_dead_tup`
-   autovacuum 상태
-   WAL 생성량
-   replication slot 상태
-   `EXPLAIN (ANALYZE, BUFFERS)`

공통으로 조심할 점도 있다.

buffer hit ratio 하나만 보고 결론내리면 위험하다. 같은 hit ratio라도 scan workload가 hot page를 밀어내는지, dirty page flush가 밀리는지, checkpoint가 튀는지에 따라 원인과 대응이 달라진다.

`index scan`이라는 말도 끝이 아니다. InnoDB secondary index scan은 clustered lookup이 추가될 수 있고, PostgreSQL index scan은 heap fetch와 visibility check가 붙을 수 있다.

## 같은 말을 다르게 해석해야 한다

`page가 dirty다`

공통적으로 메모리 page가 disk보다 최신이라는 뜻이다. 하지만 flush thread/process, checkpoint, log 구조는 다르다.

`MVCC가 있다`

공통적으로 snapshot read를 제공하지만, old version 저장 위치와 cleanup 방식이 다르다. InnoDB는 undo/purge, PostgreSQL은 heap tuple/vacuum을 본다.

`index scan이다`

InnoDB에서는 secondary index leaf에서 primary key를 얻고 clustered index를 다시 찾을 수 있다. PostgreSQL에서는 index leaf에서 TID를 얻고 heap tuple visibility를 확인한다.

`vacuum 같은 정리가 필요하다`

InnoDB는 purge가 undo/old version을 정리한다. PostgreSQL은 vacuum이 heap dead tuple과 visibility/freeze 문제를 다룬다. 같은 정리 작업으로 뭉뚱그리면 안 된다.

## 정리

InnoDB와 PostgreSQL은 같은 RDBMS지만 내부에서 row를 찾아가는 길이 다르다.

InnoDB는 primary key clustered index가 table data의 중심이다. secondary index leaf에는 secondary key와 primary key가 들어가고, 필요한 경우 primary key로 clustered index를 다시 찾아간다. 그래서 primary key 선택이 물리 배치, secondary index 크기, buffer pool 효율까지 흔든다.

PostgreSQL은 heap이 table data의 중심이다. index leaf는 heap tuple 위치인 TID를 가리키고, 실제 row version의 visibility는 heap tuple metadata와 snapshot으로 판단한다. 그래서 heap, visibility, vacuum, bloat가 성능 분석의 중심에 들어온다.

cache도 다르다.

InnoDB는 buffer pool을 중심으로 OS page cache 영향을 줄이는 방향으로 튜닝할 수 있다. PostgreSQL은 shared\_buffers와 OS page cache가 함께 움직이는 구조라 OS cache 상태를 빼놓고 설명하기 어렵다.

log와 cleanup도 다르다.

MySQL에서는 redo log와 binlog를 나눠 봐야 하고, InnoDB purge 지연을 확인해야 한다. PostgreSQL에서는 WAL, checkpoint, vacuum, autovacuum 상태를 함께 봐야 한다.

같은 단어를 쓰더라도 내부에서 지나가는 길은 다르다.

그 길을 다르게 그릴 수 있어야, 같은 `EXPLAIN` 결과를 보고도 MySQL과 PostgreSQL에서 다른 질문을 던질 수 있다.
