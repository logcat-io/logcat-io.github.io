---
title: 'MySQL은 row를 캐시하지 않는다: Buffer Pool, LRU, 그리고 scan pollution 이해하기'
description: >-
  MySQL/InnoDB를 공부하다 보면 처음에는 쿼리, 인덱스, 실행 계획에 시선이 많이 간다.EXPLAIN에서 어떤 index를 타는지,
  type이 ref인지 range인지, rows 추정치가 얼마나 되는지부터 보게 된다.
pubDate: '2026-05-29T20:37:05+09:00'
dateSource: html-visible
slug: my-sql-row-buffer-pool-lru-scan-pollution-114
tags:
  - mysql
  - index
  - LRU
  - innodb
  - Bufferpool
  - scan
  - pollution
  - optimzation
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '114'
  sourceHtml: 114/114.html
  sourceHash: 'sha256:29fbe0e8bf3e887fee0224a8087e738ae97446916ad8341c13c6d03ff5833a14'
---

MySQL/InnoDB를 공부하다 보면 처음에는 쿼리, 인덱스, 실행 계획에 시선이 많이 간다.`EXPLAIN`에서 어떤 index를 타는지, `type`이 `ref`인지 `range`인지, `rows` 추정치가 얼마나 되는지부터 보게 된다.

그런데 InnoDB 내부 구조를 다시 정리하면서 가장 핵심이 되는 포인트가 조금 달라졌다.

> **InnoDB는 row를 캐시하는 것이 아니라 page를 캐시한다.**

이 한 문장을 기준으로 보면 여러 현상이 한 흐름으로 이어진다.

-   왜 index range scan과 random lookup의 체감 성능이 다를 수 있는가
-   왜 큰 배치 쿼리 하나가 평소 잘 돌던 OLTP API latency를 흔들 수 있는가
-   왜 InnoDB가 단순한 LRU가 아니라 young/old sublist를 둬야 했는가
-   왜 chunk size를 정할 때 row 수만 보면 부족한가

이번 글은 InnoDB buffer pool을 `page`, `LRU`, `scan pollution` 관점으로 정리한 기록이다.

## 1\. 먼저, 왜 page 기반으로 생각해야 할까

SQL을 쓰는 입장에서는 보통 row 단위로 생각한다.

```
SELECT *
FROM orders
WHERE id = 100;
```

겉으로 보면 `orders`에서 row 하나를 읽는 것처럼 보인다. 하지만 InnoDB 내부에서는 그 row가 들어 있는 **page**를 찾고, 그 page를 buffer pool에 올린 뒤, page 안에서 필요한 record를 찾는 흐름에 가깝다.

InnoDB page의 기본값은 16KB다. 설정에 따라 달라질 수 있지만, 중요한 점은 크기 자체보다 **디스크와 메모리 사이의 기본 이동 단위가 row가 아니라 page**라는 것이다.

단순화하면 다음과 같다.

```sql
SQL: row 하나를 읽는다

InnoDB 관점:
  1. index B-tree를 따라간다
  2. 필요한 index/data page를 찾는다
  3. page가 buffer pool에 있으면 memory에서 읽는다
  4. 없으면 disk에서 page를 읽어 buffer pool에 올린다
  5. page 안에서 record를 찾는다
```

이 관점으로 보면 몇 가지가 자연스럽다.

-   row 하나를 읽어도 같은 page 안의 다른 row들이 함께 메모리에 올라온다.
-   인접한 key를 따라가는 range scan은 이미 읽은 page나 근처 page를 활용하기 쉽다. 단, 인덱스/물리 배치/클러스터링 정도에 따라 실제 page locality는 달라진다.
-   랜덤한 key를 계속 조회하면 여러 page를 흩어 건드리기 쉽다.
-   같은 row 수를 읽어도 접근하는 page 수가 다르면 성능이 달라질 수 있다.

그래서 MySQL 성능을 볼 때는 "몇 row를 읽었는가"와 함께 "몇 page를 건드렸는가"를 상상해야 한다.

## 2\. Buffer Pool은 무엇을 하는가

InnoDB buffer pool은 table과 index page를 메모리에 캐시하는 공간이다. 자주 접근하는 page가 buffer pool에 있으면 disk I/O 없이 메모리에서 처리할 수 있다.

읽기 흐름은 대략 이렇다.

