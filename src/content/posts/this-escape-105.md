---
title: "[JAVA] 생성자에서 리스너 등록하다가 this escape 나는 이유"
description: 'public class EarlyPublish {'
pubDate: '2026-04-07T22:02:59+09:00'
dateSource: html-visible
slug: this-escape-105
tags:
  - jvm
  - MultiThreading
  - jmm
  - escape-analysis
  - this
  - escape
  - safe-publication
  - inner-class
category: Language/Java
draft: false
legacy:
  tistoryId: '105'
  sourceHtml: '105/105-[JAVA]-생성자에서-리스너-등록하다가-this-escape-나는-이유.html'
  sourceHash: 'sha256:1424dc3e0b36ebf6ad72abed9190bcae1c0f39f7fa44732c994f64cc756f9df4'
---

## 1. 문제 코드: 생성자 안에서 리스너 등록

```java
public class EarlyPublish {

    private final String config;

    public EarlyPublish(EventBus eventBus) {
        this.config = "default";

        eventBus.register(new EventListener() {
            @Override
            public void onMessage(Message msg) {
                handle(msg);
            }
        });
    }

    private void handle(Message msg) {
        // config를 사용한다고 가정
        System.out.println("config = " + config + ", msg = " + msg);
    }
}
```

  
설명 포인트는 세 줄로 정리할 수 있다.

-   EventBus는 외부에서 이벤트를 발행하는 컴포넌트다.
-   생성자 안에서 new EventListener() { ... }로 익명 내부 클래스를 만들고, 바로 eventBus.register(...)에 등록한다.
-   이 익명 내부 클래스는 바깥 EarlyPublish 인스턴스를 캡처하고, 그 상태로 외부 객체인 eventBus에 연결된다.

이 지점에서 이미 “생성자 도중 this escape”의 씨앗이 심어져 있다.

## 2. 익명 내부 클래스가 실제로 풀리는 모습

소스 코드에서 익명 클래스는 편한 문법 설탕일 뿐이고, 컴파일러 입장에서는 실제 클래스로 풀어야 한다.  
  
개념적으로는 다음처럼 바뀐다고 보면 된다.

```java
// 컴파일러가 만들어낸다고 생각할 수 있는 클래스
class EarlyPublishListener implements EventListener {

    private final EarlyPublish outer;

    EarlyPublishListener(EarlyPublish outer) {
        this.outer = outer;
    }

    @Override
    public void onMessage(Message msg) {
        outer.handle(msg);
    }
}
```

  
그리고 EarlyPublish 생성자는 다음과 같은 형태가 된다.

```java
public class EarlyPublish {

    private final String config;

    public EarlyPublish(EventBus eventBus) {
        this.config = "default";
        eventBus.register(new EarlyPublishListener(this));
    }

    // ...
}
```

여기서 중요한 건 두 가지다.

-   익명 클래스가 아니라, 정상적인 클래스 + 필드 구조가 된다는 것.
-   EarlyPublishListener 안에 outer라는 필드가 생기고, 거기에 바깥 EarlyPublish 인스턴스가 저장된다는 것.

이걸 한 줄로 표현하면:

-   리스너 객체가 EarlyPublish 인스턴스를 필드로 품고 있는 상태로 외부(EventBus)에 등록된다.

## 3. 참조 체인으로 본 this escape

위 구조를 참조 화살표로 그리면 이렇게 된다.  
  

-   EventBus
    -   → EarlyPublishListener
    -   → outer 필드
    -   → EarlyPublish 인스턴스

그리고 이 참조 체인이 언제 만들어지는지가 핵심이다.

-   new EarlyPublish(eventBus) 호출
-   아직 생성자 실행 중 (config 초기화 등 진행 중)
-   생성자 내부에서 new EarlyPublishListener(this) 호출
-   그 리스너를 eventBus.register(...)에 넘김 → EventBus 내부 컬렉션에 저장

즉, 생성자가 끝나기도 전에:

-   외부 객체(EventBus)가 EarlyPublish 인스턴스에 도달 가능한 경로를 갖게 된다.

이 상태에서, 다른 스레드나 이벤트 루프가 EventBus를 통해 이벤트를 발행하면 어떤 일이 벌어질까?  
  

-   다른 스레드: eventBus.publish(msg)
-   내부에서 등록된 EarlyPublishListener.onMessage(...) 호출
-   그 안에서 outer.handle(msg) 실행
-   결국, 생성자 실행이 끝나기 전에 EarlyPublish 인스턴스의 메서드가 외부 스레드에서 호출될 수 있다.

이 때문에:

-   config처럼 생성자에서 초기화 중인 필드가 아직 완전히 설정되지 않았거나,
-   JMM 상에서 “초기화가 끝났다는 가시성”이 다른 스레드에 보장되기 전에,

외부 스레드가 해당 객체를 건드리는 상황이 발생한다. 이걸 보통 생성자에서 this(또는 this를 캡처한 내부 클래스)를 외부로 조기 발행(early publication) 했다, 혹은 this가 escape 했다고 표현한다.  
  
요약하면:

-   참조 체인이 생긴 것 자체보다, 그 체인이 “언제” 만들어졌느냐(생성자 도중)에 this escape의 위험이 있다.

## 4. 안전한 패턴으로 다시 쓰기

같은 기능을 조금 더 안전하게 작성해 보자.

```java
public class SafeSubscriber {

    private final String config;
    private final EventListener listener;

    private SafeSubscriber() {
        this.config = "default";
        this.listener = new EventListener() {
            @Override
            public void onMessage(Message msg) {
                handle(msg);
            }
        };
    }

    public static SafeSubscriber newInstance(EventBus eventBus) {
        SafeSubscriber subscriber = new SafeSubscriber();
        eventBus.register(subscriber.listener); // 완전히 생성된 뒤에만 외부에 등록
        return subscriber;
    }

    private void handle(Message msg) {
        System.out.println("config = " + config + ", msg = " + msg);
    }
}
```

  
여기서는 세 가지를 바꿨다.

1.  생성자를 private으로 막고,
2.  내부에서만 listener를 초기화한 뒤,
3.  정적 팩터리 메서드에서 SafeSubscriber가 완전히 만들어진 다음에 EventBus에 리스너를 등록한다.

이제 참조 체인의 생성 시점이 바뀐다.

-   new SafeSubscriber() 실행 (여기서는 외부에 아직 공개되지 않음)
-   생성자 완료 → 내부 필드/상태 초기화 완료
-   newInstance() 안에서 eventBus.register(subscriber.listener) 호출
-   그 이후에야 EventBus → listener → outer(SafeSubscriber) 참조 체인이 생긴다.

핵심 메시지는 단순하다.

-   생성자 안에서는 외부에 노출되는 일을 하지 않는다. (리스너 등록, 콜백 등록, 다른 스레드에 넘기기, 정적 컬렉션에 넣기 등)

이 규칙 하나만 지켜도, this escape로 인한 “부분 초기화 상태 노출” 문제를 상당히 줄일 수 있다.

정리하면:

-   EventBus → 리스너 → outer(EarlyPublish)라는 참조 체인 자체는 자연스러운 설계지만, 
-   이 체인이 생성자 실행 도중에 만들어지면, 외부 스레드가 아직 초기화가 끝나지 않은 객체를 호출할 수 있고, 
-   그 결과 부분 초기화 상태나 스테일 데이터를 보게 된다. 
-   이 상황을 생성자에서의 early publication, 혹은 this escape라고 부른다.
