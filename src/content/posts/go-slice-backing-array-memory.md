---
title: "[GO] 슬라이싱 유의 사항 - 10바이트가 1MiB를 붙잡는 이유"
description: "1MiB 응답 바디에서 앞 10바이트만 잘라 캐시에 넣었는데 메모리는 거의 줄지 않는다. slice header와 backing array 공유, 3-index slice의 한계, bytes.Clone으로 연결을 끊는 기준을 정리했다."
pubDate: "2026-07-31T21:08:27+09:00"
dateSource: manual
slug: go-slice-backing-array-memory
tags:
  - Go
  - slice
  - memory
  - GC
  - bytes
category: Language/Go
draft: false
---

응답 바디에서 앞부분만 떼어 캐시에 넣는 코드는 자연스럽게 보인다.

```go
preview := body[:10]
cache.Set(key, preview)
```

캐시에 들어가는 값은 10바이트다. 그런데 `body`가 1MiB였다면 실제로는 10바이트만 남는 게 아니다. `preview`가 살아 있는 동안 1MiB짜리 배열도 같이 살아 있다.

슬라이싱은 복사가 아니라 같은 배열을 바라보는 새 창을 만드는 연산이기 때문이다.

## len은 10인데 cap은 1MiB다

아래 코드로 바로 확인할 수 있다.

```go
package main

import (
	"bytes"
	"fmt"
)

// readAll이 1MiB를 읽어왔다고 치자.
func readAll() []byte {
	return make([]byte, 1<<20)
}

func main() {
	big := readAll()

	// 앞 10바이트만 필요해서 잘랐다.
	head := big[:10]
	fmt.Printf("head: len=%d cap=%d\n", len(head), cap(head))

	// 원본 배열과의 연결을 끊는다.
	safe := bytes.Clone(big[:10]) // Go 1.20+
	fmt.Printf("safe: len=%d cap=%d\n", len(safe), cap(safe))

	// bytes.Clone이 없던 시절의 관용구다.
	manual := append([]byte(nil), big[:10]...)
	fmt.Printf("manual: len=%d cap=%d\n", len(manual), cap(manual))

	// 용량까지 정확히 10으로 만들고 싶다면 make와 copy를 쓴다.
	exact := make([]byte, 10)
	copy(exact, big[:10])
	fmt.Printf("exact: len=%d cap=%d\n", len(exact), cap(exact))
}
```

Go 1.25.1에서 실행한 결과다.

```text
head: len=10 cap=1048576
safe: len=10 cap=16
manual: len=10 cap=16
exact: len=10 cap=10
```

`head`의 `len`은 분명 10이다. 인덱스로 접근할 수 있는 범위도 `head[0]`부터 `head[9]`까지다. 그런데 `cap`은 `1048576`, 그대로 1MiB다.

`bytes.Clone`과 `append`의 `cap`이 16인 건 실행 환경의 할당 결과다. 두 방식 모두 결과에 여유 용량이 붙을 수 있으므로 항상 16이라고 기대하면 안 된다. 여기서 봐야 할 건 정확한 `cap` 숫자가 아니라 **1MiB 원본과 분리된 새 배열을 가리킨다**는 점이다.

## 슬라이스에는 배열이 들어 있지 않다

슬라이스는 배열 자체가 아니다. 개념적으로 다음 세 값을 가진 작은 descriptor다.

```text
slice
  pointer  -> 이 슬라이스에서 첫 번째로 보이는 원소
  len      -> 현재 접근할 수 있는 원소 수
  cap      -> 그 원소부터 backing array 끝까지 확장할 수 있는 범위
```

`head := big[:10]`을 실행해도 10바이트를 새 메모리에 옮기지 않는다. `big`과 같은 backing array를 가리키는 slice header 하나만 생긴다.

```text
big  ─────┐
          ▼
       [ 1MiB backing array ]
          ▲
head ─────┘  len=10, cap=1MiB
```

복사가 없으니 슬라이싱은 싸다. `head[0]`을 바꾸면 `big[0]`도 바뀌는 이유도 같다. 둘은 서로 다른 배열이 아니라 같은 저장 공간을 보고 있다.

이 특성이 수명에서는 반대로 작용한다. 캐시나 구조체 필드에 `head`를 저장하면 backing array로 가는 참조가 남는다. GC는 그 배열의 앞 10바이트만 따로 회수할 수 없다. 배열 전체가 도달 가능한 객체라서 1MiB 할당을 그대로 남긴다.

`big = nil`로 바꿔도 해결되지 않는다. 변수 `big`의 참조만 지울 뿐, `head`가 같은 배열을 계속 가리키고 있기 때문이다.

