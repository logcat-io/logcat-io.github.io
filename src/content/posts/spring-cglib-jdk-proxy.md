---
title: "[SPRING] 내 서비스는 CGLIB인데 Repository는 왜 JDK 프록시일까"
description: "한 Spring Boot 앱에서 내 서비스 빈은 CGLIB, Repository는 JDK 프록시로 찍힌다. 프록시 종류가 왜 갈리는지 proxy-target-class 기본값과 구현체 유무로 직접 찍어보며 풀어본 기록."
pubDate: "2026-07-07T14:35:58+09:00"
dateSource: manual
slug: spring-cglib-jdk-proxy
tags:
  - spring
  - proxy
  - cglib
  - jdk-dynamic-proxy
  - aop
category: Spring Framework/Spring & Spring Boot
draft: false
series:
  name: "스프링 프록시와 트랜잭션"
  order: 1
---

Spring 프록시가 헷갈려서 빈 몇 개의 실제 타입을 찍어봤다. `bean.javaClass.name` 한 줄. 그랬더니 같은 애플리케이션 안에서 두 종류가 나왔다.

```
OrderService   → OrderService$$SpringCGLIB$$0
UserRepository → jdk.proxy2.$Proxy108
```

하나는 CGLIB, 하나는 JDK dynamic proxy. 설정을 바꾼 것도 아니고 Boot 기본값 그대로인데, 같은 앱에서 프록시 종류가 갈렸다. 왜 그런지 파보니 Spring이 프록시를 고르는 규칙이 정리됐다.

## 두 프록시는 만드는 방식부터 다르다

- **JDK dynamic proxy**: 대상이 구현한 인터페이스를 똑같이 구현한 별개 객체를 런타임에 만든다. 호출은 `InvocationHandler` 하나로 모인다. 대상 클래스를 상속하지 않으니, 인터페이스에 선언된 메서드만 프록시된다.
- **CGLIB**: 대상 클래스를 상속한 subclass를 만들어 메서드를 override해서 가로챈다. 인터페이스가 없어도 되는 대신, `final` 클래스·메서드는 override가 안 돼 프록시가 안 걸린다. (Kotlin은 클래스가 기본 `final`이라 `kotlin-spring` 플러그인이 열어줘야 한다.)

한 줄로 줄이면, JDK는 "인터페이스를 새로 구현", CGLIB는 "클래스를 상속"이다.

## "인터페이스면 JDK"는 Boot에선 반쪽 답

교과서 답은 "인터페이스 있으면 JDK, 없으면 CGLIB"다. 순수 Spring 기준으론 맞다. 그런데 Spring Boot는 `spring.aop.proxy-target-class=true`가 기본값이고, 이게 켜져 있으면 AOP 프록시는 인터페이스가 있어도 전부 CGLIB로 만든다.

인터페이스를 구현한 `@Service` 빈 하나로 확인해보면 이렇게 갈린다.

```
proxy-target-class=false → jdk.proxy2.$Proxy47            (JDK)
proxy-target-class=true  → BillingService$$SpringCGLIB$$0 (CGLIB, Boot 기본)
```

그래서 내가 만든 `@Service`·`@Transactional` 빈은 인터페이스가 있든 없든 실무 Boot 앱에선 사실상 다 CGLIB다. 면접에서 "인터페이스면 JDK"라고만 답하면 "그럼 Boot 기본값은요?"에서 막히는 게 이 지점이다.

Boot이 왜 true를 기본으로 잡았을까. 핵심은 JDK 프록시의 **타입**이다. JDK 프록시는 인터페이스를 구현한 `$Proxy` 객체라, 그 타입이 구현 클래스가 아니라 인터페이스다. 그래서 인터페이스 타입으로 주입받는 곳은 멀쩡하지만, 구현 클래스 타입으로 주입받는 곳에선 타입이 안 맞아 터진다.

```kotlin
@Autowired lateinit var port: BillingPort     // OK — 프록시가 BillingPort를 구현한다
@Autowired lateinit var svc:  BillingService  // JDK 프록시면 실패 — 프록시는 BillingService의 하위 타입이 아니다
```

CGLIB은 대상 클래스를 상속하니, 프록시가 구현 클래스의 하위 타입이면서 인터페이스도 그대로 물려받는다. 그래서 어느 쪽으로 주입받든 안전하다. Boot은 이 "주입 타입 사고"를 아예 없애려고 타입과 무관하게 CGLIB을 표준으로 잡았다. 대가로 `final`을 못 뚫는 제약이 따라온다.

## 그럼 Repository는 왜 JDK인가

여기서 처음 의문으로 돌아온다. `@Service`는 CGLIB인데 `UserRepository`는 왜 JDK일까. `proxy-target-class=true` 그대로인데도.

이유는 두 가지다.

