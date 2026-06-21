---
title: SELECT FOR UPDATE를 pg_locks로 따라가 보기
description: PostgreSQL에서 SELECT ... FOR UPDATE를 실행하면 row lock이 잡힌다고 말한다.
pubDate: '2026-06-20T15:49:41+09:00'
dateSource: html-visible
slug: select-for-update-pg-locks-126
tags: []
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '126'
  sourceHtml: 126/126.html
  sourceHash: 'sha256:fb682a9e63eae8ce62b45353050afcef286539228a2a6fbeadd016b78c6b395d'
---

PostgreSQL에서 `SELECT ... FOR UPDATE`를 실행하면 row lock이 잡힌다고 말한다.

이 말은 맞지만, `pg_locks`를 처음 열어보면 생각보다 헷갈린다. 분명 row 하나를 잠갔는데 `pg_locks`에는 `relation`, `virtualxid`, `transactionid` 같은 항목이 먼저 보인다. 같은 row를 다른 세션에서 다시 `FOR UPDATE`하려고 하면 그제야 `tuple` lock도 보인다.

처음에는 “row lock이 보인다는 건가, 안 보인다는 건가”가 애매했다.

이번 글은 `Lock Fundamentals Labs`에서 세 개의 세션을 띄워놓고 `SELECT ... FOR UPDATE`가 실제로 어떤 lock entry로 관찰되는지 정리한 기록이다.

실습은 PostgreSQL 기준이다. 출력은 lab 환경의 PostgreSQL 18에서 관찰한 값이고, 실행 계획이나 PostgreSQL 버전에 따라 세부 row는 조금 달라질 수 있다. 그래도 `transactionid` lock을 통해 wait 관계를 해석하는 큰 흐름은 같다.

### 실습 세션 구성

세션은 세 개를 사용했다.

```text
T1  : 먼저 row를 SELECT FOR UPDATE로 잡는 세션
T2  : 같은 row를 다시 SELECT FOR UPDATE하려고 시도하는 세션
OBS : pg_locks, pg_stat_activity를 읽기만 하는 관찰자 세션
```

OBS 세션에서는 `BEGIN`을 열지 않았다. 관찰자가 트랜잭션을 오래 붙잡으면, 관찰자 자신이 lock holder가 될 수 있기 때문이다.

테이블은 단순하게 만들었다.

```sql
DROP TABLE IF EXISTS lock_demo;

CREATE TABLE lock_demo (
  id bigint PRIMARY KEY,
  value text NOT NULL
);

INSERT INTO lock_demo VALUES
  (1, 'a'),
  (2, 'b'),
  (3, 'c');
```

관찰 쿼리는 이런 식으로 사용했다.

```sql
SELECT
  pid,
  locktype,
  mode,
  granted,
  relation::regclass,
  transactionid,
  virtualtransaction
FROM pg_locks
WHERE pid IN (
  SELECT pid
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state IN ('active', 'idle in transaction')
)
ORDER BY pid, granted DESC;
```

## pid와 transactionid는 같은 값이 아니다

먼저 T1에서 트랜잭션을 열고 row 하나를 잡았다.

```sql
BEGIN;
SELECT * FROM lock_demo WHERE id = 1 FOR UPDATE;
```

이 상태에서 `pg_locks`를 보면 대략 이런 항목이 나온다.

| pid | locktype | mode | granted | relation | transactionid |
| --- | --- | --- | --- | --- | --- |
| 87 | relation | RowShareLock | t | lock\_demo |   |
| 87 | relation | RowShareLock | t | lock\_demo\_pkey |   |
| 87 | virtualxid | ExclusiveLock | t |   |   |
| 87 | transactionid | ExclusiveLock | t |   | 787 |

여기서 `pid`와 `transactionid`를 분리해서 봐야 한다. `pid`는 PostgreSQL backend process, 즉 세션의 식별자다. 반면 `transactionid`는 그 세션 안에서 현재 수행 중인 트랜잭션 번호다.

그래서 아래 한 줄은:

```text
pid = 87, locktype = transactionid, mode = ExclusiveLock, transactionid = 787
```

이렇게 읽는 편이 좋다.

```text
세션 87이 트랜잭션 787을 수행 중이고,
그 트랜잭션 ID에 대해 ExclusiveLock을 들고 있다.
```

이 lock은 다른 세션이 T1을 기다릴 수 있게 만드는 기준점이 된다. row 자체를 기다리는 것처럼 보이지만, PostgreSQL 내부에서는 그 row를 잡고 있는 트랜잭션을 기다린다.

### T1이 FOR UPDATE를 잡았을 때 보이는 것

T1만 `FOR UPDATE`를 잡고 있을 때 관찰한 항목을 다시 나눠보면 이렇다.

```text
relation      RowShareLock   lock_demo
relation      RowShareLock   lock_demo_pkey
virtualxid    ExclusiveLock
transactionid ExclusiveLock  transactionid = 787
```

