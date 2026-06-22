---
title: "[KOTLIN] sealed class를 처음 이해할 때 가장 헷갈렸던 것들"
description: >-
  Kotlin을 공부하다 보면 sealed class 문법을 꽤 빨리 마주치게 된다. 특히 상태를 모델링하거나, 성공/실패 결과를 타입으로
  표현하려고 할 때 자주 등장한다. 그런데 처음 보면 가장 먼저 막히는 지점이 있다. object Success : Result() 같은
  문법이 대체
pubDate: '2026-04-24T01:06:30+09:00'
dateSource: html-visible
slug: sealed-class-107
tags:
  - Sealed
  - class
category: Language/Kotlin
draft: false
legacy:
  tistoryId: '107'
  sourceHtml: 107/107.html
  sourceHash: 'sha256:956ab432bf830c0eba5616362f0dc1737c38e3a487fbf10c0ac155b73c8c4f61'
---

Kotlin을 공부하다 보면 `sealed class` 문법을 꽤 빨리 마주치게 된다. 특히 상태를 모델링하거나, 성공/실패 결과를 타입으로 표현하려고 할 때 자주 등장한다. 그런데 처음 보면 가장 먼저 막히는 지점이 있다. `object Success : Result()` 같은 문법이 대체 무엇을 의미하는지 직관적으로 들어오지 않는다는 점이다.

이번 글은 이 헷갈림에서 출발해, `sealed class`의 기초 개념부터 `object, data class, when exhaustive` 체크, 그리고 활용까지 정리한 글이다.

## sealed class란 무엇인가

`sealed class`는 하위 타입이 제한된 추상 클래스라고 이해하면 된다. 즉, 어떤 부모 타입 아래에 올 수 있는 자식 타입들을 닫힌 집합으로 관리하고 싶을 때 사용한다. 예를 들어 아래 코드는 `Result`라는 타입의 가능한 경우를 세 가지로 제한한다.

```
sealed class Result {
    object Success : Result()
    object StockExhausted : Result()
    object VersionConflict : Result()
}
```

이 구조에서 `Result` 타입의 값은 반드시 `Success, StockExhausted, VersionConflict` 중 하나다. 컴파일러는 `sealed class`의 하위 타입들을 모두 알고 있기 때문에, 이후 `when` 분기에서 빠진 케이스를 검사해줄 수 있다.

## 왜 enum이 아니라 sealed class일까

처음 보면 `enum`으로도 충분해 보인다. 실제로 단순한 상태 나열만 필요하다면 `enum`도 좋은 선택이다. 하지만 `sealed class`는 각 상태마다 전혀 다른 필드와 구조를 가질 수 있어서, 상태가 조금만 복잡해져도 `enum`보다 훨씬 유연하다.

예를 들어 “성공”, “재고 부족”, “버전 충돌”은 같은 결과 타입 안에 묶고 싶지만, 어떤 실패는 추가 데이터를 함께 들고 다녀야 할 수도 있다. 이런 경우 `sealed class`는 `object`와 `data class`를 섞어서 표현할 수 있다.

```
sealed class Result {
    object Success : Result()
    data class StockExhausted(val requestedQty: Int) : Result()
    data class VersionConflict(
        val expectedVersion: Long,
        val actualVersion: Long,
    ) : Result()
}
```

`Success`는 단순히 “성공했다”는 사실만 있으면 되므로 싱글턴 객체면 충분하다.반면 `StockExhausted`는 요청 수량 같은 추가 정보가 필요할 수 있어서 매번 다른 값을 담는 `data class`가 더 적합하다.

## object Success : Result()는 무슨 뜻인가

이 문법이 처음 가장 많이 헷갈리는 부분이다. 표면적으로 보면 `Result()`가 생성자 호출처럼 보여서, 마치 `Result` 인스턴스를 만든 뒤 `Success`가 되는 것처럼 느껴질 수 있다. 하지만 정확히는 그렇게 이해하면 안 된다.

