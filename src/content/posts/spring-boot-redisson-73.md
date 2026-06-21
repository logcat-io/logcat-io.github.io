---
title: SpringBoot + Redisson을 활용한 동시성 문제 해결하기
description: 'SpringBoot를 기반으로 실시간 투표 애플리케이션을 구현하면서, 한 가지 실험을 수행했다.'
pubDate: '2024-02-15T02:35:17+09:00'
dateSource: html-visible
slug: spring-boot-redisson-73
tags:
  - Lock
  - race
  - condition
  - redis
  - SpringBoot
  - redisson
  - 동시성
  - 이슈
  - 문제
category: Spring Framework/Spring & Spring Boot
cover: /images/posts/spring-boot-redisson-73/screenshot-2024-02-15-at-2-15-12-am.png
draft: false
legacy:
  tistoryId: '73'
  sourceHtml: 73/73.html
  sourceHash: 'sha256:cab41e2625ddbb41385048205e3c7e9b48736f6d74a2bdec7863c47087b01898'
---

목차

* * *

### 들어가며

SpringBoot를 기반으로 실시간 투표 애플리케이션을 구현하면서, 한 가지 실험을 수행했다.  
  

**_멀티 스레드 환경에서 다수의 클라이언트 요청이 동시에 하나의 글에 투표를 진행하면 정상적으로 동작할 수 있을까?_**

  
실험의 시나리오는 다음과 같다.

**\[상황\]**

1.  찬성 투표가 100개인 투표 글이 있다.
2.  찬성표를 반대표로 변경하기 위한 업데이트 요청을 동시에 100번 수행한다.

**\[예상 결과\]**

1.  투표 글의 찬성 투표수는 0이 된다.
2.  투표 글의 반대 투표수는 100이 된다.

시나리오 테스트 코드를 작성한 결과, 예상한 결과와는 다른 결과를 얻을 수 있었다.

![](/images/posts/spring-boot-redisson-73/screenshot-2024-02-15-at-2-15-12-am.png)

### 문제 정의

테스트를 수행하면서 마주한 문제는 **멀티 스레드 환경에서 접할 수 있는 동시성 문제**이다. 애플리케이션은 스프링부트를 기반으로 구현되었고, **내장 톰캣**을 이용한다. 이때 **톰캣은 스레드 풀을 통해서 멀티 스레드 환경을 제공**하고, 이로 인해서 발생할 수 있는 문제이다.

#### 동시성 문제

동시성 문제는 **멀티 프로세스 혹은 멀티 스레드에서 하나의 공유 자원에 동시에 접근하게 되고, 이때 접근하는 순서에 따라서 작업에 대한 결과 값이 달라질 수 있는 문제**이다. 이러한 상황을 **경쟁 상태(race condition)**이라고 하고, 접근 순서에 따라서 달라질 수 있는 코드 영역을 **임계 영역(critical section)**이라고 한다. 임계 영역에 동시에 접근하는 것을 방지하기 위해서 뮤텍스, 세마포어, 모니터 등의 기법을 사용할 수 있다.  
  
동시성 문제를 도식화하면 아래와 같이 표현할 수 있다.

![](/images/posts/spring-boot-redisson-73/screenshot-2024-02-15-at-2-18-40-am.png)

**같은 색의 화살표가 하나의 트랜잭션**이라고 생각하면 된다. 이때 먼저 시작한 트랜잭션이 끝나기 전에, 각 스레드에서 조회를 통해 공유 정보에 접근하기 때문에 정상적인 갱신 동작이 이루어지지 않은 것이다.

### 문제 해결

동시성 문제를 해결하기 위해서는 다양한 방법을 생각해 볼 수 있다.   
  

1.  synchronized
2.  Pessimistic Lock
3.  Optimistic Lock
4.  Named Lock
5.  Lettuce
6.  Redisson

#### synchronized

