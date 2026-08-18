---
title: "[GO] p.Publish()는 되는데 Publisher = p는 왜 컴파일되지 않을까"
description: "포인터 리시버 메서드는 값 변수에서 직접 호출할 수 있지만 같은 값을 인터페이스에는 넣을 수 없다. addressable 값에 대한 호출 보정과 method set 검사가 서로 다른 규칙인 이유를 상태 변경 예제로 정리했다."
pubDate: "2026-08-01T19:42:00+09:00"
dateSource: manual
slug: go-method-set-addressable-interface-assignment
tags:
  - Go
  - interface
  - method-set
  - pointer
  - receiver
category: Language/Go
draft: true
---

다음 두 줄은 같은 규칙을 따를 것처럼 보인다.

```go
var p Post
p.Publish()

var publisher Publisher = p
```

`p.Publish()`가 된다면 `p`는 `Publish` 메서드를 가진 타입 아닌가. 그런데 두 번째 줄은 컴파일되지 않는다.

```text
cannot use p (variable of struct type Post) as Publisher value:
    Post does not implement Publisher (method Publish has pointer receiver)
```

직접 메서드를 호출할 때는 컴파일러가 주소를 보정해주지만, 인터페이스 만족 여부는 타입의 method set만 보기 때문이다.

이 둘을 같은 규칙으로 기억하면 포인터 리시버가 나올 때마다 헷갈린다.

## 재현 코드

```go
package main

import "fmt"

type Publisher interface {
	Publish()
}

type Post struct {
	published bool
}

func (p *Post) Publish() {
	p.published = true
}

func main() {
	var p Post

	p.Publish()
	fmt.Println(p.published) // true

	var publisher Publisher = p // compile error
	_ = publisher
}
```

`Publish`의 receiver는 `*Post`다. 원래대로라면 `Post` 값인 `p`에서 호출할 수 없어야 할 것 같은데 첫 호출은 정상 동작한다.

## 직접 호출에서는 addressable 값을 보정한다

변수 `p`는 주소를 취할 수 있는 addressable 값이다.

```go
&p
```

이런 값에서 포인터 리시버 메서드를 호출하면 Go는 다음 두 표현을 같은 의미로 다룬다.

```go
p.Publish()
(&p).Publish()
```

`p`가 실제로 `Publish`를 가진 게 아니다. 메서드 호출 표현식에서 주소를 취할 수 있으니 `&p`의 method set까지 확인해 짧게 쓸 수 있게 해준 것이다.

모든 값에 이 보정이 적용되지는 않는다. 주소를 취할 수 없는 값에서는 실패한다.

```go
func loadPost() Post {
	return Post{}
}

loadPost().Publish() // cannot call pointer method on loadPost()
```

함수 반환값은 호출이 끝난 뒤에도 수정된 값을 다시 관찰할 저장 위치가 없다.

맵 원소도 addressable하지 않다.

```go
posts := map[int64]Post{
	1: {},
}

posts[1].Publish() // cannot call pointer method on posts[1]
```

맵은 성장하면서 원소 위치를 옮길 수 있다. 맵 내부 원소의 안정적인 주소를 노출하지 않기 때문에 포인터 리시버를 직접 호출할 수 없다.

수정해야 한다면 값을 꺼내 다시 넣거나 처음부터 포인터를 저장한다.

```go
p := posts[1]
p.Publish()
posts[1] = p

// 또는
pointerPosts := map[int64]*Post{
	1: &Post{},
}
pointerPosts[1].Publish()
```

## 인터페이스 할당은 method set을 그대로 검사한다

인터페이스에 값을 넣을 때는 주소 보정 규칙이 없다.

```go
var publisher Publisher = p
```

컴파일러는 `p`가 addressable한 변수인지보다 `Post`라는 타입이 `Publisher`를 만족하는지 검사한다.

method set 규칙은 다음과 같다.

