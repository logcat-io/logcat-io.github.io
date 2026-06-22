---
title: "[SPRING BATCH] Spring Batch 6 도입 중 Chunk 기반 처리 버그 디버깅 및 6.0.1 패치 적용"
description: >-
  배치 서버 신규 이관 작업을 진행하면서 Spring Batch 6 버전을 도입하였다. Spring Boot 3.x, Java 21 환경을
  기준으로 배치 서버를 구성하는 상황이었기 때문에, Spring Batch 역시 최신 메이저 버전을 사용하는 것이 자연스러운 선택이었다.
pubDate: '2026-01-03T16:05:30+09:00'
dateSource: html-visible
slug: spring-batch-6-chunk-6-0-1-97
tags:
  - Debugging
  - SpringBatch
  - '6'
  - 버그
  - ChunkOrientedStep
  - bug
category: Spring Framework/Spring Batch
cover: /images/posts/spring-batch-6-chunk-6-0-1-97/spring-batch.png
draft: false
legacy:
  tistoryId: '97'
  sourceHtml: 97/97.html
  sourceHash: 'sha256:e5441ff57b8625b289db88174ea1835852ebf0d55c68fee66f34c312140970ee'
---

1\. 들어가며

배치 서버 신규 이관 작업을 진행하면서 **Spring Batch 6 버전**을 도입하였다. Spring Boot 3.x, Java 21 환경을 기준으로 배치 서버를 구성하는 상황이었기 때문에, Spring Batch 역시 최신 메이저 버전을 사용하는 것이 자연스러운 선택이었다.

하지만 이관 과정에서 **Chunk 기반 Step이 정상적으로 동작하지 않는 문제**를 발견하게 되었고, 해당 문제를 디버깅한 결과 **애플리케이션 구현이 아닌 프레임워크 버그**임을 확인하게 되었다.

이 글은 Spring Batch 6 도입 과정에서 만난 버그를 어떻게 인지하고, 공식 이슈를 통해 확인한 뒤, 최종적으로 패치 버전을 적용하여 해결한 과정을 정리한 기록이다.

* * *

## 2\. 중점적으로 봐야 하는 내용

-   Spring Batch 6에서 **Chunk 기반 Step 쿼리가 1회만 실행되는 버그**가 존재했다
-   Step / Job 상태는 COMPLETED 이지만 실제 데이터 처리는 수행되지 않았다
-   동일 코드가 Spring Batch 5.x 에서는 정상 동작했다
-   공식 GitHub 이슈로 등록된 **회귀(regression) 버그**였다
-   Spring Batch **6.0.1 패치 적용으로 문제를 해결**했다

* * *

## 3\. 본론

### 3-1. 발생한 증상

문제는 Chunk 기반 Step 실행 시 다음과 같은 형태로 나타났다.

-   JDBC 기반 ItemReader 사용
-   Reader 쿼리는 **최초 1회만 실행**
-   이후 Chunk 반복이 진행되지 않음
-   readCount / writeCount 증가 없음
-   Step / Job 상태는 정상적으로 COMPLETED

즉, **실제 데이터는 처리되지 않았지만 배치는 성공한 것처럼 종료되는 상태**였다.

운영 환경에서는 치명적인 문제로 이어질 수 있는 상황이다.

### 3-2. 디버깅 과정

초기에는 다음과 같은 가능성을 우선적으로 의심했다.

-   @StepScope, @JobScope 설정 문제
-   JobParameter 전달 오류
-   Reader open / close lifecycle 문제
-   메타 DB / 도메인 DB 분리로 인한 트랜잭션 이슈

그러나 다음 사실이 명확했다.

-   SQL 로그 상 Reader 쿼리는 1회만 실행
-   Chunk 반복 로직 자체가 실행되지 않음

이 시점에서 **Spring Batch 6 내부 동작 변경 또는 버그 가능성**을 열어두고 조사하였다. 

#### 코드 레벨 디버깅

문제의 원인을 코드 레벨에서 확인하기 위해 디버깅을 진행하였다.  
사용 중인 Reader는 JdbcPagingItemReader였기 때문에, 단순히 Reader 내부만이 아니라 **상위 Step 구현체까지 흐름을 따라가며 확인**할 필요가 있었다.

이에 따라 ChunkOrientedStep 까지 breakpoint를 설정하고 실행 흐름을 추적하였다. 그 과정에서 **ChunkTracker 내부의 moreItems 플래그가 갱신되지 않는 현상**을 발견하였다.