`object Success : Result()`는 “Result를 상속하는 `Success`라는 싱글턴 객체를 정의한다”는 뜻이다. 여기서 `Result()`는 일반적인 함수 호출의 의미가 아니라, 부모 클래스의 생성자를 호출하는 상속 문법의 일부다.

즉, 이 코드는 다음과 같은 감각으로 읽으면 된다.

-   object Success → Success라는 객체를 하나만 만든다.
-   : Result() → 이 객체는 Result를 상속하며, 부모 초기화는 Result 생성자를 통해 수행한다.

중요한 점은 `Success`의 실제 타입은 `Success` 이면서 동시에 `Result` 타입으로도 취급된다는 점이다. 다시 말해 `Success`는 `Result`의 하위 타입이다.

```
val result: Result = Result.Success
```

이 코드는 `Success`가 `Result` 타입으로 업캐스팅되어 사용되는 예다.

## 왜 인터페이스는 괄호가 없고, 추상 클래스는 괄호가 있을까

Kotlin을 자바 감각으로 보다가 많이 착각하는 지점이 여기다. 인터페이스 구현은 `:InterfaceName`인데, 추상 클래스 상속은 : `AbstractClassName()`으로 쓰기 때문에 괄호가 더 도드라져 보인다.

```
interface A
abstract class B

class C : A
class D : B()
```

차이는 단순하다. 인터페이스에는 생성자가 없고, 클래스에는 생성자가 있기 때문이다. 그래서 `: A`는 “이 인터페이스를 구현한다”는 뜻이고, `: B()`는 “이 클래스를 상속하고 부모 생성자를 이렇게 호출해 초기화한다”는 뜻이다.

자바로 대응시키면 감각이 더 잘 잡힌다.

```
class Child extends Parent {
    Child() {
        super();
    }
}
```

Kotlin에서는 이 감각이 아래 한 줄에 담긴다.

```
class Child : Parent()
```

즉, `Result()`가 보인다고 해서 “Result 인스턴스를 내가 직접 만든다”라고 보기보다는, 상속 시 부모 초기화 문법이 붙어 있다고 이해하면 훨씬 정확하다.

## sealed class의 가장 큰 장점: when exhaustive 체크

sealed class를 사용하는 가장 강력한 이유는 `when`과 결합될 때 드러난다. 컴파일러가 하위 타입의 전체 목록을 알고 있으므로, `when`에서 모든 분기를 빠짐없이 처리했는지 검사해줄 수 있다.

```
fun toMessage(result: Result): String =
    when (result) {
        Result.Success -> "성공"
        Result.StockExhausted -> "재고 부족"
        Result.VersionConflict -> "버전 충돌"
    }
```

위 코드는 `else`가 없어도 된다. 이미 `Result`의 가능한 하위 타입이 세 개뿐이라는 사실을 컴파일러가 알고 있기 때문이다.

여기서 새로운 케이스를 추가해보자.

```
sealed class Result {
    object Success : Result()
    object StockExhausted : Result()
    object VersionConflict : Result()
    object InvalidRequest : Result()
}
```

그러면 기존의 `when (result)` 코드들 중 `InvalidRequest`를 처리하지 않은 곳은 컴파일 에러가 난다. 이 특성 덕분에 상태가 늘어나더라도 누락된 분기를 런타임이 아니라 컴파일 타임에 잡아낼 수 있다.

## 예외 대신 결과 타입으로 실패를 표현하기

`sealed class Result`는 단순한 문법 예제가 아니라, 실무에서도 꽤 유용한 패턴이다. 특히 비즈니스 실패를 예외가 아니라 타입으로 표현하고 싶을 때 강력하다.

예외 기반 코드는 보통 이런 형태다.

```
fun order(): Product {
    if (stock <= 0) throw StockExhaustedException()
    if (versionMismatch) throw VersionConflictException()
    return product
}
```

이 방식은 실패가 함수 시그니처에 잘 드러나지 않는다. 호출자는 `try/catch`를 하지 않아도 컴파일은 통과할 수 있고, 결국 실패 흐름이 코드 밖으로 튀어나간다.