```
필요한 page가 buffer pool에 있음
  -> memory hit

필요한 page가 buffer pool에 없음
  -> disk에서 page read
  -> buffer pool에 적재
  -> page 안의 record 읽기
```

쓰기에서도 buffer pool은 중요하다.

```
1. buffer pool에 있는 page를 수정한다
2. page는 dirty page가 된다
3. redo log에 복구 가능한 변경 기록을 남긴다
4. dirty page는 나중에 disk로 flush된다
```

즉, buffer pool은 단순 읽기 캐시가 아니다. 읽기 성능, 쓰기 batching, dirty page flush, checkpoint 압력까지 연결되는 InnoDB의 핵심 메모리 구조다.

## 3\. LRU는 왜 등장할까

buffer pool은 유한하다. 새로운 page가 계속 들어오면 기존 page 중 일부는 밀려나야 한다. 이때 어떤 page를 남기고 어떤 page를 내보낼지 결정하는 기준이 필요하다. 가장 직관적인 기준은 LRU, 즉 Least Recently Used다. 말 그대로 최근에 사용되지 않은 page를 먼저 내보내는 방식이다. 자주 쓰는 page는 계속 남고, 오래 안 쓰는 page는 밀려난다. 얼핏 보면 꽤 합리적인 전략이다. 그런데 실제 DB workload에서는 이 LRU만으로는 막기 어려운 문제가 하나 있다. 바로 scan pollution이다.

## 4\. 순진한 LRU의 문제: scan pollution

평소에는 다음과 같은 OLTP 요청이 많다고 해보자.

-   특정 주문 조회
-   결제 상태 확인
-   회원 정보 조회
-   재고 차감

이런 요청들은 대체로 좁은 key 범위를 반복해서 접근한다. 그래서 관련 index page와 data page가 buffer pool에 올라와 있으면 latency가 안정적으로 나온다. 이 page들을 hot page라고 부를 수 있다. 그런데 같은 DB에서 리포트 생성이나 배치 작업이 큰 테이블을 처음부터 끝까지 훑는다고 해보자.

```sql
SELECT *
FROM orders
WHERE created_at >= '2026-01-01'
  AND created_at < '2026-02-01';
```

조건과 인덱스 상태에 따라 다르겠지만, 이 쿼리가 매우 넓은 범위의 page를 읽는다면 buffer pool에는 평소와 다른 page들이 대량으로 들어온다. 순수 LRU라면 방금 읽힌 scan page들이 "최근 사용된 page"로 취급된다. 그러면 원래 자주 쓰이던 hot page가 뒤로 밀리고, buffer pool 밖으로 쫓겨날 수 있다. 문제는 scan으로 읽힌 page 대부분이 다시 안 쓰일 수 있다는 점이다.

한 번 읽고 끝날 page가 반복적으로 쓰이는 hot page를 밀어내면, 이후 OLTP 요청은 다시 disk read를 해야 한다.

이게 scan pollution이다.

```
평소:
  buffer pool = hot order page, hot user page, hot payment page

대량 scan:
  report query가 많은 cold page를 읽음

순수 LRU라면:
  cold page가 최근 사용 page로 올라옴
  hot page가 밀려남

이후:
  평소 API가 다시 hot page를 disk에서 읽음
  latency 증가
```

## 5\. InnoDB는 왜 young/old를 둘까

InnoDB는 이런 문제를 줄이기 위해 단순 LRU가 아니라 midpoint insertion strategy를 사용한다. 공식 문서에서는 buffer pool LRU list가 young sublist와 old sublist로 나뉜다고 설명한다.

핵심은 새로 읽힌 page를 곧바로 "가장 중요한 hot page"로 취급하지 않는다는 점이다.

동작을 러프하게 보면 다음과 같다.

```
새로 disk에서 읽은 page
  -> LRU list의 midpoint 근처, old sublist 쪽에 들어감

짧은 시간 안에 다시 접근됨
  -> young sublist 쪽으로 승격될 수 있음

한 번 읽히고 다시 안 쓰임
  -> old sublist에 머물다가 eviction되기 쉬움
```

이 구조는 "최근에 읽힘"과 "반복해서 유용함"을 구분하려는 장치다.

새로 읽힌 page는 old sublist 쪽에 먼저 들어가므로, 한 번 훑고 지나가는 scan page가 단순 LRU보다 hot page를 덜 밀어내게 된다. 반대로 OLTP 요청이 계속 접근하는 page는 young 영역에 남기 쉽다. 덕분에 한 번 지나가는 scan이 buffer pool 전체를 오염시키는 영향을 줄일 수 있다.

