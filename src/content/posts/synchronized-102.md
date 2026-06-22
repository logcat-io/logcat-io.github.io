---
title: "[JAVA] 자바 synchronized 를 바이트코드로 까보며 이해하기"
description: >-
  자바에서 synchronized는 모니터 락을 잡는다 정도로 보통 설명하지만, 실제로 JVM 바이트코드 레벨에서는 어떻게 구현되는지
  궁금해졌다. 간단한 Account 예제를 작성해서 javap -c -v로 디스어셈블하고, synchronized 블록과 메서드가 어떤
  바이트코드로 바뀌는지
pubDate: '2026-04-02T20:38:14+09:00'
dateSource: html-visible
slug: synchronized-102
tags:
  - Lock
  - synchronized
  - bytecode
  - Monitor
  - monitorenter
  - monitorexit
category: Language/Java
draft: false
legacy:
  tistoryId: '102'
  sourceHtml: '102/102-[JAVA]-자바-synchronized-를-바이트코드로-까보며-이해하기.html'
  sourceHash: 'sha256:ed2fe1c4d0b59a3a83e32a74f0b36038d10eb88fce26b2f4754bb148e1e6f364'
---

자바에서 **synchronized**는 **모니터 락을 잡는다** 정도로 보통 설명하지만, 실제로 JVM 바이트코드 레벨에서는 어떻게 구현되는지 궁금해졌다. 간단한 **Account** 예제를 작성해서 **javap -c -v**로 디스어셈블하고, **synchronized** 블록과 메서드가 어떤 바이트코드로 바뀌는지 직접 확인해 보았다.

## 1\. 예제 코드와 디스어셈블 결과

이번에 사용한 예제 바이트코드는 대략 다음과 같다.

