---
title: "[SPRING] build와 bootJar란?"
description: >-
  Gradle로 Spring Boot application을 생성 후 jar 파일 생성하는 방법에 build와 bootJar가 있다는 것을
  알게 되었다. 지금까지 고민하지 않고 build만을 사용했는데, 이번 글에서 간단히 정리하고자 한다.
pubDate: '2023-10-17T15:56:40+09:00'
dateSource: html-visible
slug: build-boot-jar-46
tags:
  - Java
  - gradle
  - build
  - bootJar
  - difference
  - between
  - and
category: Spring Framework/Spring & Spring Boot
cover: /images/posts/build-boot-jar-46/img.png
draft: false
legacy:
  tistoryId: '46'
  sourceHtml: '46/46-[Gradle]-build와-bootJar란?.html'
  sourceHash: 'sha256:6d5b601fd80c7cc1918fda611c3e6b89b74417882903991abebaac24d901dec2'
---

Gradle로 Spring Boot application을 생성 후 jar 파일 생성하는 방법에 build와 bootJar가 있다는 것을 알게 되었다. 지금까지 고민하지 않고 build만을 사용했는데, 이번 글에서 간단히 정리하고자 한다.

## Gradle _build_

**build**는 아래와 같은 라이플 사이클을 수행하게 된다. _bootJar_와의 차이점은 **assemble**, **check처럼** 라이플 사이클에 관련된 태스크가 존재하는 것이다. check는 태스크를 실행하거나 검증 작업을 수행할 수 있고, assemble은 의존성 해결, 컴파일 등의 태스크를 거쳐 프로젝트를 빌드하고 아티팩트를 생성하는 작업을 수행한다.

![](/images/posts/build-boot-jar-46/img.png)

출처:&nbsp;https://docs.gradle.org/current/userguide/img/task-dag-examples.png

## Gradle _bootJar_

**bootJar**는 실행가능한 jar 파일을 생성하기 위해서 사용한다. bootJar는 자바 플러그인이 적용되어 있을 때 자동으로 생성되고 BootJar의 인스턴스이다. 또한, 어셈블 라이프사이클 작업을 스스로 수행한다. 어셈블 태스크는 bootJar 태스크에 종속되도록 자동 설정 되기 때문에 빌드(어셈블) 태스크를 실행하면 bootJar 태스크가 실행된다. 테스트, 코드 커버리지, 정적 코드 분석 등의 태스크 보다, 실행가능한 jar 파일을 빌드하는데 관심이 있다면 bootJar를 사용하면 된다.

### 참고

-   [https://docs.gradle.org/current/userguide/base\_plugin.html](https://docs.gradle.org/current/userguide/base_plugin.html)
-   [https://docs.spring.io/spring-boot/docs/current/gradle-plugin/reference/htmlsingle/#packaging-executable.jars](https://docs.spring.io/spring-boot/docs/current/gradle-plugin/reference/htmlsingle/#packaging-executable.jars)
-   [https://docs.gradle.org/current/userguide/build\_lifecycle.html](https://docs.gradle.org/current/userguide/build_lifecycle.html)

[Build Lifecycle](https://docs.gradle.org/current/userguide/build_lifecycle.html)

[Spring Boot Gradle Plugin Reference Guide](https://docs.spring.io/spring-boot/docs/current/gradle-plugin/reference/htmlsingle/#packaging-executable.jars)

[The Base Plugin](https://docs.gradle.org/current/userguide/base_plugin.html)
