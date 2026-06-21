---
title: 'MVCC 학습 문서: MySQL(InnoDB)와 PostgreSQL을 함께 이해하기'
description: >-
  이 글은 MVCC를 이론에서 시작해 실습으로 내려오는 순서로 정리한 글이다. 먼저 MVCC 가 왜 필요한지에 대해서 이해하고, MySQL과
  PostgreSQL이 MVCC를 구현한 방식에 대해서 간단히 살펴본다. 마지막으로 간단한 SQL 실습을 통해서 MVCC가 동작함을 확인한다.
pubDate: '2026-05-26T16:51:11+09:00'
dateSource: html-visible
slug: mvcc-my-sql-inno-db-postgre-sql-113
tags: []
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '113'
  sourceHtml: 113/113.html
  sourceHash: 'sha256:290b5a7396ec6a953edfaf671a9c3e72f542cb44867963e11779393df36e1f2b'
---

이 글은 MVCC를 이론에서 시작해 실습으로 내려오는 순서로 정리한 글이다. 먼저 MVCC 가 왜 필요한지에 대해서 이해하고, MySQL과 PostgreSQL이 MVCC를 구현한 방식에 대해서 간단히 살펴본다. 마지막으로 간단한 SQL 실습을 통해서 MVCC가 동작함을 확인한다.

### 1\. MVCC의 목적

MVCC(Multi-Version Concurrency Control)는 여러 트랜잭션이 동시에 같은 데이터를 읽고 써도, 읽기 일관성과 동시성을 함께 확보하려는 방식이다.

핵심은 간단하다.

-   하나의 row만 두고 락으로만 버티지 않는다.
-   각 트랜잭션이 자기 시점에 맞는 버전을 보게 한다.
-   읽기와 쓰기의 충돌을 줄인다.

이 방식이 필요한 이유는 분명하다.

-   읽기 트랜잭션이 쓰기 트랜잭션을 불필요하게 막지 않아야 한다.
-   쓰기 트랜잭션이 읽기 트랜잭션 전체를 멈추게 하면 처리량이 떨어진다.
-   같은 row라도 트랜잭션마다 보여야 하는 값이 다를 수 있다.

MVCC는 더티 리드를 피하는 수준을 넘어서, 일관된 snapshot을 제공하는 것을 목표로 한다.

### 2\. MVCC를 이해할 때 먼저 잡아야 할 개념

#### 2.1 Snapshot

Snapshot은 트랜잭션 또는 SQL 문장이 바라보는 데이터의 기준 시점이다.

-   어떤 트랜잭션은 이미 커밋된 값만 본다.
-   어떤 트랜잭션은 자기 시작 시점의 모습을 계속 본다.
-   같은 `SELECT`라도 격리 수준에 따라 결과가 달라질 수 있다.

직관적으로 보면 이런 구조다.

```
Data Page   -> 현재 버전
Undo Log    -> 이전 버전
TRX_ID      -> 이 버전을 만든 트랜잭션
Roll_PTR    -> 이전 버전으로 가는 포인터
Read View   -> 지금 이 버전을 보여줄지 결정하는 기준
```

#### 2.2 Version

여기서 version은 MVCC row version을 뜻한다.

-   MySQL InnoDB에서는 현재 레코드와 undo 정보를 조합해서 과거 버전을 복원한다.
-   PostgreSQL에서는 heap tuple version 자체가 버전 단위로 남고, `xmin`과 `xmax` 같은 메타데이터로 가시성을 판단한다.

#### 2.3 Visibility

Visibility는 “이 snapshot에서 이 버전을 보여도 되는가”를 판단하는 규칙이다.

-   현재 row가 있어도 내 트랜잭션에서는 안 보일 수 있다.
-   오래된 버전이 남아 있어도 이미 누구에게도 필요 없는 경우가 있다.
-   이 경우 cleanup 대상이 된다.

#### 2.4 Read lock과 Write lock

MVCC가 있다고 해서 lock이 사라지는 것은 아니다. MVCC는 주로 **읽기 일관성**을 버전으로 해결하고, lock은 **같은 row를 동시에 어떻게 만질지**를 정한다.

Read lock

read lock은 보통 **shared lock** 성격이다.

