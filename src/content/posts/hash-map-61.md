---
title: HashMap이란?
description: >-
  자바를 사용하다 보면 Map 자료구조를 많이 활용하게 된다. Map은 키와 값으로 이루어져 있고, 이때 키는 값을 구분하기 위한 유일한
  값이다.
pubDate: '2023-12-31T20:35:15+09:00'
dateSource: html-visible
slug: hash-map-61
tags: []
category: Language/Java
draft: false
legacy:
  tistoryId: '61'
  sourceHtml: '61/61-[JAVA]-HashMap이란?.html'
  sourceHash: 'sha256:8fc8346f1e60951dbb4107a6662c6394260ec4ec41f6e1f96c2b7dcbd0e63b57'
---

> 자바 Map에 대해서 공부하던 중 **버켓(Bucket)**이라는 단어를 접하게 되었다. 그래서 이번 글은 버켓에 대해서 자세하게 작성되어 있는 글을 정독하고, 정리한 글이다. 기존의 글에 개인적으로 이해하기 쉽도록 설명을 추가한 글로, 원 글을 다시 작성해 보면서 공부한 글이다.  
>   
> 원본: https://d2.naver.com/helloworld/831311

* * *

자바를 사용하다 보면 **Map 자료구조**를 많이 활용하게 된다. Map은 **키**와 **값**으로 이루어져 있고, 이때 키는 값을 구분하기 위한 유일한 값이다.

자바에서 Map은 **인터페이스**로 다양한 구현체를 제공한다. 가장 기본적으로 자주 사용되는 구현체는 **HashMap**, **TreeMap**, **LinkedHashMap** 등이 있다. 그리고 **HashTable**도 있다.   
  
HashMap은 JDK 1.2부터 추가된 Java Collections Framework에 속한 구현체 클래스다. 추가적으로 LinkedHashMap은 JDK 1.4에 추가되었다. 그리고 지금까지도 성능 개선을 위해서 끊임없이 변화하고 있다.   
  
Hashtable JDK 1.0부터 존재했던 자바의 API이다. Hashtable 또한 Map 인터페이스를 구현하고 있어 기본적으로 HashMap과 제공하는 기능이 동일하다. 하지만 조금의 차이점이 있다.

-   키나 값에 null 저장 가능 여부: HashMap은 값으로 키가 값에 Null을 저장할 수 있지만, Hashtable 불가능하다.
-   **스레드 세이프**: HashMap은 스레드 세이프하지 않지만, Hashtable은 스레드 세이프 하다. 아래의 코드에서 확인할 수 있다. HashMap의 경우에도 멀티 스레드 환경에서 사용할 수 있는데, 이때는 Collections Framework의 HashMap을 사용하면 안 되고, concurrent 패키지에 속한 ConcurrentHashMap을 사용해야 한다.

```java
	// HashMap
	public V get(Object key) {  
		Node<K,V> e;  
		return (e = getNode(key)) == null ? null : e.value;  
	}
```

```java
	// Hashtable
	@SuppressWarnings("unchecked")  
	public synchronized V get(Object key) {  
		Entry<?,?> tab[] = table;  
		int hash = key.hashCode();  
		int index = (hash & 0x7FFFFFFF) % tab.length;  
		for (Entry<?,?> e = tab[index] ; e != null ; e = e.next) {  
			if ((e.hash == hash) && e.key.equals(key)) {  
				return (V)e.value;  
			}  
		return null;   
	}
```

