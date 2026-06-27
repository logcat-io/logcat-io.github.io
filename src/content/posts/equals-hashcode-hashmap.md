---
title: "[KOTLIN] equals를 재정의하면 왜 hashCode도 같이 손봐야 하나"
description: >-
  면접 단골 질문인 equals와 hashCode를, data class 하나가 HashSet에서 사라지는 현상에서
  출발해 java.util.HashMap 소스 라인까지 따라가며 둘을 같이 재정의해야 하는 이유를 코드로 확인한다.
pubDate: '2026-06-27T21:52:23+09:00'
dateSource: manual
slug: equals-hashcode-hashmap
tags:
  - Kotlin
  - Java
  - HashMap
  - equals
  - hashCode
category: Language/Kotlin
draft: false
---

면접을 보다 보면 equals와 hashCode 질문은 심심치 않게 나온다. "equals를 재정의하면 왜 hashCode도 같이 재정의해야 하나요?" 모범답안도 거의 정해져 있다.

> equals는 객체의 논리적 동등성을 판단하고, hashCode는 해시 기반 컬렉션에서 버킷을 찾는 데 씁니다. 그래서 equals로 같다고 본 두 객체는 hashCode도 같아야 컬렉션이 제대로 동작합니다.

나도 그렇게 답했다. 틀린 답은 아니라고 생각한다. 그런데 두 번째 문장을 코드로 아느냐고 스스로에게 질문하니 말문이 막혔다. hashCode가 "버킷을 찾는다"는 게 정확히 어느 코드고, 계약을 어기면 어디서 어떻게 깨지는가. 외운 문장과 따라가 본 코드는 다르다.

equals부터 한 겹 더 보자. equals는 기본적으로 레퍼런스 동등성, 메모리 주소가 같은지를 본다. 그걸 오버라이딩한다는 건 주소가 달라도 이 필드들이 같으면 같은 객체로 취급하라고 논리적 동등성을 새로 정의하는 것이다. 그러니 그 기준이 되는 필드는 변하면 안 된다. 왜 안 되는지를 코드로 확인하고 싶었다.

그래서 따라갔다. `java.util.HashMap` 소스 라인까지. 출발은 Kotlin `data class` 하나가 컬렉션 안에서 사라지는 작은 버그였고, 도착은 "왜 가변 필드를 hashCode에 넣으면 안 되는가"였다.

---

## 1. 컬렉션에 넣은 객체가 사라진다

재현 코드는 최대한 단순화했다. 가변 필드를 가진 `data class` 하나와 `HashSet` 하나면 된다.

```kotlin
data class Order(
    val orderNo: String,                           // 불변 식별자
    var status: OrderStatus = OrderStatus.CREATED, // 가변 상태
)

enum class OrderStatus { CREATED, CANCELED }
```

`data class`라서 Kotlin이 `equals`/`hashCode`/`toString`/`copy`를 자동으로 만들어준다. 정확히는 primary constructor에 선언한 프로퍼티를 기준으로 만든다. `Order`의 primary constructor에는 `orderNo`와 `status`가 있으니, 이 둘이 그대로 `hashCode`의 재료가 된다. 자동 생성은 편하다. 하지만 문제는 `status`가 `var`라는 것. 이 주문을 식별하는 건 `orderNo` 하나면 충분한데, primary constructor에 함께 선언됐다는 이유만으로 `status`까지 hashCode에 끌려 들어간다.

아래의 메인 메서드를 살펴보자.

```kotlin
fun main() {
    val order = Order(orderNo = "ORD-7")
    val orders = hashSetOf(order)

    order.status = OrderStatus.CANCELED   // 가변 필드 한 줄 변경

    println(orders.contains(order))   // false
    println(orders.remove(order))     // false
    println(orders.size)              // 1
}
```

`orders`에 분명히 `order`를 넣었다. 그리고 같은 객체 레퍼런스를 그대로 들고 `contains`를 물었다. 그런데 결과는 `false`다. `remove`도 `false`. 크기는 그대로 1이다. 넣은 객체를, 그 객체 자신으로 찾는데도 없다고 나온다.

