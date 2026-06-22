---
title: "[JAVA] JVM Class Loading, Metaspace, 그리고 메서드 바이트코드까지 한 번에 이해하기"
description: >-
  요즘 JVM의 클래스 로딩, 링킹, 그리고 ClassLoader.defineClass() 구현까지 따라가면서 공부하고 있다. 단순히 클래스
  로딩 → 메서드 영역 → 실행 처럼 외워서는 금방 잊어버리게 되어, .class 파일의 바이트코드가 JVM 내부에서 어떤 객체/메모리 구조로
  변해서
pubDate: '2026-03-31T16:51:39+09:00'
dateSource: html-visible
slug: jvm-class-loading-metaspace-100
tags:
  - JIT
  - class
  - loader
  - jvm
  - loading
  - compiler
  - MetaSpace
  - and
  - linking
category: Language/Java
cover: /images/posts/jvm-class-loading-metaspace-100/img.png
draft: false
legacy:
  tistoryId: '100'
  sourceHtml: 100/100.html
  sourceHash: 'sha256:dccf43ddf8cd80e567c6e941536a5246611249e52cb8b2ab3dce927899012062'
---

1\. 왜 이 글을 쓰는가?

![](/images/posts/jvm-class-loading-metaspace-100/img.png)

요즘 JVM의 클래스 로딩, 링킹, 그리고 ClassLoader.defineClass() 구현까지 따라가면서 공부하고 있다. 단순히 _**클래스 로딩 → 메서드 영역 → 실행**_ 처럼 외워서는 금방 잊어버리게 되어, **.class 파일의 바이트코드가 JVM 내부에서 어떤 객체/메모리 구조로 변해서 실제로 실행되는지**를 한 번에 정리해 보려고 한다.

이 글은 다음 질문에 답하는 것을 목표로 한다.

-   .class 파일 안의 메서드 코드는 어떻게 저장돼 있을까?
-   ClassLoader.defineClass(byte\[\])가 바이트 배열을 받아서 내부에서 무슨 일을 할까?
-   메서드의 바이트코드는 JVM 메모리 어디(Method Area / Metaspace)에 저장될까?
-   인터프리터는 이 메타데이터를 어떻게 읽어서 Stack Frame을 만들고 실행할까?
-   JIT는 언제/어떻게 개입해서 Code Cache에 네이티브 코드를 만들까?

## 2\. .class 파일과 메서드의 Code attribute

먼저 디스크에 있는 .class 파일부터 살펴보려고 한다. javac는 .java 소스를 플랫폼 독립적인 바이트코드로 변환하여 .class를 만든다. .class 파일 안에는 크게 다음 정보 덩어리들이 들어있다.

-   magic, version / constant pool
-   access flags, this class, super class
-   interfaces / fields / **methods** / attributes

여기서 메서드에 해당하는 부분이 methods 배열이다. 각 메서드는 이름, 시그니처, access flags와 함께 **attributes 배열**을 가진다. 메서드의 실제 코드(바이트코드)는 attributes 중 하나인 **Code attribute** 안에 들어 있다. Code attribute 안에는 max\_stack(operand stack 최대 깊이), max\_locals(로컬 변수 슬롯 개수), code\_length, 그리고 **code\[\](바이트코드 배열)** 등이 포함된다. 여기서 포인트는 .class 파일 안에서 메서드 코드는 그저 바이트 배열일 뿐이며, 아직 Method 객체 같은 것은 존재하지 않는다는 점이다.

## 3\. ClassLoader와 defineClass(byte\[\]): 바이트 → 메타데이터

실행 시점에 JVM은 이 .class 파일을 읽어서 런타임에서 사용할 수 있는 형태로 바꿔야 한다. ClassLoader가 파일을 찾아 byte\[\] classBytes로 메모리에 올린 뒤, 내부적으로 defineClass()를 호출한다. defineClass(byte\[\])는 바이트 배열을 파싱 및 검증하여 JVM 내부 메타데이터와 Class<?>를 만드는 **로우레벨 엔트리 포인트**라고 볼 수 있다. 내부적으로는 다음과 같은 단계가 일어난다.

1.  **파싱:** 바이트 배열에서 구조 정보를 읽음.
2.  **검증(Verification):** JVM 스펙 만족 여부 및 바이트코드의 타입/스택 규칙 위반 여부 체크.
3.  **메타데이터 생성:** JVM 내부용 클래스 메타데이터(Klass) 및 메서드 메타데이터(Method) 구조체 생성.
4.  **링킹:** 정적 필드 메모리 준비 및 심볼릭 참조를 실제 메타데이터로 연결.
5.  **Class<?> 객체 생성:** Heap에 java.lang.Class 인스턴스를 생성하고 Metaspace의 Klass를 가리키게 함.

