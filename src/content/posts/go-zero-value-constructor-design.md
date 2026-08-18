---
title: "[GO] New 함수를 만들기 전에 제로값부터 설계해야 하는 이유"
description: "sync.Mutex와 bytes.Buffer는 생성자 없이 바로 쓸 수 있다. 반면 repository와 transaction이 빠진 PostService는 정상 상태가 아니다. Go 타입을 설계할 때 제로값으로 충분한 경우와 New 함수가 필요한 경계를 정리했다."
pubDate: "2026-08-01T19:40:00+09:00"
dateSource: manual
slug: go-zero-value-constructor-design
tags:
  - Go
  - zero-value
  - constructor
  - design
  - dependency-injection
category: Language/Go
draft: true
---

자바를 오래 쓰고 Go 코드를 보면 생성자가 없는 타입이 먼저 어색하다.

```go
var mu sync.Mutex
mu.Lock()
mu.Unlock()
```

`new Mutex()`도, `NewMutex()`도 없다. 선언만 했는데 바로 잠글 수 있다.

처음에는 Go가 초기화를 느슨하게 다루는 언어처럼 보였다. 실제로는 반대에 가깝다. `sync.Mutex`는 초기화가 필요 없는 게 아니라, **제로값 자체가 올바른 초기 상태가 되도록 설계된 타입**이다.

이 차이를 알고 나니 `NewX`를 만들지 말아야 할 때와 반드시 만들어야 할 때가 나뉘기 시작했다.

## 제로값은 타입 API의 일부다

Go에서 변수를 선언하면 항상 해당 타입의 제로값을 얻는다.

```go
var enabled bool   // false
var count int      // 0
var name string    // ""
var items []string // nil
var user *User     // nil
```

구조체도 모든 필드가 각 타입의 제로값으로 채워진다.

```go
type Counter struct {
	mu sync.Mutex
	n  int64
}

var c Counter
```

여기서 `c.mu`는 잠기지 않은 뮤텍스이고 `c.n`은 0이다. 둘 다 `Counter`가 시작하기에 자연스러운 상태다.

```go
func (c *Counter) Inc() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
}

func (c *Counter) Value() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}
```

사용자는 초기화 순서를 외울 필요가 없다.

```go
var c Counter
c.Inc()
fmt.Println(c.Value()) // 1
```

제로값으로 바로 쓸 수 있다는 말이 복사해도 안전하다는 뜻은 아니다. `sync.Mutex`는 처음 사용한 뒤 복사하면 안 된다. `Counter`도 포인터 리시버로 사용하고, 맵이나 함수 반환 과정에서 값 복사가 일어나지 않게 다뤄야 한다.

`bytes.Buffer`도 같은 방향으로 설계되어 있다.

```go
var buf bytes.Buffer
buf.WriteString("hello")
fmt.Println(buf.String()) // hello
```

빈 버퍼가 곧 유효한 시작 상태다. 내부 저장 공간은 실제로 쓸 때 필요해진다.

이런 타입에 다음 생성자를 추가해도 기능은 늘지 않는다.

```go
func NewCounter() *Counter {
	return &Counter{}
}
```

호출 방법만 하나 더 생긴다. `var c Counter`, `&Counter{}`, `NewCounter()` 중 무엇을 써야 하는지 팀이 고민해야 하지만 세 방식이 만드는 초기 상태는 같다.

## new(T)와 NewT는 전혀 다른 일이다

Go의 내장 함수 `new`는 생성자를 호출하지 않는다.

```go
c := new(Counter)
```

이 코드는 `Counter`의 제로값을 담을 공간을 할당하고 `*Counter`를 반환할 뿐이다. 사용자 정의 초기화 로직이 끼어들지 않는다.

반면 `NewCounter`나 `NewPostService`는 언어 기능이 아니다. 패키지가 제공하는 평범한 함수이자 이름 관례다.

```go
func NewPostService(...) *PostService {
	// 검증과 조립을 직접 작성한다.
}
```

자바의 생성자와 이름이 비슷한 역할을 할 수는 있지만, Go 컴파일러가 `New`에 특별한 의미를 부여하지 않는다.

## New 함수는 정상 상태를 조립할 때 필요하다

모든 타입이 제로값만으로 유용할 수는 없다.

```go
type PostService struct {
	posts PostRepository
	tx    Transactor
}
```

`PostService{}`의 두 필드는 모두 `nil`이다. 이 상태에서 메서드를 호출하면 서비스가 일을 할 수 없거나, 더 나쁘면 요청 처리 중간에 nil pointer panic이 난다.

이 타입에는 `NewPostService`가 필요하다.

