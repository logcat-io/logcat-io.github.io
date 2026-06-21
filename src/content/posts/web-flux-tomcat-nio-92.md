---
title: 왜 WebFlux를 선택했는가? (Tomcat NIO와 비교)
description: 티켓팅 프로젝트에서 Spring WebFlux를 사용했다는 이야기를 하면 종종 이런 질문을 받습니다.
pubDate: '2025-09-26T18:25:05+09:00'
dateSource: html-visible
slug: web-flux-tomcat-nio-92
tags:
  - webflux
  - tomcat
  - nio
  - vs
category: Spring Framework/Spring & Spring Boot
draft: false
legacy:
  tistoryId: '92'
  sourceHtml: 92/92.html
  sourceHash: 'sha256:97e0fe3a5299fab6b6aa89af0bc3289da7f418573220520af5a894d80f36550c'
---

들어가며

티켓팅 프로젝트에서 Spring WebFlux를 사용했다는 이야기를 하면 종종 이런 질문을 받습니다.

> “톰캣도 NIO를 지원하는데, 굳이 WebFlux를 선택한 이유가 뭔가요?”

저도 처음에는 “어차피 둘 다 non-blocking이면 큰 차이가 없지 않을까?” 라고 생각했지만, 실제로 비교해보면 철학과 활용 범위에서 확실한 차이가 있었습니다.

이번 글에서는 WebFlux와 Tomcat NIO를 비교하며 WebFlux를 선택한 이유를 정리해 보겠습니다.

### 아키텍처의 차이

-   **Tomcat NIO**
    -   Servlet API 기반으로 동작
    -   필터 체인, Request/Response 객체 등 **서블릿 스펙의 제약** 존재
-   **WebFlux**
    -   Reactive Streams 표준 기반
    -   Netty 같은 이벤트 루프 서버에 최적화
    -   서버-프레임워크-애플리케이션까지 **일관된 reactive 아키텍처**

### Non-blocking 범위의 차이

-   **Tomcat NIO**
    -   요청 처리 레벨에서 non-blocking 지원
    -   하지만 DB 접근, 외부 API 호출 등은 보통 여전히 **blocking 코드**
-   **WebFlux**
    -   Reactor 기반 프로그래밍 모델 제공
    -   **end-to-end non-blocking** 가능 (서버부터 비즈니스 로직까지)

### 확장성(Scalability)

-   **Tomcat NIO**
    -   Thread Pool을 효율적으로 활용
    -   요청이 많아지면 결국 worker thread 증가 → 컨텍스트 스위칭 비용 ↑
-   **WebFlux**
    -   소수의 이벤트 루프 쓰레드로 대규모 동시 요청 처리 가능
    -   특히 **IO bound 환경**에서 강력한 성능 발휘

### Spring에서의 선택 이유

-   WebFlux는 단순히 NIO 서버 위에서 돌아가는 게 목적이 아님
-   **Reactive Streams 프로그래밍 모델**을 애플리케이션 레벨에서 제공하는 것이 핵심
-   따라서 “논블로킹 서버를 쓰고 싶다”면 Tomcat NIO로도 충분할 수 있지만, **Reactive 철학을 애플리케이션 전반에 녹이고 싶다면 WebFlux가 적합**

### 나의 인사이트

개발자로서 중요한 건 단순히 기술적인 지원 여부가 아니라, **애플리케이션 전반에서 일관된 모델을 유지할 수 있느냐**였습니다.

Tomcat NIO는 “웹 서버의 비동기 I/O”를 제공하는 데 초점이 맞춰져 있다면, WebFlux는 “프로그래밍 모델 자체를 reactive하게 바꾸자”라는 더 큰 목적이 있습니다. 저는 이 차이가 “왜 WebFlux를 선택해야 하는가?”라는 질문에 대한 가장 적절한 답이라고 생각합니다.

### 참고 자료

-   [Spring WebFlux 공식 문서](https://docs.spring.io/spring-framework/reference/web/webflux.html)
-   [Servlet 3.1 NIO 공식 문서](https://docs.oracle.com/javaee/7/tutorial/servlets012.htm)