| 타입 | method set에 포함되는 메서드 |
|---|---|
| `T` | receiver가 `T`인 메서드 |
| `*T` | receiver가 `T` 또는 `*T`인 메서드 |

`Publish`의 receiver는 `*Post`이므로 결과는 이렇게 갈린다.

```go
var _ Publisher = Post{}          // 실패
var _ Publisher = (*Post)(nil)    // 통과
```

실제 값도 포인터로 넣어야 한다.

```go
var publisher Publisher = &p
publisher.Publish()
fmt.Println(p.published) // true
```

## 왜 인터페이스 할당에서도 알아서 &p를 넣지 않을까

컴파일러가 다음 코드를 자동으로 바꿔준다고 가정해보자.

```go
var publisher Publisher = p
```

```go
var publisher Publisher = &p
```

간단한 지역 변수에서는 편해 보인다. 하지만 값은 변수에서만 오지 않는다.

```go
func newPost() Post {
	return Post{}
}

var publisher Publisher = newPost()
```

반환값에는 호출자가 명시한 포인터가 없다. 컴파일러가 숨은 복사본을 만들고 그 주소를 인터페이스에 넣어야 한다. 그러면 `Publish`가 바꾸는 대상은 원래 값이 아니라 컴파일러가 만든 별도 값이 된다.

맵 원소, 함수 반환값, 다른 인터페이스에서 꺼낸 값마다 복사와 수명 규칙도 달라질 수 있다. Go는 이 변환을 암묵적으로 만들지 않고 포인터가 필요하다는 사실을 코드에 남기게 한다.

```go
p := newPost()
var publisher Publisher = &p
```

어느 값을 공유하고 수정하는지 분명하다.

## 값 리시버라면 값과 포인터가 모두 들어간다

상태를 바꾸지 않는 작은 값 타입은 값 리시버를 쓸 수 있다.

```go
type Slug string

func (s Slug) String() string {
	return string(s)
}
```

`String`은 `Slug`의 method set에도, `*Slug`의 method set에도 포함된다.

```go
var _ fmt.Stringer = Slug("go-method-set")
var _ fmt.Stringer = new(Slug)
```

값 리시버는 호출할 때 receiver 값을 복사한다. 구조체가 크거나, 내부 상태를 바꾸거나, `sync.Mutex`처럼 복사하면 안 되는 필드가 있다면 포인터 리시버가 맞다.

한 타입에서 일부 메서드는 값, 일부는 포인터 리시버로 섞으면 인터페이스 만족 범위가 메서드 조합에 따라 달라진다. 특별한 이유가 없다면 한 타입의 receiver 방식을 일관되게 유지하는 편이 읽기 쉽다.

## 컴파일 타임에 확인하는 방법

구현 타입 근처나 두 패키지를 함께 아는 wiring test에 컴파일 타임 검사를 둘 수 있다.

```go
var _ Publisher = (*Post)(nil)
```

코드를 실행하지 않는다. `*Post`가 `Publisher`를 만족하지 못하면 빌드가 실패한다.

다만 구현 패키지가 소비자 인터페이스를 몰라야 하는 구조라면 이 선언 때문에 의존성을 거꾸로 만들면 안 된다. 그런 경우에는 `main`이나 조립 테스트처럼 원래 두 타입을 모두 아는 곳에 둔다.

암묵적 인터페이스 구현과 패키지 의존성은 이전 글인 [implements가 없는데 의존성이 뒤집힌다](/posts/go-implicit-interface-dependency-inversion/)에서 따로 다뤘다. 이 글에서 기억할 경계는 더 작다.

- `p.Publish()`는 addressable한 값에 대한 메서드 호출 보정이다.
- `var publisher Publisher = p`는 `Post`의 method set 검사다.
- 포인터 리시버만 있다면 인터페이스에도 `&p`를 넣는다.

직접 호출이 된다는 사실만으로 값 타입이 그 인터페이스를 구현한다고 판단하면 안 된다.