```java
// ConcurrentHashMap

final V putVal(K key, V value, boolean onlyIfAbsent) {
        if (key == null || value == null) throw new NullPointerException();
        int hash = spread(key.hashCode());
        int binCount = 0;
        for (Node<K,V>[] tab = table;;) {
            Node<K,V> f; int n, i, fh; K fk; V fv;
            if (tab == null || (n = tab.length) == 0)
                tab = initTable();
            else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
                if (casTabAt(tab, i, null, new Node<K,V>(hash, key, value)))
                    break;                   // no lock when adding to empty bin
            }
            else if ((fh = f.hash) == MOVED)
                tab = helpTransfer(tab, f);
            else if (onlyIfAbsent // check first node without acquiring lock
                     && fh == hash
                     && ((fk = f.key) == key || (fk != null && key.equals(fk)))
                     && (fv = f.val) != null)
                return fv;
            else {
                V oldVal = null;
                synchronized (f) {  // synchronized 키워드를 확인할 수 있다.
                    if (tabAt(tab, i) == f) {
                        if (fh >= 0) {
                            binCount = 1;
                            for (Node<K,V> e = f;; ++binCount) {
                                K ek;
                                if (e.hash == hash &&
                                    ((ek = e.key) == key ||
                                     (ek != null && key.equals(ek)))) {
                                    oldVal = e.val;
                                    if (!onlyIfAbsent)
                                        e.val = value;
                                    break;
                                }
                                Node<K,V> pred = e;
                                if ((e = e.next) == null) {
                                    pred.next = new Node<K,V>(hash, key, value);
                                    break;
                                }
                            }
                        }
                        else if (f instanceof TreeBin) {
                            Node<K,V> p;
                            binCount = 2;
                            if ((p = ((TreeBin<K,V>)f).putTreeVal(hash, key,
                                                           value)) != null) {
                                oldVal = p.val;
                                if (!onlyIfAbsent)
                                    p.val = value;
                            }
                        }
                        else if (f instanceof ReservationNode)
                            throw new IllegalStateException("Recursive update");
                    }
                }
                if (binCount != 0) {
                    if (binCount >= TREEIFY_THRESHOLD)
                        treeifyBin(tab, i);
                    if (oldVal != null)
                        return oldVal;
                    break;
                }
            }
        }
        addCount(1L, binCount);
        return null;
    }
```

-   HashMap은 보조 해시 함수를 사용하기 때문에 Hashtable에 비해서 해시 충돌이 덜 발생할 수 있어 상대적으로 성능상 이점이 있다.

HashMap과 Hashtable은 '키에 대한 해시 값을 사용하여 값을 저장하고 키를 이용해서 값을 조회할 수 있다. 그리고 키-값 쌍의 개수에 따라 동적으로 크기가 증가하는 associate array'라고 할 수 있다. 이때 associate array는 다른 말로 Map, Dictionary, Symbol Table 등이 있다. 다음은 실제 HashMap과 Hashtable의 선언부이다.

```java
public class HashMap<K,V> extends AbstractMap<K,V> implements Map<K,V>, Cloneable, Serializable {
	...
```

```java
public class Hashtable<K,V> extends Dictionary<K,V> implements Map<K,V>, Cloneable, java.io.Serializable {
	...
```

map은 수학 함수에서 대응 관계를 지칭할 때 사용한다. 이를 HashMap에 대입한다면, HashMap은 키의 집합인 정의역과 값의 집합인 공역의 대응에 해시 함수를 이용한다고 해석할 수 있다.  
  
완전한 해시 함수는 동일하지 않는 두 객체 X와 Y가 있을 때, X.equals(Y) == false & X.hashCode() != Y.hashCode()인 경우를 의미한다.  
  
자바에서 Boolean이나 Number 객체의 경우에는 값 자체를 해시 값으로 사용할 수 있어 완전한 해시 함수 대상으로 생각할 수 있으나, String이나 POJO에 대하여 완전한 해시 함수를 제작하는 것은 어렵다. POJO(plain old java object)는 마틴 파울러 등이 사용하기 시작한 언어로, 순수한 자바 객체를 의미한다. 즉, 다른 지술적 의존성을 갖지 않는 객체이다.  
  
HashMap은 객체의 hashCode()의 반환 값을 사용하는데, 반환 값에 따른 버켓이라는 List 형태의 공간이 만들어진다.

```java
// HashMap
transient Node<K,V>[] table;
```

만약 M개의 원소가 있는 배열을 사용하는 경우 다음과 같이 인덱스를 계산할 수 있다.

**X.hashCode() % M**

하지만 위의 코드에서는 서로 다른 해시 코드를 가지는 서로 다른 객체가 1/M의 확률로 같은 해시 버킷을 사용하게 될 수 있고 이를 해시 충돌이라고 한다. 이때 해시 충돌이 발생하더라도 키-값 쌍의 데이터를 저장하고 조회할 수 있도록 하는 방법에는 대표적으로 두 가지의 방법이 있다.

