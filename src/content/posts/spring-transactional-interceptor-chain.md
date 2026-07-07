---
title: "[SPRING] @Transactional은 begin·commit을 박아넣는 게 아니다"
description: "@Transactional 메서드에 커스텀 @Around를 하나 더 걸어 호출 순서를 찍어보면, begin/commit이 프록시에 하드코딩된 게 아니라 인터셉터 체인의 한 칸이라는 게 드러난다. 프록시가 호출을 가로채는 실제 구조를 직접 찍어본 기록."
pubDate: "2026-07-07T15:17:48+09:00"
dateSource: manual
slug: spring-transactional-interceptor-chain
tags:
  - spring
  - transactional
  - aop
  - proxy
category: spring
draft: false
---

`@Transactional`이 어떻게 도는지 물으면 흔히 이런 그림을 그린다.

```
proxy.withdraw() {
    beginTx();
    target.withdraw();
    commitTx();
}
```

프록시 메서드 안에 begin/commit이 박혀 있고 그 사이에 원본을 부른다는 그림. 반은 맞는데 실제 구조는 다르다.

확인하려고 `@Transactional`이 붙은 평범한 서비스 메서드를 하나 뒀다. 계좌에서 돈을 빼는, 흔한 트랜잭션 메서드다.

```kotlin
@Service
class MoneyService {
    @Transactional
    fun withdraw(amount: Long): Long {
        println("[target] withdraw 실제 실행")
        return amount
    }
}
```

그리고 이 **같은 `withdraw()` 메서드에** 커스텀 `@Around`를 하나 더 걸었다.

```kotlin
@Aspect
@Component
class TimingAspect {
    @Around("execution(* MoneyService.withdraw(..))")
    fun around(pjp: ProceedingJoinPoint): Any? {
        println("[aspect] before")
        val r = pjp.proceed()
        println("[aspect] after")
        return r
    }
}
```

`withdraw()`를 한 번 부르면 순서가 이렇게 나온다.

```
[tx] begin
[aspect] before
[target] withdraw 실제 실행
[aspect] after
[tx] commit
```

begin/commit이 프록시 메서드에 그냥 박혀 있었다면, 그 사이에 내 aspect가 낄 자리가 없다. 그런데 `[aspect] before/after`가 begin/commit 안쪽에 정확히 껴 있다. 그럼 실제론 어떻게 도는 걸까.

## 프록시는 begin/commit을 박는 게 아니라 체인을 돈다

프록시가 하는 일은 "트랜잭션 코드 실행"이 아니라 "인터셉터 체인 실행"이다.

```
1. 프록시(invoke/intercept)가 호출을 먼저 받는다
2. 이 메서드에 걸리는 인터셉터를 모은다 → [TransactionInterceptor, TimingAspect]
3. ReflectiveMethodInvocation.proceed() 로 체인을 한 칸씩 타고 들어간다
4. 각 인터셉터는 "앞 작업 → proceed()(다음 칸) → 뒤 작업" 샌드위치
5. 체인 끝에서 비로소 진짜 target을 부른다
```

핵심은 `proceed()`다. 대략 이렇게 생겼다.

```
proceed():
    마지막 인터셉터까지 다 지났으면 → 진짜 target.withdraw() 호출
    아니면 → 다음 인터셉터.invoke(this)
```

`TransactionInterceptor`를 펼치면 `begin → proceed() → commit`이고, 그 `proceed()` 안에서 다음 칸인 내 aspect가 또 `before → proceed() → after`를 한다. 그리고 그 `proceed()`가 마침내 target을 부른다. 위 출력의 안쪽으로 파고드는 순서가 정확히 이 구조다.

```
TransactionInterceptor: begin
  TimingAspect: before
    target: withdraw()
  TimingAspect: after
TransactionInterceptor: commit
```

누가 바깥이냐는 `@Order`로 조정할 수 있다. 여기선 트랜잭션이 바깥, 내 aspect가 안쪽으로 나왔다.

## 그래서 @Transactional의 정체

`@Transactional`은 "프록시 메서드에 begin/commit을 자동으로 삽입하는 장치"가 아니다. **호출 시 도는 인터셉터 체인에 `TransactionInterceptor`라는 한 칸을 끼우는 신호**에 가깝다.

왜 굳이 체인이냐. begin/commit만 박을 거면 단순 래퍼로 충분하다. 체인인 이유는 **한 메서드에 여러 관심사를 층층이 쌓기 위해서**다. 트랜잭션, 로깅, 캐시, 재시도, 커스텀 aspect — 이것들이 각자 프록시를 만들어 싸우는 게 아니라, 하나의 체인에 순서대로 낀다. 위에서 트랜잭션과 내 aspect가 한 호출을 같이 감싼 게 그 증거다. `@Transactional`은 그 체인의 한 칸일 뿐이다.

## 정리

`proxy { begin; target; commit; }`이라는 그림에서 시작했지만 실제는 이랬다.

- 프록시는 begin/commit을 박는 게 아니라 **인터셉터 체인**을 돈다
- `proceed()`가 체인을 한 칸씩 타고 들어가고, 끝에서 target을 부른다
- `@Transactional`은 그 체인의 한 칸(`TransactionInterceptor`)일 뿐 — 여러 관심사를 쌓으려고 체인 구조인 것

프록시 세 편을 여기서 닫는다. 어떤 프록시인가(JDK냐 CGLIB냐), 언제 프록시가 되는가(pointcut), 그리고 그 프록시가 어떻게 도는가(체인). 셋을 붙이면 `@Transactional` 한 줄 뒤에서 벌어지는 일이 대체로 다 보인다.
