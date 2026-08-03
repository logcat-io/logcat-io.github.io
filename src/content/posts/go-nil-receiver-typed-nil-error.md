---
title: "[GO] nil 리시버는 호출되는데 error는 nil이 아니다 - typed nil 함정"
description: "nil 포인터로 메서드를 호출하는 것은 가능하지만, 그 포인터가 error 인터페이스에 들어가면 error != nil이 된다. 메서드 호출 시점의 역참조와 인터페이스의 동적 타입·값을 분리해 typed nil 버그를 정리했다."
pubDate: "2026-08-03T19:43:00+09:00"
dateSource: manual
slug: go-nil-receiver-typed-nil-error
tags:
  - Go
  - interface
  - nil
  - error
  - typed-nil
category: Language/Go
draft: false
---

Go의 nil을 공부하다 보면 서로 반대처럼 보이는 두 문장을 만난다.

- nil 포인터에서도 메서드를 호출할 수 있다.
- nil 포인터를 `error`에 넣으면 그 에러는 nil이 아니다.

둘 다 맞다.

첫 번째는 메서드 호출이 언제 포인터를 역참조하는지에 관한 문제다. 두 번째는 인터페이스 값이 동적 타입과 동적 값을 함께 가진다는 문제다. `nil`이라는 단어만 같을 뿐 확인하는 층이 다르다.

## nil 리시버 호출 자체는 panic이 아니다

연결 리스트 길이를 재귀로 계산하는 예제를 보자.

```go
package main

import "fmt"

type Node struct {
	next *Node
}

func (n *Node) Len() int {
	if n == nil {
		return 0
	}
	return 1 + n.next.Len()
}

func main() {
	var empty *Node
	fmt.Println(empty.Len()) // 0
}
```

`empty`는 nil인데 `Len` 호출은 정상적으로 메서드 안까지 들어간다. receiver를 첫 번째 인자처럼 생각하면 이해하기 쉽다.

```go
(*Node).Len(empty)
```

이 표현은 메서드 호출을 이해하기 위한 등가 형태다. nil 값도 `*Node` 타입의 값이므로 함수에 전달될 수 있다.

panic은 호출 자체가 아니라 nil 포인터가 가리키는 필드에 접근할 때 발생한다.

```go
func (n *Node) UnsafeLen() int {
	return 1 + n.next.UnsafeLen()
}

var empty *Node
empty.UnsafeLen() // n.next를 평가하는 순간 panic
```

메서드가 먼저 `n == nil`을 검사하면 nil을 종료 조건이나 빈 상태로 다룰 수 있다.

그렇다고 모든 포인터 리시버가 nil을 지원해야 하는 것은 아니다. `(*PostService)(nil).Publish()`처럼 nil이 정상 상태가 아닌 타입까지 억지로 허용하면 초기화 버그가 늦게 드러난다. nil이 도메인에서 의미 있는 상태일 때만 계약으로 삼는 편이 낫다.

## error는 인터페이스다

Go의 `error`는 다음 메서드 하나를 요구하는 인터페이스다.

```go
type error interface {
	Error() string
}
```

인터페이스 값은 개념적으로 두 정보를 가진다.

```text
(dynamic type, dynamic value)
```

인터페이스가 `nil`과 같으려면 둘 다 없어야 한다.

```go
var err error
fmt.Println(err == nil) // true
```

현재 `err`에는 동적 타입도, 동적 값도 없다.

## nil 포인터를 넣는 순간 동적 타입이 생긴다

구체 에러 타입을 하나 만들자.

```go
type ValidationError struct {
	field string
}

func (e *ValidationError) Error() string {
	if e == nil {
		return "<nil ValidationError>"
	}
	return "invalid field: " + e.field
}
```

포인터 값은 nil일 수 있다.

```go
var validationErr *ValidationError
fmt.Println(validationErr == nil) // true
```

이 값을 `error` 인터페이스에 넣으면 상태가 달라진다.

```go
var err error = validationErr
fmt.Println(err == nil) // false
fmt.Println(err)        // <nil ValidationError>
```

두 값을 나눠 보면 이유가 보인다.

```text
validationErr: (*ValidationError, nil 포인터)
err:           (dynamic type = *ValidationError, dynamic value = nil)
```

`err`의 동적 값은 nil이지만 동적 타입 `*ValidationError`가 남아 있다. `(nil, nil)`이 아니므로 인터페이스는 nil이 아니다.

여기에는 “과거에 한 번 타입이 들어갔는가” 같은 이력은 관계없다. 현재 값만 본다.

```go
err = nil
fmt.Println(err == nil) // true
```

명시적으로 nil을 대입하면 동적 타입과 값이 모두 없는 인터페이스가 된다.

## 가장 흔한 버그는 반환 타입 경계에서 생긴다

