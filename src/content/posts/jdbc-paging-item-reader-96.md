---
title: JdbcPagingItemReader 정리
description: JdbcPagingItemReader는 keyset 기반 페이징 방식을 통해 데이터를 일정 단위로 나누어 읽는 ItemReader이다.
pubDate: '2025-12-13T21:16:11+09:00'
dateSource: html-visible
slug: jdbc-paging-item-reader-96
tags:
  - 배치
  - 스프링배치
  - ItemReader
  - JdbcPagingItemReader
  - JdbcItemReader
  - JdbcCursorItemReader
category: Spring Framework/Spring Batch
draft: false
legacy:
  tistoryId: '96'
  sourceHtml: '96/96-[Spring-Batch]-JdbcPagingItemReader-정리.html'
  sourceHash: 'sha256:25c8c3c415b423f8ec1083d7ebb7810e07923502e4441785b5f2ba3a03a72130'
---

1\. 개요

JdbcPagingItemReader는 **keyset 기반 페이징 방식**을 통해 데이터를 일정 단위로 나누어 읽는 ItemReader이다.  
마지막으로 처리한 위치를 기준으로 다음 데이터를 조회하며, 이는 JdbcCursorItemReader와 구조적으로 완전히 다른 접근 방식이다.

JdbcPagingItemReader 역시 AbstractItemCountingItemStreamItemReader의 구현체이지만,  
**커넥션 관리, 장애 복구, 처리 단위** 측면에서 Cursor 방식과는 근본적인 차이가 있다.

## 2\. 초기화 과정 (doOpen)

JdbcPagingItemReader는 AbstractPagingItemReader를 상속하며, Step 시작 시 doOpen() 메서드를 통해 초기화를 수행한다.

이 단계에서 수행되는 작업은 다음과 같다.

-   PagingQueryProvider 설정 검증
-   SQL 생성 준비
-   내부 상태 초기화

**중요한 점은 이 단계에서 데이터베이스 커넥션을 획득하지 않는다는 것이다.** 이는 Cursor 방식과 가장 큰 차이점 중 하나이다.

## 3\. 데이터 조회 흐름 (doRead → doReadPage)

### 3.1 doRead()

AbstractPagingItemReader.doRead()가 호출되면 다음 흐름이 진행된다.

1.  ReentrantLock 기반 lock 획득
2.  내부 버퍼가 비어 있으면 doReadPage() 호출
3.  버퍼에 적재된 데이터를 하나씩 반환

이 lock은 멀티스레드 환경에서 **페이지 단위 데이터 일관성**을 보장하기 위한 장치이다.

### 3.2 doReadPage()

실제 DB 조회는 JdbcPagingItemReader.doReadPage()에서 수행된다.

-   기본적으로 JdbcTemplate 사용
-   Named parameter 사용 시 NamedParameterJdbcTemplate 사용
-   PagingQueryProvider가 생성한 SQL 실행
-   pageSize 만큼의 데이터를 조회

조회된 데이터는 AbstractPagingItemReader의 \*\*내부 버퍼(pageResults)\*\*에 저장된다.

## 4\. PagingQueryProvider와 DB별 페이징 처리

JdbcPagingItemReader는 데이터베이스별로 다른 페이징 전략을 추상화하기 위해 PagingQueryProvider를 사용한다.

-   MySQL
-   PostgreSQL
-   Oracle
-   SQL Server

각 DB에 맞는 **keyset 기반 페이징 SQL**을 생성한다.

```java
this.firstPageSql =
    this.queryProvider.generateFirstPageQuery(this.getPageSize());

this.remainingPagesSql =
    this.queryProvider.generateRemainingPagesQuery(this.getPageSize());
```

-   첫 페이지와 이후 페이지 SQL을 분리
-   마지막 처리 key를 기준으로 다음 페이지 조회

## 5\. 상태 저장과 재시작 (Restartability)

JdbcPagingItemReader는 마지막으로 처리한 key 값을 **ExecutionContext(JobRepository)**에 저장한다.

이를 통해 다음과 같은 장점이 있다.

-   장애 발생 시 마지막 처리 지점부터 재시작 가능
-   jumpToItem()을 통해 빠른 위치 복구
-   불필요한 데이터 재조회 없음

이는 ResultSet 포인터에 의존하는 Cursor 방식과의 결정적인 차이이다.

## 6\. 커넥션 생명주기 관점의 차이

구분CursorPaging

<table style="border-collapse: collapse; width: 100%;" border="1" data-end="3331" data-start="3193" data-ke-align="alignLeft"><tbody data-end="3331" data-start="3232"><tr data-end="3264" data-start="3232"><td data-col-size="sm" data-end="3241" data-start="3232">커넥션 유지</td><td data-col-size="sm" data-end="3251" data-start="3241">Step 전체</td><td data-col-size="sm" data-end="3264" data-start="3251">페이지 조회 시점</td></tr><tr data-end="3288" data-start="3265"><td data-col-size="sm" data-end="3276" data-start="3265">DB 세션 점유</td><td data-col-size="sm" data-end="3282" data-start="3276">장시간</td><td data-col-size="sm" data-end="3288" data-start="3282">짧음</td></tr><tr data-end="3310" data-start="3289"><td data-col-size="sm" data-end="3297" data-start="3289">장애 복구</td><td data-col-size="sm" data-end="3303" data-start="3297">불안정</td><td data-col-size="sm" data-end="3310" data-start="3303">안정적</td></tr><tr data-end="3331" data-start="3311"><td data-col-size="sm" data-end="3317" data-start="3311">재시작</td><td data-col-size="sm" data-end="3323" data-start="3317">어렵다</td><td data-col-size="sm" data-end="3331" data-start="3323">명확하다</td></tr></tbody></table>

JdbcPagingItemReader는 **페이지 조회 시점에만 커넥션을 획득하고 즉시 반환**하므로, 대용량 배치와 운영 환경에 훨씬 적합하다.

## 7\. 정리

JdbcPagingItemReader는 다음과 같은 특성을 가진다.

-   keyset 기반 페이징 방식
-   커넥션 장기 점유 없음
-   명확한 재시작 지점
-   Chunk 처리와 자연스러운 결합
-   대용량 배치에 적합한 구조

이는 Cursor 방식이 가지는 **커넥션 장기 점유, 장애 취약성, 재시작 불안정성**을 구조적으로 해결한 설계이다.