`lock_demo`와 `lock_demo_pkey`에 잡힌 `RowShareLock`은 relation-level lock이다. `FOR UPDATE`를 실행할 때 PostgreSQL은 대상 테이블에 `RowShareLock`을 잡는다. 이번 실습에서는 primary key 조건으로 접근했기 때문에 PK index relation인 `lock_demo_pkey`에도 `RowShareLock`이 보였다.

여기서 조심할 점이 있다.

이 `RowShareLock`이 우리가 말하는 row lock 그 자체는 아니다. 이름 때문에 헷갈리지만, `RowShareLock`은 table-level lock mode다. 같은 relation에 대해 어떤 종류의 작업들이 동시에 가능한지 관리하는 상위 lock으로 보는 편이 맞다.

실제 row-level lock은 heap tuple header 쪽에 기록된다. PostgreSQL은 tuple의 `xmax`와 infomask 계열 metadata를 이용해 “이 tuple은 어떤 transaction이 어떤 방식으로 잠갔는가”를 표현한다.

그래서 T1 혼자 row를 잡고 있을 때는 `pg_locks`만 봐서는 row lock 자체가 직접 보이지 않는다.

이 부분이 처음에는 제일 헷갈렸다.

```text
pg_locks에 보이는 것:
  - relation lock
  - virtualxid lock
  - transactionid lock

tuple header에 기록되는 것:
  - row-level lock owner xid
```

`pg_locks`는 lock manager 관점에서 기다릴 수 있는 대상들을 보여준다. row의 소유자 정보는 tuple 쪽에 있고, wait 관계가 생기면 그 owner xid를 따라 `transactionid` lock 대기가 만들어진다.

## T2가 같은 row를 FOR UPDATE하면 무엇이 달라질까

이제 T2에서 같은 row를 다시 잡아본다.

```sql
BEGIN;
SELECT * FROM lock_demo WHERE id = 1 FOR UPDATE;
```

이 쿼리는 T1이 commit 또는 rollback 할 때까지 대기한다.

이 시점의 `pg_locks`에서는 이런 조합이 보인다.

| pid | locktype | mode | granted | relation | transactionid |
| --- | --- | --- | --- | --- | --- |
| 177 | relation | RowShareLock | t | lock\_demo |   |
| 177 | relation | RowShareLock | t | lock\_demo\_pkey |   |
| 177 | transactionid | ExclusiveLock | t |   | 792 |
| 182 | relation | RowShareLock | t | lock\_demo |   |
| 182 | relation | RowShareLock | t | lock\_demo\_pkey |   |
| 182 | tuple | AccessExclusiveLock | t | lock\_demo |   |
| 182 | transactionid | ShareLock | f |   | 792 |

T1부터 보면 단순하다.

T1은 `transactionid = 792`에 대해 `ExclusiveLock`을 들고 있다. 이 트랜잭션이 현재 `id = 1` row를 잡고 있는 owner다.

T2는 조금 더 흥미롭다.

T2도 `lock_demo`, `lock_demo_pkey`에 `RowShareLock`을 잡았다. 여기까지는 “나도 이 relation에서 row-level lock을 시도하겠다”에 가깝다.

그리고 `tuple` locktype으로 `AccessExclusiveLock`이 `granted = true` 상태로 보인다. 이름이 꽤 강해 보이지만, 이것을 “T2가 row lock을 최종 획득했다”로 읽으면 안 된다. 이미 T1이 tuple header에 owner xid를 남겨둔 상태이기 때문이다.

핵심은 마지막 줄이다.

| session | locktype | mode | granted | transactionid |
| --- | --- | --- | --- | --- |
| T2 | transactionid | ShareLock | false | 792 |

T2는 tuple header에서 owner xid가 792라는 사실을 보고, `transactionid = 792`에 `ShareLock`을 요청했다. 그런데 T1이 같은 transactionid에 `ExclusiveLock`을 들고 있으니, T2의 요청은 `granted = false`로 대기한다.

한 줄로 줄이면 이렇다.

```text
T1은 transactionid 792를 ExclusiveLock으로 들고 있고,
T2는 같은 transactionid 792에 ShareLock을 요청하다가 막혀 있다.
```

즉, wait의 대상은 tuple 자체가 아니라 그 tuple을 잡고 있는 transaction이다.

### tuple header와 transactionid lock은 역할이 다르다

이번 실습을 통해 가장 확실히 정리된 부분은 이 레이어 구분이다.

```text
tuple header
  - 특정 row version을 누가 잠갔는지 기록한다.
  - 예: owner xid = 792

transactionid lock
  - 다른 세션이 그 transaction의 종료를 기다릴 수 있게 한다.
  - holder: ExclusiveLock
  - waiter: ShareLock, granted = false

relation lock
  - table/index relation 단위의 상위 호환성을 관리한다.
  - 예: RowShareLock
```

