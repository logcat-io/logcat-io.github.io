---
title: "[JAVA] 자바 동시성 프로그래밍: 기초부터 메모리 모델, 설계 전략까지 한 번에 정리하기"
description: >-
  단일 스레드 환경에서는 코드가 위에서 아래로 순차적으로 실행되기 때문에 상태 변화를 추적하기 쉽다. 하지만 멀티코어 환경에서 여러 스레드가
  동시에 실행되면, CPU 캐시와 메인 메모리 사이의 데이터 불일치로 인해 예상치 못한 버그가 발생한다. 단순히 synchronized 를
  쓰면 안전
pubDate: '2026-04-01T18:19:09+09:00'
dateSource: html-visible
slug: post-101
tags:
  - thread
  - 동시성
  - volatile
  - synchronized
  - Concurrency
  - jmm
category: Language/Java
cover: /images/posts/post-101/screenshot-2026-04-01-at-5-54-50-pm.png
draft: false
legacy:
  tistoryId: '101'
  sourceHtml: 101/101.html
  sourceHash: 'sha256:660e859aa5b63e084ba050b64cddc0dba96056216265a03a57be8a2e36338f92'
---

1\. 왜 이 글을 쓰는가?

단일 스레드 환경에서는 코드가 위에서 아래로 순차적으로 실행되기 때문에 상태 변화를 추적하기 쉽다. 하지만 멀티코어 환경에서 여러 스레드가 동시에 실행되면, CPU 캐시와 메인 메모리 사이의 데이터 불일치로 인해 예상치 못한 버그가 발생한다. 단순히 _**synchronized**_ 를 쓰면 안전하다고 외우기보다, **자바 메모리 모델(JMM)이 어떻게 작동하고 JVM 내부에서 스레드와 모니터 락이 어떤 구조로 관리되는지**를 정리하는 것이 목적이다.

이 글은 다음 질문들에 답하는 것을 목표로 한다.

-   왜 스레드를 늘린다고 무조건 성능이 좋아지지 않는가? (암달의 법칙)
-   자바 스레드의 실제 상태는 어떻게 변하며 인터럽트는 왜 중요한가?
-   JMM의 Happens-Before 관계란 무엇인가?
-   synchronized와 volatile은 내부적으로 어떻게 다르게 동작하는가?
-   안전한 동시성 설계를 위한 객체 구성 전략은 무엇인가?

## 2\. 동시성의 성능 한계: 암달의 법칙 (Amdahl's Law)

멀티스레드를 사용한다고 해서 성능이 선형적으로 증가하지는 않는다. 프로그램에는 반드시 병렬화할 수 없는 **순차적인 부분(_s_)**이 존재하기 때문이다.

**암달의 법칙 공식:**

![](/images/posts/post-101/screenshot-2026-04-01-at-5-54-50-pm.png)

(_s_: 순차적 실행 비율, _N_: 스레드 수)

아무리 스레드 수를 무한대로 늘려도 _s_ 구간 때문에 성능 향상에는 물리적 한계가 존재한다. 특히 공유 자원을 보호하기 위한 **크리티컬 섹션(Critical Section)**이 많아질수록 _s_ 가 커지므로, 락을 최소화하는 설계가 성능의 핵심이다.

## 3\. 자바 스레드 기본기와 상태 모델

java.lang.Thread는 JVM 힙에 존재하는 객체이자, OS 스레드에 대한 메타데이터를 담고 있는 래퍼 클래스이다. 

자바 스레드 상태는 대략 다음과 같다.

-   **NEW → RUNNABLE:** start() 호출 시 실제 OS 스레드가 생성된다.
-   **BLOCKED:** synchronized 락 획득을 위해 대기하는 상태이다.
-   **WAITING / TIMED\_WAITING:** wait(), join(), sleep() 등에 의해 실행을 멈춘 상태이다.
-   **TERMINATED:** 자바 스레드에 해당하는 OS 스레드가 실행을 중단한 경우이다.
-   **인터럽트(Interrupt):** sleep과 같은 차단 메서드는 InterruptedException을 던져 스레드를 깨운다. Thread.interrupted()를 활용한 협조적 취소가 자바의 표준 종료 방식이다.

## 4\. JMM과 공유 가변 상태 (Race Condition)

여러 스레드가 같은 필드를 읽고 쓸 때, CPU 캐시 때문에 서로 다른 값을 보는 현상이 발생한다.

![](/images/posts/post-101/img.png)

위 그림처럼 코어 A가 값을 수정해도 코어 B의 캐시에는 반영되지 않을 수 있다. JMM은 **Happens-Before** 관계를 통해 "어떤 쓰기가 다른 스레드에 반드시 보여야 하는가"를 정의하여 가시성과 원자성 문제를 제어한다.

```java
public class RaceConditionDemo {
    private static int counter = 0;

    public static void main(String[] args) throws InterruptedException {
        Runnable task = () -> {
            for (int i = 0; i < 1_000_000; i++) {
                counter++; // 동기화 없음
            }
        };

        Thread t1 = new Thread(task);
        Thread t2 = new Thread(task);

        t1.start();
        t2.start();
        t1.join();
        t2.join();

        System.out.println("counter = " + counter); // 2_000_000이 아닐 가능성 높음
    }
}
```

