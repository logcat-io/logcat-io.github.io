---
title: "[GO] 임베딩은 상속이 아니다 - Base 메서드는 Derived를 다시 호출하지 않는다"
description: "Go의 임베딩은 메서드를 승격하지만 가상 메서드 디스패치를 만들지 않는다. Derived에서 같은 이름의 메서드를 정의해도 Base.Process 내부 호출은 바뀌지 않는 이유와, 바뀌는 동작을 인터페이스로 주입하는 기준을 정리했다."
pubDate: "2026-08-01T19:41:00+09:00"
dateSource: manual
slug: go-embedding-is-not-inheritance
tags:
  - Go
  - embedding
  - composition
  - interface
  - design
category: Language/Go
draft: true
---

Go 구조체에 다른 타입을 이름 없이 넣으면 바깥 타입에서 안쪽 메서드를 바로 호출할 수 있다.

```go
type Base struct{}

func (Base) Greet() {
	fmt.Println("hello")
}

type Derived struct {
	Base
}

func main() {
	d := Derived{}
	d.Greet()
}
```

겉모양만 보면 상속과 비슷하다. `Derived`가 `Base`의 메서드를 물려받은 것처럼 보인다.

여기서 자바식 기대를 하나 더 얹으면 바로 어긋난다. `Derived`에 같은 이름의 메서드를 만들면 `Base` 내부에서도 그 메서드가 동적으로 호출될 것이라는 기대다.

Go 임베딩에는 그런 가상 메서드 디스패치가 없다.

## 호출 결과부터 확인해보자

```go
package main

import "fmt"

type Base struct{}

func (b Base) Process() {
	fmt.Println("process start")
	b.step()
}

func (Base) step() {
	fmt.Println("Base.step")
}

type Derived struct {
	Base
}

func (Derived) step() {
	fmt.Println("Derived.step")
}

func main() {
	d := Derived{}
	d.Process()
	d.step()
}
```

실행 결과는 다음과 같다.

```text
process start
Base.step
Derived.step
```

`d.step()`은 `Derived.step`을 호출한다. 하지만 `d.Process()` 안에서는 `Base.step`이 호출된다.

`b`의 정적 타입은 처음부터 끝까지 `Base`다. 바깥에 어떤 타입이 `Base`를 임베딩했는지는 `Process`가 알지 못한다.

## d.Process()는 승격된 메서드 호출이다

`Derived`가 `Process`를 새로 가진 게 아니다. 임베딩된 필드의 메서드가 바깥 타입의 selector에서 **promoted method**로 보일 뿐이다.

```go
d.Process()
```

이 호출은 개념적으로 다음 호출의 짧은 형태다.

```go
d.Base.Process()
```

`Process`가 받는 receiver도 `Derived`가 아니라 `d.Base`다.

```text
Derived d
└── Base field ──> Base.Process(Base receiver)
                         └── Base.step()
```

상속 언어의 `this`가 실제 하위 객체를 가리키고 override된 메서드를 찾는 구조와 다르다. `Base.Process`는 `Derived`를 모르며, 다시 바깥 객체로 올라가 메서드를 탐색하지도 않는다.

## 같은 이름의 메서드는 override가 아니라 가림이다

`Derived`가 직접 `Process`를 정의할 수는 있다.

```go
func (d Derived) Process() {
	fmt.Println("Derived.Process")
}
```

이제 `d.Process()`는 `Derived.Process`를 호출한다. 그렇다고 `Base.Process`가 대체된 것은 아니다.

```go
d.Process()      // Derived.Process
d.Base.Process() // Base.Process
```

바깥 타입에 더 가까운 이름이 selector에서 선택된 것이다. 임베딩된 필드는 여전히 별도 값이고 그 메서드도 그대로 남아 있다.

필드도 같은 방식으로 동작한다.

```go
type Base struct {
	Name string
}

func (b Base) Greet() {
	fmt.Println("hello,", b.Name)
}

type Derived struct {
	Base
	Name string
}

d := Derived{
	Base: Base{Name: "Base"},
	Name: "Derived",
}

d.Greet() // hello, Base
```

`Derived.Name`이 있어도 `Base.Greet`의 `b.Name`은 `Base.Name`이다. 두 필드는 같은 슬롯을 override하는 관계가 아니다.

## Template Method를 그대로 옮기면 깨진다

상속 기반 코드에서는 부모가 흐름을 잡고 일부 단계를 하위 클래스가 바꾸는 Template Method 패턴을 자주 쓴다.

```go
func (b Base) Process() {
	b.validate()
	b.step() // 자식이 바꿔주길 기대
	b.finish()
}
```

Go에서 `Derived.step`을 추가해도 `Base.Process`의 호출 대상은 바뀌지 않는다. 코드는 컴파일되고 실행도 되므로 더 위험하다. 확장 지점이 동작한다고 생각했는데 늘 기본 구현만 실행될 수 있다.

바뀌어야 하는 동작은 명시적인 의존성으로 만든다.

```go
type Stepper interface {
	Step()
}

type Processor struct {
	stepper Stepper
}

func NewProcessor(stepper Stepper) *Processor {
	return &Processor{stepper: stepper}
}

func (p *Processor) Process() {
	fmt.Println("process start")
	p.stepper.Step()
	fmt.Println("process finish")
}
```

구현은 흐름 바깥에서 주입한다.

```go
type PostStep struct{}

func (PostStep) Step() {
	fmt.Println("publish post")
}

processor := NewProcessor(PostStep{})
processor.Process()
```

이제 어떤 동작이 바뀌는 지점인지 타입에 드러난다. 테스트에서는 작은 stub을 넣어 호출 여부도 확인할 수 있다.

인터페이스가 항상 필요한 건 아니다. 변형이 하나뿐이고 바꿀 이유도 없다면 함수로 직접 작성하는 편이 더 단순하다. 상속을 흉내 내기 위해 인터페이스를 만드는 게 아니라, 런타임에 교체되어야 하는 동작이 실제로 있을 때 사용한다.

## 임베딩이 유용한 자리

임베딩 자체가 나쁜 것은 아니다. 반복되는 전달 코드를 줄이고 작은 타입을 조합할 때 유용하다.

```go
type LoggingHandler struct {
	next http.Handler
}

func (h LoggingHandler) ServeHTTP(
	w http.ResponseWriter,
	r *http.Request,
) {
	log.Printf("%s %s", r.Method, r.URL.Path)
	h.next.ServeHTTP(w, r)
}
```

위 예제는 이름 있는 필드를 썼다. `next`라는 역할을 드러내고 외부 API로 메서드가 승격되는 것도 막는다.

반대로 안쪽 타입의 API를 의도적으로 바깥에 드러내고 싶다면 임베딩이 간결하다.

```go
type ReadWriter struct {
	io.Reader
	io.Writer
}
```

판단할 때는 두 가지를 본다.

- 안쪽 타입의 메서드를 바깥 타입 API로 공개해도 되는가
- 단순한 조합인가, 하위 타입의 override를 기대하고 있는가

첫 번째 답이 아니면 이름 있는 필드가 더 명확하다. 두 번째가 override라면 임베딩으로는 해결되지 않는다.

임베딩은 `Base` 안에 `Derived`가 들어 있는 관계가 아니다. `Derived` 안에 `Base` 값 하나가 들어 있는 관계다. 메서드 승격은 selector를 편하게 만들 뿐, 호출 모델을 상속으로 바꾸지 않는다.