`status` 한 줄 바꿨을 뿐이다.

표면적인 설명은 쉽다. data class의 hashCode가 status를 포함하니까, status를 바꾸면 hashCode가 달라지고, 그래서 HashSet이 못 찾는다는 것이다. 맞는 말이라고 생각한다. 하지만 이 문장에는 검증되지 않은 단어가 너무 많다. "HashSet이 hashCode로 찾는다"는 게 구체적으로 어느 코드인가. "못 찾는다"는 정확히 어디서 갈라지는가. 거기까지 보지 않으면 외운 것이지 이해한 게 아니다.

그래서 바닥까지 가 보기로 했다.

---

## 2. 디깅 환경 — 진짜 소스를 손에 넣기

추측으로 쓰면 의미가 없다. 내가 실제로 실행하는 JDK의 소스를 직접 봐야 한다. 작업 환경은 Liberica JDK 21이다 (sdkman `21.0.6-librca`). JDK 배포본에는 표준 라이브러리 소스가 `src.zip`으로 같이 들어있으니, 아래 명령으로 `HashSet`과 `HashMap`만 꺼내 보자.

```bash
SRC="$HOME/.sdkman/candidates/java/21.0.6-librca/lib/src.zip"
unzip -o "$SRC" \
  "java.base/java/util/HashSet.java" \
  "java.base/java/util/HashMap.java" \
  -d ./jdk-src
```

벤더는 신경 쓸 필요 없다. Liberica는 BellSoft가 빌드한 배포본이지만, `java.util` 같은 표준 라이브러리는 벤더가 손대지 않고 OpenJDK 소스를 그대로 가져간다. 그래서 같은 21.0.6 베이스라면 Temurin이든 Corretto든 `HashMap.java`가 바이트 단위로 동일하다. 아래 라인 번호는 OpenJDK 21 기준으로 그대로 통한다.

---

## 3. 첫 번째 벽 — Kotlin의 HashSet은 대체 뭔가

`hashSetOf(order)`부터 타입을 타고 내려가려고 했는데, 자꾸 이상한 데서 막혔다. `Set`에서 구현체로 점프하면 바디도 없는 `kotlin.collections.AbstractMutableSet` 같은 추상 선언으로 빠져버렸다. 그래서 `HashSet` 선언을 직접 열었더니, 아래처럼 나왔다.

```kotlin
public expect class HashSet<E> : MutableSet<E> {
    public constructor()
    override fun add(element: E): Boolean
    override fun contains(element: E): Boolean
    override fun remove(element: E): Boolean
    // 시그니처만 있고 구현 바디가 없다
}
```

`expect class`. Kotlin Multiplatform의 그 `expect`다. 공통 코드에는 "이런 게 있다"는 선언만 두고, 실제 구현은 플랫폼별 `actual`로 둔다. 그렇다면 JVM의 `actual`은 어디 있을까. actual을 따라가면 `kotlin-stdlib`의 `TypeAliases.kt`에 닿는다. JVM에서 쓰는 컬렉션 타입이 전부 이 파일에 typealias로 모여 있다.

```kotlin
// kotlin-stdlib — jvmMain/kotlin/collections/TypeAliases.kt
@SinceKotlin("1.1") public actual typealias HashSet<E> = java.util.HashSet<E>
@SinceKotlin("1.1") public actual typealias HashMap<K, V> = java.util.HashMap<K, V>
```

JVM에서 `kotlin.collections.HashSet`의 구현체는 클래스가 아니라 typealias였다. 즉 `java.util.HashSet`의 다른 이름일 뿐이다. "Kotlin이 만든 HashSet 구현 클래스"를 아무리 찾아도 안 나왔던 이유가 이거였다. 그런 건 없다. 처음부터 `java.util.HashSet`이었다.

### 바이트코드로 못 박기

