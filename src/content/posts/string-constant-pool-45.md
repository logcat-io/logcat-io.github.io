---
title: String constant pool이란?
description: >-
  이전 글에서 Java의 String 클래스의 특징을 알아볼 때, 객체의 공유 특성을 설명하면서 String constant pool에 대해서
  언급했다. 이번 글에서는 String constant pool에 대해서 설명하고자 한다.
pubDate: '2023-10-13T14:40:53+09:00'
dateSource: html-visible
slug: string-constant-pool-45
tags:
  - 자바
  - string
  - constant
  - pool
  - 상수
  - 풀
category: Language/Java
cover: /images/posts/string-constant-pool-45/img.png
draft: false
legacy:
  tistoryId: '45'
  sourceHtml: '45/45-[JAVA]-String-constant-pool이란?.html'
  sourceHash: 'sha256:70f82fae0eaae2b664f55abb4bc3f25e89630308bd3df6e61d8e26e6c150f208'
---

이전 글 참고: [2023.10.12 - \[Java\] - \[JAVA\] String 클래스의 특징](https://ditto-dev.tistory.com/43)

[\[JAVA\] String 클래스의 특징](https://ditto-dev.tistory.com/43)

이전 글에서 Java의 String 클래스의 특징을 알아볼 때, 객체의 공유 특성을 설명하면서 **_String constant pool_**에 대해서 언급했다. 이번 글에서는 String constant pool에 대해서 설명하고자 한다.

먼저, String constant pool은 문자열이 저장되어 있는 공간으로 문자열 연산의 성능을 개선하고 메모리를 절약하기 위해서 구현되었다. 여기서 공간이라는 의미는 메모리 영역을 의미하는데, 아래의 JVM의 메모리 구조에서는 String constant pool을 찾을 수 없다.

![](/images/posts/string-constant-pool-45/img.png)

출처:&nbsp;https://www.javatpoint.com/memory-management-in-java

_그렇다면 어디에 위치하고 있는 것일까?_

결론부터 말하자면 String constant pool은 **힙(Heap) 영역**에 존재한다. JDK 7 이전에는 permgen 영역의 일부였지만, JDK 7부터 현재까지는 메인 힙 영역의 존재한다. Permgen 영역에서 힙 영역으로 이동안 이유는 메모리 부족에 대한 이유가 있다.

Permgen 영역은 고정된 크기를 가지는 영역으로 런타임시 크기를 확장할 수 없고, GC(garbage collection)에 적합하지 않았다. 크기가 고정되어 있기 때문에 많은 문자열을 저장할 경우, JVM에서 메모리 부족에 따른 오류가 발생할 위험이 있었다.

이를 개선하고자 JDK 7부터는 GC에 적합한 힙 영역으로 String constant pool을 옮기게 되었다. 힙 영역으로 옮기면서 JVM에 의해 GC가 동작하게 되었고 메모리 부족의 위험이 줄어들게 되었다.

이전 글에서 String 객체를 만드는 두 가지 방법에 대해서 설명했다. 그중 문자열 리터럴을 통해서 String 객체를 생성하면, JVM은 내부적으로 문자열 객체를 생성하고 상수 풀에 저장한다. 그리고 생성된 객체가 저장된 상수 풀 공간을 스택에 저장된 변수가 참조하도록 하게 된다.

```
String text1 = "JAVA";
```

![](/images/posts/string-constant-pool-45/edited-screenshot-2023-10-13-at-2-29-08-pm.png)

만약 다음과 같이 새로운 문자열 변수를 생성한다면 가장 먼저 JVM은 문자열 상수 풀에서 동일한 문자열 값이 있는지 검사한다. 그리고 같은 문자열 값이 있다면 같은 메모리 공간을 참조하고, 다른 경우에는 새로운 문자열 값을 생성 후 생성된 메모리 공간을 참조하도록 한다. 이렇게 기존 문자열 객체를 참조하는 방식을 문자열 인터닝(String Interning)이라고 한다.

```
String text2 = "JAVA";
String text3 = "JAVASCRIPT";
```

![](/images/posts/string-constant-pool-45/edited-screenshot-2023-10-13-at-2-29-51-pm.png)

이렇게 Java는 문자열 리터럴을 통해서 String 객체를 생성하는 경우, 문자열 상수 풀에 모든 값을 저장하고, 새로운 String 객체가 같은 값을 참조해야 하는 경우 풀에 있는 값을 참조할 수 있도록 한다. 즉, 문자열 상수 풀은 힙 메모리 영역 내의 작은 캐시 역할을 수행하여 메모리 사용량을 줄이고 메모리 내 기존 인스턴스를 재사용할 수 있도록 한다.

하지만 모든 String 객체가 상수 풀을 참조하는 것은 아니다. 상수 풀의 메모리 참조를 스킵할 수 있는 방법이 있는데, 이전에 설명한 new 키워드를 통한 객체 생성이다. new 키워드는 동일한 문자열 값의 존재 유무에 상관없이 항상 새로운 인스턴스를 생성한다. 그리고 생성된 인스턴스는 상수 풀에 생성되는 것이 아니라, 상수 풀 외부의 힙 영역에 생성된다.

```
String text4 = new String("JAVA");
```

![](/images/posts/string-constant-pool-45/edited-screenshot-2023-10-13-at-2-30-20-pm.png)

마지막으로 위에서 설명한 문자열 인터닝은 JVM에서 내부적으로 처리되지만, java에서는 수동으로 인터닝을 수행할 수 있도록 _String.intern()_ 메서드를 지원한다.

```
String text5 = new String("JAVA").intern();
```

_intern()_ 메서드는 힙 메모리의 문자열 객체 복사본을 생성하여 상수 풀에 저장한다. 이때 상수 풀에 동일한 문자열이 존재하면 새로운 객체를 생성하지 않고, 존재하는 문자열 객체에 대한 참조를 반환한다. 실제 == 연산을 통해 참조 주소를 비교하면 결과가 true인 것을 확인할 수 있다.

```
System.out.println(text1 == text5);
```

```
true
```

#### 정리

String constant pool은 문자열 연산의 성능 향상과 메모리 절약을 하기 위해서 구현되었다. 그리고 JDK 7 이전에는 permgen 영역에 존재했으나, 이후에는 힙 영역 내부로 이동했다. 모든 String 객체가 상수 풀에 저장되는 것은 아니고, 문자열 리터럴을 통해 생성된 객체가 저장된다. 하지만 문자열 리터럴을 통해서 매번 String 객체를 생성하는 경우 상수 풀의 모든 문자열 객체를 검색해야 하기 때문에 오버헤드가 발생할 수 있다.

#### 참고

-   [https://www.geeksforgeeks.org/string-constant-pool-in-java/](https://www.geeksforgeeks.org/string-constant-pool-in-java/)
-   [https://www.baeldung.com/java-string-constant-pool-heap-stack](https://www.baeldung.com/java-string-constant-pool-heap-stack)
-   [https://www.baeldung.com/java-permgen-metaspace](https://www.baeldung.com/java-permgen-metaspace)
-   [https://www.baeldung.com/java-string-pool](https://www.baeldung.com/java-string-pool)
-   [https://muratakkan.medium.com/understanding-and-using-the-java-string-pool-in-java-d60d3176716](https://muratakkan.medium.com/understanding-and-using-the-java-string-pool-in-java-d60d3176716)
-   [https://www.baeldung.com/string/intern](https://www.baeldung.com/string/intern)
