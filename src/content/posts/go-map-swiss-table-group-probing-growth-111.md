---
title: "[GO] Go map 내부 구조 뜯어보기 - Swiss Table, group, probing, growth"
description: Go에서 map은 겉으로 보면 평범한 키-값 저장소다. 하지만 런타임 안쪽으로 들어가면 버전마다 꽤 다른 구현을 만난다.
pubDate: '2026-05-12T19:50:28+09:00'
dateSource: html-visible
slug: go-map-swiss-table-group-probing-growth-111
tags:
  - map
  - 자료구조
  - HashMap
  - golang
  - 해시맵
  - swiss
  - table
  - internals
category: Language/Go
cover: >-
  /images/posts/go-map-swiss-table-group-probing-growth-111/gemini-generated-image-g043kzg043kzg043.png
draft: false
legacy:
  tistoryId: '111'
  sourceHtml: 111/111.html
  sourceHash: 'sha256:e8e82f380650147209fec186ad6349c78406ab1398ea0ff1e8722f7c3b56dfb9'
---

Go에서 `map`은 겉으로 보면 평범한 키-값 저장소다. 하지만 런타임 안쪽으로 들어가면 버전마다 꽤 다른 구현을 만난다.

Java를 공부할 때 HashMap 내부가 linked list에서 red-black tree로 바뀌는 구조를 본 적이 있다. Go의 map도 같은 궁금증으로 들여다봤는데, 버전마다 설명이 달라서 직접 소스를 찾아보게 됐다. 이 글은 그 과정에서 정리한 내용이다.

* * *

예전 Go map 설명을 보면 `hmap`, `bmap`, `tophash`, `overflow bucket`, `oldbuckets`, `evacuate` 같은 단어가 자주 나온다. 그 설명이 틀린 것은 아니다. 다만 현재 Go 1.25 기준의 기본 구현을 설명하는 글로 읽으면 방향이 어긋난다.

현재 Go 런타임의 map은 Swiss Table 계열 설계를 사용한다. 큰 그림은 아래 정도만 잡고 가면 된다.

-   `Map`: map 전체의 최상위 구조
-   `table`: 하나의 Swiss Table
-   `group`: 8개 slot과 8바이트 control word를 가진 작은 묶음
-   `slot`: key/value 한 쌍
-   `control byte`: 각 slot의 상태와 해시 일부를 담는 메타데이터

아래 내용은 로컬에서 확인한 Go 1.25.1 런타임 소스 기준이다. 내부 구현은 언제든 바뀔 수 있으니, 이 구조를 애플리케이션 코드의 전제로 삼으면 안 된다.

## 예제 코드 - 겉에서 보는 map

```
package main

import "fmt"

func main() {
    m := make(map[string]int)

    m["a"] = 1
    m["b"] = 2
    m["c"] = 3

    fmt.Println("len:", len(m))
    fmt.Println("a:", m["a"])
    fmt.Println("b:", m["b"])
    fmt.Println("c:", m["c"])

    delete(m, "b")
    fmt.Println("after delete:", m)
}
```

겉에서는 `make`, 조회, 대입, 삭제만 보인다. 안쪽에서는 해시 계산, table 선택, group 탐색, control byte 비교, key 비교, 필요 시 grow가 일어난다.

## 1\. map 값은 내부 테이블을 가리키는 작은 값처럼 동작한다

Go에서 map 변수는 값이다.  
하지만 그 값은 런타임이 관리하는 내부 hash table을 가리키는 작은 핸들처럼 동작한다.

```
m1 := map[string]int{"a": 1}
m2 := m1

m2["a"] = 100
fmt.Println(m1["a"]) // 100
```

`m2 := m1`은 map 값을 복사한다. 하지만 두 map 값이 같은 내부 table을 가리키므로 원소 수정은 서로 보인다. 함수에 map을 넘겨도 마찬가지다.

```
func add(m map[string]int) {
    m["b"] = 2
}

func main() {
    m := map[string]int{"a": 1}
    add(m)
    fmt.Println(m) // map[a:1 b:2]
}
```

