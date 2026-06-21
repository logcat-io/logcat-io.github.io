---
title: 윈도우 함수 + VIEW 조합의 성능 함정
description: '1\. 들어가며: "VIEW에 윈도우 함수가 있으면 인덱스가 안 먹힌다?"'
pubDate: '2026-03-03T22:59:57+09:00'
dateSource: html-visible
slug: view-98
tags:
  - mysql
  - Performance
  - SQL
  - TUNING
  - 윈도우
  - 함수
  - window
  - function
  - DB
  - 성능
  - Optimization
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '98'
  sourceHtml: '98/98-[MySQL]-윈도우-함수-+-VIEW-조합의-성능-함정.html'
  sourceHash: 'sha256:a3b882510953c6c0c72aba9948e1f17947ec71038c545f660a97b645c7e2a314'
---

1\. 들어가며: "VIEW에 윈도우 함수가 있으면 인덱스가 안 먹힌다?"

최근 동료가 특정 기능을 작업하던 중 조회 성능이 급격히 저하되는 문제를 겪었다. 원인은 윈도우 함수가 포함된 VIEW 테이블을 조회할 때 발생한 현상이었으며, 이 조합이 **Condition Push-Down**을 방해한다는 점을 분석하였다. 평소 뷰를 편리하게 사용해왔으나 이러한 구체적인 성능 제약 사항은 경험해 본 적이 없었다. 이에 해당 지식을 직접 확인하고 이해하기 위해 로컬 환경에서 Docker를 이용해 상황을 재현하고 실험을 진행하였다.

### 2\. 이론적 배경: 왜 옵티마이저는 조건을 무시하는가?

MySQL 옵티마이저는 뷰를 쿼리할 때 두 가지 실행 전략을 선택한다.

-   **Merge:** 뷰의 정의와 외부 쿼리를 합쳐 하나의 최적화된 쿼리로 실행한다. 인덱스 활용이 가능하다.
-   **Materialization (구체화):** 뷰 결과를 먼저 임시 테이블로 만든 뒤 필터링을 수행한다. 인덱스 활용이 불가능하다.

뷰 내부에 DENSE\_RANK()와 같은 윈도우 함수가 포함되면 MySQL은 무조건 **Materialization** 전략을 택한다. 이는 **의미론적 오류(Semantic Error)**를 막기 위함이다. 윈도우 함수는 특정 범위(Window) 내의 데이터를 기준으로 값을 계산하는데, 외부 WHERE 조건을 미리 내부로 밀어 넣으면(Push-Down) 계산의 기반이 되는 데이터셋 자체가 바뀌어 결과값이 왜곡될 수 있기 때문이다.

그리고 실행 순서상 WINDOW FUNCTION은 **WHERE 이후**에 실행되기 때문이다.

```sql
FROM / JOIN
WHERE
GROUP BY
HAVING
WINDOW FUNCTION
SELECT
ORDER BY
LIMIT
```

### 3\. 실험 환경 구축 (Reproduction Lab)

실제 운영 환경의 규모를 모사하기 위해 Docker 기반 MySQL 환경에서 약 **3만 건**의 샘플 데이터를 생성하였다.

#### 3-1. 실험용 카페 도메인 테이블 (DDL)

```sql
CREATE TABLE baristas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50)
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    menu VARCHAR(50),
    customer_name VARCHAR(50),
    barista_id BIGINT,
    created_at DATETIME,
    FOREIGN KEY (barista_id) REFERENCES baristas(id),
    INDEX idx_barista_id (barista_id) -- 성능 최적화를 위한 인덱스
);
```

#### 3-2. 윈도우 함수 기반 VIEW 생성

```sql
CREATE OR REPLACE VIEW v_barista_rank AS
SELECT
  DENSE_RANK() OVER (ORDER BY o.menu) AS menu_rank,
  o.id AS order_id, o.menu, o.customer_name, o.barista_id, b.name AS barista_name
FROM orders o
JOIN baristas b ON b.id = o.barista_id
ORDER BY menu_rank;
```

### 4\. 성능 문제 재현 및 실행 계획 분석

#### 4-1. VIEW를 통한 조회 (Materialization 발생)

```sql
EXPLAIN ANALYZE
SELECT * FROM v_barista_rank WHERE barista_id = 10;
```

