---
title: '스레드 안전한 공유 객체를 만드는 세 가지 축: 불변, 공개, confinement'
description: 이 글은 공유 객체를 어떻게 설계·공개해야 안전한가를 JMM(Java Memory Model)과 JIT 관점까지 엮어서 정리한 것이다.
pubDate: '2026-04-06T23:29:30+09:00'
dateSource: html-visible
slug: confinement-104
tags:
  - jvm
  - Concurrency
  - MultiThreading
  - jit-compiler
  - jmm
  - immutable-object
  - escape-analysis
  - java-concurrency-patterns
category: Language/Java
draft: false
legacy:
  tistoryId: '104'
  sourceHtml: 104/104.html
  sourceHash: 'sha256:afb1995680adc021e476ac72a0e5af7dfa3d2cb9960b5886aa72ebdaa4f6211c'
---

## 1\. 이 글에서 정리할 것

이 글은 공유 객체를 어떻게 설계·공개해야 안전한가를 JMM(Java Memory Model)과 JIT 관점까지 엮어서 정리한 것이다.

핵심 축은 세 가지다.

-   공유 가변 상태를 가능한 줄이고, 불변/결과적 불변으로 최대한 끌어올릴 것
-   객체를 어떻게 공개하느냐(safe publication) 를 설계에 포함할 것
-   아예 공유하지 않을 수 있을 때는 thread confinement로 escape 자체를 막을 것

### 2\. 공유 상태의 세 단계: 불변 / 결과적으로 불변 / 가변

공유 상태는 다음 세 수준으로 나눠서 보는 게 이해가 쉽다.

#### 2.1 완전 불변(Immutable)

조건은 세 가지 정도로 정리할 수 있다.

-   생성 이후 상태가 절대 변하지 않는다 (setter 없음, 내부 가변 구조도 변경되지 않음).
-   모든 필드가 final이고, 생성자에서 한 번만 설정된다.
-   생성 도중 this가 외부로 escape 하지 않는다 (생성자 안에서 리스너 등록, 다른 스레드에 넘기기 등 없음).

예: String, primitive wrapper, 잘 설계된 값 객체(돈, 좌표, 기간 등).

완전 불변의 장점은 명확하다.

-   어떤 스레드에서 어떻게 공유하든, 추가 동기화 없이 안전하다.
-   defensive copy를 덜 만들어도 된다 (외부에 넘겨도 값이 바뀌지 않으니까).

단, “내부에 가변 객체를 들고 있지만 바깥에서 안 바꾸겠지” 같은 건 이미 깨진 설계라서, 진짜 불변인지 항상 확인해야 한다.

#### 2.2 결과적으로 불변(Effectively immutable)

코드는 겉으로 가변처럼 보여도, “생성 이후 논리적으로는 절대 변경하지 않는다”는 제약을 지키는 객체다.

-   DTO인데 setter가 없고 생성자만 있는 클래스
-   애플리케이션 시작 시점에 한 번 만들어서, 이후 구성 변경이 거의 없는 설정 스냅샷 등

이런 객체는 안전하게 공개(safe publication)만 되면, 이후에는 동기화 없이 읽어도 된다.

예를 들면:

```
class AppConfig {
    private final String endpoint;
    private final int timeout;

    // 생성자에서만 설정, 이후 변경 없음
    AppConfig(String endpoint, int timeout) {
        this.endpoint = endpoint;
        this.timeout = timeout;
    }
}

class Holder {
    private volatile AppConfig config; // 안전한 공개를 위한 volatile

    public void init() {
        config = new AppConfig("https://api.example.com", 1000);
    }

    public AppConfig getConfig() {
        return config; // 이후 여러 스레드에서 동기화 없이 읽어도 안전
    }
}
```

config에 대한 volatile write → volatile read가 happens-before를 만들어서, 객체의 모든 필드 쓰기가 다른 스레드에서 보장되도록 해 준다.

#### 2.3 가변(Mutable)

생성 이후에도 상태가 계속 바뀌는 일반적인 객체다.

이런 객체는 두 타이밍에 모두 신경 써야 한다.

-   처음에 다른 스레드에서 보이도록 만들 때: 안전한 공개 필요
-   그 이후 읽고 쓸 때: 동기화(락, volatile, 원자 클래스 등) 필요

정리하면 다음과 같이 볼 수 있다.

| 상태 타입 | 공개 시 요구사항 | 이후 접근 동기화 |
| --- | --- | --- |
| 완전 불변 | 아무 방법으로나 공개해도 OK | 불필요 |
| 결과적으로 불변 | 안전한 공개 필요 | 불필요 |
| 가변 | 안전한 공개 + 이후 접근 동기화 | 필요 |

### 3\. 안전한 공개(Safe publication)