## 4\. Method Area vs Metaspace: 저장 위치의 구분

JVM 스펙과 실제 구현체인 HotSpot의 용어를 구분할 필요가 있다.

-   **JVM 스펙 (Method Area):** 논리적인 영역으로, 타입 메타데이터가 들어가는 곳이다. 스펙상 "메서드의 바이트코드를 포함한 메타데이터는 Method Area에 저장된다"고 정의한다.
-   **HotSpot 구현 (Metaspace):** Java 8 이상에서 Method Area를 구현한 **네이티브 메모리 영역**이다.

**메모리 구조 요약:**

-   **Metaspace:** Klass, Method 구조체, 런타임 상수 풀 (설계도)
-   **Heap:** 인스턴스, 배열, Class<?> 자바 객체 (실체)
-   **Java Stack:** 스레드별 Stack Frame (실행 컨텍스트)

## 5\. Method 메타데이터(Method / methodOop)의 구성

클래스 로딩 시, JVM은 각 메서드마다 하나의 **메서드 메타데이터 구조체**를 만든다. 이 구조체는 메서드 이름, 시그니처, 각종 플래그와 함께 **바이트코드 포인터/버퍼**를 가진다. 즉, .class 파일의 Code attribute에 있던 바이트코드 배열이 이 구조체 내부로 옮겨지는 것이다. 과거 HotSpot에서는 이를 methodOop라는 포인터 타입으로 다루기도 했다.

## 6\. 인터프리터: 메타데이터 → Stack Frame → 실행

메서드 호출 시, 인터프리터는 Metaspace에 있는 Method 메타데이터를 보고 **Java Stack 위에 Stack Frame**을 만든다. 예를 들어 obj.add(1, 2) 호출 시, 인터프리터는 Method(add)를 찾아 max\_locals, max\_stack, bytecode 포인터 등을 읽어온다. 이 정보를 바탕으로 새 Frame을 만들고, 호출자의 스택에서 인자들을 pop하여 새 Frame의 locals에 배치한다. 이후 인터프리터는 바이트코드를 한 인스트럭션씩 읽으며 Frame 위의 데이터를 조작하고 실행한다.

## 7\. JIT, Code Cache, 그리고 인터프리터 → JIT 승급

HotSpot은 **Tiered Compilation**을 사용하여 효율을 극대화한다.

1.  처음엔 모든 메서드를 인터프리터로 실행하며 프로파일 정보를 수집한다.
2.  메서드가 "hot"하다고 판단되면 **C1 컴파일러**가 네이티브 코드로 컴파일하여 **Code Cache** 영역에 저장한다.
3.  이때 Method 메타데이터의 entry point가 Code Cache 안의 주소로 설정된다.
4.  더 자주 호출되면 **C2 컴파일러**가 강한 최적화를 적용해 다시 컴파일하고 주소를 교체한다.

이후 메서드 호출 시 JVM은 entry point를 확인하여 JIT 코드가 있으면 네이티브 코드로 즉시 점프하고, 없으면 인터프리터로 바이트코드를 실행한다.

## 8.  다이어그램 정리 

```bash
[1] .java → .class
-----------------------------
.java → javac → MyClass.class
       - methods[]
           - Code attribute (bytecode[])

[2] ClassLoader & defineClass
-----------------------------
MyClass.class → byte[] classBytes
   → defineClass(name, bytes, ...)
       - 파싱 / 검증
       - Klass / Method 메타데이터 생성
       - 링크 / Class<?> (Heap) 생성

[3] Metaspace (Method Area 구현)
-----------------------------
Klass(MyClass) - fields, methods[]
   - Method m1
       * name, desc, flags, max_locals, max_stack
       * bytecode 포인터 (Code attr)
       * 예외 테이블, CP ref

[4] 런타임 메모리 구조
-----------------------------
Metaspace : Klass, Method, CP (설계도)
Heap      : 객체들, Class<?> 인스턴스
Java Stack: 각 메서드 호출의 Frame 들
CodeCache : JIT 네이티브 코드 (C1/C2)

[5] 인터프리터 실행 & JIT
-----------------------------
- invoke* 명령어 → Metaspace.Method 조회
- Java Stack 에 Frame 생성 → bytecode 실행
- hot 메서드 → JIT 컴파일 → Code Cache 저장
- Method.entry 업데이트 → JIT 코드 실행
```
