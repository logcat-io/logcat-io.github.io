---
title: "[GO] Handler 한 줄로 이해하는 net/http 서버의 뼈대"
description: "일반 함수가 HandlerFunc를 거쳐 http.Handler가 되고, ServeMux와 미들웨어도 같은 인터페이스로 연결된다. Go 1.25.1 net/http 실제 소스를 따라 Server에서 최종 함수까지 ServeHTTP 호출이 이어지는 경로를 정리했다."
pubDate: "2026-08-02T00:20:00+09:00"
dateSource: manual
slug: go-net-http-handler-spine
tags:
  - Go
  - HTTP
  - net-http
  - Handler
  - ServeMux
category: Language/Go
draft: false
---

`net/http`를 공부하면서 처음에는 `Handle`, `HandleFunc`, `HandlerFunc`, `ServeMux`가 각각 따로 있는 개념처럼 보였다.

이름도 비슷해서 외워야 할 API가 많은 줄 알았다. 그런데 소스를 따라가 보니 모두 한 인터페이스로 모였다.

```go
type Handler interface {
	ServeHTTP(ResponseWriter, *Request)
}
```

서버가 애플리케이션 코드에 요구하는 계약은 `ServeHTTP` 하나다.

라우터인 `ServeMux`도 `Handler`이고, 일반 함수는 `HandlerFunc`를 거치면 `Handler`가 된다. 미들웨어는 `Handler`를 받아 다른 `Handler`를 반환한다. 구현체는 계속 바뀌지만 다음 대상을 부르는 표현은 `ServeHTTP(w, r)`로 같다.

이 글의 소스 코드는 로컬에 설치된 Go 1.25.1의 `/usr/local/go/src/net/http/server.go`에서 직접 확인했다. 버전에 따라 라우팅 내부 구현은 달라질 수 있지만 `Handler`를 중심으로 한 호출 구조는 같다.

## 시작은 Handler 하나다

Go 1.25.1의 실제 `Handler` 선언이다.

```go
type Handler interface {
	ServeHTTP(ResponseWriter, *Request)
}
```

요청을 처리할 수 있는 타입인지 판단하는 기준은 구체 타입의 이름이 아니다.

```go
type HelloHandler struct{}

func (HelloHandler) ServeHTTP(
	w http.ResponseWriter,
	r *http.Request,
) {
	fmt.Fprintln(w, "hello")
}
```

`HelloHandler`는 `http.Handler`를 선언부에서 언급하지 않았다. 그래도 메서드 집합이 맞으므로 인터페이스를 만족한다.

```go
var _ http.Handler = HelloHandler{}
```

서버 입장에서는 `HelloHandler`, `*ServeMux`, 미들웨어 중 무엇이 들어왔는지 알 필요가 없다.

```go
type Server struct {
	// ...
	Handler Handler // handler to invoke, http.DefaultServeMux if nil
	// ...
}
```

필드 타입이 `Handler`다. 최종 구현체가 무엇이든 `ServeHTTP`만 호출하면 된다.

## 일반 함수는 아직 Handler가 아니다

실제로 자주 작성하는 코드는 구조체보다 함수에 가깝다.

```go
func hello(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "hello")
}
```

함수의 시그니처는 `ServeHTTP`와 같지만 함수 자체에는 메서드가 없다.

```go
var _ http.Handler = hello // 컴파일 실패
```

인터페이스는 함수 시그니처만 비교하는 게 아니라 타입의 메서드 집합을 검사한다. `hello`는 호출 가능한 함수 값일 뿐 `ServeHTTP` 메서드를 가진 값이 아니다.

그 간극을 `HandlerFunc`가 메운다.

## HandlerFunc는 함수 타입에 메서드를 붙인 어댑터다

`server.go`의 실제 구현은 짧다.

```go
// The HandlerFunc type is an adapter to allow the use of
// ordinary functions as HTTP handlers. If f is a function
// with the appropriate signature, HandlerFunc(f) is a
// Handler that calls f.
type HandlerFunc func(ResponseWriter, *Request)

// ServeHTTP calls f(w, r).
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
	f(w, r)
}
```