## 5\. synchronized 와 모니터

자바의 모든 객체는 **모니터(Monitor)**를 가진다. 이는 상호 배제(Mutual Exclusion)와 조건 대기(wait/notify)를 결합한 구조이다.

### 메서드 vs 블록

-   인스턴스 synchronized 메서드: this의 모니터를 잠근다.
-   static synchronized 메서드: Class 객체의 모니터를 잠근다.
-   synchronized 블록: 특정 범위에만 락을 적용하며, 바이트코드에서는 monitorenter / monitorexit로 표현된다.
-   메서드는 ACC\_SYNCHRONIZED 플래그로 표시되어, 호출 시 JVM이 암묵적으로 모니터 진입/퇴출을 수행한다.

### 재진입 가능한 락

-   자바 모니터는 재진입 가능(reentrant)하다.
-   같은 스레드가 이미 잡은 락을 다시 잡으면, JVM이 “보유 횟수”를 증가시키고 통과시키며, 모두 풀렸을 때 락이 해제된다.

### wait / notify / join

-   wait(): 해당 객체의 모니터를 가진 상태에서만 호출 가능, 호출 시 락을 놓고 WAITING/TIMED\_WAITING 상태로 들어간다.
-   notify()/notifyAll(): 같은 모니터에서 대기 중인 스레드를 깨운다.
-   join(): 대상 스레드가 TERMINATED 될 때까지 기다리는 고수준 API로, 내부적으로 wait/notify 패턴을 사용한다.

![](/images/posts/post-101/img-1.png)

## 6\. volatile과 플래그 패턴

volatile은 필드에 대한 **특별한 메모리 접근 규칙**을 정의한다.

-   volatile 읽기: 변수의 값을 CPU 캐시가 아닌 메인 메모리에서 직접 읽고 쓰도록 강제하여, 메인 메모리와 동기화를 보장하는 메모리 배리어를 삽입한다.
-   volatile 쓰기: 값을 즉시 주 메모리에 플러시하고, 다른 스레드가 곧바로 볼 수 있게 한다.

JMM 관점에서 volatile write/read는 Happens-Before 엣지를 제공해 재배치와 가시성을 제어한다.

따라서:

-   “종료 플래그”, “상태 변경 플래그” 같은 값에는 synchronized 대신 volatile만으로도 충분한 경우가 많다.
-   단, ++ 같은 복합 연산에는 여전히 원자성이 없으므로 주의해야 한다.

## 7\. 안전한 동시성 설계를 위한 객체 전략

### 불변 객체 (Immutable Object)

초기화 후 상태가 절대 바뀌지 않는 객체로, 별도의 동기화 없이 안전하게 공유할 수 있다.

-   모든 필드를 생성자에서 설정하고 private으로 관리한다.
-   외부 노출 메서드는 상태를 변경하지 않아야 한다.
-   final은 참조의 변경을 막을 뿐, 내부 객체의 상태까지 자동으로 불변으로 만들지는 않으므로 주의가 필요하다.

### 완전히 동기화된 객체 (Fully Synchronized Object)

다음 조건을 만족하여 타입 안전성과 진행성을 보장하는 객체이다.

1.  모든 필드는 생성 시 일관된 상태로 초기화된다.
2.  모든 필드는 private이며 외부로 직접 노출되지 않는다.
3.  모든 공용 메서드는 동기화되어 있으며 유한한 시간 내에 종료된다.
4.  불일치 상태에서 자신 또는 타 인스턴스의 메서드를 호출하지 않는다.

## 8\. 설계 시 체크리스트

-   공유 가변 상태를 최소화하고, 가능한 불변 객체로 설계한다.
-   꼭 필요한 공유 가변 상태에는 synchronized/Lock, volatile 등으로 Happens-Before를 명확히 만든다.
-   락 범위와 순서를 설계해서 데드락을 피하고, 진행성을 보장한다.
-   Thread 상태, interrupt, wait/notify/join 패턴을 이해하고, 차단 지점에서 인터럽트를 잘 처리한다.
-   암달의 법칙을 의식하면서, “락이 걸린 직렬 구간”을 줄인다.

## 9\. 다이어그램 정리

```java
[1] 성능 설계: 암달의 법칙
    - 순차 구간(s) 최소화가 성능의 핵심

[2] 스레드 생명주기
    - NEW -> RUNNABLE -> BLOCKED/WAITING -> TERMINATED
    - 인터럽트를 통한 협조적 종료 권장

[3] 가시성과 JMM
    - volatile: 메인 메모리 즉시 반영 (가시성)
    - synchronized: 상호 배제 + 가시성 (원자성)

[4] 모니터 락 특징
    - 모든 객체는 모니터를 가짐
    - 재진입(Reentrancy) 지원으로 데드락 방지 도움
```