1.  **Open Addressing**: 만약 데이터를 삽입하려고 하는 버켓이 이미 사용 중인 경우 다른 해시 버켓에 삽입한다. 이때 버켓을 찾는 방법에는 Linear Probing, Quadratic Probing 등이 있다.
    1.  Linear Probing
        -   빈 버켓까지 다음 버켓으로 선형적으로 탐색한다. 선형 함수는 다음과 같다.
        -   h′(k,i)=(h(k)+i) mod m (i: 시도 횟수, h(k): 키 k에 대한 해시 인덱스, m: 해시 테이블의 크기)
    2.  Quadratic Probing
        -   빈 버켓까지 제곱 함수를 사용한다. 제곱 함수는 다음과 같다.
        -   h′(k,i)=(h(k)+c1​⋅i+c2​⋅i2) mod m (i: 시도횟수, h(k): 키 k 에 대한 해시 인덱스, m: 해시 테이블의 크기, c: 양의 상수)
2.  **Separate Chaining**: 해시 충돌이 발생한 경우 빈 버켓을 찾는 것이 아니라, 링크드 리스트로 연결한다.

HashMap의 해시 충돌 해결 방법 중 Separate Chaining을 사용한다. Open Addressing의 경우 데이터를 삭제할 때 효율이 좋지 못하다.  
  
하지만 Separate Chainig도 자바의 버전에 따라서 HashMap 에서의 구현코드가 계속해서 변경되었다. Java 2 부터 7 까지의 HashMap에서는 Separate Chainig 구현에서 링크드 리스트를 사용했다면, Java 8 부터는 데이터의 개수가 일정 개수 이상이 되면 링크드 리스트 대신 트리를 사용한다.  
  
이때 일정 개수의 기준은 상수로 구현되어 있는데 다음과 같다.

```java
// HashMap
/**  
* The bin count threshold for using a tree rather than list for a  
* bin. Bins are converted to trees when adding an element to a  
* bin with at least this many nodes. The value must be greater  
* than 2 and should be at least 8 to mesh with assumptions in  
* tree removal about conversion back to plain bins upon  
* shrinkage.  
*/  
static final int TREEIFY_THRESHOLD = 8;  
  
/**  
* The bin count threshold for untreeifying a (split) bin during a  
* resize operation. Should be less than TREEIFY_THRESHOLD, and at  
* most 6 to mesh with shrinkage detection under removal.  
*/  
static final int UNTREEIFY_THRESHOLD = 6;
```

해시 버켓 하나의 키-값 쌍의 데이터가 8(**\=TREEIFY\_THRESHOLD**)개 이상 모이면 링크드 리스트를 트리로 변경한다. 만약 트리에서 데이터가 삭제되어 6(**\=UNTREEIFY\_THRESHOLD**)개가 되면 트리를 다시 링크드 리스트로 변경하게 된다. 변경하는 이유는 트리가 리스트에 비해서 메모리 사용량이 많고, 데이터가 작아지는 경우 트리와 링크드 리스트의 Worst Case 수행 시간의 차이가 무의미해 지기 때문이다. 이때 8과 6으로 2만큼의 차이를 둔 것은 동일한 데이터가 반복되어 삽입/삭제되는 경우 불필요한 변환이 발생하여 성능 저하를 발생시킬 수 있기 때문이다.  
  
위의 버켓 코드에서 확인할 수 있듯이 Java 8 부터는 Map.Entry를 구현한 Node 구현체를 사용한다. 그리고 링크드 리스트에서 트리로 변경할 때 사용될 TreeNode가 Node의 하위 클래스이다. (조금더 자세히 보면 HashMap.Node를 상속한 Entry를 상속한 것이다.)  
  
TreeNode 에는 다양한 메서드가 있는데, treeify() 메서드는 링크드 리스트를 트리로 변환하고, untreeify 메서드는 반대의 역할을 수행한다.  
  

**_그렇다면 어떤 트리로 링크드 리스트를 변경하는 것일까?_** 

  
이때 사용하는 트리는 **Red-Black Tree**이다. Red-Black Tree는 Collections Frameworkdml TreeMap과 구현이 거의 같다. 트리 순회 시 사용하는 대소 판단의 기준은 해시 함수의 값을 사용한다. 해시 함수의 결과 값이 같은 경우 동등한 노드로 취급 되지만, 만약 동등하지 않은 경우가 발생할 수 잇다. Total Ordering 문제인데, Java 8 에서는 tieBreakOrder() 메서드로 해결한다.

