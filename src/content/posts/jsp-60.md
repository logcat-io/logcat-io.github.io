---
title: 서블릿과 JSP란?
description: >-
  자바로 웹 개발을 공부하면 반드시 공부하는 것이 스프링 Web MVC 프레임워크(이하 스프링 MVC)다. 그만큼 스프링 MVC는 웹
  애플리케이션을 개발함에 있어서 필요한 다양한 기술적 편의를 제공한다. 그중에서 가장 강력한 부분이 Bean이 아닐까 싶다.
pubDate: '2023-12-10T22:33:33+09:00'
dateSource: html-visible
slug: jsp-60
tags:
  - 서블릿
  - Todo
  - application
category: Spring Framework/Servlet & JSP
cover: /images/posts/jsp-60/screenshot-2023-12-10-at-9-34-39-pm.png
draft: false
legacy:
  tistoryId: '60'
  sourceHtml: '60/60-[Servlet]-서블릿과-JSP란?.html'
  sourceHash: 'sha256:de9b047814ae711e9578bed3959afde458b2b00d717e946bb6cf466ca097b093'
---

자바로 웹 개발을 공부하면 반드시 공부하는 것이 스프링 Web MVC 프레임워크(이하 스프링 MVC)다. 그만큼 스프링 MVC는 웹 애플리케이션을 개발함에 있어서 필요한 다양한 기술적 편의를 제공한다. 그중에서 가장 강력한 부분이 _**Bean**_이 아닐까 싶다.  
  
스프링 MVC를 사용해서 웹 애플리케이션 개발 하다 보면 간혹 가다 만나는 것이 **서블릿(Servlet)**과 **JSP(Java Server Pages)**이다.

**_서블릿? JSP?_**

간단하게 설명하자면, **서블릿**은 Java EE 기술 스택 중 하나로 **서버에서 동적으로 클라이언트의 요청에 대한 응답을 처리할 수 있는 API들을 정의한 집합**이다. **JSP**의 경우 **서블릿과 같은 맥락이지만 화면을 처리하는 역할에 초점**이 맞추어져 있다.   
  
이전에 웹 애플리케이션은 정적인 리소스(HTML, CSS, JS, IMG...)등을 응답할 수 있는 WA(Web Server)로 충분했지만, 기술이 발전됨에 따라서 클라이언트의 요청에 대해서 동적인 페이지, 동적인 데이터를 응답해야 하는 경우가 생겼다. 그리고 이러한 클라이언트의 동적인 요청을 WS(Web Server)가 아닌, WAS(Web Application Server)에서 처리할 수 있는 **3 tier** 구조가 등장하였고 서블릿과 JSP를 통해서 문제를 해결했다. WS에는 Apache, IIS 등이 있고, WAS에는 Tomcat, WebLogic, WebSphere 등이 있다  
  

_**그렇다면 왜 스프링 MVC와 서블릿?**_

  
스프링 혹은 부트로 웹 애플리케이션을 개발하기 위해서는 웹 애플리케이션을 실행시킬 수 있는 서버가 필요하다. 부트의 경우에는 내부적으로 톰캣(Tomcat)을 내장하고 있고, 이때 톰캣이 위에서 설명한 WAS이다. 그리고 톰캣은 서블릿과 JSP가 동작할 수 있는 실행 환경을 제공하고 이를 **서블릿 컨테이너**라고 한다. 즉, 스프링 MVC를 통해서 클라이언트의 요청과 응답을 처리할 수 있는 기반에는 서블릿이 깔려있다.  
  
서블릿 컨테이너는 서블릿의 런타임 환경으로 다양한 역할을 수행한다. 

-   웹 서버와의 네트워크 통신
-   서블릿의  생명 주기를 관리
-   URL을 특정 서블릿과 맵핑
    -   web.xml에 작성하고, 서블릿 3.0부터 애노테이션(@WebServlet)을 통해서 URL을 직접 매핑할 수 있다.
-   멀티 쓰레드 지원

**스프링 컨테이너**와 **서블릿 컨테이너**를 도식화 하면 다음과 같이 표현할 수 있다. 실제로 톰캣은 WS와 WAS 모두의 역할을 수행할 수 있다. 하지만 역할을 수행하는 것이지 높은 성능의 WS의 역할을 대체하는 것은 아니다.