-   여러 트랜잭션이 같은 row를 읽는 것은 허용한다.
-   하지만 그 row를 바꾸는 작업은 막는다.
-   “읽고 나서 같은 row를 기준으로 후속 작업을 하겠다”는 상황에서 사용한다.

Write lock

write lock은 보통 **exclusive lock** 성격이다.

-   같은 row에 대해 다른 트랜잭션이 동시에 수정하지 못하게 막는다.
-   필요하면 읽기도 막는다.
-   동일 row를 기준으로 변경을 확정해야 할 때 사용한다.

MVCC와의 관계

-   일반 `SELECT`는 보통 snapshot read를 한다.
-   `SELECT ... FOR UPDATE` / `SELECT ... FOR SHARE` 같은 locking read는 row lock을 건다.
-   `UPDATE` / `DELETE`도 내부적으로는 해당 row를 안전하게 수정하기 위한 lock을 사용한다.
-   따라서 “MVCC = lock이 없음”은 아니다. 더 정확히는 “읽기 경로에서의 충돌을 줄이기 위해 MVCC를 쓰고, 충돌이 중요한 경로에서는 lock을 함께 쓴다”가 맞다.

TIP

-   단순 조회면 snapshot read가 맞다.
-   읽은 값을 기준으로 곧바로 갱신해야 하면 locking read를 고려한다.
-   여러 row의 합이나 조건이 정합성 규칙이라면 `SERIALIZABLE` 또는 명시적 잠금이 필요할 수 있다.

### 3\. MySQL InnoDB의 MVCC

InnoDB는 일반적으로 **undo log + read view** 중심으로 MVCC를 이해하면 된다.

row 변경 동작은 다음과 같다.

1.  UPDATE 또는 DELETE가 발생하면 기존 값의 이전 모습이 undo 쪽에 남는다.
2.  데이터 페이지에는 최신 레코드가 남는다.
3.  읽는 트랜잭션은 read view를 기준으로 현재 버전을 볼지 결정한다.
4.  현재 버전이 보이면 그대로 읽고, 보이면 안 되면 undo를 따라가서 과거 버전을 재구성한다.

즉 InnoDB는 “버전을 테이블에 계속 쌓는다”기보다, **현재 버전과 undo 기반 과거 복원**으로 이해하는 편이 정확하다.

#### 3.1 InnoDB에서 중요한 내부 요소

-   clustered index: 실제 row가 저장되는 기준 구조
-   secondary index: 보조 탐색 경로
-   undo log: 과거 값을 복원하기 위한 기록
-   read view: 어떤 트랜잭션이 보이는지 판단하는 기준
-   purge: MVCC와 rollback에 더 이상 필요하지 않은 undo를 정리하는 과정

#### 3.2 InnoDB가 오래된 버전을 정리해야 하는 이유

오래된 MVCC version이 계속 남으면 다음 문제가 생긴다.

-   undo가 쌓인다.
-   history list가 길어진다.
-   오래된 snapshot 때문에 purge가 못 지우는 구간이 늘어난다.
-   디스크와 버퍼 효율이 떨어진다.
-   긴 트랜잭션이 운영 병목이 된다.

### 4\. PostgreSQL의 MVCC

PostgreSQL은 UPDATE가 일어날 때 기존 row를 덮어쓰는 방식이 아니라 **새 tuple version을 만드는 방식**으로 이해하는 편이 좋다.

핵심 메타데이터는 다음과 같다.

-   `xmin`: 이 tuple을 만든 트랜잭션
-   `xmax`: 이 tuple의 생명을 끝내는 데 관여한 트랜잭션

읽는 쪽은 snapshot 기준으로 visible한 tuple만 선택한다.

#### 4.1 PostgreSQL에서 중요한 내부 요소

-   heap tuple version: 실제 row version
-   transaction ID: 가시성 판단의 핵심 입력
-   VACUUM / autovacuum: 더 이상 필요 없는 dead tuple 정리
-   visibility map: vacuum과 index-only scan에 영향을 주는 보조 정보

#### 4.2 PostgreSQL이 cleanup을 반드시 해야 하는 이유

PostgreSQL은 이전 버전 tuple이 실제 heap에 남기 때문에 오래되면 정리가 필요하다.

-   dead tuple이 쌓인다.
-   table과 index가 커진다.
-   더 많은 page를 읽게 된다.
-   vacuum이 늦어지면 성능과 운영 안정성이 떨어진다.