```bash
public class Account
  minor version: 0
  major version: 65
  flags: (0x0021) ACC_PUBLIC, ACC_SUPER
  this_class: #8                          // Account
  super_class: #2                         // java/lang/Object
  interfaces: 0, fields: 1, methods: 8, attributes: 1
Constant pool:
   #1 = Methodref          #2.#3          // java/lang/Object."<init>":()V
   #2 = Class              #4             // java/lang/Object
   #3 = NameAndType        #5:#6          // "<init>":()V
   #4 = Utf8               java/lang/Object
   #5 = Utf8               <init>
   #6 = Utf8               ()V
   #7 = Fieldref           #8.#9          // Account.balance:D
   #8 = Class              #10            // Account
   #9 = NameAndType        #11:#12        // balance:D
  #10 = Utf8               Account
  #11 = Utf8               balance
  #12 = Utf8               D
  #13 = Utf8               (I)V
  #14 = Utf8               Code
  #15 = Utf8               LineNumberTable
  #16 = Utf8               rawWithdraw
  #17 = Utf8               (I)Z
  #18 = Utf8               StackMapTable
  #19 = Utf8               rawDeposit
  #20 = Utf8               getRawBalance
  #21 = Utf8               ()D
  #22 = Utf8               safeWithdraw
  #23 = Class              #24            // java/lang/Throwable
  #24 = Utf8               java/lang/Throwable
  #25 = Utf8               safeWithdrawToMethod
  #26 = Utf8               safeDeposit
  #27 = Utf8               getSafeBalance
  #28 = Utf8               SourceFile
  #29 = Utf8               Account.java
{
  public Account(int);
    descriptor: (I)V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=3, locals=2, args_size=2
         0: aload_0
         1: invokespecial #1                  // Method java/lang/Object."<init>":()V
         4: aload_0
         5: iload_1
         6: i2d
         7: putfield      #7                  // Field balance:D
        10: return
      LineNumberTable:
        line 4: 0
        line 5: 4
        line 6: 10

  public boolean rawWithdraw(int);
    descriptor: (I)Z
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=5, locals=2, args_size=2
         0: aload_0
         1: getfield      #7                  // Field balance:D
         4: iload_1
         5: i2d
         6: dcmpl
         7: iflt          23
        10: aload_0
        11: aload_0
        12: getfield      #7                  // Field balance:D
        15: iload_1
        16: i2d
        17: dsub
        18: putfield      #7                  // Field balance:D
        21: iconst_1
        22: ireturn
        23: iconst_0
        24: ireturn
      LineNumberTable:
        line 10: 0
        line 11: 10
        line 12: 21
        line 15: 23
      StackMapTable: number_of_entries = 1
        frame_type = 23 /* same */

  public void rawDeposit(int);
    descriptor: (I)V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=5, locals=2, args_size=2
         0: aload_0
         1: aload_0
         2: getfield      #7                  // Field balance:D
         5: iload_1
         6: i2d
         7: dadd
         8: putfield      #7                  // Field balance:D
        11: return
      LineNumberTable:
        line 19: 0
        line 20: 11

  public double getRawBalance();
    descriptor: ()D
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=2, locals=1, args_size=1
         0: aload_0
         1: getfield      #7                  // Field balance:D
         4: dreturn
      LineNumberTable:
        line 23: 0

  public boolean safeWithdraw(int);
    descriptor: (I)Z
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=5, locals=4, args_size=2
         0: aload_0
         1: dup
         2: astore_2
         3: monitorenter
         4: aload_0
         5: getfield      #7                  // Field balance:D
         8: iload_1
         9: i2d
        10: dcmpl
        11: iflt          29
        14: aload_0
        15: aload_0
        16: getfield      #7                  // Field balance:D
        19: iload_1
        20: i2d
        21: dsub
        22: putfield      #7                  // Field balance:D
        25: iconst_1
        26: aload_2
        27: monitorexit
        28: ireturn
        29: aload_2
        30: monitorexit
        31: goto          39
        34: astore_3
        35: aload_2
        36: monitorexit
        37: aload_3
        38: athrow
        39: iconst_0
        40: ireturn
      Exception table:
         from    to  target type
             4    28    34   any
            29    31    34   any
            34    37    34   any
      LineNumberTable:
        line 27: 0
        line 28: 4
        line 29: 14
        line 30: 25
        line 32: 29
        line 34: 39
      StackMapTable: number_of_entries = 3
        frame_type = 252 /* append */
          offset_delta = 29
          locals = [ class java/lang/Object ]
        frame_type = 68 /* same_locals_1_stack_item */
          stack = [ class java/lang/Throwable ]
        frame_type = 250 /* chop */
          offset_delta = 4

  public synchronized boolean safeWithdrawToMethod(int);
    descriptor: (I)Z
    flags: (0x0021) ACC_PUBLIC, ACC_SYNCHRONIZED
    Code:
      stack=5, locals=2, args_size=2
         0: aload_0
         1: getfield      #7                  // Field balance:D
         4: iload_1
         5: i2d
         6: dcmpl
         7: iflt          23
        10: aload_0
        11: aload_0
        12: getfield      #7                  // Field balance:D
        15: iload_1
        16: i2d
        17: dsub
        18: putfield      #7                  // Field balance:D
        21: iconst_1
        22: ireturn
        23: iconst_0
        24: ireturn
      LineNumberTable:
        line 38: 0
        line 39: 10
        line 40: 21
        line 43: 23
      StackMapTable: number_of_entries = 1
        frame_type = 23 /* same */

  public void safeDeposit(int);
    descriptor: (I)V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=5, locals=4, args_size=2
         0: aload_0
         1: dup
         2: astore_2
         3: monitorenter
         4: aload_0
         5: aload_0
         6: getfield      #7                  // Field balance:D
         9: iload_1
        10: i2d
        11: dadd
        12: putfield      #7                  // Field balance:D
        15: aload_2
        16: monitorexit
        17: goto          25
        20: astore_3
        21: aload_2
        22: monitorexit
        23: aload_3
        24: athrow
        25: return
      Exception table:
         from    to  target type
             4    17    20   any
            20    23    20   any
      LineNumberTable:
        line 47: 0
        line 48: 4
        line 49: 15
        line 50: 25
      StackMapTable: number_of_entries = 2
        frame_type = 255 /* full_frame */
          offset_delta = 20
          locals = [ class Account, int, class java/lang/Object ]
          stack = [ class java/lang/Throwable ]
        frame_type = 250 /* chop */
          offset_delta = 4

  public double getSafeBalance();
    descriptor: ()D
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=3, locals=3, args_size=1
         0: aload_0
         1: dup
         2: astore_1
         3: monitorenter
         4: aload_0
         5: getfield      #7                  // Field balance:D
         8: aload_1
         9: monitorexit
        10: dreturn
        11: astore_2
        12: aload_1
        13: monitorexit
        14: aload_2
        15: athrow
      Exception table:
         from    to  target type
             4    10    11   any
            11    14    11   any
      LineNumberTable:
        line 53: 0
        line 54: 4
        line 55: 11
      StackMapTable: number_of_entries = 1
        frame_type = 255 /* full_frame */
          offset_delta = 11
          locals = [ class Account, class java/lang/Object ]
          stack = [ class java/lang/Throwable ]
}
```