```java
private static class ChunkTracker {

    private boolean moreItems = true;
    private boolean moreItems;

    void noMoreItems() {
    
    void init() {
    	this.moreItems = true;
    }

    void reset() {
	    this.moreItems = false;
    }
    
    ...
```

-   moreItems는 쿼리 수행 이후
    -   “다음에 읽을 row가 더 존재하는지”를 판단하는 플래그 변수이다
-   정상적인 경우:
    -   Chunk 처리 종료 후 reset() 을 통해 상태가 초기화된다
-   문제 상황:
    -   moreItems가 false로 변경된 이후
    -   **다음 Chunk 반복 전에 reset 되지 않고 그대로 유지됨**

#### 문제가 되는 이유

이 부분이 문제가 되는 이유는 다음과 같다.

-   JdbcPagingItemReader는 일반적으로 **빈으로 등록되어 싱글톤으로 동작**
-   내부 상태(moreItems 등)는 인스턴스 변수로 관리됨
-   한 번 false로 변경된 상태가 reset 되지 않으면
    -   이후 Chunk 반복 시에도 “더 이상 읽을 데이터가 없다”고 판단
    -   결과적으로 **Chunk 반복이 즉시 종료**

즉, Reader 내부 상태가 정상적으로 초기화되지 않으면서 **실제 데이터가 존재함에도 Step 이 종료되는 상황**이 발생한 것이다.

이 동작은 애플리케이션 코드나 설정 문제라기보다는 **Spring Batch 6 내부 Chunk 반복 처리 로직의 회귀(regression) 문제**로 판단할 수 있는 지점이었다.

![](/images/posts/spring-batch-6-chunk-6-0-1-97/spring-batch.png)

### 3-3. 공식 이슈 확인

조사한 내용으로 검색 결과, 동일한 문제가 **Spring Batch 공식 GitHub 이슈**로 이미 등록되어 있었다.

-   이슈 링크  
    [https://github.com/spring-projects/spring-batch/issues/5126](https://github.com/spring-projects/spring-batch/issues/5126)

![](/images/posts/spring-batch-6-chunk-6-0-1-97/screenshot-2026-01-03-at-4-01-06-pm.png)

해당 이슈에서는 다음과 같은 내용이 확인되었다.

-   Spring Batch 6에서 Chunk 반복 처리 로직이 조기에 종료되는 회귀 버그
-   Reader 가 더 읽을 데이터가 있음에도 Step 이 종료됨
-   이미 **수정 커밋은 머지된 상태**
-   다만 당시 기준으로는 **패치 릴리스는 아직 배포되지 않음**

즉, 이번 문제는 **애플리케이션 코드 문제가 아닌 프레임워크 자체 버그**였다.

### 3-4. Spring Batch 6.0.1 패치 적용

이후 Spring Batch **6.0.1 패치 버전이 릴리스**되었고,아래와 같이 BOM 버전을 명시하여 패치를 적용하였다.

```java
dependencyManagement {
    imports {
        mavenBom("org.springframework.batch:spring-batch-bom:6.0.1")
    }
}
```

패치 적용 후 확인한 결과는 다음과 같다.

-   Chunk 기반 Step 정상 반복 수행
-   Reader 쿼리 다회 실행 확인
-   read / write 카운트 정상 증가
-   기존 Job 코드 수정 없이 문제 해결

* * *

## 4\. 나의 인사이트

이번 경험을 통해 다시 한 번 느낀 점은 다음과 같다.

-   메이저 버전 도입 시에는 **프레임워크 내부 회귀 버그 가능성**을 항상 염두에 두어야 한다
-   이상 동작을 무조건 구현 문제로 단정하지 말고, 공식 이슈를 함께 확인하는 습관이 필요하다
-   “릴리스 대기 중인 패치”를 전제로 한 **운영 리스크 관리 전략**도 설계의 일부이다
-   Spring Batch 6 자체는 충분히 사용할 만한 버전이며, **6.0.1 패치로 안정성이 크게 개선되었다**

신규 버전 도입은 단순한 업그레이드가 아니라, **검증과 리스크 관리까지 포함한 하나의 작업**이라는 점을 다시 체감한 경험이었다.

## 참고 자료

-   [Spring Batch Issue #5126](https://github.com/spring-projects/spring-batch/issues/5126)