다만 함수 안에서 map 변수 자체를 다른 map으로 바꾸는 것은 호출자에게 보이지 않는다.

```
func replace(m map[string]int) {
    m = map[string]int{"new": 1}
}

func main() {
    m := map[string]int{"a": 1}
    replace(m)
    fmt.Println(m) // map[a:1]
}
```

이 부분만 놓치지 않으면 된다:

-   map 변수는 복사될 수 있는 값이다.
-   map 값들은 같은 내부 table을 공유할 수 있다.
-   원소 추가/수정/삭제는 공유된 내부 table에 반영된다.
-   map 변수 자체를 재대입하는 것은 그 변수에만 적용된다.

## 2\. 현재 구현의 큰 그림 - Map, directory, table, group

Go 1.25 기준 map 구현은 Swiss Table 기반이다. 다이어그램으로 줄이면 이런 모습에 가깝다.

![](/images/posts/go-map-swiss-table-group-probing-growth-111/gemini-generated-image-g043kzg043kzg043.png)

런타임 소스에서 최상위 구조를 훑어보면 이런 값들이 보인다.

```
type Map struct {
    used uint64 // 실제 원소 수. len(m)의 기준
    seed uintptr

    dirPtr unsafe.Pointer
    dirLen int

    globalDepth uint8
    globalShift uint8

    writing uint8
    tombstonePossible bool
    clearSeq uint64
}
```

필드 이름까지 외울 필요는 없다. 읽을 때는 다음 정도만 눈에 들어오면 충분하다.

-   `used`: map에 살아 있는 key/value 개수
-   `seed`: 해시 seed. 해시 공격과 순서 의존을 줄이는 데 중요하다.
-   `dirPtr`, `dirLen`: table들을 찾기 위한 directory
-   `globalDepth`, `globalShift`: hash 상위 비트로 table을 고르는 데 쓰는 정보
-   `writing`: 동시 write 감지에 쓰는 상태
-   `tombstonePossible`: 삭제 표시가 남아 있을 가능성

작은 map은 별도 table directory 없이 group 하나에 들어갈 수 있다. 8개 이하의 원소만 가진 작은 map에서는 이 최적화 덕분에 구조가 더 단순하다.

## 3\. group - 8개 slot과 control word

Swiss Table에서 자주 보게 되는 단위가 group이다. Go의 group은 8개 slot을 가진다.

```
group

control word: 8 bytes
  [c0][c1][c2][c3][c4][c5][c6][c7]

slots: 8 key/value pairs
  [k0,v0][k1,v1][k2,v2][k3,v3][k4,v4][k5,v5][k6,v6][k7,v7]
```

각 control byte는 해당 slot의 상태를 나타낸다.

```
empty   : 비어 있음
deleted : 삭제됐지만 probing 때문에 남겨둔 tombstone
full    : 사용 중이며 H2 해시 조각을 담음
```

현재 구현에서 control byte는 개념적으로 다음 정보를 담는다.

```
empty   : 1000 0000
deleted : 1111 1110
full    : 0hhh hhhh
```

`full` 상태의 하위 7비트는 key hash의 일부인 H2다. 이 덕분에 lookup 때 8개 slot의 control byte를 한 번에 비교해서 후보 slot을 빠르게 좁힐 수 있다. 예전 구현의 `tophash [8]uint8`과 역할은 비슷해 보일 수 있다.  
하지만 현재 구현은 `bmap + overflow chain`이 아니라 `group + control word + probing`이 중심이다.

## 4\. 해시값을 어떻게 나눠 쓰는가 - H1과 H2

키를 조회하거나 삽입할 때 런타임은 키의 해시값을 계산한다. 현재 Swiss map은 해시값을 크게 둘로 나눠 쓴다.

```
hash
  |
  +-- H1: 상위 57비트
  |       table/group 위치와 probe sequence 계산에 사용
  |
  +-- H2: 하위 7비트
          group 안 control byte 후보 매칭에 사용
```