물론 이것이 scan pollution을 완전히 없앤다는 뜻은 아니다. buffer pool이 작거나 scan 범위가 너무 크면, OLTP latency는 여전히 영향을 받을 수 있다. 실제 동작은 이보다 훨씬 복잡하다. 여기서는 InnoDB 동작 원리를 잡기 위한 단순화된 모델 정도로 보는 게 좋다.

## 5\. 배치 chunk size를 볼 때도 이 관점이 필요하다

배치 작업을 설계할 때 흔히 chunk size를 row 수로 정한다.

```
1000건씩 처리할까?
5000건씩 처리할까?
10000건씩 처리할까?
```

row 수는 필요한 기준이지만 충분하지 않다. InnoDB 관점에서는 이 질문도 같이 해야 한다.

> **이 chunk가 한 번에 몇 개의 page를 새로 읽게 만드는가?**

예를 들어 primary key 순서대로 좁은 범위를 읽는 batch와, 랜덤한 id 목록을 들고 여러 row를 흩어 읽는 batch는 같은 1000건이라도 buffer pool에 주는 압력이 다를 수 있다.

다음 순서로 접근해 볼 수 있다.

1.  작은 chunk로 시작한다.
2.  처리량을 측정한다.
3.  API latency 변화를 같이 본다.
4.  문제가 없을 때 chunk를 조금씩 키운다.

처리 시간만 보고 chunk를 키우면, 배치는 빨라졌는데 서비스 API가 느려지는 상황을 만들 수 있다.

## 6\. 인덱스 설계와도 연결된다

buffer pool 관점은 인덱스 설계와도 연결된다.

좋은 인덱스는 단순히 "index를 탄다"에서 끝나지 않는다. 더 적은 page를 읽게 만들고, 더 좁은 range를 지나가게 만들고, clustered index 재조회 비용을 줄일 수 있다.

예를 들어 secondary index만으로 필요한 컬럼을 모두 읽을 수 있으면 MySQL `EXPLAIN`에서 `Using index`가 보일 수 있다. 이른바 covering index다.

하지만 covering index도 공짜는 아니다.

-   index가 커지면 index page 수가 늘어난다.
-   write 시 유지해야 할 page가 늘어난다.
-   buffer pool에 올라와야 할 index page도 늘어난다.

결국 인덱스도 page 집합이다. 읽기를 줄이기 위해 만든 인덱스가 쓰기와 메모리에는 비용을 만든다. 그래서 인덱스는 쿼리 하나가 아니라 workload 전체로 봐야 한다.

## 7\. 정리

이번에 정리하면서 가장 크게 남은 문장은 이것이다.

> **MySQL 성능을 이해할 때는 row보다 page를 먼저 떠올려야 한다.**

이 관점 하나만 잡아도 여러 개념이 연결된다.

-   buffer pool은 row cache가 아니라 page cache다.
-   buffer pool miss라면 page 하나를 통째로 읽어온다.
-   range scan과 random lookup은 접근하는 page 패턴이 완전히 다르다.
-   순진한 LRU는 큰 scan에 의해 hot page를 쉽게 밀어낼 수 있다.
-   InnoDB의 young/old LRU는 scan pollution을 줄이기 위한 장치다.
-   batch chunk size는 row 수뿐 아니라 page churn 관점에서도 봐야 한다.
-   인덱스는 page 접근 수를 줄일 수도 있지만, 그 자체로 page 비용을 만든다.

InnoDB를 볼 때 `EXPLAIN`은 시작점이다. 그 다음에는 실행 계획 뒤에서 어떤 B-tree page와 data page가 움직이는지 상상해야 한다. 그 감각이 있어야 배치, 인덱스, buffer pool, API latency를 같은 그림 안에서 볼 수 있다.

## 참고

-   [MySQL 8.4 Reference Manual - InnoDB Buffer Pool](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html)
-   [MySQL 8.4 Reference Manual - The InnoDB Buffer Pool LRU Algorithm](https://dev.mysql.com/doc/refman/8.4/en/innodb-performance-midpoint_insertion.html)
-   [MySQL 8.4 Reference Manual - InnoDB Architecture](https://dev.mysql.com/doc/refman/8.4/en/innodb-architecture.html)
