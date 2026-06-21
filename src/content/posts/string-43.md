---
title: String 클래스의 특징
description: 먼저 String 클래스가 무엇인지 간단히 알아보자.
pubDate: '2023-10-12T18:22:12+09:00'
dateSource: html-visible
slug: string-43
tags:
  - 자바
  - string
  - 특징
category: Language/Java
cover: /images/posts/string-43/edited-screenshot-2023-10-12-at-6-17-20-pm.png
draft: false
legacy:
  tistoryId: '43'
  sourceHtml: '43/43-[JAVA]-String-클래스의-특징.html'
  sourceHash: 'sha256:7e63d2e532428e2530d98603e5eea8f35d33d7fb934adcab40a5ce57e80116c7'
---

먼저 `String` 클래스가 무엇인지 간단히 알아보자.

String은 자바가 제공하는 클래스 중에서 문자열을 다루는 클래스다. `String` 클래스의 객체를 생성하는 방법은 두 가지가 있는데, `new` 키워드 통해 생성자의 입력 매개변수로 문자열을 전달하는 방법과 문자열 리터럴 방법이 있다.

```java
String text1 = new String("new 키워드"); // new 키워드
String text2 = "리터럴"; // 문자열 리터럴
```

이때 두 가지 방법 모두 메모리에 저장되는 방식은 동일하다. `String`은 참조 자료형이기 때문에 실제 데이터(문자열)는 힙 메모리에 위치하고, 참조 변수 `text1`은 힙 메모리의 데이터를 가리키게 된다.

`String` 클래스는 다른 클래스와는 다르게 **두 가지의 특징**이 있다.

첫 번째 특징은 **불변성**이다.

이는 한번 정의된 문자열은 변경할 수 없다는 것이다. 만약 `text1` 변수의 문자열을 재할당하면 `JVM`은 기존 힙 메모리에 저장된 문자열을 수정하지 않고 새로운 문자열을 가진 객체를 생성한다. 그리고 새로 생성된 객체의 메모리 주소를 `text1`가 참조하게 한다. 다음은 코드의 실행에 따른 메모리 구조에 대한 설명이다. (여기서 메모리 주소를 단순화하기 위해서 임의의 주소를 할당했다.)

```
String text1 = new String("JAVA"); // --- 그림 (1)
String text2 = text1; // --- 그림 (2)
text1 = "JAVASCRIPT"; // --- 그림 (3)
```

![](/images/posts/string-43/edited-screenshot-2023-10-12-at-6-17-20-pm.png)

(1)

![](/images/posts/string-43/edited-screenshot-2023-10-12-at-6-17-30-pm.png)

(2)

![](/images/posts/string-43/edited-screenshot-2023-10-12-at-6-17-50-pm.png)

(3)

두 번째 특징은 같은 문자열의 **객체 공유**이다.

이는 문자열 리터럴로 생성된 `String` 객체에만 적용되는 것으로, 문자열 리터럴을 통해서 생성한 객체 중 같은 문자열끼리는 객체를 공유하게 된다.

_어떻게 객체를 공유하는 것일까?_

바로 힙 영역의 `String constant pool`에서 답을 찾을 수 있다. 글로 이해하는 것이 다소 모호할 수 있기 때문에 코드를 통해서 위의 경우를 살펴보자. 코드에서는 스택 영역에 저장된 메모리 주소(참조값)만 비교하기 위해서 `==` 연산자를 사용했고, 논리적 동일성을 확인하기 위해서 기본 객체의 `hashCode()`의 값과 동일한 값을 반환하는 `System.identityHashCode` 메서드를 사용했다.

\[코드\]

```
String text1 = new String("JAVA");  
String text2 = "JAVA";  
String text3 = "JAVA";  
String text4 = new String("JAVA");  
String text5 = "JAVASCRIPT";

// == 를 이용해 스택의 메모리 값 비교  
System.out.println("text1 == text2 " + (text1 == text2));  // false
System.out.println("text2 == text3 " + (text2 == text3));  // true
System.out.println("text3 == text4 " + (text3 == text4));  // false
System.out.println("text4 == text1 " + (text4 == text1));  // false
System.out.println("text2 == text5 " + (text2 == text5));

System.out.println("=======================");

// 스택 영역에 저장된 논리 메모리 주소 출력  
System.out.println("text1 hash code = " + System.identityHashCode(text1));  
System.out.println("text2 hash code = " + System.identityHashCode(text2));  
System.out.println("text3 hash code = " + System.identityHashCode(text3));  
System.out.println("text4 hash code = " + System.identityHashCode(text4));
System.out.println("text5 hash code = " + System.identityHashCode(text5));
```

\[결과\]

```
text1 == text2 false
text2 == text3 true
text3 == text4 false
text4 == text1 false
text2 == text5 false

=======================

text1 hash code = 681842940
text2 hash code = 1363058925
text3 hash code = 1363058925
text4 hash code = 1392838282
text5 hash code = 523429237
```

위의 코드의 결과에서 알 수 있듯이 같은 문자열을 리터럴로 생성한 text2와 text3의 논리 메모리 주소가 같은 것을 볼 수 있고, 해시 값도 같은 것을 확인할 수 있다.

## 정리

`String`은 자바에서 문자열을 다루는 클래스로 다음과 같은 두 가지의 특징이 있다.

1.  한번 정의된 문자열은 변경할 수 없고, 만약 변경 시 기존의 문자열을 변경하는 것이 아니라 새로운 문자열 객체를 생성한다.
2.  문자열 리터럴을 통해서 생성한 객체 중 같은 문자열을 참조하는 변수는 같은 객체를 공유한다.

## 참고

-   [https://docs.oracle.com/javase/8/docs/api/java/lang/System.html#identityHashCode-java.lang.Object-](https://docs.oracle.com/javase/8/docs/api/java/lang/System.html#identityHashCode-java.lang.Object-)