Go에서는 함수 타입에도 메서드를 정의할 수 있다. `HandlerFunc`의 underlying type은 `func(ResponseWriter, *Request)`이고, 여기에 `ServeHTTP`가 붙어 있다.

```go
h := http.HandlerFunc(hello)
```

`http.HandlerFunc(hello)`는 일반 함수를 정의된 함수 타입 `HandlerFunc`로 바꾸는 타입 변환이다. 새 구조체를 만들어 함수를 필드에 넣는 코드는 없다.

어댑터 역할은 `ServeHTTP` 메서드가 만든다.

```text
h.ServeHTTP(w, r)
        │
        └──> hello(w, r)
```

타입 변환이 끝나면 `h`의 메서드 집합에 `ServeHTTP`가 있으므로 `Handler` 자리에 들어갈 수 있다.

```go
var h http.Handler = http.HandlerFunc(hello)
```

`HandlerFunc`는 함수 호출 방식과 서버의 인터페이스 계약을 연결하는 작은 어댑터다.

## Handle과 HandleFunc의 차이

`ServeMux`에는 등록 메서드가 두 개 있다.

```go
func (mux *ServeMux) Handle(pattern string, handler Handler)

func (mux *ServeMux) HandleFunc(
	pattern string,
	handler func(ResponseWriter, *Request),
)
```

`Handle`은 이미 `Handler`인 값을 받는다.

```go
mux.Handle("/hello", HelloHandler{})
```

`HandleFunc`는 일반 함수를 받는다.

```go
mux.HandleFunc("/hello", hello)
```

Go 1.25.1의 실제 구현을 보면 차이가 마지막 한 줄에 드러난다.

```go
func (mux *ServeMux) Handle(pattern string, handler Handler) {
	if use121 {
		mux.mux121.handle(pattern, handler)
	} else {
		mux.register(pattern, handler)
	}
}

func (mux *ServeMux) HandleFunc(pattern string, handler func(ResponseWriter, *Request)) {
	if use121 {
		mux.mux121.handleFunc(pattern, handler)
	} else {
		mux.register(pattern, HandlerFunc(handler))
	}
}
```

`use121` 분기는 Go 1.21 라우팅 동작과의 호환을 위한 경로다. 현재 경로에서 `HandleFunc`가 하는 핵심 작업은 다음 한 줄이다.

```go
mux.register(pattern, HandlerFunc(handler))
```

흐름을 풀면 이렇다.

```text
일반 함수
   │  HandlerFunc(handler) 타입 변환
   ▼
HandlerFunc 값
   │  ServeHTTP 메서드를 가지므로
   ▼
Handler로 register
```

`HandleFunc`는 별도의 핸들러 모델을 제공하지 않는다. 함수 타입 변환과 등록을 한 번에 해주는 편의 API다.

패키지 함수 `http.HandleFunc`도 같은 일을 `DefaultServeMux`에 수행한다.

```go
func HandleFunc(pattern string, handler func(ResponseWriter, *Request)) {
	if use121 {
		DefaultServeMux.mux121.handleFunc(pattern, handler)
	} else {
		DefaultServeMux.register(pattern, HandlerFunc(handler))
	}
}
```

`mux.HandleFunc`는 내가 만든 mux에 등록하고, `http.HandleFunc`는 패키지 전역 `DefaultServeMux`에 등록한다는 차이가 있다. 의존 관계를 코드에 드러내고 테스트 간 전역 상태를 공유하지 않으려면 `NewServeMux`로 만든 값을 직접 넘기는 편이 읽기 쉽다.

## ServeMux도 Handler다

`http.NewServeMux()`는 `*ServeMux`를 반환한다.

```go
func NewServeMux() *ServeMux {
	return &ServeMux{}
}
```

`*ServeMux`에는 `ServeHTTP` 메서드가 있다.

