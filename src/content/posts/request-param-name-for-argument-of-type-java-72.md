---
title: >-
  @RequestParam 예외: Name for argument of type [java.lang.String] not specified,
  and parameter name information not available via reflection.
description: 프로젝트를 수행하면서 우연히 질문을 받게 되었다.
pubDate: '2024-01-18T17:39:10+09:00'
dateSource: html-visible
slug: request-param-name-for-argument-of-type-java-72
tags: []
category: Spring Framework/Spring & Spring Boot
cover: >-
  /images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-4-38-37-pm.png
draft: false
legacy:
  tistoryId: '72'
  sourceHtml: 72/72.html
  sourceHash: 'sha256:ec4709cfa6763a82c8bf308afc1e085fe79c0681ab21d5b5000ec55693888147'
---

목차

* * *

프로젝트를 수행하면서 우연히 질문을 받게 되었다.

_**@RequestParam에 value 속성을 지정하지 않으면 예외가 발생하는가?  -sky-**_

기본적으로 @RequestParam과 @PathVariable은 request의 **파라미터와 매개변수의 이름이 동일하다면, value 속성을 생략할 수 있다**. 또한 @RequestParam 어노테이션도 생략할 수 있다. 그렇기 때문에 당연하게 발생하지 않고, 매개변수의 이름과 파라미터의 이름이 같다면 어노테이션도 생략할 수 있다고 답했다. 하지만 당연하다고 생각했던 것이 예외를 발생시켰다. 

예외를 발생시킨 코드는 아래와 같다.

```java
@GetMapping("/login")  
public ResponseEntity<?> getPostByParam(@RequestParam String name, @RequestParam int age) {  
	return new ResponseEntity<>(new Response<>(OK.value(), name + " : " + age), OK);  
}
```

그리고 위의 코드에서 발생시킨 예외는 다음과 같다.

```bash
java.lang.IllegalArgumentException: Name for argument of type [java.lang.String] not specified, and parameter name information not available via reflection. Ensure that the compiler uses the '-parameters' flag.
	at org.springframework.web.method.annotation.AbstractNamedValueMethodArgumentResolver.updateNamedValueInfo(AbstractNamedValueMethodArgumentResolver.java:185) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.method.annotation.AbstractNamedValueMethodArgumentResolver.getNamedValueInfo(AbstractNamedValueMethodArgumentResolver.java:160) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.method.annotation.AbstractNamedValueMethodArgumentResolver.resolveArgument(AbstractNamedValueMethodArgumentResolver.java:106) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.method.support.HandlerMethodArgumentResolverComposite.resolveArgument(HandlerMethodArgumentResolverComposite.java:122) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.method.support.InvocableHandlerMethod.getMethodArgumentValues(InvocableHandlerMethod.java:226) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.method.support.InvocableHandlerMethod.invokeForRequest(InvocableHandlerMethod.java:179) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.mvc.method.annotation.ServletInvocableHandlerMethod.invokeAndHandle(ServletInvocableHandlerMethod.java:118) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.invokeHandlerMethod(RequestMappingHandlerAdapter.java:917) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.handleInternal(RequestMappingHandlerAdapter.java:829) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.mvc.method.AbstractHandlerMethodAdapter.handle(AbstractHandlerMethodAdapter.java:87) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1089) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.DispatcherServlet.doService(DispatcherServlet.java:979) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.FrameworkServlet.processRequest(FrameworkServlet.java:1014) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at org.springframework.web.servlet.FrameworkServlet.doGet(FrameworkServlet.java:903) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at jakarta.servlet.http.HttpServlet.service(HttpServlet.java:564) ~[tomcat-embed-core-10.1.17.jar:6.0]
	at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:885) ~[spring-webmvc-6.1.2.jar:6.1.2]
	at jakarta.servlet.http.HttpServlet.service(HttpServlet.java:658) ~[tomcat-embed-core-10.1.17.jar:6.0]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:205) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:149) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.websocket.server.WsFilter.doFilter(WsFilter.java:51) ~[tomcat-embed-websocket-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:174) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:149) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.springframework.web.filter.RequestContextFilter.doFilterInternal(RequestContextFilter.java:100) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:116) ~[spring-web-6.1.2.jar:6.1.2]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:174) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:149) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.springframework.web.filter.FormContentFilter.doFilterInternal(FormContentFilter.java:93) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:116) ~[spring-web-6.1.2.jar:6.1.2]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:174) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:149) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.springframework.web.filter.CharacterEncodingFilter.doFilterInternal(CharacterEncodingFilter.java:201) ~[spring-web-6.1.2.jar:6.1.2]
	at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:116) ~[spring-web-6.1.2.jar:6.1.2]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:174) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:149) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.StandardWrapperValve.invoke(StandardWrapperValve.java:167) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.StandardContextValve.invoke(StandardContextValve.java:90) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.authenticator.AuthenticatorBase.invoke(AuthenticatorBase.java:482) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.StandardHostValve.invoke(StandardHostValve.java:115) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.valves.ErrorReportValve.invoke(ErrorReportValve.java:93) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.core.StandardEngineValve.invoke(StandardEngineValve.java:74) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.catalina.connector.CoyoteAdapter.service(CoyoteAdapter.java:340) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.coyote.http11.Http11Processor.service(Http11Processor.java:391) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.coyote.AbstractProcessorLight.process(AbstractProcessorLight.java:63) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.coyote.AbstractProtocol$ConnectionHandler.process(AbstractProtocol.java:896) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.util.net.NioEndpoint$SocketProcessor.doRun(NioEndpoint.java:1744) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.util.net.SocketProcessorBase.run(SocketProcessorBase.java:52) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.util.threads.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1191) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.util.threads.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:659) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at org.apache.tomcat.util.threads.TaskThread$WrappingRunnable.run(TaskThread.java:61) ~[tomcat-embed-core-10.1.17.jar:10.1.17]
	at java.base/java.lang.Thread.run(Thread.java:833) ~[na:na]
```