typealias는 컴파일 타임 개념이라 말로만 하면 미덥지 않다. 그러니 바이트코드를 직접 보자. 이러면 확실해진다.

```bash
javap -c -p build/classes/kotlin/main/.../SampleClass.class
```

```text
38: invokestatic  kotlin/collections/SetsKt.hashSetOf:([Ljava/lang/Object;)Ljava/util/HashSet;
62: invokevirtual java/util/HashSet.contains:(Ljava/lang/Object;)Z
69: invokevirtual java/util/HashSet.remove:(Ljava/lang/Object;)Z
```

`hashSetOf`의 리턴 타입 디스크립터가 `Ljava/util/HashSet;`다. `contains`/`remove` 호출도 전부 `java/util/HashSet`로 직접 꽂힌다. 바이트코드 어디에도 `kotlin/collections/HashSet`은 없다. typealias는 컴파일되면서 흔적도 없이 `java.util.HashSet`으로 치환되고 사라지기 때문이다.

> 디스크립터 읽는 법만 짧게 보자. `([Ljava/lang/Object;)Ljava/util/HashSet;`는 `(파라미터)리턴` 구조다. `[`는 배열, `L...;`는 참조 타입이다. 그래서 파라미터는 `Object[]`(vararg가 배열로 컴파일되고 제네릭은 소거됨), 리턴은 `java.util.HashSet`. 기본형은 한 글자다 (`I`=int, `Z`=boolean, `J`=long).

여기서 하나 정리됐다. 파고들 대상은 Kotlin이 아니다. Kotlin은 이름만 빌려줬을 뿐, `hashCode`와 버킷 로직은 전부 `java.util.HashMap`에서 돈다. 그러니 따라가야 할 곳은 `kotlin.collections.HashSet`이 아니라 `java.util.HashSet`이고, 그 속의 `HashMap`이다. 추적 방향이 잡혔다.

---

## 4. HashSet은 껍데기다

`java.util.HashSet`을 열어 보면 살짝 김이 빠진다. 로직이 거의 없기 때문이다.

```java
public class HashSet<E> extends AbstractSet<E> implements Set<E>, ... {
    private transient HashMap<E,Object> map;             // 진짜 알맹이
    private static final Object PRESENT = new Object();   // 더미 value

    public boolean add(E e)           { return map.put(e, PRESENT) == null; }  // :228
    public boolean contains(Object o) { return map.containsKey(o); }           // :212
    public boolean remove(Object o)   { return map.remove(o) == PRESENT; }     // :244
}
```

`HashSet`은 속에 `HashMap`을 하나 들고, 원소를 key로, 의미 없는 싱글톤 `PRESENT`를 value로 넣는다. 집합의 "중복 없음"은 HashMap key의 유일성에서 그대로 따라온다. `add`가 `map.put(...) == null`을 반환하는 게 그 구현이다. 이미 있던 key면 `put`이 옛 value를 돌려주니, `add`는 `false`가 된다.

여기서 잠깐 옆길로 새 보자. 그러면 그냥 HashMap을 쓰면 되지 왜 HashSet인가. 될 수는 있다. `HashMap<Order, Any>`에 매번 더미 value를 넣으면 똑같이 동작한다. 그런데 안 쓰는 이유는 성능이 아니라 의미다. `Set<UserId>`는 "유일한 ID 모음"이라고 타입이 말해주지만, `Map<UserId, Boolean>`은 그 boolean이 뭔지 읽는 사람이 추론해야 한다. HashSet은 멤버십만 필요하다는 의도를 타입으로 드러내고, 더미 value 처리를 캡슐화한 것이다. Set이라는 추상 자료형을 HashMap으로 구현했을 뿐, 둘은 푸는 문제가 다르다.

어느 쪽이든 동작은 같다. key 자리에 객체를 넣고, 그 hashCode로 버킷 위치를 정한다. 그 과정을 보러 `HashMap`으로 들어가 보자.

---

## 5. hash() — hashCode를 그대로 안 쓴다

