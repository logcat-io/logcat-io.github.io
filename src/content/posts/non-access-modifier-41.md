---
title: "[JAVA] Non-Access Modifier란?"
description: 총 7개의 Non-Access Modifier가 도입되었으며 아래와 같다.
pubDate: '2023-10-10T18:35:57+09:00'
dateSource: html-visible
slug: non-access-modifier-41
tags:
  - Non-Access
  - Modifier
  - keword
  - 자바
  - 키워드
category: Language/Java
draft: false
legacy:
  tistoryId: '41'
  sourceHtml: '41/41-[JAVA]-Non-Access-Modifier란?.html'
  sourceHash: 'sha256:f303759f8cb691494e055dcd38c3ccd29bf2e696ebbfe091c143b9fc64b7915f'
---

**Non-Access Modifiers**는 JVM에 클래스의 동작, 메서드 또는 변수 등에 대해 알리기 위해서 JAVA 7에 도입된 키워드다.

총 7개의 Non-Access Modifier가 도입되었으며 아래와 같다.

1.  final
2.  static
3.  abstract
4.  synchronized
5.  transient
6.  strictfp
7.  native

## \# final

final 키워드는 다음에 적용할 수 있다.

-   class: final 키워드가 붙은 클래스는 다른 클래스로부터의 상속이 제한된다.
-   method: final 키워드가 붙은 메서드는 Java Runtime Environment에서 어떤 하위 클래스에서도 메서드 오버라이딩할 수 없게 된다.
-   instance variable
-   local variable
-   method arguments

instance, local, method arguments와 같이 final이 variable에 붙게 되면, 값을 변경할 수 없도록 제한하게 된다. 즉, JVM에서 상수로 관리하게 되고, 단 한 번만 초기화된다는 것을 의미한다.

```
final class Developer {
	private static final name = "developer";
	private final int age;

	public SingleThread(int age) {
		this.age = age;
	}

	public void coding(final String request) {
		final int cnt = 0;
		...
	}
}
```

## \# abstract

abstract 키워드는 다음에 적용할 수 있다.

-   class: abstract 키워드가 붙은 클래스는 인스턴스화할 수 없다는 것을 의미한다. 하지만 클래스를 통해 객체를 생성할 수 없지만 상속은 할 수 있다. 여기서 주의할 점은 abstract class가 생성자를 가진다면 이 abstract class를 상속하는 하위 클래스의 생성자 내부에서 abstract class의 생성자를 호출해 주어야 한다.
-   method: abstract 키워드가 붙은 메서드는 정의가 되지 않은 메서드다. 오직 메서드 시그니처만 가지고 있기 때문에 하위 클래스에서 반드시 오버 라이딩 해주어야 한다. 그렇지 않으면 인스턴스를 생성하지 못하는데, 힙 영역에는 생성되는 객체는 내부의 요소가 미완성인 상태로 들어갈 수 없기 때문이다.

```
public abstract class Calculator {
	public abstract int sum(int x, int y);
}

public class EngineeringClaculator extends Calculator {
	@Override
	public void int sum(int x, int y) {
		return x + y;
	}
}
```

## \# synchronized

synchronized 키워드는 메서드에 적용할 수 있다. synchronized 키워드는 여러 스레드에서 동시에 하나의 메서드에 액세스 하는 것을 제한하여 동기적인 동작을 수행할 수 있도록 도와준다. 이는 멀티 쓰레딩 기능을 사용할 때 동시성 문제를 해결하는데 도움이 된다.

```
class Sample {
	private SyncObject syncObject;
	public synchronized void start() {}
	public void end() {
		synchronized(syncObject) {
		}
	}
}
```

## \# static

static 키워드는 다음에 적용할 수 있다.

-   class: 오직 중첩된 이너 클래스에만 사용할 수 있다.
-   method: static method는 정적 메스드로 불리고 정적 멤버 변수 혹은 정적 메서드에만 액세스 할 수 있다. 정적 메서드는 this 또는 super pointer로 참조할 수 없고 오직 클래스로부터 참조해야 한다. 정적 메서드 내부에서는 인스턴스 변수에 접근할 수 없다. 이는 정적 메서드가 인스턴스 변수를 참조하는 시점에 인스턴스가 존재하지 않을 수 있기 때문이다. 정적 메서드를 사용하는 것이 인스턴스 메서드를 사용하는 것보다 성능이 향상될 수 있는데, 인스턴스 메서드는 실행 시 호출되어야 할 메서드를 찾는 과정이 추가적으로 필요하기 때문에 시간이 더 걸리기 때문이다.
-   variable: static variable은 정적 멤버 변수로 불리고 클래스가 JVM에 의해 메서드 영역에 로드되는 시점에 자동적으로 생성된다. 그리고 메서드 영역의 클래스 데이터 내부에 위치하기 때문에 모든 인스턴스에서 멤버 변수에 접근할 수 있다. 그렇기 때문에 공통으로 사용되는 상수 등을 클래스 수준에서 관리할 수 있게 된다.
-   block: static class가 로딩될 때 초기화 작업을 수행할 수 있는 block으로 정적 멤버 변수만 사용할 수 있다.

```
public class Sample {
	private static int limit;
	static {
		limit = 100_000;
	}
	public static void main(String[] args) {}
	public static class InnerSample {}
}
```

## \# native

native 키워드는 특정 메서드가 플랫폼 종속적으로 작성되었음을 나타내는 메서드에만 사용한다. 즉, Java 이외에 C/C++와 같은 언어로 작성된 메서드에 액세스 하기 위해 사용되는 키워드다.

```
public class Thread implements Runnable {
	private native void start0();
}
```

## \# strictfp

strictfp 키워드는 class와 method에 사용될 수 있는데, 부동 소수점 숫자에 대한 연산 결과가 모든 플랫폼에서 동일한 결과를 가져오도록 하기 위해서 사용한다.

```
public class Sample {
	public strictfp double sum(double x, double y) {
		return x + y;
	}
}
```

## \# transient

transient 키워드는 네트워크를 통해 데이터를 전송하는 경우 손실되지 않고, 직렬화할 필요가 없는 멤버를 JVM에 알리기 위해서 사용한다.

```
public class Sample {
	int x = 10;
	transient int y = 20;
	transient static int w = 30;
	transient final int z = 40;
}
```

### 참고

-   [https://www.educba.com/non-access-modifiers-in-java/](https://www.educba.com/non-access-modifiers-in-java/)

[Non Access Modifiers in Java | Top 7 Types of Non Access Modifiers](https://www.educba.com/non-access-modifiers-in-java/)

-   [https://www.geeksforgeeks.org/synchronization-in-java/](https://www.geeksforgeeks.org/synchronization-in-java/)

[Synchronization in Java - GeeksforGeeks](https://www.geeksforgeeks.org/synchronization-in-java/)