핵심 문장은 하나다.

> 객체를 공개할 때, 참조와 그 객체의 상태가 동시에 보이도록 보장하라.

단순히 “공개 필드나 컬렉션에 객체 참조를 대입하는 것”만으로는 안전한 공개가 아니다.

-   다른 스레드가 부분 초기화 상태를 볼 수 있다.
-   CPU/JIT reordering 때문에, 생성자 안에서의 필드 쓰기보다 참조 저장이 먼저 관측될 수 있다.

#### 3.1 대표적인 안전 공개 패턴

다음 패턴들은 JMM 상에서 안전한 공개를 보장한다.

1.  정적 초기화(static initialization)

```
public class GlobalConfig {
    public static final AppConfig INSTANCE = new AppConfig(...);
}
```

-   클래스 초기화는 JVM이 내부 락으로 보호하며, 초기화 완료 전에는 어떤 스레드도 해당 정적 필드를 볼 수 없다.
-   한 번 초기화가 끝나고 나면, 모든 스레드에서 완전히 초기화된 INSTANCE만 보게 된다.

1.  volatile 필드에 대입하기

```
class ConfigHolder {
    private volatile AppConfig config;

    public void init() {
        config = new AppConfig(...); // volatile write
    }

    public AppConfig getConfig() {
        return config;               // volatile read
    }
}
```

-   volatile write → volatile read 사이에 happens-before 관계가 생기고, write 이전의 모든 쓰기가 read 이후의 스레드에서 보이게 된다.

1.  락으로 보호되는 필드에 넣기

```
class SharedHolder {
    private AppConfig config;
    private final Object lock = new Object();

    public void publish(AppConfig cfg) {
        synchronized (lock) {
            config = cfg;
        }
    }

    public AppConfig get() {
        synchronized (lock) {
            return config;
        }
    }
}
```

-   같은 락으로 쓰기와 읽기를 감싸면, unlock → lock 사이에 happens-before가 생겨, 참조와 그 객체 상태를 동시에 보게 된다.

1.  동시성 컬렉션 / 핸드오프 API 사용

-   BlockingQueue.put()/take()
-   ConcurrentMap.put()/get()
-   Future.get() 등

이런 API들은 내부적으로 안전한 공개를 만족하도록 설계되어 있다.

요약하면:

-   결과적으로 불변: 안전한 공개만 되면 이후에는 동기화 없이 사용.
-   가변: 안전하게 공개 + 이후 읽기/쓰기 모두 동기화.

### 4\. thread confinement: “애초에 공유하지 말자”

동기화 비용과 복잡도를 줄이는 가장 쉬운 방법은, 애초에 공유하지 않는 것이다. 이걸 흔히 thread confinement라고 부른다.

#### 4.1 개념

-   어떤 객체가 오직 하나의 스레드에서만 접근된다면, 그 객체는 그 스레드에 confined 되었다고 말한다.
-   confined 객체는 동기화 없이 마음껏 읽고 써도 된다.
-   언어 차원에서 키워드는 없고, 우리가 코드로 escape 경로를 막아야 한다.

#### 4.2 Stack confinement / 로컬 변수

로컬 변수/파라미터로만 존재하고, 필드/콜백/컬렉션 등을 통해 다른 스레드로 넘기지 않으면, 그 참조는 stack-confined라고 볼 수 있다.

```
void process(List<Item> items) {
    int localCount = 0; // 이 스레드에서만 사용
    for (Item item : items) {
        if (item.isValid()) localCount++;
    }
    log(localCount);
}
```

localCount는 현재 스레드의 스택 프레임에만 존재하고, 다른 스레드에 공유되지 않는다. 이런 값은 JMM 관점에서 동기화 걱정에서 완전히 벗어난다.

주의할 점:

```
void f(Executor executor) {
    List<String> list = new ArrayList<>(); // list 참조는 로컬
    executor.submit(() -> list.add("x"));  // 실제 리스트 객체는 다른 스레드로 escape
}
```

-   list 변수 자체는 스택에 있지만, ArrayList 인스턴스는 람다(클로저)를 통해 다른 스레드로 넘어간다.
-   이 경우 해당 리스트는 더 이상 confined가 아니다.

#### 4.3 ThreadLocal confinement

ThreadLocal은 JDK가 제공하는 thread confinement 도구다.

```
private static final ThreadLocal<DateFormat> fmt =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

String format(Date date) {
    return fmt.get().format(date);
}
```

-   각 스레드는 fmt.get()를 호출할 때 자기만의 인스턴스를 받는다.
-   같은 ThreadLocal 변수를 여러 스레드가 공유하더라도, 실제로는 “스레드별로 다른 인스턴스를 들고 있다”고 보면 된다.
-   따라서 내부 상태가 가변이어도, 해당 스레드 안에서만 쓰면 동기화 없이 안전하다.