**하나, Repository는 구현 클래스가 없다.** `UserRepository`는 인터페이스 선언뿐이고, 내가 짠 구현체가 없다. CGLIB은 상속할 클래스가 있어야 하는데 상속할 게 없다. 그러니 CGLIB은 애초에 불가능하고, 인터페이스를 구현하는 JDK proxy 말곤 방법이 없다.

**둘, Repository 프록시는 AOP가 만든 게 아니다.** `proxy-target-class`는 `@Transactional`·`@Async` 같은 AOP advisor 기반 프록시에만 적용되는 스위치다. Spring Data 리포지토리는 그 경로가 아니라 Spring Data 전용 팩토리가 인터페이스를 보고 직접 프록시를 만든다. 그래서 전역 `proxy-target-class` 값과 무관하게 항상 JDK proxy다. `@FeignClient`, MyBatis `@Mapper`, `@HttpExchange` 클라이언트도 같은 이유로 JDK다 — 전부 구현체 없는 인터페이스를 각자 팩토리가 프록시로 만든다.

그래서 한 앱 안에서 이렇게 나뉜다.

- 내가 만든 서비스 클래스 → CGLIB (Boot 기본)
- 인터페이스 추상화(repository·client·mapper) → JDK

처음 찍힌 두 줄은 버그가 아니라, 서로 다른 메커니즘이 만든 서로 다른 프록시가 공존한 결과였다.

한 가지는 정확히 하자. "내 서비스는 CGLIB"이라 했지만, 이건 `@Transactional`처럼 프록시를 유발하는 게 걸렸을 때의 얘기다. 아무것도 안 걸린 순수 `@Service`는 프록시조차 생기지 않는다. 그래서 이 글은 "프록시가 된다면 어떤 타입인가"에 대한 답이고, "애초에 언제 프록시가 되는가"는 다른 질문으로 남겨둔다.

## 한 스텝 더: self-invocation이 깨지는 것도 같은 구조 때문

프록시가 원본과 별개 객체라는 걸 알고 나면 self-invocation 문제도 같은 그림이다. 프록시는 원본(target)을 감싼 다른 객체고, 메서드 내부의 `this`는 프록시가 아니라 원본이다. 그래서 `this.otherMethod()`로 부르면 프록시를 거치지 않고, `@Transactional` 같은 인터셉터가 낄 자리가 없다. 외부에서 프록시를 통해 들어온 호출만 가로채인다.

## Kotlin이면 그 CGLIB은 공짜가 아니다

마지막으로. 위에서 `@Service`는 CGLIB이라고 했는데, Kotlin에선 그게 그냥 되지 않는다. CGLIB은 대상 클래스를 **상속**해서 프록시를 만드는데, Kotlin 클래스와 메서드는 기본이 `final`이라 상속·override가 막혀 있다.

그래서 `kotlin("plugin.spring")` 없이 `@Service` 하나를 띄우면 앱이 아예 안 뜬다. 컨텍스트 초기화 단계에서 이렇게 죽는다.

```
BeanCreationException: Error creating bean 'orderService':
  Could not generate CGLIB subclass of class OrderService
Caused by: java.lang.IllegalArgumentException: Cannot subclass final class OrderService
```

`kotlin("plugin.spring")`(all-open 플러그인)이 하는 일이 이거다. `@Component`·`@Transactional` 같은 게 붙은 클래스와 그 메서드를 컴파일 시점에 `open`으로 바꿔, CGLIB이 상속할 수 있게 열어준다.

더 위험한 건 조용히 새는 경우다. 클래스는 열렸는데 특정 `@Transactional` 메서드만 `final`이면, 앱은 멀쩡히 뜨고 그 메서드만 프록시에서 빠진다. 에러 없이 `@Transactional`이 no-op이 되는 것 — 롤백이 필요한 상황이 터지기 전엔 안 보인다.

대부분의 Kotlin + Spring 프로젝트가 이걸 신경 안 쓰고 사는 이유는, `start.spring.io`나 IDE가 프로젝트를 만들 때 `build.gradle.kts`에 저 플러그인을 자동으로 넣어주기 때문이다. 빌드 파일을 직접 손으로 짜보기 전엔 이게 왜 있는지 볼 일이 없다. "CGLIB은 상속으로 프록시를 만든다"를 알고 나서야, 이 한 줄이 왜 필수인지가 보인다.

## 정리

`getClass()` 하나 찍은 데서 시작했는데, Spring이 프록시를 고르는 규칙이 이렇게 갈렸다.

- 방식: JDK는 인터페이스 구현, CGLIB은 클래스 상속
- 내 AOP 빈: Boot 기본 `proxy-target-class=true`라 전부 CGLIB
- Repository·Feign처럼 구현체 없는 인터페이스: 각자 팩토리가 만드는 JDK proxy, `proxy-target-class`와 무관

한 애플리케이션에 두 종류가 같이 사는 건, 서로 다른 목적의 프록시가 각자 방식으로 만들어졌기 때문이다.