```go
var ErrNilDependency = errors.New("post service dependency is nil")

func NewPostService(
	posts PostRepository,
	tx Transactor,
) (*PostService, error) {
	if posts == nil || tx == nil {
		return nil, ErrNilDependency
	}

	return &PostService{
		posts: posts,
		tx:    tx,
	}, nil
}
```

생성 함수가 하는 일은 메모리 할당이 아니다.

- 필수 의존성을 받는다.
- 값의 조합이 유효한지 검사한다.
- 호출자가 내부 필드 구성을 몰라도 되게 감춘다.
- 정상적으로 만들어진 인스턴스가 지켜야 할 불변식을 한곳에 모은다.

repository나 transaction처럼 없으면 동작 자체가 성립하지 않는 값은 옵션이 아니다. 생성 시점에 받는 편이 낫다.

## 생성 함수만 만들면 잘못된 생성이 완전히 막힐까

여기서 한계가 하나 있다.

```go
svc, err := NewPostService(posts, tx) // 권장 경로
```

생성 함수를 제공해도 `PostService` 타입을 export했다면 같은 패키지 안에서는 언제든 `PostService{}`를 만들 수 있다. 외부 패키지에서도 타입의 공개 형태에 따라 제로값 선언이 가능하다.

`NewPostService`는 자바 생성자처럼 모든 생성 경로를 언어 차원에서 가로채지 않는다. 관례를 더 강하게 만들고 싶다면 선택지가 있다.

- 필드를 unexported로 두어 외부에서 임의 조립하지 못하게 한다.
- concrete type 자체를 unexported로 두고 생성 함수가 필요한 인터페이스를 반환한다.
- 메서드 진입점에서도 필수 상태를 확인해 실패 원인을 가깝게 남긴다.
- 가능하다면 잘못된 상태를 표현할 수 없는 더 작은 값 타입으로 나눈다.

무조건 concrete type을 숨기는 것도 답은 아니다. 테스트와 디버깅이 불편해질 수 있고, 불필요한 인터페이스가 하나 더 생길 수도 있다. 생성 실패가 실제로 어떤 사고를 만드는지 보고 경계를 정해야 한다.

그리고 `posts == nil` 검사만으로 typed nil까지 잡을 수 있는 건 아니다. `(*PostgresRepo)(nil)`이 인터페이스 안에 들어오면 인터페이스 자체는 nil이 아니다. 이 문제는 생성자보다 인터페이스 값의 표현과 관련된 별도 함정이다.

## 제로값이 유용하다는 말도 설계 결정이다

구조체 필드가 모두 제로값을 가진다고 해서 그 구조체가 자동으로 잘 설계되는 것은 아니다.

```go
type RetryPolicy struct {
	MaxAttempts int
	Delay       time.Duration
}
```

`MaxAttempts == 0`을 어떻게 해석할지 먼저 정해야 한다.

- 재시도하지 않는 유효한 정책인가
- 제한 없이 재시도한다는 뜻인가
- 아직 초기화되지 않은 잘못된 상태인가

셋 중 무엇이든 가능하다. 타입이 그 의미를 정하지 않으면 호출자마다 다르게 해석한다.

제로값 설계는 단순히 생성자를 생략하는 기법이 아니다. 값이 비어 있을 때도 의미가 하나로 정해지게 만드는 작업이다.

`nil` 슬라이스도 좋은 예다. 읽기와 `len`, `range`, `append`가 정상적으로 동작하므로 “항목이 없음”이라는 상태를 자연스럽게 표현한다. 반대로 반드시 하나 이상의 값이 있어야 하는 타입이라면 슬라이스 필드의 제로값은 불변식을 만족하지 못한다.

## 판단 기준

| 질문 | 제로값 사용 | New 함수 고려 |
|---|---|---|
| 빈 상태가 정상적인 시작인가 | 예 | 아니오 |
| 첫 사용까지 자원 할당을 미뤄도 되는가 | 예 | 상황에 따라 |
| 필수 의존성이 있는가 | 아니오 | 예 |
| 여러 필드 사이 불변식을 검사해야 하는가 | 아니오 | 예 |
| 기본값의 의미가 하나로 명확한가 | 예 | 불명확하면 필요 |

`Counter`는 0부터 세면 된다. `bytes.Buffer`는 비어 있으면 된다. 이런 타입은 제로값이 가장 짧고 안전한 생성 경로다.

`PostService`는 repository와 transaction이 없으면 서비스가 아니다. 이런 타입의 `New`는 편의 함수가 아니라 정상 상태를 조립하는 경계다.

새 타입을 만들 때 습관적으로 `NewX`부터 추가하지 않는다. 먼저 `var x T`가 무엇을 뜻해야 하는지 정한다. 그 상태가 유효하다면 제로값으로 두고, 유효하게 만들기 위해 반드시 받아야 할 값이 있을 때 생성 함수를 둔다.