```go
// ServeHTTP dispatches the request to the handler whose
// pattern most closely matches the request URL.
func (mux *ServeMux) ServeHTTP(w ResponseWriter, r *Request) {
	if r.RequestURI == "*" {
		if r.ProtoAtLeast(1, 1) {
			w.Header().Set("Connection", "close")
		}
		w.WriteHeader(StatusBadRequest)
		return
	}
	var h Handler
	if use121 {
		h, _ = mux.mux121.findHandler(r)
	} else {
		h, r.Pattern, r.pat, r.matches = mux.findHandler(r)
	}
	h.ServeHTTP(w, r)
}
```

이 메서드가 하는 핵심 작업은 두 단계다.

1. 요청과 가장 잘 맞는 `Handler`를 찾는다.
2. 찾은 값의 `ServeHTTP(w, r)`를 호출한다.

```go
var _ http.Handler = (*http.ServeMux)(nil)
```

따라서 mux 자체를 서버의 `Handler` 필드에 넣을 수 있다.

```go
mux := http.NewServeMux()
mux.HandleFunc("/hello", hello)

server := &http.Server{
	Addr:    ":8080",
	Handler: mux,
}
```

서버는 mux가 라우터라는 사실을 모른다. `Handler` 하나를 받았고 그 메서드를 호출할 뿐이다. 라우팅은 `ServeMux.ServeHTTP` 안에서 일어난다.

## Server는 어디에서 ServeHTTP를 호출할까

`http.ListenAndServe`부터 내려가 보면 서버가 `Handler`를 호출하는 지점이 나온다.

```go
func ListenAndServe(addr string, handler Handler) error {
	server := &Server{Addr: addr, Handler: handler}
	return server.ListenAndServe()
}
```

`Server.ListenAndServe`는 TCP listener를 만들고 `Serve`로 넘긴다.

```go
func (s *Server) ListenAndServe() error {
	if s.shuttingDown() {
		return ErrServerClosed
	}
	addr := s.Addr
	if addr == "" {
		addr = ":http"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return s.Serve(ln)
}
```

`Server.Serve`의 accept loop에서는 연결마다 새로운 service goroutine을 시작한다. 아래는 관련 부분만 발췌한 코드다.

```go
for {
	rw, err := l.Accept()
	if err != nil {
		// 에러 처리 생략
	}

	connCtx := ctx
	// ConnContext 처리 생략

	c := s.newConn(rw)
	c.setState(c.rwc, StateNew, runHooks)
	go c.serve(connCtx)
}
```

여기서 정확히 나눠야 할 부분이 있다. HTTP/1.x 경로에서는 요청마다 무조건 새 고루틴을 만드는 게 아니라, 받아들인 연결마다 `go c.serve(connCtx)`를 시작한다.

그 연결 고루틴이 요청을 읽은 뒤 handler를 부른다.

```go
inFlightResponse = w
serverHandler{c.server}.ServeHTTP(w, w.req)
inFlightResponse = nil
```

HTTP/1.x keep-alive 연결이라면 같은 `c.serve` 루프가 다음 요청을 다시 읽는다. HTTP/2는 stream을 다루는 경로가 별도로 있지만 애플리케이션 코드에 도달할 때는 역시 `Handler.ServeHTTP` 계약을 사용한다.

## serverHandler가 사용자 Handler를 선택한다

`conn.serve`가 바로 `Server.Handler`를 호출하지는 않는다. 내부 타입 `serverHandler`가 한 번 중간에 들어간다.

Go 1.25.1 소스는 다음과 같다.

```go
// serverHandler delegates to either the server's Handler or
// DefaultServeMux and also handles "OPTIONS *" requests.
type serverHandler struct {
	srv *Server
}

func (sh serverHandler) ServeHTTP(rw ResponseWriter, req *Request) {
	handler := sh.srv.Handler
	if handler == nil {
		handler = DefaultServeMux
	}
	if !sh.srv.DisableGeneralOptionsHandler && req.RequestURI == "*" && req.Method == "OPTIONS" {
		handler = globalOptionsHandler{}
	}

	handler.ServeHTTP(rw, req)
}
```