`HashMap`이 key를 받으면 제일 먼저 하는 일이다 (`HashMap.java:336`).

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

두 가지를 한다. null이면 0이다 (그래서 HashMap은 null key를 1개 허용한다). null이 아니면 `key.hashCode()`를 호출하는데, 그 값을 그대로 쓰지 않고 한 번 가공한다. `h ^ (h >>> 16)`.

왜 섞는 걸까. 버킷 자리를 정하는 식이 곧 나오는데, `(n - 1) & hash` 꼴이다. 기본 테이블 크기 `n=16`이면 `n-1 = 0b1111`이라, hash의 하위 4비트만 자리 결정에 쓰인다. 상위 비트는 통째로 버려진다. 그러면 하위 비트만 같고 상위가 다른 두 객체가 같은 자리로 몰려버린다.

`h ^ (h >>> 16)`은 상위 16비트를 하위로 끌어내려 XOR한다. 상위 비트의 정보를 하위 비트 결정에 참여시키는 것이다. 숫자로 보면 효과가 분명하다.

```text
A.hashCode = 0xABCD0000  → 하위 4비트 0 → 같은 자리
B.hashCode = 0x12340000  → 하위 4비트 0 → 충돌

spread 후:
A: 0xABCD0000 ^ 0x0000ABCD = 0xABCDABCD → 하위 4비트 D
B: 0x12340000 ^ 0x00001234 = 0x12341234 → 하위 4비트 4   → 충돌 해소
```

비용은 시프트 한 번에 XOR 한 번이라 거의 공짜다. 소스 주석도 "the cheapest possible way to reduce systematic lossage"라고 적어뒀다.

---

## 6. (n - 1) & hash — 나눗셈 없는 나머지

자리 계산은 `putVal`에서 이렇게 나온다 (`HashMap.java:636`).

```java
if ((p = tab[i = (n - 1) & hash]) == null)
    tab[i] = newNode(hash, key, value, null);
```

`(n - 1) & hash`가 버킷 인덱스다. 그런데 이게 왜 인덱스가 되는지가 핵심이다.

전제는 테이블 크기 `n`이 항상 2의 거듭제곱이라는 것이다. 그러면 `n-1`은 하위 비트가 전부 1인 마스크가 된다 (`16-1 = 0b1111`). `hash & (n-1)`은 hash의 하위 비트만 남기고 자른다. 이건 `hash % n`과 결과가 같다. 단, n이 2의 거듭제곱일 때만 그렇다.

```text
hash    = ...1010 1100 1101
n-1(15) = 0000 0000 1111
─────────────────────── &
결과    = 0000 0000 1101 = 13   → 버킷 13
```

`%`는 나눗셈이라 느리고, `&`는 비트 연산 한 번이라 빠르다. 그래서 매 put/get마다 도는 이 계산을 `&`로 처리하려고, HashMap은 capacity를 항상 2의 거듭제곱으로 유지한다. resize도 정확히 2배로 늘린다. 16, 32, 64라는 숫자가 우연이 아니라 이 트릭을 쓰기 위한 설계다.

`newNode(hash, key, value, null)` 한 줄도 그냥 지나치면 안 된다. 노드를 만들 때, 그 시점의 hash를 노드에 박아 넣기 때문이다. 노드 클래스를 보자 (`HashMap.java:281`).

```java
static class Node<K,V> implements Map.Entry<K,V> {
    final int hash;   // final. 한번 정해지면 안 바뀐다
    final K key;
    V value;
    Node<K,V> next;
}
```

`hash`가 `final`이다. put 시점의 hash가 노드에 박제된다. 이 디테일을 기억해두자. 뒤에서 결정적으로 작용한다.

---

## 7. getNode — 찾기, 그리고 세 개의 관문

`contains`는 `containsKey`로, `containsKey`는 `getNode`로 간다. 버그가 드러나는 6줄을 보자 (`HashMap.java:573`).

