---
title: "[SPRING] Getter와 객체 직렬화"
description: 요청 응답으로 아래의 객체를 담은 리스트를 반환하는 과정에서 리스트의 객체가 계속 빈 객체로 반환되는 문제가 발생했다.
pubDate: '2023-08-26T22:44:58+09:00'
dateSource: html-visible
slug: getter-35
tags:
  - Java
  - Jackson
  - 자바빈
  - 객체
  - 직렬화
  - getter와
category: Spring Framework/Spring & Spring Boot
draft: false
legacy:
  tistoryId: '35'
  sourceHtml: '35/35-[Spring-Boot]-Getter와-객체-직렬화.html'
  sourceHash: 'sha256:882c32d03b75d02e653c2c382d5ca11c96328d26eec6f845d4c2fedf117ba664'
---

요청 응답으로 아래의 객체를 담은 리스트를 반환하는 과정에서 리스트의 객체가 계속 빈 객체로 반환되는 문제가 발생했다.

```java
public class SampleDto {
    private Long id;
    private String name;
    private SampleType type;
    private String code;
    
    public SampleDto(){}
 }
```

서버에서 응답 결과에 대한 로그를 찍었을 때는 값이 잘 찍혔는데, 왜 클라이언트에서는 빈 객체만 반환되었을까?

## 원인은 getter 누락

**원인은 DTO 객체에 getter를 생성해 주지 않았기 때문입니다.**

> getter와 빈 객체 사이에는 어떤  연관관계가 있을까?  
>   

## Jackson은 자바빈 규약을 따른다

**Spring Boot**는 **java** 객체를 **JSON으로** 변환하기 위해서 내부적으로 **Jackson** **라이브러리**를 사용해서 직렬화 과정을 수행합니다.

(만약 직렬화에 대해서 모른다면 [\[JAVA\] 직렬화(Serialization)란?](https://ditto-dev.tistory.com/34) 글에 간단히 정리해 두었습니다.)

이때 **Jackson** 라이브러리는 **자바빈 규약**(JavaBeans specification)을 따르는데, 자바빈 규약은 다음과 같습니다.

-   자바빈은 기본 패키디지 이외의 특정 패키지에 속해야 한다.
-   기본 생성자가 있어야 한다.
-   멤버변수의 접근 제어자는 private여야 한다.
-   멤버변수에 getter/setter 메서드가 존재해야 한다.
-   getter/setter 메서드는 접근 제어자가 public이어야 한다.
-   직렬화가 되어 있어야 한다. 하지만 필수는 아니다.

위의 자바빈 규약에 따르면, 객체의 필드에 접근하기 위해서는 해당 프로퍼티에 대한 **getter/setter** 메서드가 제공되어야 합니다. Jackson 라이브러리의 JSON 직렬화 과정에서도 이 규약을 따르며, getter 메서드를 통해 프로퍼티 값을 읽어옵니다.

그런데 위의 코드에서는 getter 메서드가 누락되었고, 때문에 Jackson은 getter 메서드를 통해 프로퍼티 값을 읽어오지 못해 빈 객체만 반환했던 것입니다.

## 해결 — getter를 제공하라

따라서 Jackson이 객체를 JSON으로 직렬화하는 과정에서 문제가 발생하지 않도록 하려면, 해당 클래스의 필드에 대한 getter 메서드를 제공해야 합니다. 물론 **ObjectMapper**를 사용할 때도 getter를 반드시 제공해야 합니다. 사실 **Jackson2HttpMEssageConverter** 내부적으로 ObjectMapper를 사용해서 직렬화를 수행하기 때문입니다.

만약 특정 필드를 JSON으로 직렬화하고 싶지 않은 경우에는 **@JsonIgnore** 어노테이션을 해당 필드에 사용하여, Jackson에게 해당 필드를 무시하도록 지시할 수 있습니다.