## 원인 분석

예외를 발생시킨 원인을 찾고 해결하기 위해서 몇 가지의 실험을 진행하였다. 

**\[가설 1\]** _@RequestParam의 value 속성을 지정하는 방법_

value 속성을 지정하니 정상적으로 파라미터를 받을 수 있었다. 그렇다면 속성이 없는 경우 문제가 발생하는 것인데, 예외를 잘 보면 파라미터 정보가 없다는 것을 알 수 있다.

**\[가설 2\]** _IntelliJ의 Gradle 프로젝트 빌드를 Gradle로 수행하기_

문제에 대해서 알아보던 중 문제가 발생한 코드를 실행시킨 IntelliJ의 설정 중에서 Gradle 프로젝트의 빌드 방법이 다른 것을 발견했다. 기본적으로 Gradle로 빌드시 수행되는 시간이 길어서 IntelliJ IDEA를 통해서 빌드를 수행하는데, 이때 Gradle로 빌드를 수행하니 정상적으로 파라미터를 받을 수 있었다.

## 문제 해결

실험을 통해서 가설 2에 더 집중하기로 생각했고, 해결 방법을 찾아보았다. 가설 2에 대한 해결 방법은 3번에서 보다 자세하게 설명한다.

### \[해결 방법 1\] \-parameters flag 적용

예외를 자세히 보면 컴파일 옵션에 \-parameters flag를 사용할 것을 권장하고 있다. \-parameters flag는 아래에 추가할 수 있는데, 추가 후 API 요청 시에 정상적으로 파라미터를 받는 것을 확인할 수 있다.

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-4-38-37-pm.png)

### \[해결 방법 2\] value 속성 사용하기

  
위에서 설명한 것과 같이 value 속성을 지정하면 정상적으로 동작하는 것을 알 수 있다.

```java
@GetMapping("/login")  
public ResponseEntity<?> getPostByParam(@RequestParam("name") String name, @RequestParam int age) {  
return new ResponseEntity<>(new Response<>(OK.value(), name + " : " + age), OK);  
}
```

### \[해결 방법 3\]  Gradle 프로젝트 빌드를 Gradle로 수행하기

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-4-42-23-pm.png)

가설 2에서 검증하였듯이, Gradle로 빌드를 수행하면 애플리케이션이 정삭 동작하는 것을 알 수 있다. 

여기서 궁금증이 생기게 된다.

_**왜 빌드를 수행하는 방법에 따라서 동작이 달라질까?**_

이 부분은 스프링 공식 문서를 살펴보면 힌트를 얻을 수 있다. 공식문서의 URI Template Patterns 내용 중 TIP 부분을 살펴보면 다음과 같은 문장이 있다.

> Or if the URI template variable name matches the method argument name you can omit that detail. As long as your code is not compiled without debugging information, Spring MVC will match the method argument name to the URI template variable name:

