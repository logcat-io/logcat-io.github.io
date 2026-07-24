---
title: "[JAVA] Integer 127 == 127 은 왜 true인가 - 오토박싱과 IntegerCache"
description: "객체 비교는 equals로 하라고 배우는데, Integer 127끼리는 ==가 true다. javap로 바이트코드를 뜯고 JDK의 IntegerCache 소스까지 열어보니 ==의 의미가 피연산자 타입에 따라 컴파일 타임에 갈라지고 있었다. 박싱이 메모리와 객체 생성에 남기는 비용까지."
pubDate: "2026-07-24T21:30:00+09:00"
dateSource: manual
slug: java-autoboxing-integer-cache
tags:
  - Java
  - JVM
  - bytecode
  - autoboxing
  - memory
category: Language/Java
draft: false
---

자바에서 객체 비교는 `equals`를 써야 한다고 배운다. `==`는 참조를 비교하니까.

그런데 `Integer` 127과 127은 `==`가 `true`다. 128부터는 `false`고.
같은 규칙을 따르는 코드인데 숫자만 바뀌었을 뿐이다.

IntegerCache에 대해 얼핏 들어본 적이 있는데, 정말 그런지 궁금해서 직접 `javap`로 뜯고 JDK 소스까지 열어봤다.
결론부터 말하면 캐시는 절반의 답이었다. 진짜는 `==`가 컴파일 타임에 두 갈래로 갈라진다는 쪽에 있었다.

## 무슨 일이 일어나는가

다음 예제 코드로 살펴보자.

```java
package org.basic;

public class Main {
    public static void main(String[] args) {
        Integer a = 127, b = 127;
        Integer c = 128, d = 128;

        int e = 2100;
        Integer f = 2100;

        System.out.println(a == b);      // true
        System.out.println(c == d);      // false
        System.out.println(c.equals(d)); // true
        System.out.println(e == f);      // true
    }
}
```

`a == b`는 `true`, `c == d`는 `false`. 여기까지는 "127까지는 캐시된다"로 설명이 된다.
`c.equals(d)`가 `true`인 것도 값을 비교하니 당연하다.

문제는 마지막 줄이다.

2100은 캐시 범위 밖이다. `c == d`를 `false`로 만든 바로 그 범위다. 그런데 `e == f`는 `true`가 나온다.
캐시로는 이 줄이 설명되지 않는다.

## 왜 — 바이트코드가 답을 갖고 있다

`javap -c -v`로 클래스 파일을 뜯었다. major version 65, Java 21이다.

먼저 변수 선언부. `int e`와 `Integer f`가 어떻게 다른지 보인다.

```
27: sipush        2100
30: istore        5                  // int e — 정수 그대로 저장
32: sipush        2100
35: invokestatic  #7                 // Integer.valueOf(int) 호출
38: astore        6                  // Integer f — 참조로 저장
```

`Integer f = 2100`은 소스에 없던 `Integer.valueOf(2100)` 호출로 바뀐다.
컴파일러가 끼워 넣은 것이다. 오토박싱의 정체가 이 `invokestatic` 한 줄이다.

이제 비교 부분이다.

```
59: aload_3
60: aload         4
62: if_acmpne     69                 // c == d — 참조 비교
```

```
88: iload         5
90: aload         6
92: invokevirtual #29                // Integer.intValue() — 언박싱
95: if_icmpne     102                // e == f — 값 비교
```

같은 `==`인데 명령어가 다르다.

`if_acmpne`는 a(reference) 비교, `if_icmpne`는 i(int) 비교다.
양쪽 다 `Integer`면 참조를 비교하고, 한쪽이 `int`면 `intValue()`로 언박싱한 뒤 값을 비교한다.

**`==`의 의미가 런타임 값이 아니라 피연산자의 정적 타입으로 결정된다.**
javac가 컴파일 시점에 어느 쪽 명령어를 낼지 확정해버린다.

컴파일러 재량이 아니라 JLS에 못박혀 있는 동작이다.
§15.21은 동등 연산자가 받을 수 있는 피연산자 조합을 세 갈래로 규정한다.
수치 타입으로 변환 가능한 둘, `boolean`·`Boolean` 둘, 각각 참조 타입이거나 null 타입인 둘.
나머지는 전부 컴파일 에러다. 예제 코드는 이 중 두 갈래에 나눠 걸린다.