반면 결과 타입을 사용하면 다음처럼 바뀐다.

```
fun order(): Result {
    if (stock <= 0) return Result.StockExhausted
    if (versionMismatch) return Result.VersionConflict
    return Result.Success
}
```

이제 함수 시그니처만 봐도 “이 함수는 성공/실패를 반환값으로 표현한다”는 사실이 드러난다. 실패가 비정상 흐름이 아니라, 호출자가 정상적으로 처리해야 하는 상태 집합으로 바뀌는 것이다.

## HTTP 상태 코드 매핑과도 잘 맞는다

이 패턴은 UseCase와 Controller 사이에서 특히 깔끔하게 동작한다. UseCase는 HTTP를 모르더라도, 결과 타입만 잘 정의해두면 프레젠테이션 계층에서 상태 코드로 안전하게 변환할 수 있다.

```
fun Result.toHttpStatus(): Int = when (this) {
    Result.Success -> 200
    Result.StockExhausted -> 409
    Result.VersionConflict -> 409
}
```

이렇게 하면 도메인 계층은 웹 프레임워크에 덜 오염되고, 웹 계층은 `when`으로 명시적으로 매핑 규칙을 관리할 수 있다. 새로운 실패 타입이 추가되면 매핑 누락도 컴파일 단계에서 드러난다.

## object와 data class는 어떻게 구분해서 쓸까

실무에서 가장 자주 하는 고민은 “이 케이스를 `object`로 둘지 `data class`로 둘지”다. 판단 기준은 의외로 단순하다.

### object가 어울리는 경우

추가 데이터 없이 상태 자체만 표현하면 되는 경우다.

```
sealed class LoginState {
    object LoggedIn : LoginState()
    object LoggedOut : LoginState()
}
```

여기서 `LoggedIn`과 `LoggedOut`은 각 상태를 설명하는 부가 데이터가 없다. 프로그램 전체에서 하나의 인스턴스만 있어도 충분하므로 `object`가 적절하다.

### data class가 어울리는 경우

상태마다 담아야 할 값이 달라지는 경우다.

```
sealed class LoginResult {
    data class Success(val token: String) : LoginResult()
    data class Failure(val reason: String) : LoginResult()
}
```

이 경우 성공할 때마다 토큰 값이 다르고, 실패할 때마다 이유가 다를 수 있으므로 매번 새로운 인스턴스가 필요하다. 그래서 `data class`가 자연스럽다.

### 처음 학습할 때 추천하는 연습 순서

`sealed class`는 문법 하나만 외운다고 익숙해지지 않는다. 상태 모델링 문제를 직접 몇 번 풀어보는 것이 가장 빠르다.

-   enum으로 만들었던 간단한 상태를 sealed class로 다시 작성해보기.
-   `object`만 쓰는 버전에서 시작한 뒤, 상태 하나를 `data class`로 바꿔보기.
-   `when`에서 일부 분기를 고의로 빼보고 컴파일러가 어떻게 잡아주는지 확인해보기.
-   UseCase 결과를 sealed class로 만들고, Controller에서 HTTP 응답으로 매핑해보기.

특히 마지막 연습은 실무 감각을 익히는 데 도움이 된다. `sealed class`를 단순 문법이 아니라 “상태를 안전하게 모델링하는 도구”로 이해하게 되기 때문이다.

## 마무리

처음 `object Success : Result()`를 보면 생성자 호출처럼 보여서 어색한 것이 정상이다. 하지만 이 문법은 “상속 + 부모 초기화”로 읽어야 하고, `object`는 상태 하나를 나타내는 싱글턴 객체라고 이해하면 금방 정리된다.

결국 `sealed class`의 핵심은 문법보다 모델링에 있다. 가능한 상태를 닫힌 집합으로 만들고, 그 상태들을 `when`에서 컴파일 타임에 빠짐없이 처리하게 만드는 것, 그리고 예외 대신 실패를 타입으로 드러내는 것이 `sealed class`가 주는 가장 큰 장점이 아닌가 생각된다.