자바에서는 멀티 스레드 환경에서 동기적으로 메서드가 동작할 수 있도록 **synchronized** 키워드를 제공한다. **synchronized 키워드를 적용한 객체는 JVM에 의해서 Monitor를 생성한다.** 모니터를 생성 후 내부적으로는 block과 unblock을 수행한다. block이 된 영역은 사용하는 스레드를 제외하고 모두 접근할 수 없다. 하지만 block과 unblock 과정을 수행하기 때문에 성능저하를 일으킬 수 있다. 또한, 교착 상태가 발생할 수 있다.

#### Pessimistic Lock

-   데이터에 Lock을 걸어서 정합성을 맞추는 방법이다. Exclusive Lock을 레코드에 걸면 다른 트랜잭션에서는 Lock을 획득하기 위해서 대기한다.
-   단, 데드락이 발생할 수 있기 때문에 주의해야 한다.
-   SQL 쿼리는 \`SELECT ~ FOR UPDATE\` 쿼리가 데이터베이스에 나가게 된다.

#### Optimistic Lock

-   레코드에 버전을 부여해서 조회와 갱신 시 버전 비교를 통해서 정합성을 맞추는 방법이다. 만약 갱신 시 버전이 맞지 않으면 값을 다시 조회하게 된다.(개발자가 직접 구현해야 한다.)
-   엔티티에 버전을 추가해줘야 한다.

#### Named Lock

-   말 그대로 이름을 가진 Lock이다.
-   데이터베이스의 별도의 저장소에 이름을 가진 락을 저장하고, 해당 이름에 대한 락을 해제되기 전 까지는 다른 트랜잭션에서 락을 획득할 수 없다.
-   보통 분산락에서 사용하는 방법이다.

#### Lettuce

-   redis를 dependency에 추가하면 별도의 라이브러리 설치 없이 사용할 수 있다.
-   Spin Lock 방식으로 동시에 많은 스레드가 Lock 획득을 대기 중이라면, redis 서버에 부하를 발생시킬 수 있다.
-   Lock 획득에 대한 재시도가 필요 없는 경우에 사용하면 좋다.

#### Redisson

-   별도의 라이브러리를 추가해야 사용할 수 있다.
-   Pub/Sub 방식으로 되어 있어, Lettuce 보다 서버에 부하를 줄일 수 있다.
-   Lettuce와 다르게 분산락을 기본적으로 지원한다.
-   Lock 획득을 재시도해야 하는 경우에 사용하면 좋다.

이번 프로젝트에서는 synchronized와 Redisson을 이용하여 락을 수행하였다.   
  
Pessimistic Lock, Optimistic Lock, Names Lock을 이용해서 데이터베이스에서 락을 수행할 수 있지만, 영속성 영역에 부하를 줄 수 있기 때문에 선택하지 않았다.

### synchronized 적용

업데이트 요청을 처리하는 메서드에 synchronized를 적용할 수 있지만, 불필요한 영역도 함께 block 될 수 있기 때문에 임계 영역에만 적용해 주었다.

```java
synchronized(this) {
	// 트랜잭션 로직 update query
}
```

![](/images/posts/spring-boot-redisson-73/screenshot-2024-02-15-at-2-25-03-am.png)

테스트 결과는 성공적으로 통과할 수 있었다. 하지만 synchronized는 요청이 처리하는 서버에서는 정상 동적할 수 있지만, 분산화된 서버 환경에서는 정상동작 하지 않을 수 있다.

### Redisson 적용

먼저, redisson을 사용하기 위해서는 의존성을 추가해야 한다.

```java
dependencies {
	implementation 'org.redisson:redisson-spring-boot-starter:3.23.2'
}
```

redisson은 분산화된 환경에서도 대응할 수 있도록 redisson을 적용했다. redisson은 자바 언어로 구현된 레디스 클라이언트로 인메모리 데이터 그리드 기능을 갖추고 있다. Redis를 보다 편리하고 쉽게 사용할 수 있다. 그리고 redisson은 분산락을 간단하게 사용할 수 있도록 기능을 제공한다.  
  
redisson을 적용한 로직은 아래와 같다.

```java
final String key = postId + ":lock:key"; // lock 에서 사용할 키를 생성
final RLock lock = redissonClient.getLock(key); // 생성한 키를 통해서 락을 획득
final String worker = Thread.currentThread().getName(); // 로그를 위해서 스레드 이름 획득 

