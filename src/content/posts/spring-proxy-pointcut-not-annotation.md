---
title: "[SPRING] @Service를 붙였는데 왜 프록시가 안 생길까"
description: "@Service를 붙인 빈은 프록시가 아니고, 어노테이션 하나 없는 빈은 CGLIB 프록시로 찍힌다. Spring이 프록시를 씌우는 진짜 기준이 어노테이션이 아니라 pointcut이라는 걸 직접 찍어보며 확인한 기록."
pubDate: "2026-07-07T15:12:28+09:00"
dateSource: manual
slug: spring-proxy-pointcut-not-annotation
tags:
  - spring
  - proxy
  - aop
  - pointcut
category: spring
draft: false
series:
  name: "스프링 프록시와 트랜잭션"
  order: 2
---

프록시 종류(JDK냐 CGLIB냐)를 찍어보다가 더 이상한 걸 봤다. `@Service`를 붙인 빈이 프록시가 아니었다.

```
PlainService  → PlainService                 (원본 그대로, 프록시 아님)
AuditTarget   → AuditTarget$$SpringCGLIB$$0   (CGLIB 프록시)
```

이상한 건 둘의 어노테이션이다. 프록시가 **안 된** `PlainService`엔 `@Service`가 붙어 있고, 프록시가 **된** `AuditTarget`엔 메서드에 어노테이션이 하나도 없다. "어노테이션이 있으면 프록시가 붙는다"는 통념과 정반대다. 그럼 Spring은 뭘 기준으로 프록시를 씌우는 걸까.

## 프록시는 빈을 다 만든 뒤에 붙는다

먼저 언제 붙는지부터. Spring은 빈을 이렇게 올린다.

```
1. 빈 인스턴스 생성 → 의존성 주입 → 초기화 콜백
2. 그 직후, BeanPostProcessor가 "이 빈을 프록시로 감쌀까?" 판단
3. 감싸기로 하면 프록시를 만들고, 레지스트리엔 원본 대신 '프록시'를 넣어둔다
```

그래서 우리가 주입받는 건 이미 프록시고, 원본은 그 안에 감춰져 있다. 여기서 2번의 판단이 이 글의 핵심이다.

## 판단 기준은 어노테이션이 아니라 pointcut

Spring AOP엔 Advisor라는 게 있다. **Advisor = Pointcut + Advice**로 이뤄진다.

- **Pointcut** = "어디에" 적용할지 — 어떤 클래스·메서드에 걸리는지
- **Advice** = "무엇을" 할지 — 트랜잭션 시작/커밋 같은 실제 동작

BeanPostProcessor는 컨테이너에 등록된 **모든 Advisor를 하나씩 돌면서** 딱 하나를 묻는다 — **"이 빈의 클래스·메서드가 네 pointcut에 걸리냐?"** 하나라도 걸리면 프록시로 감싸고, 하나도 안 걸리면 원본 그대로 둔다. 어노테이션이 있냐 없냐가 아니라, **pointcut에 걸리냐 안 걸리냐**다.

이 한 문장으로 처음의 두 줄이 설명된다.

**`@Service`인데 프록시가 안 된 이유.** `@Service`는 "이 클래스를 빈으로 등록해라"는 스테레오타입일 뿐, 프록시와는 상관이 없다. `PlainService`엔 `@Transactional`도, 걸리는 aspect도 없어서 매칭되는 pointcut이 하나도 없다. 그래서 프록시가 안 붙고 원본 그대로다.

**어노테이션이 없는데 프록시가 된 이유.** `AuditTarget`엔 이런 aspect가 걸려 있었다.

```kotlin
@Aspect
@Component
class AuditAspect {
    @Before("execution(* AuditTarget.*(..))")   // 어노테이션이 아니라 '시그니처'로 매칭한다
    fun before() { /* ... */ }
}
```

이 pointcut은 `AuditTarget`의 메서드 시그니처로 매칭한다. 대상에 어노테이션이 붙어 있는지는 보지도 않는다. 그래서 `AuditTarget`엔 advice 어노테이션이 하나도 없는데도 pointcut에 걸려 프록시가 붙었다.

## 그럼 @Transactional은 뭐였나

"어노테이션이 프록시를 만든다"는 착각은 어디서 왔을까. `@Transactional`의 경우, 그 advisor의 pointcut이 **마침 `@Transactional` 어노테이션을 검사하도록** 만들어져 있어서다. 즉 어노테이션은 pointcut이 보는 여러 입력 중 하나일 뿐이지, 프록시를 만드는 주체가 아니다. `AuditAspect`처럼 pointcut이 시그니처만 보면 어노테이션은 아예 등장하지도 않는다.

그래서 "이 빈이 프록시가 될까?"를 예측하려면 질문을 바꿔야 한다. "이 빈에 어노테이션이 붙어 있나?"가 아니라, "이 빈에 매칭되는 advisor의 pointcut이 있나?"로.

## 걸리는 게 여러 개면 프록시도 여러 개일까

아니다. `@Transactional`도 걸리고 커스텀 aspect도 걸리면, 매칭된 advisor는 여러 개여도 프록시는 **하나**다. Spring은 매칭된 것들을 순서(order)대로 정렬해서, 그 하나의 프록시 안에 **체인으로 쌓는다**. 그래서 프록시 여부의 판단은 "걸리는 advisor가 하나라도 있나"이고, 걸린 게 여럿이면 그것들이 한 프록시 안에 줄을 선다.

이렇게 줄 선 advisor들이 호출 때 실제로 어떤 순서로 도는지는 또 다른 이야기라, 여기선 접어둔다.

## 정리

`@Service`를 붙였는데 프록시가 아니어서 시작했는데, Spring이 프록시를 씌우는 기준이 이거였다.

- 프록시는 빈을 다 만든 뒤 BeanPostProcessor가 붙인다
- 붙이냐 마냐는 매칭되는 advisor의 pointcut이 있냐로 갈린다
- 걸린 advisor가 여럿이면 프록시는 하나, 그 안에 순서대로 쌓인다
- 어노테이션은 그 pointcut이 보는 입력 중 하나일 뿐, 기준 자체가 아니다

앞 글에서 "어떤 프록시(JDK냐 CGLIB냐)"를 봤다면, 이번엔 "프록시가 되냐 마냐, 무엇을 기준으로"였다. 같은 프록시를 다른 각도에서 본 셈이다.
