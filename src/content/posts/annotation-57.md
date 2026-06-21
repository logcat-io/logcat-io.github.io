---
title: 어노테이션(Annotation)이란?
description: 이번 글에서는 어노테이션에 대해서 간단하게 정리하고자 한다.
pubDate: '2023-11-09T14:19:52+09:00'
dateSource: html-visible
slug: annotation-57
tags:
  - annotation
  - 어노테이션
  - 자바
  - 자바의
  - 신
category: Language/Java
cover: /images/posts/annotation-57/screenshot-2023-11-09-at-2-13-27-pm.png
draft: false
legacy:
  tistoryId: '57'
  sourceHtml: '57/57-[JAVA]-어노테이션(Annotation)이란?.html'
  sourceHash: 'sha256:aa546e50ecda8476d259227149de212e2894d9114da1866c1bae3b281360bd46'
---

이번 글에서는 _**어노테이션**_에 대해서 간단하게 정리하고자 한다.

스프링으로 개발을 진행하면서 가장 많이 접하는 것이 어노테이션이다. 어노테이션은 스프링에서 설정을 편리하게 해 주고, 가독성을 높여준다. 또한, 롬복과 같은 도구를 통해 가독성을 높이고 생산성을 높일 수 있다.

**_그렇다면 어노테이션이 무엇일까?_**

어노테이션은 클래스나 메서드 등의 선언 시에 @를 사용하는 것으로 메타데이터로도 불린다. JDK 5부터 등장했다.

어노테이션은 다음과 같은 상황에서 사용할 수 있다.

1.  컴파일러에게 정보를 알려주는 경우
2.  컴파일 혹은 deployment 시의 작업을 지정하는 경우
3.  실행할 때 별도의 처리가 필요한 경우

어노테이션은 클래스, 메서드, 변수 등 모든 요소에 선언할 수 있다.

자바에서는 3개의 어노테이션이 정의되어 있다. 실제로 메타 어노테이션이라는 것이 4개 있지만, 메타 어노테이션은 선언을 위해서 존재하기 때문에 사용 가능한 것은 3개라고 기억하면 좋을 것 같다.

-   @Override
-   @Deprecated
-   @SupressWarinings

JDK 버전이 올라가면 어노테이션도 더 많이 늘어날 것이다.

## @Override

@Override 어노테이션은 메서드가 부모 클래스에서 정의된 메서드를 재정의(Overriding) 했음을 명시할 때 사용한다. 만약 부모 클래스에 많은 메서드가 있고, 자식 클래스에서 몇 개의 메서드를 overriding 했다고 생각하자. 이러한 경우 자식 클래스만 보고 부모 클래스의 어떤 메서드를 overriding 했는지 알기 어렵다. 이럴 때 @Override 어노테이션을 사용하면 명확한 구분을 할 수 있다. 그리고 만약 자식 클래스에서 overriding이 잘못된 경우 컴파일러에서 예외를 통해 알려주게 되는데, 이것은 위에서 설명한 컴파일러에게 정보를 알려주는 경우에 해당된다.

```
public interface Animal {
    void feed();
    void sleep();
}

public class Hippo implements Animal {
    @Override
    public void feed() {
    }

    @Override
    public void sleep(String time) {
    }
}
```

![](/images/posts/annotation-57/screenshot-2023-11-09-at-2-13-27-pm.png)

## @Deprecated

@Deprecated는 더 이상 사용하지 않는 클래스 혹은 메서드를 선언할 때 사용한다. 만약, @Deprecated 어노테이션이 선언된 클래스 혹은 메서드를 사용하면 경고가 나타난다.

```java
public interface Animal {
    void feed();
    void sleep();
    @Deprecated
    void bark();
}

public class Hippo implements Animal {
    @Override
    public void feed() {
    }

    @Override
    public void sleep(String time) {
    }

    @Override
    public void bark(){}
    }
}
```

![](/images/posts/annotation-57/screenshot-2023-11-09-at-2-13-54-pm.png)

## @SuppressWarnings

@SuppressWarnings 컴파일 시 경고가 발생할 수 있는 상황에 컴파일러에게 경고가 발생할 수 있다는 것을 인지하고 있다고 알리는 것이다. 그래서 @SuppressWarnings 선언되어 있다면 경고를 나타내지 않는다.

```java
public class Hippo implements Animal {
    @Override
    public void feed() {
    }

    @Override
    public void sleep(String time) {
    }

    @Override
    @SuppressWarnings("deprecation")
    public void bark(){
    }
}
```

위와 같이 @SuppressWarnings를 선언해 주면 경고가 나타나지 않는 것을 확인할 수 있다. @SuppressWarnings 에는 deprecation

과 같은 기본값을 입력해 주어야 하는데, 목록은 다음 링크에서 확인하 수 있다.