try {  
	// 락 획득을 시도
	// 10초 동안 락 회득을 시도하고, 3초 동안 임대
	final boolean isAvailable = lock.tryLock(10, 3, TimeUnit.SECONDS);
	log.info("[REQUEST] Thread:{}, lock: {}", worker, lock.getName());
	
	// 유효 시간이 지났다면 락 획득에 실패
	if (!isAvailable) {
		log.info("[FAIL] Get Lock");
		return;
	}
	
	log.info("[PROGRESS] Current Thread: {}", worker);
	
	// 트랜잭션 로직 update query

} catch(InterruptedException e) {
	e.printStackTrace();
} finally {
	if (lock != null
		&& lock.isLocked() // 잠금이 되었는지 확인
		&& lock.isHeldByCurrentThread() // 해당 세션애서 생성한 락인지 확인
	){
		
		lock.unlock();
		log.info("[SUCCESS] Finish Thread: {}", worker);
	}
}
```

락을 획득하는 것은 **tryLock** 메서드를 호출한다. tryLock가 **Pub/Sub 기반**으로 **lock의 해제를 구독**하게 된다. 아래의 코드에서 해당 내용을 확인할 수 있다. 락 획득을 시도할 때 넘긴 waitTime 만큼 채널을 구독하고 있게 된다.

```java
current = System.currentTimeMillis();  
CompletableFuture<RedissonLockEntry> subscribeFuture = subscribe(threadId);  
try {  
	// time -> waitTime
    subscribeFuture.get(time, TimeUnit.MILLISECONDS);  
} catch (TimeoutException e) {  
    if (!subscribeFuture.completeExceptionally(new RedisTimeoutException(  
            "Unable to acquire subscription lock after " + time + "ms. " +  
                    "Try to increase 'subscriptionsPerConnection' and/or 'subscriptionConnectionPoolSize' parameters."))) {  
        subscribeFuture.whenComplete((res, ex) -> {  
            if (ex == null) {  
                unsubscribe(res, threadId);  
            }        
		});    
	}
	acquireFailed(waitTime, unit, threadId);  
    return false;  
}
```

redisson도 내부적으로 상호 배제를 위해서 세마포어를 사용한다. 

```java
public CompletableFuture<E> subscribe(String entryName, String channelName) {  
    AsyncSemaphore semaphore = service.getSemaphore(new ChannelName(channelName));  
    CompletableFuture<E> newPromise = new CompletableFuture<>();  
  
    semaphore.acquire().thenAccept(c -> {  
        if (newPromise.isDone()) {  
            semaphore.release();  
            return;  
        }  
        E entry = entries.get(entryName);  
        if (entry != null) {  
            entry.acquire();  
            semaphore.release();  
            entry.getPromise().whenComplete((r, e) -> {  
                if (e != null) {  
                    newPromise.completeExceptionally(e);  
                    return;  
                }                newPromise.complete(r);  
            });            return;  
	
	...
```

redisson을 적용 후, 테스트 코드가 정상적으로 통과했다.

![](/images/posts/spring-boot-redisson-73/screenshot-2024-02-15-at-2-28-46-am.png)

이번 글에서는 동시성 문제의 가능성을 실험해 보고, 그 해결방법에 대해서 실습해 보았다.

### 참고

[https://www.javadoc.io/doc/org.redisson/redisson/2.8.2/org/redisson/api/RLock.html#tryLock(long,%20long,%20java.util.concurrent.TimeUnit)](https://www.javadoc.io/doc/org.redisson/redisson/2.8.2/org/redisson/api/RLock.html#tryLock\(long,%20long,%20java.util.concurrent.TimeUnit\))

[https://helloworld.kurly.com/blog/distributed-redisson-lock/](https://helloworld.kurly.com/blog/distributed-redisson-lock/)

[https://github.com/redisson/redisson/wiki/8.-distributed-locks-and-synchronizers/#81-lock](https://github.com/redisson/redisson/wiki/8.-distributed-locks-and-synchronizers/#81-lock)