**raw\*** 계열 메서드는 일반적인 산술/필드 접근 바이트코드만 보이고, 동기화 관련 명령은 등장하지 않는다. 반대로 **safe\*** 계열에서는 monitorenter / monitorexit 혹은 ACC\_SYNCHRONIZED 플래그가 붙는 것을 확인할 수 있다.

## 2\. synchronized 블록: monitorenter / monitorexit

먼저 블록에 synchronized 를 건 safeWithdraw(int)의 바이트코드이다.

```bash
public boolean safeWithdraw(int);
  Code:
    stack=5, locals=4, args_size=2
       0: aload_0
       1: dup
       2: astore_2
       3: monitorenter
       4: aload_0
       5: getfield      #7                  // balance
       8: iload_1
       9: i2d
      10: dcmpl
      11: iflt          29
      14: aload_0
      15: aload_0
      16: getfield      #7
      19: iload_1
      20: i2d
      21: dsub
      22: putfield      #7
      25: iconst_1
      26: aload_2
      27: monitorexit
      28: ireturn
      29: aload_2
      30: monitorexit
      31: goto          39
      34: astore_3
      35: aload_2
      36: monitorexit
      37: aload_3
      38: athrow
      39: iconst_0
      40: ireturn
    Exception table:
       from    to  target type
           4    28    34   any
          29    31    34   any
          34    37    34   any
```

여기서 볼 수 있는 특징은 다음과 같다.

1.  synchronized 블록 → monitorenter / monitorexit 로 치환
    -   synchronized (this) 부분이 aload\_0, dup, astore\_2, monitorenter로 컴파일된다.
    -   나갈 때는 항상 aload\_2로 같은 객체를 로드한 뒤 monitorexit를 호출한다.
2.  컴파일러가 자동으로 try-finally 패턴을 만든다
    -   예외 테이블을 보면, 본문 구간에서 예외가 발생하면 34로 점프해서 monitorexit를 실행한 뒤 예외를 다시 던지는 구조이다.
    -   즉 synchronized 블록은 바이트코드 레벨에서 “try { ... } finally { monitorexit }” 형태로 변환되어, 예외가 발생하더라도 락이 반드시 풀리도록 보장한다.
3.  락 대상 객체를 로컬 변수에 별도로 저장
    -   dup 후 astore\_2로 this를 따로 저장해 두고, 모든 monitorexit에서 동일한 로컬 변수(여기서는 2번)를 사용한다.
    -   컴파일러 입장에서는 “어떤 경로로 빠져나가도 동일한 객체에 대해 exit 한다”는 것을 명확히 하기 위한 패턴으로 볼 수 있다.

단순한 safeDeposit(int)도 같은 패턴을 따른다.

```bash
public void safeDeposit(int);
  Code:
     0: aload_0
     1: dup
     2: astore_2
     3: monitorenter
     4: ... // 작업
    15: aload_2
    16: monitorexit
    17: goto          25
    20: astore_3
    21: aload_2
    22: monitorexit
    23: aload_3
    24: athrow
    Exception table:
       from    to  target type
           4    17    20   any
          20    23    20   any
```

정리하면, **synchronized 블록은 바이트코드에서 monitorenter / monitorexit + 예외 테이블을 이용한 try-finally 패턴으로 구현된다** 정도로 이해할 수 있다.

## 3\. synchronized 메서드: ACC\_SYNCHRONIZED 플래그

이번에는 메서드 전체에 synchronized 를 붙인 safeWithdrawToMethod(int)이다.

```bash
public synchronized boolean safeWithdrawToMethod(int);
  descriptor: (I)Z
  flags: (0x0021) ACC_PUBLIC, ACC_SYNCHRONIZED
  Code:
    stack=5, locals=2, args_size=2
       0: aload_0
       1: getfield      #7                  // balance
       4: iload_1
       5: i2d
       6: dcmpl
       7: iflt          23
      10: aload_0
      11: aload_0
      12: getfield      #7
      15: iload_1
      16: i2d
      17: dsub
      18: putfield      #7
      21: iconst_1
      22: ireturn
      23: iconst_0
      24: ireturn
```

여기서는 눈에 띄는 점이 두 가지이다.