`c == d`는 양쪽이 참조 타입이니 **§15.21.3 Reference Equality Operators**로 간다.

> 동등 연산자의 피연산자가 둘 다 참조 타입이거나 null 타입이면, 그 연산은 객체 동등성(object equality)이다. (…)
> 실행 시점에 `==`의 결과는 피연산자 값이 모두 null이거나 둘 다 같은 객체 또는 배열을 참조하면 `true`이고, 그 외에는 `false`다.

값이 같은지는 아예 논의 대상이 아니다. "같은 객체를 가리키는가"만 묻는다.

`e == f`는 한쪽이 `int`라서 **§15.21.1 Numerical Equality Operators**로 빠진다.

> 동등 연산자의 피연산자가 둘 다 수치 타입이거나, 하나가 수치 타입이고 다른 하나가 수치 타입으로 변환 가능(§5.1.8)하면,
> 피연산자에 이항 수치 승격(§5.6)이 수행된다. (…) 이항 수치 승격은 언박싱 변환(§5.1.8)을 포함할 수 있다.

`Integer`가 "수치 타입으로 변환 가능"에 해당하는 근거가 §5.1.8 언박싱 변환이다.
그리고 승격을 정의한 **§5.6 Numeric Contexts**는 규칙 첫 줄이 이렇게 시작한다.

> 어떤 표현식이 참조 타입이면, 그것에 언박싱 변환(§5.1.8)을 적용한다.

바이트코드에서 본 `invokevirtual Integer.intValue()`가 정확히 이 한 줄의 집행이다.
스펙이 언박싱하라고 했고 javac가 그 호출을 심었다.

`e == f`가 `true`인 건 2100이 캐시에 있어서가 아니다. 애초에 참조를 비교하지 않았기 때문이다.

추가적으로, 이항 수치 승격은 SE 13까지 §5.6.2였다가 SE 14에서 §5.6으로 흡수됐다.
검색하면 §5.6.2로 안내하는 자료가 아직 많은데 내용은 같다.

### 캐시는 그 다음 문제

참조를 비교한다는 걸 알았으니, 이제 `a == b`가 왜 `true`인지가 남는다.
`Integer.valueOf`를 열어보면 된다.

```java
@IntrinsicCandidate
public static Integer valueOf(int i) {
    if (i >= IntegerCache.low && i <= IntegerCache.high)
        return IntegerCache.cache[i + (-IntegerCache.low)];
    return new Integer(i);
}
```

범위 안이면 미리 만들어둔 배열에서 꺼내 쓰고, 밖이면 `new`. 그래서 127은 같은 객체고 128은 다른 객체다.

캐시 배열을 실제로 만드는 곳은 `IntegerCache`의 static 초기화 블록이다.

```java
static {
    int h = 127;
    String integerCacheHighPropValue =
        VM.getSavedProperty("java.lang.Integer.IntegerCache.high");
    if (integerCacheHighPropValue != null) {
        try {
            h = Math.max(parseInt(integerCacheHighPropValue), 127);
            h = Math.min(h, Integer.MAX_VALUE - (-low) - 1);
        } catch (NumberFormatException nfe) {
            // If the property cannot be parsed into an int, ignore it.
        }
    }
    high = h;
    // ...
    // range [-128, 127] must be interned (JLS7 5.1.7)
    assert IntegerCache.high >= 127;
}
```

`Math.max(parseInt(...), 127)`. 상한을 127보다 **낮게는 못 만든다.**
프로퍼티에 10을 넣어도 127로 되돌린다. 마지막 `assert`도 같은 말을 반복한다.

`-128 ~ 127`이 스펙상 의무이기 때문이다(JLS §5.1.7). 캐시는 최적화가 아니라 규약이다.
그래서 이 구간의 `==` 동작은 어느 JVM에서도 동일하고, 반대로 128 이상은 아무것도 보장되지 않는다.
`low`는 조정 수단조차 없다. 늘리는 것만 허용된다.

```bash
java -XX:AutoBoxCacheMax=1000 Main
# 또는 -Djava.lang.Integer.IntegerCache.high=1000
```

이걸 올리면 `c == d`가 `true`로 바뀐다.
소스를 한 글자도 건드리지 않았는데 실행 옵션만으로 답이 달라진다.

## 어떻게 — 규칙은 단순한데 비용은 안 단순하다