```java
final Node<K,V> getNode(Object key) {
    Node<K,V>[] tab; Node<K,V> first, e; int n, hash; K k;
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (first = tab[(n - 1) & (hash = hash(key))]) != null) {        // ① 버킷 관문
        if (first.hash == hash &&                                      // ② hash 관문
            ((k = first.key) == key || (key != null && key.equals(k)))) // ③ equals 관문
            return first;
        if ((e = first.next) != null) {
            if (first instanceof TreeNode)
                return ((TreeNode<K,V>)first).getTreeNode(hash, key);
            do {                                                       // 체인 순회
                if (e.hash == hash &&
                    ((k = e.key) == key || (key != null && key.equals(k))))
                    return e;
            } while ((e = e.next) != null);
        }
    }
    return null;
}
```

세 관문을 차례로 통과해야 "찾았다"가 된다.

**① 버킷 관문.** `hash(key)`를 지금 다시 계산하고, `(n-1) & hash`로 버킷을 짚어 첫 노드를 꺼낸다. 그 자리가 비었으면(`null`) 거기서 끝, `return null`.

**② hash 관문.** `first.hash == hash`. 노드에 박제된 hash(put 시점 값)와 방금 계산한 hash(현재 값)를 비교한다.

**③ equals 관문.** 그제야 `equals`로 정밀 비교한다. hash가 같은 것만 equals를 호출해서 무거운 비교를 아낀다.

이제 버그가 코드 위에 정확히 얹힌다. `status`를 바꾸면 도미노가 넘어간다.

```text
status 변경
 → hashCode() 바뀜
 → hash() 결과 바뀜
 → (n-1) & hash 의 하위 비트 바뀜 → 버킷 인덱스가 달라짐
```

put은 옛 버킷에 옛 hash로 박아뒀는데, `getNode`는 새 hash로 새 버킷을 짚는다. 그래서 두 갈래로 갈린다.

- 새 버킷이 비어있으면 ① 관문에서 `first == null` → 즉시 `return null`.
- 새 버킷에 다른 노드가 있으면 ② 관문에서 `first.hash`(옛값) ≠ `hash`(새값) → 탈락. 체인을 순회해도 거기 노드들은 다 옛 hash라 전부 탈락 → `return null`.

핵심 역설이 여기 있다. 그 `order` 객체는 set 안에 멀쩡히 살아있다. 레퍼런스도 그대로다. ③ 관문의 `first.key == key`까지만 갔으면 `==`로 바로 통과했을 것이다. 그런데 ①②에서 이미 길이 갈려, ③까지 도달하지 못한다. `remove`도 `removeNode`로 같은 탐색을 하니 똑같이 실패한다. 그래서 `contains`도 `remove`도 `false`다.

---

## 8. 충돌, 순회, 트리 — "O(1)"의 진실

여기서 한 발 더 가 보자. 같은 버킷에 여러 노드가 몰리면(충돌) 어떻게 될까. 위 `getNode`의 `do...while`이 그 답이다. 연결리스트를 `next`로 끝까지 순회한다. 그래서 알게 된 게 있다. HashMap의 "O(1)"은 버킷 점프까지의 얘기다. 버킷 안은 충돌 노드 수만큼 순회한다.

체인이 너무 길어지면 트리로 바꾼다. `putVal`의 체인 추가 지점이다.

```java
for (int binCount = 0; ; ++binCount) {
    if ((e = p.next) == null) {
        p.next = newNode(hash, key, value, null);
        if (binCount >= TREEIFY_THRESHOLD - 1)   // 8 - 1
            treeifyBin(tab, hash);
        break;
    }
    // ...
}
```