개념 코드로 쓰면 이렇다.

```
func h1(h uintptr) uintptr {
    return h >> 7
}

func h2(h uintptr) uintptr {
    return h & 0x7f
}
```

조회는 이런 식으로 흘러간다.

1.  key의 hash를 계산한다.
2.  큰 map이면 hash 상위 비트로 table을 고른다.
3.  H1으로 시작 group을 정한다.
4.  group의 control word에서 H2와 같은 control byte를 찾는다.
5.  H2가 같은 slot만 실제 key 비교를 한다.
6.  못 찾고 group 안에 empty가 있으면 조회 실패로 끝난다.
7.  empty가 없으면 probe sequence에 따라 다음 group을 본다.

H2는 7비트뿐이므로 같은 H2를 가진 다른 key가 나올 수 있다. 그래서 H2 매칭은 최종 판정이 아니라 후보 필터다.  
최종 판정은 항상 실제 key 비교로 한다.

## 5\. 충돌 처리 - overflow chain이 아니라 probing

예전 Go map 구현은 한 bucket에 8개 slot을 두고, 더 필요하면 overflow bucket을 체인으로 붙였다. 현재 Swiss map은 기본적으로 open addressing 방식이다. 충돌이 나면 overflow bucket을 붙이는 대신 다음 group들을 탐색한다.

```
groups array

start group
  |
  v
[group 3] -- 못 찾고 empty도 없음 --> [group 4] --> [group 6] --> ...
```

probe sequence는 단순히 바로 다음 group만 보는 선형 탐색이 아니다. 현재 구현은 quadratic probing 계열의 순서를 쓴다.

```
p(i) = (i*i + i)/2 + H1  (mod groupCount)
```

group 개수는 2의 거듭제곱이어야 한다. 이 조건에서 probe sequence는 모든 group을 방문할 수 있다.

lookup이 멈추는 기준은 empty slot이다. 탐색 중 empty slot이 있는 group을 만나면, 그 뒤 probe sequence에는 찾는 key가 없다고 판단할 수 있다. 이 성질 때문에 삭제 처리에서 tombstone이 필요해진다.

## 6\. delete - 항상 tombstone이 되는 것은 아니다

`delete(m, key)`는 key/value를 제거한다. 하지만 control byte를 어떻게 바꾸는지는 상황에 따라 다르다.

현재 구현은 여기서 조금 영리하게 움직인다.

-   삭제 대상이 들어 있는 group 안에 empty slot이 이미 있다면, 삭제된 slot을 그냥 empty로 바꿀 수 있다.
-   그 group이 꽉 차 있었고 probe sequence 중간에 있을 수 있다면, 삭제된 slot을 deleted tombstone으로 표시한다.

왜 tombstone이 필요할까?

open addressing에서는 lookup이 empty slot을 만나면 탐색을 멈춘다. 그런데 probe sequence 중간에 있던 원소를 그냥 empty로 바꿔버리면, 그 뒤쪽에 있는 key를 찾기 전에 탐색이 끊길 수 있다.

```
probe sequence:

group A -> group B -> group C

group B의 slot을 잘못 empty로 바꾸면,
group C에 있는 key를 찾기 전에 탐색이 멈출 수 있다.
```

그래서 probe invariant를 유지해야 하는 경우에는 deleted tombstone을 둔다. tombstone은 나중에 삽입 시 재사용될 수 있고, grow/rehash 과정에서 정리될 수 있다.

현재 구현에는 tombstone을 일부 정리하려는 `pruneTombstones` 경로도 있다. 다만 iterator semantics 때문에 slot을 마음대로 이동시키는 방식의 정리는 제한적이다.

## 7\. 언제 커지는가 - load factor와 growthLeft

Swiss Table은 table을 꽉 채우지 않는다. empty slot이 있어야 lookup 실패를 판정할 수 있기 때문이다.