![](/images/posts/jsp-60/screenshot-2023-12-10-at-9-34-39-pm.png)

\[출처\](https://user-images.githubusercontent.com/8748075/86555900-d9095d00-bfa5-11ea-87f9-fac27fc6de3f.png)

클라이언트의 요청이 Nginx와 같은 웹 서버로 들어오면 동적 콘텐츠가 필요한 경우 서블릿 컨테이너로 요청을 전달한다.   
  
서블릿 컨테이너는 요청에 대한 자바 스레드를 하나 생성한다. 이때 스레드는 스레드 풀을 이용할 수 있다. 그리고 **web.xml** 또는 **@WebServlet**에 맵핑된 URL을 기반으로 적정한 서블릿을 찾고 요청을 전달한다. 전달된 요청은 필터를 거쳐 서블릿 컨텍스트로 흘러들어 간다. 실제, 하나의 톰캣은 여러 웹 애플리케이션을 실행할 수 있는데, 이때 각각의 애플리케이션은 **고유의 메모리 공간**을 필요로 한다. 메모리 공간에는 서블릿과 JSP 등의 인스턴스가 저장되고 세션 쿠키를 저장하기 위한 세선 저장소도 위치하게 되는데, 이 공간을 **서블릿 컨텍스트**라고 한다. 다음 그림의 초록색 영역이 서블릿 컨텍스트이다. 그림에서는 서블릿 컨텍스트에 하나의 서블릿만 있지만, 실제로 구현에 따라서 다수의 서블릿을 통해서 요청을 처리하게 된다.

![](/images/posts/jsp-60/screenshot-2023-12-10-at-9-35-13-pm.png)

요청을 받은 서블릿 컨텍스트는 요청에 맞는 적절한 서블릿 객체의 service() 메서드를 호출한다. 만약, 스프링에서 service() 부분을 확인하고 싶다면 HttpServlet의 service() -> FrameworkServlet의 doXXX() -> processRequest() -> DispatcherServlet의 doService() -> doDispatch() 순서로 따라가 보면 좋을 것 같다. (해당 부분은 따로 정리해서 글로 남겨두려고 한다.)

```java
protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {  
	String method = req.getMethod();  
	  
	if (method.equals(METHOD_GET)) {  
		long lastModified = getLastModified(req);  
		if (lastModified == -1) {  
		// servlet doesn't support if-modified-since, no reason  
		// to go through further expensive logic  
		doGet(req, resp);  
		} else {  
			long ifModifiedSince = req.getDateHeader(HEADER_IFMODSINCE);  
			if (ifModifiedSince < lastModified) {  
			// If the servlet mod time is later, call doGet()  
			// Round down to the nearest second for a proper compare  
			// A ifModifiedSince of -1 will always be less  
			maybeSetLastModified(resp, lastModified);  
			doGet(req, resp);  
		} else {  
			resp.setStatus(HttpServletResponse.SC_NOT_MODIFIED);  
		}  
	}  
	  
	} else if (method.equals(METHOD_HEAD)) {  
		long lastModified = getLastModified(req);  
		maybeSetLastModified(resp, lastModified);  
		doHead(req, resp);  
	  
	} else if (method.equals(METHOD_POST)) {  
		doPost(req, resp);  
	  
	} else if (method.equals(METHOD_PUT)) {  
		doPut(req, resp);  
	  
	} else if (method.equals(METHOD_DELETE)) {  
		doDelete(req, resp);  
	  
	} else if (method.equals(METHOD_OPTIONS)) {  
		doOptions(req,resp);  
	  
	} else if (method.equals(METHOD_TRACE)) {  
		doTrace(req,resp);  
	  
	} else {  
	//  
	// Note that this means NO servlet supports whatever  
	// method was requested, anywhere on this server.  
	//  
	  
	String errMsg = lStrings.getString("http.method_not_implemented");  
	Object[] errArgs = new Object[1];  
	errArgs[0] = method;  
	errMsg = MessageFormat.format(errMsg, errArgs);  
	  
	resp.sendError(HttpServletResponse.SC_NOT_IMPLEMENTED, errMsg);  
	}  
}
```

**service()** 메서드는 HttpServletRequest와 HttpServletResponse 매개변수를 전달받는다.

그리고 HttpServletRequest.getMethod()를 통해서 요청 메서드를 참조하고 적절한 처리 메서드를 호출한다.

서블릿은 service 이외에도 2개의 생명 주기를 갖는다. 

-   **init()**: 서블릿은 처음 URL을 호출할 때 생성되는데 초기 생성 시 한 번만 호출된다. 또한, 서버가 처음 시작될 때 서블릿이 로드될 수 있도록 지정(load-on-startup 옵션 참고)할 수 있다.
-   **destroy()**: 서블릿의 요청이 종료되면 호출된다. destroy()가 호출되면 서브릿 객체는 가비지 컬렉션으로 표시되고, GC의 대상이 된다.

```java
public interface Servlet {  
	public void init(ServletConfig config) throws ServletException;  
	public void service(ServletRequest req, ServletResponse res)  
	throws ServletException, IOException;  
	public void destroy();  
}
```

  
지금까지 서블릿 컨테이너, 서블릿 컨텍스트 및 서블릿에 대해서 알아봤다.

하지만 아직 JSP가 남아있다. JSP는 서블릿과 같은 맥락이지만 화면을 처리하는 역할이라고 설명했다. 

_**그럼 서블릿은 HTML에 대한 처리를 할 수 없는가?**_ 

그렇지 않다. 다만 서블릿은 자바 코드로 HTML 문자열을 만들어 낸다면, JSP는 HTML에 자바 코드를 사용할 수 있는 차이점이 있다.   
  
서블릿을 통해서 HTML 문자열을 표현하기 위해 **PrintWriter** 객체를 이용할 수 있다. PrintWriter 객체는 HttpResponseRequest객체의 getWriter 메서드를 통해 반환받을 수 있다. 간단하게 샘플 페이지를 작성한 코드는 다음과 같다.

![](/images/posts/jsp-60/screenshot-2023-12-10-at-10-05-14-pm.png)

```java
@WebServlet("/sample")  
public class SampleController extends HttpServlet {  
	@Override  
	protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {  
		resp.setContentType("text/html");  
		resp.setCharacterEncoding("UTF-8");  
		  
		PrintWriter writer = resp.getWriter();  
		  
		writer.println("<html>");  
		writer.println("<head><title>Sample Page</title></head>");  
		writer.println("<body>");  
		writer.println("<h1>샘플 페이지입니다.</h1>");  
		writer.println("<p>자바 코드로 생성한 페이지이기 때문에 동적으로 데이터를 바인딩 할 수 있습니다.</p>");  
		writer.println("<p> 남은 " + getCurrentYear() + "년의 마무리를 위해서 화이팅입니다:) </p>");  
		writer.println("</body>");  
		writer.println("</html>");  
	}  
	  
	private int getCurrentYear() {  
		return LocalDate.now().getYear();  
	}  
}
```

코드를 보면 자바 문자열로 HTML을 작성한 것을 볼 수 있다. 이렇게 작성한 코드는 정말 너무 많은 끔찍한 버그를 품을 수 있다. 만약 tag의 '<' 기호가 하나라도 없다면? 화면은 그려지지 않고, 정말 눈이 아프게 문자열에서 버그를 찾아야 할 것이다. (샘플 페이지를 만들면서 직접 경험하였다... ) 이러한 문제를 해결하기 위해서 비즈니스 로직은 서블릿에서 담당하고, 프레젠테이션은 JSP에서 담당하도록 역할이 구분된 것이다.

같은 페이지를 JSP를 통해서 만들면 다음과 같다.

```html
<%@ page contentType="text/html;charset=UTF-8" language="java" %>  
<html>  
	<head>  
	<title>Sample Page</title>  
	</head>  
	<body>  
		<h1>샘플 페이지입니다.</h1>  
		<p>자바 코드로 생성한 페이지이기 때문에 동적으로 데이터를 바인딩 할 수 있습니다.</p>  
		<p>남은 ${year}년의 마무리를 위해서 화이팅입니다:)</p>  
	</body>  
</html>
```

그냥 HTML을 작성하고 동적으로 변경되는 부분만 변경해 주면 된다.  
  

_**그런데 JSP 코드는 자바 코드가 아님에도 서블릿과 동일하게 동작할 수 있는 이유가 무엇일까?**_

  
사실 **JSP로 작성된 코드는 서블릿 코드로 변환되어 컴파일되고 실행된다**. 즉, JSP 파일은 요청받는 순간 자바 파일로 생성되고, 생성된 자바 파일이 .class인 바이트코드로 컴파일되어 실행되게 된다.

![](/images/posts/jsp-60/screenshot-2023-12-10-at-10-06-31-pm.png)

지금까지 서블릿과 JSP에 대해서 알아보았다.   
  
그럼 알아본 것은 지식이지만 이제 실제 만들어 보면서 체득하기 위해서, 단순히 서블릿과 JSP 만을 이용해서 초간단TODO 애플리케이션을 구현해 보았다. 구현된 코드는 깃헙에서 확인할 수 있다. (아직 모든 개발이 끝난 것이 아니라는 점을 양해해주셨으면 한다)

![](/images/posts/jsp-60/ezgif-com-video-to-gif.gif)

만들면서 다양한 부분에서 스프링 MVC의 강력함을 경험할 수 있었다.

-   스프링 MVC는 DispatcherServlet에서 HandlerMapping을 통해서 적절한 컨트롤러를 찾는 반면, 서블릿에서는 요청에 대한 서블릿을 일일이 만들어야 한다.
-   스프링 MVC의 경우 HttpMessageConver에서 Jackson 라이브러리 등을 통해 매개변수에 대한 형변환과 객체 맵핑을 자동을 수행해 주지만, 서블릿의 경우 직접 수행해야 한다. 그래서 form data를 매개변수로 받을 때, 스프링에서는 @RequestBody라는 애노테이션으로 편리하게 접근할 수 있지만, 서블릿은 BufferedReader로부터 문자열로 읽어온 뒤 처리해야 한다.
-   DataSource에 대한 정보를 환경변수로 등록해서 사용하고 싶었는데, 서블릿에서 환경변수를 참조하기 위해서는 ServletContext 객체에 접근해서 사용해야 한다. 이 부분은 외부에서 주입해서 일일이 맵핑해 주었다. 부트는 초기화 작업에 자동으로 수행한다. 처음에는 초기 요청에 따라서 초기화하는 방법을 생각해 보았지만, 투두 앱의 경우 로그인한 사용자가 즉시 목록을 보는 것이 중요하기 때문에, 컨테이너가 생성될 때 바로 초기화할 수 있도록 했다.
-   프로젝트에서는 데이터베이스의 커넥션을 획득하기 위해서 HikariCP를 사용하고, 커넥션을 얻기 위해서 enum class로 ConnectionUtil을 생성해 주었다. 그리고 커넥션 풀의 초기화는 init listener를 등록해서 컨테이너가 초기에 뜨는 순간 수행될 수 있도록 해주었다.
-   JSP를 반환하거나 forward 하는 코드 등의 중복이 많다.
-   로그인에 대한 여부를 검사하기 위해서 filter를 구현하면서, 스프링에서도 동일하게 서블릿의 Filter interface를 구현하여 사용하는 것을 경험할 수 있었다. 

이번 글의 단순히 스프링의 DispatcherServlet의 코드를 살펴보다가 Servlet에 알게 되었고, 궁금증에 대해서 학습한 것이 시작이었다. 지금의 부트는 spring-boot-starter-web과 같은 의존성을 제공하고, starter 내부적으로 서블릿 컨테이너와 상호 작용을 추상화해서 동작하게 된다. 하지만 DispatcherServlet의 동작을 명확히 이해하기 위해서는 서블릿에 대해서 한 번쯤 학습해 보고 싶었고, 정말 많은 부분에서 스프링 부트가 추상화해 두었고 편리하게 제공하고 있다는 것을 깨달을 수 있었다.

\* 혹시 잘못된 정보가 있다면 댓글로 알려주시면 너무 감사하겠습니다 :)