`Server.Handler`가 있으면 그 값을 사용한다. nil이면 `DefaultServeMux`로 대체한다. `OPTIONS *` 요청에 대한 예외 처리까지 끝낸 뒤 마지막에는 같은 호출이 남는다.

```go
handler.ServeHTTP(rw, req)
```

서버 내부 타입조차 `ServeHTTP`를 구현하고 다음 `Handler`로 전달한다.

## 미들웨어도 Handler에서 Handler로 이어진다

미들웨어는 이 구조를 그대로 이용한다.

```go
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}
```

입력도 `http.Handler`, 반환도 `http.Handler`다.

반환값의 실제 타입은 `HandlerFunc`다. 이 함수가 요청 전후 작업을 수행하고 안쪽의 `next.ServeHTTP`를 호출한다.

```text
logging HandlerFunc
        │ next.ServeHTTP
        ▼
     ServeMux
        │ h.ServeHTTP
        ▼
hello HandlerFunc
        │ f(w, r)
        ▼
   hello 함수
```

인증, panic recovery, request ID, 응답 압축도 같은 모양으로 쌓을 수 있다. 프레임워크가 정해둔 별도 미들웨어 베이스 클래스를 상속하는 게 아니라 `Handler`를 받아 `Handler`를 돌려주는 함수면 된다.

## 전체 코드를 한 번 연결해보자

```go
package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

func hello(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	fmt.Fprintf(w, "hello, %s\n", name)
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /hello/{name}", hello)

	server := &http.Server{
		Addr:              ":8080",
		Handler:           logging(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	if err := server.ListenAndServe();
		err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
```

등록할 때 `hello`가 `HandlerFunc`로 변환된다.

```text
mux.HandleFunc(..., hello)
                  └──> HandlerFunc(hello)
```

서버에는 mux를 한 번 감싼 logging handler가 들어간다.

```text
Server.Handler = logging(mux)
```

요청 하나가 애플리케이션 코드까지 내려오는 호출 흐름은 다음과 같다.

```text
TCP accept
  └─> conn.serve
       └─> serverHandler.ServeHTTP
            └─> logging HandlerFunc.ServeHTTP
                 └─> ServeMux.ServeHTTP
                      └─> hello HandlerFunc.ServeHTTP
                           └─> hello(w, r)
```

각 단계의 구체 타입은 다르다. 내부 서버 어댑터, 미들웨어, 라우터, 함수 어댑터가 차례로 등장한다. 호출하는 쪽에서는 전부 `Handler`다.

## Handler가 설명하는 범위

`Handler` 한 줄이 TCP accept, TLS handshake, HTTP 파싱, keep-alive, timeout까지 구현해주는 것은 아니다. `net/http` 내부에는 그 일을 처리하는 코드가 훨씬 많이 있다.

다만 네트워크에서 읽은 요청을 애플리케이션의 라우터와 미들웨어, 최종 함수로 전달하는 경로는 `ServeHTTP` 하나로 좁아진다.

- 일반 함수는 `HandlerFunc` 타입 변환으로 `Handler`가 된다.
- `HandleFunc`는 그 변환과 mux 등록을 함께 처리한다.
- `ServeMux`도 `ServeHTTP`를 구현한 `Handler`다.
- 미들웨어는 `Handler`를 받아 다른 `Handler`를 만든다.
- 서버는 구체 타입을 구분하지 않고 다음 `ServeHTTP`를 호출한다.

처음에는 비슷한 이름의 API 네 개를 따로 외우고 있었다. 소스를 따라가고 나니 외울 건 하나였다.

```go
type Handler interface {
	ServeHTTP(ResponseWriter, *Request)
}
```

웹 서버 전체가 한 줄이라는 뜻은 아니다. 애플리케이션 요청 처리 경로의 공통 축이 이 한 줄이라는 뜻이다.