## cap만 10으로 줄이면 해결될까

Go에는 세 번째 인덱스로 용량을 제한하는 full slice expression이 있다.

```go
tight := big[:10:10]
fmt.Println(len(tight), cap(tight)) // 10 10
```

겉으로 보면 해결된 것 같다. `cap`도 10이 됐다.

하지만 `tight`도 여전히 `big`의 backing array를 가리킨다. 세 번째 인덱스는 새 배열을 만들지 않는다. `append`가 원본의 11번째 바이트부터 덮어쓰지 못하도록 확장 범위만 제한한다.

```go
tight := big[:10:10]
tight = append(tight, 1) // cap이 부족하므로 여기서 새 배열을 할당한다.
```

`append` 이후에는 새 배열로 분리되지만, 그전까지 `tight` 하나만 오래 보관해도 1MiB는 남아 있다.

정리하면 두 문제는 다르다.

- `big[:10:10]`: append가 원본 배열의 나머지 영역을 덮어쓰는 일을 막는다.
- `bytes.Clone(big[:10])`: 원본 배열과의 참조를 끊어 수명을 분리한다.

`cap`은 backing array를 공유하고 있다는 단서가 될 수는 있어도, `cap`만 줄인다고 메모리 보유 문제가 사라지는 건 아니다.

## 응답 바디 캐시에서 어떻게 커지는가

다음과 같은 코드가 위험하다.

```go
type PreviewCache struct {
	items map[string][]byte
}

func (c *PreviewCache) Put(key string, body []byte) {
	c.items[key] = body[:10]
}
```

서로 다른 요청에서 1MiB 응답을 읽고 앞 10바이트씩 10,000개 저장했다고 해보자.

캐시가 필요로 한 데이터는 `10 × 10,000 = 100,000`바이트, 약 98KiB다. 하지만 각 조각이 서로 다른 1MiB 배열을 붙잡으면 backing array만 약 9.77GiB가 남는다. 맵과 할당자 오버헤드를 빼고도 이 정도다.

트래픽이 늘수록 RSS가 천천히 오르는데 캐시 엔트리 크기를 합쳐보면 설명이 안 되는 패턴이 나온다. 프로파일에서는 큰 `ReadAll` 할당이 계속 살아 있는 것처럼 보인다. 할당한 곳은 읽기 코드지만, 수명을 늘린 곳은 `body[:10]`을 저장한 캐시다.

복사해서 넣으면 수명 관계가 끊어진다.

```go
func (c *PreviewCache) Put(key string, body []byte) {
	c.items[key] = bytes.Clone(body[:10])
}
```

이제 캐시는 작은 새 배열만 붙든다. `body`를 가리키는 다른 참조가 없다면 1MiB 원본은 GC 대상이 된다.

## 무조건 복사해야 하는 건 아니다

슬라이싱이 backing array를 공유하는 건 버그가 아니라 성능 특성이다. 바로 소비하고 버리는 코드라면 복사하지 않는 편이 낫다.

```go
func handle(body []byte) {
	parseHeader(body[:10]) // 호출 안에서만 쓰고 끝난다면 굳이 복사할 이유가 없다.
}
```

복사에는 새 할당과 데이터 복사 비용이 든다. 1MiB 중 10바이트만 오래 보관하는 상황에서는 아주 싼 대가지만, 원본과 거의 같은 크기를 잠깐 쓸 뿐이라면 이득이 없다.

판단 기준은 크기와 수명이다.

- 부분 슬라이스가 함수 안에서 잠깐 쓰이고 끝나는가
- 원본보다 훨씬 작은 조각이 캐시, 큐, 채널, 구조체 필드로 빠져나가는가
- 원본 버퍼가 크거나 풀에서 빌린 메모리인가
- 부분 슬라이스의 수명이 원본보다 길어지는가

작은 조각이 긴 수명을 갖는 경계에서 복사한다. `bytes.Clone`은 그 의도를 코드에 가장 직접적으로 남긴다.

## 마무리

`len=10`은 이 슬라이스를 통해 볼 수 있는 범위가 10바이트라는 뜻이지, 메모리도 10바이트만 소유한다는 뜻이 아니다.

슬라이싱은 복사하지 않는다. 부분 슬라이스가 오래 살아남으면 원본 backing array도 같이 살아남는다. `big[:10:10]`으로 `cap`을 줄여도 공유 관계는 그대로다.

응답 바디처럼 큰 버퍼에서 작은 조각만 캐시하거나 반환해야 한다면 수명을 한 번 더 봐야 한다. 원본보다 오래 남는다면 `bytes.Clone`이나 `make` + `copy`로 연결을 끊는다.