규칙 자체는 한 줄이다. 박싱 타입에는 `==` 대신 `equals`. 아니면 기본 타입으로 내린다.

그런데 언박싱이 `intValue()` **메서드 호출**이라는 사실에서 함정이 하나 더 파생된다.

```java
Map<String, Integer> counts = new HashMap<>();
int c = counts.get("없는키");   // NPE
```

`get`이 `null`을 반환하면 `null.intValue()`가 된다. 대입문에 NPE가 숨어 있고, 스택트레이스에는 `Integer.intValue()`만 찍힌다.
`if (someInteger == 0)` 같은 조건문도 똑같이 언박싱이라 `null`이면 그 자리에서 터진다.

메모리 쪽은 계산이 단순하다. 64비트 HotSpot에 compressed oops가 켜진 기본 환경 기준으로,

| | 원소당 크기 |
|---|---|
| `int` | 4바이트 |
| `Integer` 객체 | 16바이트 (헤더 12 + 값 4) |
| `int[]` 원소 | 4바이트 (연속) |
| `Integer[]` 원소 | 20바이트 (참조 4 + 객체 16, 흩어짐) |

100만 개짜리 배열이면 4MB와 20MB의 차이다. 5배.
숫자보다 아픈 건 배치 쪽이다. `int[]`는 값이 메모리에 연속으로 눕지만 `Integer[]`는 참조만 연속이고 실제 값은 힙 여기저기에 흩어진다. 순회할 때 캐시 지역성이 무너진다.

생성 횟수도 셀 수 있다.

```java
Long sum = 0L;
for (long i = 0; i < 1_000_000; i++) {
    sum += i;   // sum = Long.valueOf(sum.longValue() + i)
}
```

`sum`의 타입이 `long`이 아니라 `Long`이라는 이유 하나로 반복마다 새 `Long`이 만들어진다.
`Long` 캐시도 `-128 ~ 127`이라 두 번째 반복부터는 전부 새 객체다. 백만 개.
글자 하나 차이인데 GC가 치워야 할 쓰레기가 백만 개 생긴다.

실행 시간까지 직접 재보지는 않았다. JIT가 escape analysis로 상당 부분 걷어내기도 해서 체감 차이는 상황을 타는데,
그래서 더더욱 "그때그때 다르다"에 기대는 것보다 타입을 정확히 쓰는 쪽이 편하다.

## 마무리

오토박싱을 쓰지 말자는 얘기는 아니다.
제네릭이 기본 타입을 못 담는 이상 `List<Integer>`는 필요하고, 그때마다 `Integer.valueOf`를 손으로 적는 코드가 더 낫지도 않다.
문법 설탕으로서 제 몫은 충분히 한다.

다만 이 설탕이 `==`의 의미까지 함께 바꾼다는 건 알고 쓰는 편이 낫겠다.

`a == b`라는 다섯 글자만 봐서는 참조 비교인지 값 비교인지 알 수 없다.
`a`와 `b`의 선언까지 거슬러 올라가야 하고, 경우에 따라 `-XX:AutoBoxCacheMax` 설정까지 알아야 결과가 예측된다.
읽는 사람이 알아야 할 범위가 그 줄 밖으로 넓어지는 셈이다.

그럼 자바 5 때 박싱 타입의 `==`를 아예 막았으면 되지 않았을까 싶다가도,
이미 쌓여 있던 코드를 전부 깨는 선택이라 쉽지 않았겠다는 생각이 든다.
하위 호환을 짊어진 언어가 어디까지 감수해야 하는지는 아직 내가 판단할 만큼 알지 못한다.
결과적으로는 IntelliJ의 `Number objects are compared using '=='` 경고처럼 도구 쪽 장치가 그 자리를 메우고 있다.

이번에 얻은 건 외우고 있던 문장 하나를 근거로 바꾼 것이다.
"127까지는 캐시된다"가 아니라, 컴파일러가 `if_acmpne`를 골랐는지 `if_icmpne`를 골랐는지의 문제였다.
캐시는 그 뒤에 붙는 각주에 가깝다.

`javap -c` 한 번이면 확인되는 걸 그동안 문장으로만 외우고 있었다.
JDK 소스도 열어보니 생각보다 읽을 만했다.
`Long`과 `Character`의 캐시는 어떻게 다른지, `String` 상수 풀은 또 어떤지 같은 방식으로 들여다볼 생각이다.