현재 구현의 일반 table은 평균 최대 load를 group 기준 7/8로 둔다. 즉 8개 slot 중 평균적으로 7개 정도까지 채우는 것을 목표로 한다. 작은 map 최적화처럼 특수한 경로는 별도로 존재하지만, 일반 table의 grow 기준은 7/8로 이해하면 된다.

table 쪽에는 이런 값들이 붙어 있다.

```
type table struct {
    used uint16
    capacity uint16
    growthLeft uint16
    localDepth uint8
    index int
    groups groupsReference
}
```

자주 보는 필드는 이 정도다:

-   `used`: 해당 table에 살아 있는 원소 수
-   `capacity`: slot 총 개수
-   `growthLeft`: grow 없이 더 넣을 수 있는 수
-   `groups`: group 배열

삽입할 때 `growthLeft`가 남아 있으면 새 slot에 넣는다. `growthLeft`가 0이면 tombstone 정리를 먼저 시도하고, 그래도 공간이 부족하면 rehash/grow가 일어난다.

## 8\. 성장 방식 - table grow와 directory split

예전 구현은 `oldbuckets`를 두고 bucket을 조금씩 evacuate했다.

현재 구현은 다르다.

현재 Swiss map은 map 전체를 하나의 거대한 table로만 두지 않는다. 큰 map에서는 directory가 여러 table을 가리키고, hash 상위 비트로 어떤 table을 쓸지 고른다.

```
Map directory

00 -> table A
01 -> table A
10 -> table B
11 -> table C
```

이 방식은 extendible hashing에 가깝다.

table 하나가 커져야 할 때 map 전체를 한 번에 재배치하지 않고, 해당 table만 grow하거나 split할 수 있다. 성장 경로는 크게 두 가지다.

1.  table이 아직 충분히 작으면 더 큰 table로 교체한다.
2.  table이 최대 크기에 도달하면 table을 둘로 split하고 directory를 갱신한다.

현재 Go 1.25 소스에서는 table 최대 capacity가 1024 slot으로 잡혀 있다. 이 값은 런타임 구현 세부사항이며, 버전에 따라 바뀔 수 있다.

차이를 짚으면 이렇다:

-   구 구현: `oldbuckets`와 `nevacuate`로 bucket을 점진적으로 이동
-   현재 구현: table 단위 grow/split + directory로 map 전체 성장 비용을 나눔

따라서 현재 Go map을 설명할 때 `oldbuckets`와 `evacuate`를 중심에 두면 정확하지 않다.

## 9\. iteration - 순서는 보장되지 않는다

map range 순서는 보장되지 않는다. 현재 구현에서도 iteration 시작 위치는 무작위화된다.

```
m := map[string]int{
    "a": 1,
    "b": 2,
    "c": 3,
}

for k, v := range m {
    fmt.Println(k, v)
}
```

출력 순서에 의존하면 안 된다.정렬된 순서가 필요하면 key를 slice로 뽑아서 정렬해야 한다.

```
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)

for _, k := range keys {
    fmt.Println(k, m[k])
}
```

iteration 중 map이 바뀌는 경우도 Go spec이 허용하는 범위 안에서만 생각해야 한다.

-   새로 추가된 entry는 iteration 중 보일 수도 있고 안 보일 수도 있다.
-   삭제된 entry는 아직 반환되지 않았다면 나오지 않을 수 있다.
-   같은 entry가 두 번 나오면 안 된다.

이런 제약 때문에 런타임 map iteration 구현은 꽤 복잡하다.

특히 iteration 도중 table grow/split이 일어나면, iterator는 기존 table을 기준으로 순서를 유지하면서도 최신 값과 삭제 여부를 확인해야 한다.

## 10\. Java HashMap과 비교

Java HashMap과 비교하면 차이가 더 잘 보인다.

Java HashMap, JDK 8 기준:

-   bucket 배열을 사용한다.
-   bucket 안은 처음에 linked list다.
-   한 bucket에 원소가 많이 몰리면 red-black tree로 바뀔 수 있다.
-   resize 때 bucket 배열을 키우고 entry를 재배치한다.