```sql
-> Materialize (rows=30000)
    -> Sort (rows=30000)
        -> Window aggregate: dense_rank() (rows=30000)
            -> Sort: o.menu (rows=30000)
                -> Table scan on orders (30000 rows)
```

-   **실행 계획 요약:**
    -   \-> Materialize (rows=30000)
    -   \-> Window aggregate: dense\_rank()
    -   \-> Table scan on orders (30000 rows)
-   **분석:** 바리스타 10번의 주문은 1,042건뿐이지만, MySQL은 전체 30,000건을 모두 스캔하고 정렬하여 윈도우 함수를 계산한 뒤 임시 테이블을 만든다. 그 후에야 **barista\_id = 10** 을 필터링한다. 데이터가 수백만 건일 경우 시스템 장애로 이어질 수 있는 위험한 구조이다.

#### 4-2. Native Query로 우회 (Push-Down 성공)

```sql
EXPLAIN ANALYZE
SELECT DENSE_RANK() OVER (ORDER BY o.menu) AS menu_rank, o.*
FROM orders o WHERE o.barista_id = 10;
```

```sql
-> Window aggregate (rows=1042)
    -> Sort (rows=1042)
        -> Index lookup on orders using barista_id (rows=1042)
```

-   **실행 계획 요약:**
    -   \-> Window aggregate (rows=1042)
    -   \-> Index lookup on orders using idx\_barista\_id (rows=1042)
-   **분석:** WHERE 조건이 먼저 적용되어 인덱스를 타고 필요한 1,042건만 먼저 읽어온다. 계산 대상이 **약 23배** 줄어들며 성능이 드라마틱하게 개선된다.

### 5\. 성능 비교 요약

<table style="border-collapse: collapse; width: 100%; height: 80px;" border="1" data-ke-align="alignLeft"><tbody><tr style="height: 20px;"><td style="width: 17.1706%; height: 20px; text-align: left;"><b>비교 항목</b></td><td style="width: 42.2867%; height: 20px; text-align: center;"><b>VIEW 기반 조회 (Problem)</b></td><td style="width: 40.5426%; height: 20px; text-align: center;"><b>Native Query (Solution)</b></td></tr><tr style="height: 20px;"><td style="width: 17.1706%; height: 20px; text-align: left;"><b>처리 데이터 수</b></td><td style="width: 42.2867%; height: 20px; text-align: center;"><b>30,000 rows (전체)</b></td><td style="width: 40.5426%; height: 20px; text-align: center;"><b>1,042 rows (필터링)</b></td></tr><tr style="height: 20px;"><td style="width: 17.1706%; height: 20px; text-align: left;"><b>최적화 전략</b></td><td style="width: 42.2867%; height: 20px; text-align: center;"><b>Materialization (구체화)</b></td><td style="width: 40.5426%; height: 20px; text-align: center;"><b>Push-down + Index</b></td></tr><tr style="height: 20px;"><td style="width: 17.1706%; height: 20px; text-align: left;"><b><span data-path-to-node="31,3,0,0">평균 실행 시간</span></b></td><td style="width: 42.2867%; height: 20px; text-align: center;"><b>69ms</b></td><td style="width: 40.5426%; height: 20px; text-align: center;"><b>3ms (약 23배 개선)</b></td></tr></tbody></table>

### 6\. 나의 인사이트: 지식은 재현을 통해 완성된다

이번 실험을 통해 다음과 같은 사실을 명확히 체감하였다.

-   윈도우 함수가 포함된 VIEW는 무조건 Materialization 경로를 따른다.
-   외부 WHERE 조건을 아무리 잘 걸어도 Push-down 되지 않으면 성능은 회복될 수 없다.
-   데이터 규모가 커질수록 이 문제는 기하급수적인 성능 저하를 야기한다.
-   Native Query로 우회하여 인덱스를 활용하면 조회 범위를 대폭 축소할 수 있다.
-   운영 시스템에서 윈도우 함수가 포함된 VIEW 사용은 특별히 주의해야 한다.

#### **참고 자료**

-   [MySQL Manual: Derived Condition Pushdown Optimization](https://dev.mysql.com/doc/refman/8.4/en/derived-condition-pushdown-optimization.html)