### 5\. 클래스 초기화와 static 필드의 안전 공개

불변/결과적으로 불변 객체를 공개할 때 자주 쓰는 패턴이 public static final이다. 이게 왜 안전한지 이해하려면, JVM의 클래스 초기화 규칙을 한 줄로 기억해 두면 좋다.

#### 5.1 클래스 초기화 락 개념

JVM은 대략 다음을 보장한다.

-   각 클래스/인터페이스 C마다 고유한 초기화 락 L\_C가 있다.
-   C를 처음 사용할 때, 한 스레드가 L\_C를 잡고 (static 초기화)을 실행한다.
-   초기화가 끝나기 전에는, 다른 스레드는 C의 정적 필드에 접근하기 위해 블록된다.
-   초기화가 완료된 이후에야 다른 스레드가 C의 정적 필드를 볼 수 있다.

즉:

```
  public class ConfigHolder {
    public static final AppConfig GLOBAL = new AppConfig(...);
}
```

-   JVM이 처음으로 ConfigHolder를 로딩/사용하려 할 때, 클래스 초기화 락 아래에서 GLOBAL을 한 번만 초기화한다.
-   그 이후에 다른 스레드가 ConfigHolder.GLOBAL을 읽을 때는, 이미 완전히 초기화된 객체만 보게 된다.

따라서 static 초기화는 락 + happens-before가 합쳐진 공짜 safe publication이라고 볼 수 있다.

#### 6\. escape analysis와 “return하면 밖으로 빼니까 안전하지 않다?” 

마지막으로, thread confinement를 JIT 최적화(escape analysis)와 연결해서 보자.

#### 6.1 Escape analysis 개요

JIT 컴파일러는 “이 객체 참조가 어디까지 나가는가?”를 분석한다.

-   전혀 메서드 밖으로 안 나가면: NoEscape
-   같은 스레드 안의 다른 메서드까지만: ArgEscape / MethodEscape
-   다른 스레드에도 갈 수 있으면: GlobalEscape (실제 명칭은 구현마다 다름)
-   NoEscape / 일부 MethodEscape인 객체는 상황에 따라:
-   힙 대신 스택/레지스터에 둘 수 있다 (stack allocation, scalar replacement).
-   해당 객체에 대한 락을 제거할 수 있다 (synchronized elision).

즉, 우리가 코드 레벨에서 escape 하지 않도록 설계(thread confinement)를 해 주면, JIT 입장에서는 더 공격적인 최적화를 적용하기 쉬워진다.

#### 6.2 return acc;는 안전하지 않은가?

예를 들어:

```
  Point sumDistances(List<Point> pts) {
    Point acc = new Point(0, 0);
    for (Point p : pts) {
        // acc 갱신
    }
    return acc;
}
```

여기서 질문은 두 가지다.

1.  공유/스레드 안전 관점
    -   “리턴하면 밖으로 빼니까 thread confinement가 깨지나?”
2.  최적화 관점
    -   “리턴하면 스택/레지스터 할당은 못 하나?”

각각 따로 보자.

(1) 스레드 안전 관점

-   “메서드 밖으로 나간다”와 “다른 스레드에 공유된다”는 별개의 문제다.
-   호출한 같은 스레드 안에서만 리턴값을 쓰고 버리면, 여전히 그 스레드에 confined라고 볼 수 있다.
-   리턴값을 다른 스레드에 넘기거나, 공유 컬렉션에 넣을 때 비로소 thread confinement가 깨진다.

즉:

-   리턴 자체가 문제는 아니고, 리턴 이후 그 값을 어디로 보내느냐가 문제다.

(2) 스택/레지스터 최적화 관점

-   메서드가 끝난 뒤에도 객체를 써야 한다면(리턴값), 그 객체는 논리적으로 메서드 수명을 넘어 존재해야 한다.
-   이 경우 “순수한” stack allocation만으로는 부족하고, JIT의 scalar replacement, escape analysis 결과에 따른 더 고급 최적화가 필요하다.
-   그래서 직관적으로 “메서드 안에서만 쓰이고 끝나는 객체(NoEscape)가 힙 할당 제거의 가장 좋은 후보”라는 말이 나온다.

정리하면:

-   “리턴하면 무조건 thread confinement가 깨진다”는 아니다.
-   리턴값을 어떤 스레드에서 어떻게 쓰느냐에 따라 confinement 유지 여부가 갈린다.
-   “리턴하면 스택/레지스터 최적화는 더 어려워진다”는 직관은 대체로 맞다.  
    다만 실제 HotSpot은 inlining + scalar replacement로 꽤 많은 경우를 최적화할 수 있다.