해석하면 다음과 같다. URI 템플릿 변수 이름이 메서드 인수 이름과 일치하는 경우 해당 세부 정보를 생략할 수 있다. 코드가 디버깅 정보 없이 컴파일되지 않는 한, Spring MVC는 메서드 인수 이름을 템플릿 변수 이름과 일치시킨다.  
  
여기서 주목할 부분은 **'코드가 디버깅 정보 없이 컴파일되지 않는 한'**이다. 반대로 말하면, 디버깅 정보 없이 컴파일된다면 자동으로 템플릿 변수와 일치시키지 못한다고 생각할 수 있다. 

그렇다면 자바 소스 코드를 컴파일할 때 디버깅 정보를 포함할 수 있는 확인 해 봐야 한다. 이는 Javac 공식 문서에서 알 수 있는데, 자바 소스 코드를 컴파일할 경우 javac -g와 같이 \-g 옵션을 적용하여 지역변수를 포함하는 디버깅 정보를 생성할 수 있다. 아래의 공식문서에서 발췌한 것이다.

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-5-27-43-pm.png)

그렇다면 Gradle도 자바 애플리케이션을 빌드할 때 아래와 같이 자바 소스 코드에 대한 컴파일을 수행하게 된다.

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-4-58-42-pm.png)

이때 디버깅 정보를 포함하여 자바 애플리케이션을 컴파일한다고 가정할 수 있다. 그리고 이 부분은 Gradle의 API 문서에서 찾을 수 있었다. Gradle의 공식문서에는 JavaCompile 항목이 존재하는데, 컴파일 옵션 API에서 setDebug 메서드를 확인할 수 있다.

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-5-29-47-pm.png)

setDebug 메서드는 위의 설명과 같이 자바 클래스 파일 생성 시 디버깅 정보의 포함여부는 설정할 수 있고, 기본값이 True이기 때문에 자바 클래스 파일 생성 시 자동으로 디버깅 정보를 포함하여 컴파일하게 된다.   
  
그렇기 때문에 IntelliJ IDEA에서 Gradle로 빌드 방식을 바꾸면 정상 동작하게 되는 것이다.  
  
아쉽게도 IntellJ IDEA의 경우에는 아래와 같이 디버깅 정보의 포함여부를 선택할 수 있게 제공하지만, 선택 후 애플리케이션을 실행해도 예외가 발생하는 결과를 바뀌지 않았다. 이 부분에 대해서는 명확하게 확인할 수는 없었다.

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-5-31-39-pm.png)

![](/images/posts/request-param-name-for-argument-of-type-java-72/screenshot-2024-01-18-at-5-06-12-pm.png)

당연하게 생각하는 부분에서 문제를 마주해서 당황스러웠지만, 해답을 찾는 과정에서 많은 것을 배울 수 있었다.   
  
  
_\* 문제를 인지하고 해답을 찾으면서 주관적인 견해로 작성된 방법입니다. 혹시 잘못된 부분이 있다면 댓글로 남겨주시면 정말 감사하겠습니다._

## 참고

\- [https://stackoverflow.com/questions/25797584/name-for-argument-type-java-lang-string-not-available-and-parameter-name-info](https://stackoverflow.com/questions/25797584/name-for-argument-type-java-lang-string-not-available-and-parameter-name-info)

\- [https://docs.spring.io/spring-framework/docs/3.2.16.RELEASE/spring-framework-reference/html/mvc.html](https://docs.spring.io/spring-framework/docs/3.2.16.RELEASE/spring-framework-reference/html/mvc.html)

\- [https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/requestparam.html](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/requestparam.html)

\- [https://github.com/spring-projects/spring-boot/issues/38541](https://github.com/spring-projects/spring-boot/issues/38541)

\- [https://m.blog.naver.com/sm\_woo/70185755273](https://m.blog.naver.com/sm_woo/70185755273)

\- [https://www.jetbrains.com/help/idea/java-compiler.html#javac\_eclipse](https://www.jetbrains.com/help/idea/java-compiler.html#javac_eclipse)

\- [https://docs.gradle.org/current/javadoc/org/gradle/api/tasks/compile/CompileOptions.html#isDebug--](https://docs.gradle.org/current/javadoc/org/gradle/api/tasks/compile/CompileOptions.html#isDebug--)

\- [https://stackoverflow.com/questions/29593500/how-can-i-set-the-compileoptions-for-my-gradle-java-plugin](https://stackoverflow.com/questions/29593500/how-can-i-set-the-compileoptions-for-my-gradle-java-plugin)