Go map, Go 1.25 기준:

-   Swiss Table 계열 구현이다.
-   group 하나가 8개 slot과 control word를 가진다.
-   control byte로 8개 slot의 후보 여부를 빠르게 좁힌다.
-   충돌은 overflow chain이 아니라 probing으로 처리한다.
-   큰 map은 directory와 여러 table로 나뉠 수 있다.
-   table 단위 grow/split으로 성장 비용을 제한한다.
-   red-black tree 전환은 없다.

둘 다 평균 O(1) 조회/삽입을 노리지만 내부 설계는 상당히 다르다.

## 11\. 예전 Go map 구현 - hmap, bmap, overflow, evacuation

Go map을 검색하면 아직도 다음과 같은 설명이 많이 나온다.

```
type hmap struct {
    count      int
    B          uint8
    buckets    *bmap
    oldbuckets *bmap
}

type bmap struct {
    tophash [8]uint8
    // followed by keys[8], values[8], overflow pointer
}
```

이 모델은 구 구현을 이해하는 데는 맞다. 현재 Go 소스에도 `runtime/map_noswiss.go`에 이런 구현이 남아 있다. 다만 활성화가 필요하고, 기본 빌드에서는 쓰이지 않는다.

구 구현의 큰 특징:

-   bucket 하나에 최대 8개 key/value 쌍을 저장한다.
-   bucket 안에는 `tophash [8]uint8`가 있다.
-   같은 bucket에 8개를 넘게 넣어야 하면 overflow bucket을 체인으로 붙인다.
-   load factor가 커지거나 overflow bucket이 많아지면 grow한다.
-   grow 중에는 `oldbuckets`를 두고 bucket을 점진적으로 evacuate한다.

둘을 나란히 놓으면 이렇게 볼 수 있다.

| 구 구현 | 현재 Swiss map |
| --- | --- |
| `hmap` | `internal/runtime/maps.Map` |
| `bmap` | `group` |
| `tophash` | control byte의 H2 |
| overflow bucket chain | quadratic probing |
| `oldbuckets`, `nevacuate` | table grow/split, directory |
| load factor 약 6.5 entries/bucket | 평균 group load 7/8 |

그래서 블로그나 강의에서 `hmap/bmap/overflow` 설명을 보면 먼저 Go 버전과 빌드 설정을 확인해야 한다.

## 12\. 코드 쓸 때 기억할 것

### 12-1. 동시성

일반 map은 동시 write에 안전하지 않다. 여러 goroutine이 같은 map을 동시에 쓰거나, 한쪽이 읽는 동안 다른 쪽이 쓰면 문제가 된다.

```go
m := map[string]int{}

go func() {
    m["a"] = 1
}()

go func() {
    m["b"] = 2
}()
```

이런 코드는 안전하지 않다. 필요하면 `sync.Mutex`, `sync.RWMutex`, 또는 사용 패턴에 맞는 `sync.Map`을 써야 한다.

```
type Store struct {
    mu sync.RWMutex
    m  map[string]int
}

func (s *Store) Set(k string, v int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}

func (s *Store) Get(k string) (int, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.m[k]
    return v, ok
}
```

### 12-2. nil map

nil map은 읽을 수 있지만 쓸 수 없다.

```
var m map[string]int

fmt.Println(m["x"]) // 0
m["x"] = 1          // panic: assignment to entry in nil map
```

쓰기 전에 `make`가 필요하다.

```
m := make(map[string]int)
m["x"] = 1
```

### 12-3. 큰 key/value 타입

map은 key 비교와 value 저장 비용의 영향을 받는다. 큰 struct를 key로 쓰면 hash와 비교 비용이 커질 수 있다. 큰 struct를 value로 저장하면 대입과 복사 비용이 커질 수 있다.