T1이 `id = 1`을 `FOR UPDATE`로 잡으면 tuple header에 owner xid가 기록된다. T2가 같은 row를 잡으려 할 때 PostgreSQL은 이 owner xid를 확인한다. 그리고 `pg_locks`에서 `transactionid = owner xid`에 대한 `ShareLock`을 요청한다.

이미 owner transaction은 자기 transactionid에 `ExclusiveLock`을 들고 있다. 그래서 T2는 대기한다.

이 구조 덕분에 PostgreSQL은 “누가 누구를 기다리는가”를 lock manager에서 표현할 수 있다. row의 소유권은 tuple에 있고, wait graph는 transactionid lock으로 이어진다.

### 왜 holder는 ExclusiveLock이고 waiter는 ShareLock일까

처음 봤을 때는 이 부분도 이상했다.

T1이 `ExclusiveLock`을 들고 있고, T2가 기다린다면 T2도 `ExclusiveLock`을 요청해야 할 것 같았다. 그런데 실제로는 T2가 `ShareLock`을 요청한다. 이 방식이 더 자연스럽다.

holder의 `ExclusiveLock`은 “이 transaction은 아직 진행 중이고, 다른 transaction이 이 transaction의 종료를 기다려야 한다”는 기준점이다. waiter의 `ShareLock`은 “나는 이 transaction이 끝날 때까지 기다리겠다”는 표시다. 같은 transactionid에 여러 세션이 동시에 기다릴 수 있으므로 waiter 쪽은 share mode로 표현된다.

만약 기다리는 쪽까지 모두 exclusive 요청으로만 표현한다면, 여러 waiter를 같은 transactionid 아래에 자연스럽게 줄 세우기 어렵다. PostgreSQL은 holder와 waiter의 mode를 다르게 두면서, 하나의 transactionid에 대해 현재 owner와 대기자들을 함께 표현한다.

실제로 운영에서 볼 때는 `granted = false`인 `transactionid ShareLock`을 찾으면 된다. 그 `transactionid` 값이 기다리고 있는 owner xid다.

### 운영에서 볼 때는 무엇을 먼저 봐야 할까

운영에서 lock wait를 볼 때 처음부터 tuple header를 직접 파고들기는 어렵다. 보통은 `pg_locks`, `pg_stat_activity`, `pg_blocking_pids()`부터 본다.

예를 들어 이런 쿼리로 blocked session을 먼저 찾을 수 있다.

```go
SELECT
  a.pid,
  a.state,
  a.wait_event_type,
  a.wait_event,
  pg_blocking_pids(a.pid) AS blocking_pids,
  a.query
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;
```

그 다음 `pg_locks`에서 `granted = false`인 항목을 본다.

```sql
SELECT
  pid,
  locktype,
  mode,
  granted,
  relation::regclass,
  transactionid
FROM pg_locks
WHERE NOT granted
ORDER BY pid;
```

`locktype = transactionid`, `mode = ShareLock`, `granted = false`라면, 대개 다른 transaction이 잡고 있는 row-level lock 때문에 기다리는 상황으로 볼 수 있다. 이때 `transactionid` 값은 “내가 기다리는 transaction”이다.

물론 이것만으로 모든 원인을 끝까지 설명할 수는 없다. 어떤 SQL이 그 row를 잡았는지, 왜 transaction이 오래 열려 있는지, 애플리케이션이 commit을 늦게 하는지까지 같이 봐야 한다.

그래도 출발점은 분명해진다.

```text
blocked pid가 기다리는 transactionid는 무엇인가?
그 transactionid를 가진 holder pid는 누구인가?
holder는 왜 commit/rollback 하지 않고 있는가?
```

이 세 질문으로 좁혀가면 된다.

### 정리

이번 실습에서 얻은 기준은 세 가지다.

첫째, `pid`와 `transactionid`는 다른 축이다. `pid`는 세션이고, `transactionid`는 그 세션이 수행 중인 transaction의 ID다. 세션은 자기 transactionid에 `ExclusiveLock`을 들고, 이 lock이 다른 세션의 대기 대상이 된다.

둘째, `SELECT ... FOR UPDATE`에서 실제 row-level lock은 주로 tuple header의 `xmax`/infomask 쪽에 기록된다. T1만 잡고 있을 때 `pg_locks`에는 relation `RowShareLock`, `virtualxid`, `transactionid ExclusiveLock`이 보이고, row lock 자체가 그대로 한 줄로 드러나지는 않는다.

셋째, 같은 row를 두 번째 세션이 다시 `FOR UPDATE`하려고 하면 wait 관계가 `transactionid ShareLock, granted = false`로 나타난다. T2는 tuple의 owner xid를 보고, 그 transactionid가 끝나기를 기다린다.

이 패턴을 알고 나면 `pg_locks` 출력이 덜 낯설어진다.

row를 기다리는 것처럼 보여도, PostgreSQL은 결국 “그 row를 잡고 있는 transaction”을 기다린다.
