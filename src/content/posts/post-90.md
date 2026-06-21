---
title: '#1 생성자 대신 정적 팩터리 메서드를 고려하라'
description: '정적 팩터리 메서드는 new 키워드로 객체를 직접 생성하지 않고,'
pubDate: '2025-09-15T19:59:12+09:00'
dateSource: html-visible
slug: post-90
tags:
  - 자바
  - 정적
  - 팩터리
  - 메서드
  - 이팩티브
  - effective
  - 3/e
category: Language/Java
draft: false
legacy:
  tistoryId: '90'
  sourceHtml: 90/90.html
  sourceHash: 'sha256:045bbded7aa4d88dd796f1f7cb5642a0c23c1905216f56ca782eb6513109cc8e'
---

목차

* * *

### 중점적으로 봐야 하는 내용

-   클래스는 생성자와 별도로 **정적 팩터리 메서드**를 제공할 수 있다.
-   정적 팩터리 메서드는 생성자와 달리 **이름을 가질 수 있어 의도를 명확히 표현**할 수 있다.
-   또한, **하위 타입 반환**, **인스턴스 재사용**, **구현체 캡슐화** 등 다양한 이점을 제공한다.

### 주요 개념 요약

정적 팩터리 메서드는 new 키워드로 객체를 직접 생성하지 않고,  
**클래스 내부에 선언된 static 메서드를 통해 객체를 반환**하는 방식이다.

예시:

```java
public class User {
    private final String name;

    private User(String name) { 
        this.name = name;
    }

    public static User of(String name) {
        return new User(name);
    }
}
```

```java
User user = User.of("hyedddi");
```

### 장점

-   **이름을 가질 수 있다**
    -   생성자 오버로딩보다 의도가 명확하다.
    -   User.from(entity), User.of(name, email) 처럼 목적을 드러낼 수 있다.
-   **인스턴스를 새로 생성하지 않아도 된다 (인스턴스 통제)**
    -   매번 새 객체를 만들지 않고 캐시된 객체를 재사용 가능 → 메모리 절약
    -   싱글턴 / 불변 객체 패턴 구현에 유용
-   **반환 타입의 하위 타입 객체를 반환할 수 있다**
    -   외부에는 인터페이스만 공개하고, 내부 구현체는 자유롭게 교체 가능
    -   구현을 감춤으로써 유연성 확보
-   **입력 매개변수에 따라 다른 클래스의 객체를 반환할 수 있다**
    -   팩터리가 어떤 구체 클래스를 반환하는지 외부는 몰라도 된다.
-   **작성 시점에 구현 클래스가 없어도 된다**
    -   반환 타입(인터페이스)만 먼저 정의하고, 실제 구현체는 나중에 작성 가능
    -   서비스 제공자 프레임워크(Service Provider Framework)에서 많이 사용됨

### 단점

-   **상속 불가**
    -   생성자가 private이므로 하위 클래스를 만들 수 없다.
-   **API에서 눈에 잘 안 띈다**
    -   생성자는 문법적으로 항상 드러나지만, 정적 메서드는 문서화하지 않으면 발견하기 어렵다.

### 정적 팩터리 메서드 명명 규칙

<table style="border-collapse: collapse; width: 100%;" border="1" data-end="1867" data-start="1489" data-ke-align="alignLeft"><tbody data-end="1867" data-start="1531"><tr data-end="1565" data-start="1531"><td style="text-align: left;" data-col-size="sm" data-end="1545" data-start="1531">from</td><td style="text-align: left;" data-col-size="sm" data-end="1565" data-start="1545">하나의 매개변수를 받아 형변환</td></tr><tr data-end="1598" data-start="1566"><td style="text-align: left;" data-col-size="sm" data-end="1580" data-start="1566">of</td><td style="text-align: left;" data-col-size="sm" data-end="1598" data-start="1580">여러 매개변수를 받아 집계</td></tr><tr data-end="1635" data-start="1599"><td style="text-align: left;" data-col-size="sm" data-end="1613" data-start="1599">valueOf</td><td style="text-align: left;" data-col-size="sm" data-end="1635" data-start="1613">from, of의 더 자세한 버전</td></tr><tr data-end="1694" data-start="1636"><td style="text-align: left;" data-col-size="sm" data-end="1665" data-start="1636">instance / getInstance</td><td style="text-align: left;" data-col-size="sm" data-end="1694" data-start="1665">인스턴스를 반환 (같은 인스턴스일 수도 있음)</td></tr><tr data-end="1743" data-start="1695"><td style="text-align: left;" data-col-size="sm" data-end="1724" data-start="1695">create / newInstance</td><td style="text-align: left;" data-col-size="sm" data-end="1743" data-start="1724">항상 새로운 인스턴스를 생성</td></tr><tr data-end="1783" data-start="1744"><td style="text-align: left;" data-col-size="sm" data-end="1758" data-start="1744">getType</td><td style="text-align: left;" data-col-size="sm" data-end="1783" data-start="1758">다른 클래스에서 타입의 인스턴스를 반환</td></tr><tr data-end="1825" data-start="1784"><td style="text-align: left;" data-col-size="sm" data-end="1798" data-start="1784">newType</td><td style="text-align: left;" data-col-size="sm" data-end="1825" data-start="1798">다른 클래스에서 타입의 새 인스턴스를 반환</td></tr><tr data-end="1867" data-start="1826"><td style="text-align: left;" data-col-size="sm" data-end="1840" data-start="1826">type</td><td style="text-align: left;" data-col-size="sm" data-end="1867" data-start="1840">getType/newType의 간결한 버전</td></tr></tbody></table>

### 실무 적용 예시: Entity ↔ Domain ↔ DTO 변환

회사에서 클린 아키텍처를 적용하는 과정에서 **정적 팩터리 메서드를 적극적으로 활용하기 위해 노력했다.**  
클린 아키텍처에서는 도메인 계층이 외부(인프라 계층)에 의존하거나 이를 알아서는 안 되기 때문에, **엔티티를 도메인 객체로 변환할 때 인프라 계층에 정적 팩터리 메서드를 두는 방식으로 구현했다.**

이렇게 하면

-   도메인 계층은 외부 의존 없이 순수하게 유지되고
-   변환 책임은 의존하는 쪽(인프라, DTO)에서 맡게된다.

### 나의 인사이트

-   정적 팩터리 메서드를 사용함으로써 Entity → Domain → DTO 변환을 명확하고 직관적으로 만들 수 있었다.
-   필요한 필드만 내려줄 수 있어 **간결함과 명확성**을 동시에 얻었고,
-   도메인 계층은 외부 구현을 몰라도 되므로 **변경에 유연하게 대응할 수 있었다.**
