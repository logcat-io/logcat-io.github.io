---
title: "[JPA] 트랜잭션 전파로 인해 업데이트 쿼리가 발행되지 않은 문제 해결하기"
description: 프로젝트를 수행하면서 동시성 문제를 redisson을 활용하여 해결하였다. 해당 글은 아래에서 확인할 수 있다.
pubDate: '2024-02-22T02:25:50+09:00'
dateSource: html-visible
slug: post-74
tags:
  - Transactional
  - spring
  - boot
  - 스프링
  - 부트
  - 트랜잭션
  - 전파
  - 문제
  - Transaction
  - propagation
category: ORM/JPA
cover: /images/posts/post-74/screenshot-2024-02-22-at-2-18-03-am.png
draft: false
legacy:
  tistoryId: '74'
  sourceHtml: >-
    74/74-[JPA]-트랜잭션-전파로-인해-업데이트-쿼리가-발행되지-않은-문제-해결하기.html
  sourceHash: 'sha256:f1bfa721bacf270858f75ca0ebebf1739c56855ee6a7fdb9b4424e1e9a9cc1bf'
---

## 들어가며

프로젝트를 수행하면서 동시성 문제를 redisson을 활용하여 해결하였다. 해당 글은 아래에서 확인할 수 있다.

[\[Spring & Spring Boot\] - \[Redisson\] SpringBoot + Redisson을 활용한 동시성 문제 해결하기](https://ditto-dev.tistory.com/73)

[\[Redisson\] SpringBoot + Redisson을 활용한 동시성 문제 해결하기](https://ditto-dev.tistory.com/73)

하지만 문제를 해결하기 위해서 임계 영역에 대한 락을 발행하였지만, **데이터베이스에 값이 갱신되지 않는 상황이 발생**하였다.

## 문제 정의

의심되는 상황은 2가지로 정리할 수 있었다. 

1.  락이 정상적으로 발행되지 않았다.
2.  업데이트 쿼리가 정상적으로 날아가지 않았다.

1번의 경우 redis를 모니터링한 결과 정상적으로 락이 발행된 것을 확인할 수 있었다.

![](/images/posts/post-74/screenshot-2024-02-22-at-2-18-03-am.png)

2번의 경우인 JPA 옵션을 통해서 업데이트 쿼리가 발행되지 않는 것을 확인하였고, 평균 100건에 4건 정도만 정상적으로 날아갔다.

업데이트 쿼리가 생성되어야 하는 로직은 다음과 같다.

```java
@Override  
public void upAgreeCount(Long postId) {  
  PostEntity postEntity = findPostEntityorElseThrow(postId);  
  postEntity.upAgreeCount();  
  postJpaRepository.saveAndFlush(postEntity);  
}
```

업데이트 로직에서는 엔티티를 바로 반영하기 위해서 _**saveAndFlush**_ 메서드를 호출하였는데, 이때 업데이트 쿼리가 날아가지 않은 것이다.

**문제의 원인은 메서드 호출에 따른 트랜잭션 전파에서 찾을 수 있었다.** 아래는 메서드 호출에 대한 흐름을 간략히 도식화했다.

![](/images/posts/post-74/screenshot-2024-02-22-at-2-19-45-am.png)

_**VoteServiceImpl**에서_ _**Transaction**_을 시작하게 되고, _**PostRepositoryImpl**_에서도 _**Transaction**_을 시작하게 된다.   
  
이때 트랜잭션 내부에서 새로운 트랜잭션을 다시 실행하는 경우 내부 트랜잭션이 외부 트랜잭션을 이어받게 된다. 이는 **하나의 물리 트랜잭션으로 묶인다는 것을 의미**할 수 있다.

다음은 공식문서의 글을 발췌한 것이다.

> PROPAGATION\_REQUIRED enforces a physical transaction, either locally for the current scope if no transaction exists yet or participating in an existing 'outer' transaction defined for a larger scope.

여기서 고민해 볼 점은 트랜잭션에 대한 _**Commit**_ 요청은 한 번 수행될 수 있다. 만약에 내부 트랜잭션이 하나의 물리 트랜잭션으로 묶이게 된다면, 내부 트랜잭션은 어떻게 될 것인가?  
  
결론은 아무것도 수행하지 않는다는 것이다. 즉, 새로운 커넥션을 생성하여 트랜잭션을 수행하지 않는다. 단지 역할을 수행하지만 트랜잭션이 끝나는 시점은 물리 트랜잭션이 끝나는 시점에 반영되게 된다.  
  
이는 위의 다이어그램에서 _**PostRepository**_에서 락을 획득하는 것과 별개로, _**PostRepositoryImpl**_의 트랜잭션은 물리 트랜잭션인 _**VoterServiceImpl**_에서 시작한 트랜잭션이 끝날 때 비로소 _**Commit**_ 이 수행되는 것을 의미한다  
  
그렇기 때문에 락을 획득해서 접근을 제한해도 업데이트 쿼리가 물리 트랜잭션이 _**Commit**_ 되는 순간까지는 날아가지 않았던 것이다.

## 문제 해결

트랜잭션 전파를 해결하기 위해서는 내부 트랜잭션을 물리 트랜잭션과 분리하여 독립적인 트랜잭션으로 만들어 주면 된다. 이때 _**PROPAGATION\_REQUIRES\_NEW**_를 사용하면 간단하게 각 트랜잭션 범위에 대한 독립적인 물리적 트랜잭션을 생성하게 되고, 외부 트랜잭션에 참여하지 않게 된다. _**@Transactional**_ 어노테이션에 아래와 같이 적용할 수 있다.

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)  
public void upAgreeCount(Long postId) {
	...
}
```

적용 후, 정상적으로 업데이트 쿼리가 발행되고 테스트 코드도 정상적으로 통과하는 것을 확인할 수 있었다.

![](/images/posts/post-74/screenshot-2024-02-22-at-2-21-57-am.png)

## 참고

[https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

[https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)