[https://www.ibm.com/docs/ko/radfws/9.6.1?topic=code-excluding-warnings](https://www.ibm.com/docs/ko/radfws/9.6.1?topic=code-excluding-warnings)

[@SuppressWarnings를 사용하여 경고 제외](https://www.ibm.com/docs/ko/radfws/9.6.1?topic=code-excluding-warnings)

## 메타 어노테이션

메타 어노테이션은 개발자가 직접 어노테이션을 선언할 때 사용한다. 메타 어노테이션은 4개가 있으며 다음과 같다.

1.  @Target
2.  @Retention
3.  @Documented
4.  @Inherited

### @Target

@Target 어노테이션은 적용 대상을 지정할 수 있다. 적용 대상의 목록은 ElementType enum에 정의되어 있다.

```
@Target(ElementType.METHOD)
```

```java
package java.lang.annotation;  

public enum ElementType {  
/** Class, interface (including annotation interface), enum, or record  
* declaration */  
TYPE,  

/** Field declaration (includes enum constants) */  
FIELD,  

/** Method declaration */  
METHOD,  

/** Formal parameter declaration */  
PARAMETER,  

/** Constructor declaration */  
CONSTRUCTOR,  

/** Local variable declaration */  
LOCAL_VARIABLE,  

/** Annotation interface declaration (Formerly known as an annotation type.) */  
ANNOTATION_TYPE,  

/** Package declaration */  
PACKAGE,  

/**  
* Type parameter declaration  
*  
* @since 1.8  
*/  
TYPE_PARAMETER,  

/**  
* Use of a type  
*  
* @since 1.8  
*/  
TYPE_USE,  

/**  
* Module declaration.  
*  
* @since 9  
*/  
MODULE,  

/**  
* Record component  
*  
* @jls 8.10.3 Record Members  
* @jls 9.7.4 Where Annotations May Appear  
*  
* @since 16  
*/  
RECORD_COMPONENT;  
}
```

자주 사용 되는 목록은 다음과 같다.

-   TYPE: 클래스, 인터페이스, enum 클래스 등 선언 시
-   FIELD: enum 상수를 포함한 필드값 선언 시
-   METHOD: 메서드 선언 시
-   CONSTRUCTOR: 생성자 선언 시
-   PACKAGE: 패키지 선언 시
-   PARAMETER: 매개 변수 선언 시

### @Retention

@Retention 어노테이션은 컴파일 혹은 프로그램을 실행할 때, 어노테이션의 정보를 유지하는 범위을 지정할 수 있다. 각 범위는 RetenionPolicy enum에 정의되어 있다.

-   SOURCE: 유효범위 소스코드, 컴파일시 어노테이션 정보가 삭제됨
-   CLASS: 유효범위 클래스, 단, JVM 에는 읽어 들이지 않음
-   RUNTIME: 실행 중일 때 JVM 에서 참조할 수 있음

```
@Retention(RetentionPolicy.RUNTIME)
```

```
package java.lang.annotation;  

public enum RetentionPolicy {  
/**  
* Annotations are to be discarded by the compiler.  
*/  
SOURCE,  

/**  
* Annotations are to be recorded in the class file by the compiler  
* but need not be retained by the VM at run time. This is the default  
* behavior.  
*/  
CLASS,  

/**  
* Annotations are to be recorded in the class file by the compiler and  
* retained by the VM at run time, so they may be read reflectively.  
*  
* @see java.lang.reflect.AnnotatedElement  
*/  
RUNTIME  
}
```

### @Documented

@Documented 어노테이션은 어노테이션 타입에 대한 정보다. @Documented 어노테이션이 어노테이션 인터페이스에 선언되어 있다면, 해당 어노테이션 인터페이스는 Javadocs와 같은 API문서에 포함되는 것을 의미한다.

```
package java.lang.annotation;

@Documented  
@Retention(RetentionPolicy.RUNTIME)  
@Target(ElementType.ANNOTATION_TYPE)  
public @interface Documented {  
}
```

### @Inherited

@Inherited 어노테이션이 선언된 클래스의 자식 클래스에서 부모 클래스의 어노테이션이 상속된다는 것을 의미한다.

### \[실습\] Custom annotation

메타 어노테이션을 사용하면 새로운 어노테이션을 선언할 수 있다.

```java
@Documented
@Target({ElementType.METHOD, ElementType.CONSTRUCTOR})
@Retention(RetentionPolicy.RUNTIME)
public @interface Custom {
        public String description() default "Custom annotation";
}
```

CustomAnnotation은 메서드와 생성자에 적용할 수 있고, 런타임 동안 유지될 수 있는 어노테이션이다. @interface 어노테이션은 위에서 설명이 없었는데, 자바의 interface를 선언하는 것 같이, @interface로 어노테이션을 선언할 수 있다.

지금까지 알아본 어노테이션은 자바의 표준 어노테이션이다. 자바 EE, 스프링 프레임워크 그리고 JUnit 프레임워크에는 다양한 어노테이션이 정의되어 있다.

-   자바 EE(Enterprise Edition) 어노테이션
    -   `@Entity`: JPA(Java Persistence API) 엔터티 클래스를 지정한다.
    -   `@Table`: 엔터티 클래스가 매핑될 데이터베이스 테이블을 지정한다.
    -   `@Column`: 엔터티의 필드가 데이터베이스의 열과 매핑될 때 사용한다.
    -   `@Id`: 엔터티의 기본 키 필드를 지정한다.
-   Spring 프레임워크 어노테이션
    -   `@Component`: Spring 컴포넌트 스캔 대상 클래스를 지정한다.
    -   `@Autowired`: 의존성 주입을 요청할 때 사용한다.
    -   `@Controller`, `@Service`, `@Repository`: Spring 컨트롤러, 서비스, 리포지토리 클래스를 지정한다.
    -   `@RequestMapping`: 요청 URL과 메서드를 매핑한다.
-   JUnit 테스트 프레임워크 어노테이션
    -   `@Test`: 테스트 메서드를 지정한다.
    -   `@Before`, `@After`: 각 테스트 메서드 실행 전과 후에 실행할 메서드를 지정한다.
    -   `@BeforeClass`, `@AfterClass`: 테스트 클래스 전체의 실행 전과 후에 실행할 메서드를 지정한다.

각 어노테이션은 필요에 따라서 각 공식문서를 참고하면, 쉽게 사용할 수 있을 것이다.

### 참고

-   자바의 신 vol.1

[자바의 신 - 전2권](https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=111321886)