`TREEIFY_THRESHOLD = 8`. 흔히 "버킷에 8개 넘으면 레드블랙 트리로 바뀐다"고 외운다. 그런데 `treeifyBin`을 열어보면 조건이 하나 더 있다 (`HashMap.java:761`).

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    int n, index; Node<K,V> e;
    if (tab == null || (n = tab.length) < MIN_TREEIFY_CAPACITY)  // 64
        resize();                                                 // 트리화 대신 resize
    else if (...) { /* 트리로 변환 */ }
}
```

`MIN_TREEIFY_CAPACITY = 64`. 테이블 전체 capacity가 64 미만이면, 한 버킷에 8개가 쌓여도 트리로 안 가고 `resize`로 테이블을 2배 키운다. 작은 테이블의 충돌은 데이터가 나빠서가 아니라 테이블이 작아서일 때가 많고, 그땐 키워서 분산시키는 게 트리(노드당 포인터 6개에 균형 유지 비용까지)보다 싸기 때문이다. 트리는 테이블도 충분히 큰데 특정 버킷만 비정상적으로 몰릴 때의 최후 수단이다.

반대 방향도 있다. `UNTREEIFY_THRESHOLD = 6`. 트리가 쪼개져 노드 6개 이하가 되면 다시 연결리스트로 되돌린다. 올라가는 문턱(8)과 내려오는 문턱(6) 사이에 7이라는 완충지대를 둬서, 7 근처에서 add와 remove가 반복될 때 트리와 리스트를 오가는 변환이 진동하는 걸 막는다. 온도조절기 히스테리시스와 같은 발상이다.

내려오는 길은 `resize` 안에 있었다. 테이블을 2배로 늘리면, 각 버킷의 노드를 두 갈래로 나눠 새 테이블에 재배치한다 (`HashMap.java:727`, 일반 노드 기준).

```java
do {
    next = e.next;
    if ((e.hash & oldCap) == 0) { /* lo: 제자리 */ }
    else                        { /* hi: 제자리 + oldCap */ }
} while ((e = next) != null);
```

2배 확장이라 capacity 비트가 하나 늘고, 그 비트(`e.hash & oldCap`) 하나로 노드가 lo/hi 두 갈래로 깔끔하게 갈린다. 트리 노드는 전용 `split`이 처리하는데 (`HashMap.java:2297`), 거기서 갈라진 갈래가 6개 이하로 작아지면 `untreeify`로 연결리스트로 복귀시킨다.

```java
if (loHead != null) {
    if (lc <= UNTREEIFY_THRESHOLD)            // 6 이하
        tab[index] = loHead.untreeify(map);   // 트리 → 리스트
    else { tab[index] = loHead; ... loHead.treeify(tab); }
}
```

자료구조가 부하에 따라 살아 움직인다. 리스트로 시작하고, 한 버킷이 몰리고 테이블도 크면 트리로 올라가고, resize로 흩어지면 다시 리스트로 내려온다. 그래서 복잡도는 이렇게 적어야 정확하다.

| 상황 | 버킷 내부 | 전체 |
|---|---|---|
| 분산 잘 됨 (load factor 0.75 유지) | 노드 약 1개 | 평균 O(1) |
| 충돌 다발, 트리화 전 | 리스트 순회 | 최악 O(n) |
| 충돌 다발, 트리화 후 | 레드블랙 트리 | 최악 O(log n) |

"O(1)"은 평균이자 분할상환이다. 보장된 상수시간이 아니다. 그걸 떠받치는 게 `load factor 0.75`다. 원소가 capacity의 75%를 넘으면 resize해서 버킷 점유율을 낮게 유지하고, 그 덕에 평균 순회가 1~2 스텝에 그친다. Java 8이 트리화를 넣으면서 최악이 O(n)에서 O(log n)으로 내려갔고, 해시 충돌을 악의적으로 유도하는 DoS 방어도 겸한다.

이건 앞서 본 재현 코드와는 결이 다른 곁가지다. 그 코드는 버킷당 원소가 1개라 순회도 트리화도 없었다. 거기서 못 찾은 건 버킷 자체가 이동했기 때문이다. 트리화는 한 버킷에 여러 원소가 몰릴 때 일어나는 일이고, 재현 코드에서 벌어진 건 한 원소가 버킷을 갈아탄 일이다. 둘 다 `(n-1) & hash`라는 같은 식 위에서 벌어지는 다른 케이스다.

---

## 9. 출발점으로 — 그래서 계약이다

처음 면접 질문으로 돌아와 보자. equals를 재정의하면 왜 hashCode도 같이 손봐야 하나.

`getNode`의 세 관문이 답이다. HashMap은 hashCode로 버킷을 좁히고, equals로 최종 확인한다. 두 단계가 한 몸으로 움직인다. 그래서 `Object`의 계약이 이렇게 못 박혀 있다.

- `a.equals(b)`가 true이면 `a.hashCode() == b.hashCode()`여야 한다.
- 그 역은 강제가 아니다. hashCode가 같아도 equals는 다를 수 있다. 그게 충돌이고, ③ 관문이 거른다.

equals만 바꾸고 hashCode를 안 바꾸면, 이 계약이 깨진다. 같다고 판정될 두 객체가 다른 버킷에 들어가 영영 못 만나는 것이다. 면접 모범답안 한 줄("컬렉션이 제대로 동작하려면")의 실체가 바로 이 버킷 구조였다.

그리고 이 글의 버그는 계약 위반의 변종이다. equals와 hashCode를 안 맞춘 게 아니라 — `data class`라 둘이 자동으로 맞춰져 있다 — 그 hashCode의 입력(`status`)이 객체 수명 중에 변한다는 것이 문제다. HashMap은 한 번 넣은 key의 hashCode가 안 바뀐다는 걸 전제로, 노드에 hash를 박제하고 버킷을 잡는다. 그러니 가변 필드를 hashCode에 넣는 순간 그 전제가 깨진다.

처방은 의외로 단순하다. 컬렉션의 key나 원소로 쓸 객체는 hashCode/equals의 입력을 불변으로 둔다. `data class`를 그렇게 쓸 거면 프로퍼티를 `val`로 잡거나, 변하는 필드는 빼고 변하지 않는 식별자만으로 equals/hashCode를 직접 구현한다. 그리고 객체를 컬렉션에 넣은 뒤에는 그 식별 필드를 건드리지 않는다.

이게 특히 잘 터지는 대표 사례가 JPA 엔티티다. 엔티티는 본질이 가변이고, `@GeneratedValue` id는 저장 전엔 null이었다가 나중에 채워진다. 거기에 `data class`까지 얹으면 같은 버그가 더 교묘하게 난다. 그건 다음 글에서 따로 다룬다.

---

## 10. 따라가고 나서

외운 것과 따라간 것은 다르다. "equals 바꾸면 hashCode도"라는 결론은 처음부터 알고 있었다. 그런데 `getNode`의 `first.hash == hash` 한 줄을 직접 보기 전까지는, 노드에 hash가 박제된다는 것도, 버킷이 비었을 때와 다른 노드가 있을 때 실패 경로가 갈린다는 것도 몰랐다. 표면 설명("hashCode가 바뀌니까")은 그 두 경로를 한 덩어리로 뭉뚱그린다.

따라가다 막힌 데도 많았다. Kotlin 컬렉션이 자바로 어떻게 이어지는지 몰라, `AbstractMutableSet`과 `expect class`에서 한참 헤맸다. typealias라는 답을 알고 나니 허무할 만큼 단순했지만, 그 경계를 모르면 디버거 step-into가 영원히 추상 선언만 맴돈다.

남은 것도 있다. 레드블랙 트리의 `treeify`와 균형 회전은 호출 지점만 확인하고 내부는 안 봤다. resize의 lo/hi 분할이 비트 하나로 갈리는 건 봤지만, 그게 왜 순서를 보존하는지(`preserve order` 주석)는 더 파야 한다. 트리 안에서의 `getTreeNode` 탐색도 통과만 했다.

그래도 출발 질문은 닫혔다고 생각한다. equals와 hashCode는 HashMap의 버킷 구조가 묶어둔 한 쌍이고, 그 hashCode의 입력이 변하면 구조가 무너진다.