#### 4.3 PostgreSQL 쿼리

```
SELECT ctid, xmin, xmax, id, balance
FROM account
WHERE id = 1;

SELECT relname, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

SELECT pid, state, query, xact_start
FROM pg_stat_activity
WHERE state <> 'idle';
```

확인 포인트:

-   tuple version이 실제로 어떻게 보이는지
-   dead tuple이 쌓이는지
-   long transaction이 vacuum을 막고 있는지

### 5\. MySQL과 PostgreSQL의 차이

| 항목 | MySQL InnoDB | PostgreSQL |
| --- | --- | --- |
| 과거 버전 관리 | undo log와 read view로 과거 버전 재구성 | 새 tuple version 생성 후 xmin/xmax로 가시성 판단 |
| 기본 격리 수준 | Repeatable Read | Read Committed |
| 읽기 일관성 핵심 | consistent read, read view | snapshot visibility |
| locking read | `SELECT ... FOR UPDATE`, `SELECT ... FOR SHARE` | `FOR UPDATE`, `FOR SHARE` |
| 버전 정리 | purge가 중요 | vacuum/autovacuum이 중요 |
| 버전 저장 감각 | 현재 레코드 + undo | heap 안에 버전이 누적 |

### 6\. 실습: MySQL InnoDB에서 스냅샷 확인

아래 실습은 세션을 여러 개 열어, 같은 row가 트랜잭션마다 다르게 보이는 것을 확인하는 예제다.

준비

```
DROP DATABASE IF EXISTS mvcc_lab;
CREATE DATABASE mvcc_lab;
USE mvcc_lab;

CREATE TABLE account (
  id INT PRIMARY KEY,
  owner_name VARCHAR(20),
  balance INT,
  note VARCHAR(20),
  KEY idx_note(note)
) ENGINE=InnoDB;

INSERT INTO account VALUES (1, 'LogCat', 1000, 'A');
COMMIT;
```

Session 1: 오래된 snapshot 열기

```
USE mvcc_lab;
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT id, owner_name, balance, note FROM account WHERE id = 1;
-- 기대 결과: A
```

Session 2: 현재 값을 변경

```
USE mvcc_lab;
UPDATE account SET note = 'B', balance = 2000 WHERE id = 1;
COMMIT;
```

Session 1: 같은 snapshot 유지

```
SELECT id, owner_name, balance, note FROM account WHERE id = 1;
-- 기대 결과: 여전히 A
```

Session 3: 새 snapshot에서 읽기

```
USE mvcc_lab;
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT id, owner_name, balance, note FROM account WHERE id = 1;
-- 기대 결과: B
```

추가 변경

```
UPDATE account SET note = 'C', balance = 3000 WHERE id = 1;
COMMIT;
```

이후에도:

-   Session 1은 A를 본다.
-   Session 3은 B를 본다.
-   새로 시작한 세션은 C를 본다.

관찰 쿼리

```
SELECT
  trx_id,
  trx_state,
  trx_started,
  TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_seconds,
  trx_rows_locked,
  trx_rows_modified,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

확인 포인트:

-   살아 있는 transaction이 무엇인지
-   오래 열린 transaction이 있는지

### 7\. 정리

MVCC 는 단순히 "버전을 여러 개 둔다"는 뜻이 아니다.

-   MySQL InnoDB는 undo log 와 read view로 과거 버전을 복원한다.
-   PostgreSQL은 tuple version과 xmin/xmax, vacuum으로 버전 생명주기를 관리한다.
-   두 DB 모두 읽기 일관성을 얻는 대신, 오래된 버전 정리가 반드시 필요하다.

### 8\. 참고

-   MySQL Locking Reads: [https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
-   MySQL Isolation Levels: [https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
-   PostgreSQL MVCC Introduction: [https://www.postgresql.org/docs/current/mvcc-intro.html](https://www.postgresql.org/docs/current/mvcc-intro.html)
-   PostgreSQL Transaction Isolation: [https://www.postgresql.org/docs/current/transaction-iso.html](https://www.postgresql.org/docs/current/transaction-iso.html)
-   PostgreSQL SSI wiki: [https://wiki.postgresql.org/wiki/SSI](https://wiki.postgresql.org/wiki/SSI)