```java
static int tieBreakOrder(Object a, Object b) {  
	int d;  
	if (a == null || b == null ||  
		(d = a.getClass().getName().  
		compareTo(b.getClass().getName())) == 0)  
		d = (System.identityHashCode(a) <= System.identityHashCode(b) ? 
	-1 : 1);  
	return d;  
}
```

해시 버켓의 개수가 적다면 메모리 사용을 아낄 수 있지만, 위에서 언급한 해시 충돌의 문제로 인해서 성능 저하를 발생시킬 수 있다. HashMap은 이러한 문제에 대해서 데이터의 개수가 일정 개수 이상이 되면, 해시 버켓의 개수를 두 배로 늘리게 된다. 개수가 늘어나면 해시 충돌을 감소 시킬 수 있기 때문이다. 해당 과정은 resize() 메서드에 구현되어 있고, 아래는 resize() 메서드의 일부다.

```java
final Node<K,V>[] resize() {  
	Node<K,V>[] oldTab = table;  
	int oldCap = (oldTab == null) ? 0 : oldTab.length;  
	int oldThr = threshold;  
	int newCap, newThr = 0;  
	if (oldCap > 0) {  
		if (oldCap >= MAXIMUM_CAPACITY) {  
			threshold = Integer.MAX_VALUE;  
			return oldTab;  
		}  
		else if ((newCap = oldCap << 1) < MAXIMUM_CAPACITY &&   // 2배 증가
			oldCap >= DEFAULT_INITIAL_CAPACITY)  
			newThr = oldThr << 1; // double threshold  
		}  
	else if (oldThr > 0) // initial capacity was placed in threshold  
		newCap = oldThr;  
	else { // zero initial threshold signifies using defaults  
		newCap = DEFAULT_INITIAL_CAPACITY;  
		newThr = (int)(DEFAULT_LOAD_FACTOR * DEFAULT_INITIAL_CAPACITY); 
	}  
	if (newThr == 0) {  
		float ft = (float)newCap * loadFactor;  
		newThr = (newCap < MAXIMUM_CAPACITY && ft < (float)MAXIMUM_CAPACITY ?  
		(int)ft : Integer.MAX_VALUE);  
	}
	
	threshold = newThr;
```

하지만 2배로 증가시키는 것은 온전히 해시 충돌을 해결하지는 못한다. 해시 버켓의 개수를 2배씩 늘리면 결과적으로 버켓의 개수는 2^a 개가 되어 버린다. 이는 2의 승수로 나누는 경우 해시 충돌이 발생할 수 있게 된다.  
  
이를 개선하기 위해서 **보조 해시 함수**가 필요하다. 보조 해시 함수는 HashMap과 Hashtable의 차이점에서 언급했었다.  
  
보조 해시 함수의 목적은 키의 해시 값을 변형하여, 해시 충돌 가능성을 줄이는 것이다. 보조 해시 함수는 JDK 1.4 부터 등장하였고 Java 5 부터 Java 7까지 보조 해시 함수가 변화했지만, Java 8 부터는 다시 Java 5 방식의 보조 해시 함수를 사용한다. 링크드 리스트를 트리로 변환하여 해시 충돌을 완화시켰고, Java 7의 보조 해시 함수의 효과가 크지 않았기 때문이다.

```java
// Java 7
final int hash(Object k) {
  int h = hashSeed;
  if (0 != h && k instanceof String) {
     return sun.misc.Hashing.stringHash32((String) k);
  }

  h ^= k.hashCode();
  // This function ensures that hashCodes that differ only by
  // constant multiples at each bit position have a bounded
  // number of collisions (approximately 8 at default load factor).
  h ^= (h >>> 20) ^ (h >>> 12);
  return h ^ (h >>> 7) ^ (h >>> 4);
}
```

```java
// Java 5 & 8
static final int hash(Object key) {  
	int h;  
	return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);  
}
```

이상 자바의 HashMap에 대해서 자세히 알아봤다.

## 참고

-   [https://d2.naver.com/helloworld/831311](https://d2.naver.com/helloworld/831311)
-   자바의 신 Vol.2
-   [https://stackoverflow.com/questions/34479098/what-has-change-in-java-7-for-hashmap-from-java-5](https://stackoverflow.com/questions/34479098/what-has-change-in-java-7-for-hashmap-from-java-5)