다음 함수는 문제가 없어 보인다.

```go
func validatePost() *ValidationError {
	return nil
}
```

호출 결과를 같은 구체 타입으로 받으면 실제로 문제없다.

```go
validationErr := validatePost()
fmt.Println(validationErr == nil) // true
```

하지만 `error`를 반환하는 함수에서 그대로 넘기면 typed nil이 만들어진다.

```go
func publish() error {
	return validatePost()
}

err := publish()
fmt.Println(err == nil) // false
```

`publish`의 반환 지점에서 `*ValidationError`가 `error`로 변환된다. 포인터 값은 nil이지만 동적 타입이 채워진다.

호출 코드는 에러 경로로 들어간다.

```go
if err := publish(); err != nil {
	return fmt.Errorf("publish post: %w", err)
}
```

실패가 없었는데 실패로 처리된다. HTTP handler라면 500 응답을 내릴 수 있고, worker라면 성공한 작업을 재시도할 수도 있다.

구체 에러를 따로 만드는 API를 유지해야 한다면 반환 전에 nil을 분리한다.

```go
func publish() error {
	validationErr := validatePost()
	if validationErr != nil {
		return validationErr
	}
	return nil
}
```

더 단순한 방법은 하위 함수부터 `error`를 반환하고 성공을 명시적인 `nil`로 표현하는 것이다.

```go
func validatePost() error {
	if valid {
		return nil
	}
	return &ValidationError{field: "title"}
}
```

에러가 없을 때는 `return nil`이다. `(*ValidationError)(nil)`을 `error`로 변환해서 반환하지 않는다.

## nil-safe Error 메서드는 해결책이 아니다

앞의 `Error` 메서드는 nil을 검사하므로 다음 출력이 panic 없이 끝났다.

```go
fmt.Println(err)
```

이건 로깅 과정의 panic을 막았을 뿐이다. `err != nil`이라는 판단은 바뀌지 않는다.

```go
if err != nil {
	// 여전히 이 분기로 들어온다.
}
```

nil-safe receiver를 구현했다고 typed nil이 “에러 없음”으로 바뀌지는 않는다. `Error()`가 호출 가능하다는 사실과 인터페이스 비교 결과는 별개다.

오히려 nil을 검사하지 않는 구현은 포맷팅이나 로깅 중에 panic을 만들 수 있다.

```go
func (e *ValidationError) Error() string {
	return "invalid field: " + e.field // e가 nil이면 panic 가능
}
```

가장 안전한 해결은 typed nil 에러를 만들지 않는 것이다.

## 생성자에서 interface == nil만 검사해도 놓칠 수 있다

typed nil은 `error`에만 생기는 현상이 아니다. 모든 인터페이스에 같은 규칙이 적용된다.

```go
type PostRepository interface {
	Save(Post) error
}

var postgres *PostgresRepo
var posts PostRepository = postgres

fmt.Println(postgres == nil) // true
fmt.Println(posts == nil)    // false
```

생성 함수가 다음 검사만 한다면 typed nil은 통과한다.

```go
func NewPostService(posts PostRepository) (*PostService, error) {
	if posts == nil {
		return nil, errors.New("posts is nil")
	}
	return &PostService{posts: posts}, nil
}
```

모든 인터페이스 인자를 reflection으로 검사하는 방식도 가능하지만 보통은 API를 더 복잡하게 만든다. 구현 생성 함수가 nil 포인터를 성공값처럼 반환하지 않게 하고, 조립 코드에서 구체 포인터를 확인한 뒤 인터페이스로 넘기는 편이 단순하다.

```go
repo, err := postgres.NewRepository(db)
if err != nil {
	return err
}
if repo == nil {
	return errors.New("postgres repository is nil")
}

service, err := NewPostService(repo)
```

정상 생성 경로에서 nil 구현체가 나올 수 없다면 이 추가 검사도 필요 없다. 먼저 구현의 반환 계약을 단단하게 만드는 쪽이 낫다.

## nil을 볼 때 타입까지 같이 본다

nil 관련 코드는 값 하나만 보면 헷갈린다.

```text
var p *T = nil       -> nil 포인터
var i any = nil      -> nil 인터페이스: (nil, nil)
var i any = p        -> typed nil: (*T, nil)
```

nil 포인터 receiver의 메서드는 내부에서 역참조하기 전까지 호출할 수 있다. 반면 그 포인터가 인터페이스에 들어가면 동적 타입이 생겨 인터페이스는 nil이 아니게 된다.

`error` 없음은 `(동적 타입 없음, 동적 값 없음)`이어야 한다. 성공 경로에서는 구체 에러 포인터의 nil을 반환하지 말고 인터페이스 nil인 `return nil`을 반환한다.