-   바이트코드에 monitorenter / monitorexit가 전혀 등장하지 않는다.
-   대신 메서드 플래그에 ACC\_SYNCHRONIZED가 붙어 있다.

JVM 스펙에 따르면, 이 플래그가 붙은 메서드는 **호출 시점에 JVM이 암묵적으로 해당 모니터에 진입하고, 메서드가 리턴하거나 예외로 종료될 때 자동으로 모니터에서 빠져나온다.**

인스턴스 메서드인 경우 this의 모니터를 사용하고, static synchronized 메서드는 해당 클래스의 Class 객체 모니터를 사용한다. 즉, synchronized 메서드는 “메서드 전체를 하나의 synchronized 블록으로 본다”라고 이해하면 되고, 컴파일된 바이트코드는 일반 메서드와 거의 동일하지만, **동기화 여부는 메서드 플래그에 의해 JVM이 처리한다**는 차이가 있다.

## 4\. monitorenter / monitorexit 가 하는 일

바이트코드에서 본 monitorenter / monitorexit 명령은 JVM 내부에서 모니터(락)와 관련된 핵심 동작을 수행한다.

스펙 수준에서 보면 대략 다음과 같이 정의된다.

-   monitorenter
    -   스택 꼭대기에 있는 객체 참조를 꺼내 그 객체와 연관된 모니터를 획득한다.
    -   모니터 소유자가 없으면 현재 스레드가 소유자가 되고, 이미 현재 스레드가 소유 중이면 재진입 카운터만 증가한다.
    -   다른 스레드가 소유 중이면 모니터가 해제될 때까지 블록된다.
-   monitorexit
    -   스택에서 객체 참조를 꺼내 모니터의 재진입 카운터를 감소시키고, 카운터가 0이 되면 모니터를 해제한다.
    -   현재 스레드가 소유하지 않은 모니터에 대해 호출하면 IllegalMonitorStateException이 발생한다.

구현 관점에서 보면, HotSpot JVM은 이 모니터를 바로 OS 락에 매핑하지 않고, 여러 단계의 최적화를 거친다.

-   편향 락(biased locking)
    -   경쟁이 거의 없는 경우, 객체 헤더의 Mark Word에 “이 객체는 특정 스레드에게 편향되어 있다”는 정보만 남겨 두고, 그 스레드가 다시 synchronized 에 들어올 때는 별다른 동기화 연산을 하지 않는 식으로 동작한다.
-   경량 락(lightweight lock)
    -   경쟁이 있지만 크리티컬 섹션이 짧은 경우, CAS 연산과 스레드 스택에 잠금 레코드를 두는 방식으로 락을 구현한다.
-   중량 락(heavyweight lock)
    -   실제로 여러 스레드가 동시에 경쟁하는 경우, OS 수준의 뮤텍스/커널 객체를 사용하는 무거운 락으로 승급한다.

또한 락의 진입/해제 시점에는 적절한 메모리 배리어를 삽입해서, Java Memory Model 이 요구하는 가시성과 순서 보장(happens-before 관계)을 만족하도록 구현한다.

## 5\. 정리

이번에 바이트코드를 직접 까보면서 정리한 포인트는 다음과 같다.

-   synchronized 블록은 바이트코드에서 monitorenter / moniterexit 명령으로 변환되고, 예외 테이블을 이용한 try-finally 패턴으로 컴파일되어 어떤 경로로든 블록을 빠져나갈 때 반드시 monitorexit가 한 번 호출되도록 보장한다.
-   synchronized 메서드는 바이트코드에 동기화 관련 명령이 보이지 않고, 메서드 플래그에 ACC\_SYNCHRONIZED만 붙는다. 실제 모니터 진입/퇴출은 메서드 호출/리턴 시점에 JVM이 처리한다.
-   monitorenter / monitorexit 는 객체 모니터의 소유권과 재진입 카운터를 관리하는 명령이고, HotSpot 같은 구현체에서는 편향 락, 경량 락, 중량 락 등 여러 수준으로 구현하여 대부분의 synchronized를 빠르게 처리하면서도 Java Memory Model의 요구사항을 만족시킨다.

이 정도까지 보면, 소스 코드에서 synchronized 한 줄을 쓰는 게 단순히 “락 잡기”가 아니라, **JVM 입장에서는 바이트코드 수준 모니터 명령과 다양한 락 구현, 메모리 배리어까지 엮이는 꽤 많은 일**이라는 걸 확인할 수 있다.
