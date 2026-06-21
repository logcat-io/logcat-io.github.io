---
title: JSP / Maven / Tomcat 프로젝트 생성하기
description: '본 포스팅은 Intellij Ultimate IDEA, Tomcat 9.0.73, Java 11.0.18을 통해 진행되었습니다.'
pubDate: '2023-04-29T01:46:52+09:00'
dateSource: html-visible
slug: jsp-maven-tomcat-10
tags:
  - Tomcat
  - 웹개발
  - Maven
  - IntelliJ
  - jsp/maven/tomcat
  - 프로젝트
  - 생성
category: Spring Framework/Servlet & JSP
cover: >-
  /images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-06-15-am.png
draft: false
legacy:
  tistoryId: '10'
  sourceHtml: '10/10-[JSP]-JSP-_-Maven-_-Tomcat-프로젝트-생성하기.html'
  sourceHash: 'sha256:042c587f9950989bbe507e5e71dcfbbec0ff20cd510b747ba9fd14b3facd2456'
---

본 포스팅은 **Intellij** **Ultimate IDEA**, **Tomcat 9.0.73**, **Java 11.0.18**을 통해 진행되었습니다.

**Intellij** **Ultimate IDEA**는아래의 링크에서 다운로드 받을 수 있습니다.

[https://www.jetbrains.com/idea/](https://www.jetbrains.com/idea/ "Intellij IDEA")

[IntelliJ IDEA – the Leading Java and Kotlin IDE](https://www.jetbrains.com/idea/)

## **\# 프로젝트 생성**

먼저 **New Project** 로 새로운 프로젝트를 생성합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-06-15-am.png)

**Maven** 프로젝트에서 동적 웹 개발을 위해서, **Artifact**는 **maven-archetype-webapp** 을 선택합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-09-29-am.png)

**Create** 버튼을 누르면 아래와 같이 프로젝트가 성공적으로 생성됩니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-17-26-am.png)

## **\# 톰캣(Tomcat) 설치**

**JSP** 등 동적 웹 개발을 위해서는 웹 애플리케이션 서버가 필요하고, 일반적으로 많이 사용되는 **아파치 톰캣(Apache Tomcat)**을 사용하겠습니다.

[톰캣 사이트](https://tomcat.apache.org/)에 접속하여 원하는 버전을 다운로드할 수 있고, 이번 프로젝트에서는 **Tomcat 9** 버전을 활용하겠습니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-27-39-am.png)

반드시 Tomcat 9 버전을 사용할 필요는 없으며, 사용하는 기술 사양에 맞게 선택하면 됩니다. 아래는 톰캣 버전에 따른 기술 사양표입니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-38-33-am.png)

https://tomcat.apache.org/whichversion.html

버전을 선택했다면 운영체제에 맞는 링크를 클릭해 Tomcat을 다운로드를 진행합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-32-29-am.png)

다운로드가 완료되었다면, 다운로드한 파일은 찾기 쉬운 위치에 압축 해제 후 저장합니다. 추후 **Intellij**에서 불러올 것입니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-37-11-am.png)

## **\# Tomcat jsp API 추가**

**Maven**에서 **Tomcat**을 사용하기 위해서 **Tomcat jsp API**를 **pom.xml**에 추가해 주어야 합니다.

먼저, [Maven repository로](https://mvnrepository.com/) 이동합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-46-53-am.png)

**Tomcat jsp**를 검색하고, 가장 상단의 **Tomcat JSP API**를 선택해 줍니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-47-24-am.png)

위에서 받아준 Tomcat 버전과 동일한 버전을 클릭해 줍니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-49-15-am.png)

**Maven 탭의 태그를 모두 복사**합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-51-30-am.png)

이제 생성한 프로젝트로 이동 후 **pom.xml**에 복사한 태그를 **dependencies** 태그 내부에 붙여줍니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-54-54-am.png)

해당 내용을 붙여 놓으면 오른쪽에 아래와 같은 **아이콘**을 나타나게 되고,

![](/images/posts/jsp-maven-tomcat-10/screenshot-2023-04-29-at-12-58-33-am.png)

해당 아이콘을 누르면 새로 추가한 **Tomcat jsp api** 관련 라이브러리가 **External Libraries** 하위에 생긴 것을 볼 수 있습니다. 

![](/images/posts/jsp-maven-tomcat-10/screenshot-2023-04-29-at-12-59-42-am.png)

만약 해당 아이콘이 나타나지 않는다면, **pom.xml** 우클릭 후 **Maven** > **Reload** **project**를 클릭해 주면 동일하게 라이브러리를 설치할 수 있습니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-12-58-17-am.png)

이제 위에서 다운로드한 **Tomcat**을 적용하기 위해서 **Edit Configurations**를 클릭합니다.

![](/images/posts/jsp-maven-tomcat-10/screenshot-2023-04-29-at-1-09-21-am.png)

**Add new** > **Tomcat Server** > **Local**을 선택해 줍니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-10-55-am.png)

위에서 다운로드한 **Tomcat** 폴더를 찾고 불러옵니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-13-53-am.png)

**Tomcat**을 불러오고 **HTTP port**를 **8080**으로 변경해 줍니다. (8081을 사용해도 무방합니다.)

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-15-52-am.png)

다음으로 **Deploy**를 위한 **Artifacts**를 추가해 줍니다. **:war**와 **:war exploded** 두 개 중 **:war exploded**를 선택해 줍니다. 두 가지의 차이는 :war exploded의 경우 아카이브를 압축 해제한 후 배포하는 방법을 의미합니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-17-22-am.png)

**Application context**의 경우 **context**의 경로인데, 아래와 같이 기본적으로 설정된 경로를 사용하게 되면 localhost:8080/HelloWorld\_war\_exploded/ 가 기본 주소가 되게 됩니다. 만약 깔끔하게 localhost:8080/ 을 위해서는 /를 남기고 뒤에 문자를 지워 주면 됩니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-24-29-am.png)

모든 선택이 완료되었다면 **Apply** > **OK**를 눌러 마무리합니다.

이제 **RUN** 버튼을 눌러 **Tomcat** 서버를 실행해 줍니다.

![](/images/posts/jsp-maven-tomcat-10/screenshot-2023-04-29-at-1-22-37-am.png)

서버가 성공적으로 실행되면 페이지가 정상적으로 출력되는 것을 확인할 수 있습니다.

![](/images/posts/jsp-maven-tomcat-10/edited-screenshot-2023-04-29-at-1-23-39-am.png)