다만 무조건 포인터가 더 좋은 것은 아니다. 포인터를 쓰면 간접 참조, GC 스캔, 공유 변경 위험이 생긴다. 실무에서는 다음 기준으로 판단하는 편이 낫다.

-   key는 작고 비교가 빠른 타입이 좋다.
-   value가 작고 불변처럼 쓰이면 값 저장이 단순하다.
-   value가 크고 자주 수정되면 포인터 저장을 검토한다.
-   포인터 value는 nil 가능성과 공유 변경을 명확히 관리해야 한다.

### 12-4. capacity hint

원소 수를 어느 정도 알고 있다면 capacity hint를 주는 편이 좋다.

```
usersByID := make(map[int64]User, len(users))
for _, user := range users {
    usersByID[user.ID] = user
}
```

hint는 최종 크기를 보장하는 값이 아니라 초기 할당을 잡는 힌트다.그래도 불필요한 grow를 줄이는 데 꽤 효과가 있다.

### 12-5. 삭제가 많을 때

삭제가 많은 map은 tombstone이나 내부 capacity 때문에 메모리와 탐색 비용이 기대와 다르게 남을 수 있다. 정말 많이 지우고 남은 데이터가 적다면 새 map을 만들어 옮기는 방식이 더 명확할 수 있다.

```
next := make(map[string]Item, len(liveKeys))
for _, k := range liveKeys {
    if v, ok := old[k]; ok {
        next[k] = v
    }
}
old = next
```

## 예제 코드 - map 메모리 관찰

map 내부 group이나 table을 일반 Go 코드에서 직접 안정적으로 들여다보는 것은 좋지 않다.  
대신 메모리 변화는 `runtime.ReadMemStats`, `GODEBUG=gctrace=1`, `pprof`로 관찰할 수 있다.

```go
package main

import (
    "fmt"
    "runtime"
)

func printMemStats(tag string) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)

    fmt.Println("====", tag, "====")
    fmt.Printf("Alloc = %v KB\n", m.Alloc/1024)
    fmt.Printf("TotalAlloc = %v KB\n", m.TotalAlloc/1024)
    fmt.Printf("HeapAlloc = %v KB\n", m.HeapAlloc/1024)
    fmt.Printf("HeapInuse = %v KB\n", m.HeapInuse/1024)
    fmt.Println()
}

func main() {
    printMemStats("start")

    m := make(map[int]int)

    for i := 0; i < 100_000; i++ {
        m[i] = i
    }
    printMemStats("after insert")

    for i := 0; i < 90_000; i++ {
        delete(m, i)
    }
    printMemStats("after delete")

    for i := 100_000; i < 200_000; i++ {
        m[i] = i
    }
    printMemStats("after re-insert")

    runtime.GC()
    printMemStats("after GC")

    _ = m
}
```

실행:

```
GODEBUG=gctrace=1 go run main.go
```

이 코드는 map의 내부 구조를 직접 보여주지는 않는다.하지만 대량 삽입, 삭제, 재삽입이 heap 사용량에 어떤 영향을 주는지 감을 잡는 데 좋다.

## 마무리

Go 1.25 기준 map을 볼 때는 `hmap/bmap/overflow` 그림을 잠깐 내려놓는 편이 낫다. 현재 구현은 `Map -> directory -> table -> group -> slot` 흐름으로 보는 쪽이 훨씬 자연스럽다.

group 하나는 8개 slot과 8바이트 control word를 갖고, hash는 H1/H2로 나뉜다. H1은 table과 group을 찾아가는 데 쓰이고, H2는 group 안에서 후보 slot을 줄이는 데 쓰인다. 충돌은 overflow bucket chain이 아니라 probing으로 처리하고, 성장은 `oldbuckets` evacuation이 아니라 table grow/split과 directory 갱신으로 풀어낸다.

예전 자료에서 보던 `hmap`, `bmap`, `oldbuckets` 설명은 여전히 구 구현을 이해하는 데 쓸모가 있다. 다만 최신 Go map을 설명할 때는 Swiss Table 모델과 분리해서 읽어야 한다.
