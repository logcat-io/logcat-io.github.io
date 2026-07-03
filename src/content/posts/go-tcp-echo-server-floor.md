---
title: "[GO] TCP 에코 서버를 직접 만들며 본 애플리케이션 서버의 바닥"
description: >-
  Spring 위에서만 짜다가 Go 로 작은 TCP 에코 서버를 바닥부터 만들어봤다. listen→accept→read→write
  가 서버의 전부였고, 처음 버전은 순차 호출이라 두 번째 접속이 먹통이 됐다. go 한 단어를
  붙이자 살아났다. Tomcat 소스의 Acceptor·Poller 와 대응시켜 보며, 애플리케이션 서버의
  맨 아래 한 층을 손으로 만져본 기록.
pubDate: '2026-07-03T17:45:00+09:00'
dateSource: manual
slug: go-tcp-echo-server-floor
tags:
  - Go
  - TCP
  - Socket
  - goroutine
  - Network
  - Tomcat
category: Language/Go
draft: false
---

요즘 Go 로 Redis 를 흉내내서 만들어보고 있다. 그냥 재미로 시작한 프로젝트다.
프레임워크가 다 해주던 걸 표준 라이브러리만으로 직접 짜보자는 건데, 첫 단계가 TCP 서버였다.
`net.Listen` 과 `Accept` 를 직접 다뤄보니, 평소 Spring Boot 위에서 컨트롤러만 짜던 내가 어떤
바닥 위에 서 있었는지가 꽤 선명해졌다. 그 기록이다.

## 리스닝 소켓 하나, 그게 서버의 전부다

첫 목표는 대단한 게 아니었다. `nc localhost 6379` 로 붙어서 입력한 줄이 대문자로 돌아오는 최소
서버. 딱 그거였다.

구조는 Go 관례를 따라 진입점(`cmd/tinyredis`)과 서버 본체(`internal/server`)를 나눴다. 파일 두 개,
다 합쳐 80줄 남짓이다.

```go
// cmd/tinyredis/main.go
package main

import (
	"flag"
	"log/slog"
	"os"
	"tinyredis/internal/server"
)

func main() {
	addr := flag.String("addr", ":6379", "listen address")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	srv := server.New(*addr, logger)
	if err := srv.ListenAndServe(); err != nil {
		logger.Error("server exited", "err", err)
		os.Exit(1)
	}
}
```

서버 본체의 처음 버전은 이랬다.

```go
// internal/server/server.go — 처음 버전
package server

import (
	"bufio"
	"log/slog"
	"net"
	"strings"
)

type Server struct {
	addr string
	log  *slog.Logger
}

func New(addr string, log *slog.Logger) *Server {
	return &Server{addr: addr, log: log}
}

func (s *Server) ListenAndServe() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	s.log.Info("listening on", "addr", ln.Addr().String())

	for {
		conn, err := ln.Accept()
		if err != nil {
			s.log.Warn("accept failed", "err", err)
			continue
		}
		s.handleConn(conn) // 순차 처리 — 이 줄이 곧 문제가 된다
	}
}

func (s *Server) handleConn(conn net.Conn) {
	defer func(conn net.Conn) {
		err := conn.Close()
		if err != nil {
			s.log.Warn("failed to close connection", "err", err)
		}
	}(conn)
	r := bufio.NewReader(conn)
	w := bufio.NewWriter(conn)

	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		if _, err := w.WriteString(strings.ToUpper(line)); err != nil {
			return
		}
		if err := w.Flush(); err != nil {
			return
		}
	}
}
```

만들어 놓고 보니 생각보다 별게 없었다. 포트를 하나 열고(`net.Listen`), 연결을 받고(`Accept`), 그
연결에서 바이트를 읽어서 쓴다(`bufio` read/write). listen → accept → read → write. 이 네 동작이
전부다. `bufio.Reader` 로 한 줄 읽어서 `strings.ToUpper` 로 대문자 바꿔 되돌려주는 게 이
서버가 하는 일의 100% 다.

## HTTP 서버도 결국 이 위에 있다

좀 이상한 기분이 든다. 나는 평소에 이런 코드를 짠 적이 없다. `net.Conn` 을 직접 만질 일이 없었으니까.
늘 `@GetMapping` 붙은 메서드 안에서 `request` 받고 `response` 를 돌려줬다.

그런데 그 HTTP 서버도 뜯어보면 이 아래에서 똑같이 소켓을 열고 있다.

차이는 "TCP 를 쓰느냐"가 아니었다. Spring 이든 이 에코 서버든 둘 다 TCP 위에 있다. 차이는 그 위에 뭐가
얹혀 있느냐다. 이 에코 서버는 프로토콜이 "한 줄 읽어서 대문자로" 가 전부라 내가 직접 다 짰다. HTTP
서버는 그 자리에 요청 파싱, 라우팅, 미들웨어, `HttpServletRequest` 같은 추상화가 두껍게 올라가 있고,
개발자는 그 위에서 비즈니스 로직만 짠다. Spring Boot 애플리케이션도 맨 밑까지 파고 내려가면 결국
소켓을 열고 `accept` 하고 바이트를 읽는다. 그 층을 프레임워크가 가려줄 뿐이다.

## Tomcat 을 열어보면 같은 뼈대가 나온다

말로만 하면 심심해서, 정말 그런지 Tomcat 소스를 열어봤다 (apache/tomcat main 브랜치 기준). Spring
Boot 의 내장 Tomcat 에서 연결을 받는 곳은 `org.apache.tomcat.util.net.Acceptor` 다. 전용 스레드
하나가 이 루프를 돈다.

```java
// org.apache.tomcat.util.net.Acceptor#run — 에러 처리 등을 걷어낸 발췌
while (!stopCalled) {
    try {
        // if we have reached max connections, wait
        endpoint.countUpOrAwaitConnection();

        // Endpoint might have been paused while waiting for latch
        // If that is the case, don't accept new connections
        if (endpoint.isPaused()) {
            continue;
        }

        U socket;
        try {
            // Accept the next incoming connection from the server
            // socket
            socket = endpoint.serverSocketAccept();
        } catch (Exception e) {
            // We didn't get a socket
            endpoint.countDownConnection();
            if (endpoint.isRunning()) {
                // Introduce delay if necessary
                errorDelay = handleExceptionWithDelay(errorDelay);
                // re-throw
                throw e;
            } else {
                break;
            }
        }
        
        ...
        
                // Configure the socket
        if (!stopCalled && !endpoint.isPaused()) {
            // setSocketOptions() will hand the socket off to
            // an appropriate processor if successful
            if (!endpoint.setSocketOptions(socket)) {
                endpoint.closeSocket(socket);
            }
}
```

`serverSocketAccept()` 한 줄. 내가 만든 accept 루프와 같은 자리다. 다른 점이라면 accept 하기 전에
`countUpOrAwaitConnection()` 으로 연결 수 상한부터 확인한다는 것 — 아까 "직접 얹어야 할 게
산더미"라고 했던 것 중 하나(연결 수 제한)가 실제로 여기 얹혀 있다.

받은 소켓은 `poller.register(socketWrapper)` 로 **Poller** 에 등록된다. Poller 는 Selector 기반
이벤트 루프다.

```java
// org.apache.tomcat.util.net.NioEndpoint#setSocketOptions
@Override
protected boolean setSocketOptions(SocketChannel socket) {
    NioSocketWrapper socketWrapper = null;
    try {
        // Allocate channel and wrapper
        NioChannel channel = null;
        if (nioChannels != null) {
            channel = nioChannels.pop();
        }
        if (channel == null) {
            SocketBufferHandler bufhandler = new SocketBufferHandler(socketProperties.getAppReadBufSize(),
                    socketProperties.getAppWriteBufSize(), socketProperties.getDirectBuffer());
            channel = createChannel(bufhandler);
        }
        NioSocketWrapper newWrapper = new NioSocketWrapper(channel, this);
        channel.reset(socket, newWrapper);
        connections.put(socket, newWrapper);
        socketWrapper = newWrapper;

        // Set socket properties
        // Disable blocking, polling will be used
        socket.configureBlocking(false);
        if (getUnixDomainSocketPath() == null) {
            socketProperties.setProperties(socket.socket());
        }

        socketWrapper.setReadTimeout(getConnectionTimeout());
        socketWrapper.setWriteTimeout(getConnectionTimeout());
        socketWrapper.setKeepAliveLeft(NioEndpoint.this.getMaxKeepAliveRequests());
        poller.register(socketWrapper);  <----
        return true;
        
       ...
```

```java
// org.apache.tomcat.util.net.NioEndpoint.Poller#run
keyCount = selector.select(selectorTimeout);   // 소켓 수천 개를 스레드 하나가 감시
...
while (iterator != null && iterator.hasNext()) {
    SelectionKey sk = iterator.next();
    iterator.remove();
    NioSocketWrapper socketWrapper = (NioSocketWrapper) sk.attachment();
    if (socketWrapper != null) {
        processKey(sk, socketWrapper);   // 읽을 준비된 소켓 → 워커 스레드 풀로 제출
    }
}
```

`processKey` 가 워커 스레드 풀(`maxThreads`, 기본 200)에 작업을 넘기고, 워커가 HTTP 를 파싱해
서블릿 컨테이너 → `DispatcherServlet` → `@GetMapping` 까지 올라간다. 정리하면 이렇게 대응된다.

| 내 에코 서버 | Tomcat (NIO) |
|---|---|
| `ln.Accept()` 루프 | Acceptor 스레드의 `serverSocketAccept()` 루프 |
| Go 런타임의 netpoller | Poller (`selector.select`) |
| `go handleConn(conn)` | 워커 스레드 풀 + `Http11Processor` (HTTP 파싱) |

하나 배운 차이도 있다. Tomcat NIO 의 논블로킹은 **요청과 요청 사이**의 이야기다. keep-alive 로 놀고
있는 커넥션 수천 개는 Poller 가 스레드 없이 감시해 주지만, 요청 처리가 시작되면 워커 스레드 하나를
끝까지 점유한다. Go 는 처리 중에도 goroutine 이라 값싼 반면, Tomcat 은 처리 중엔 진짜 OS 스레드다.
`maxThreads` 가 동시 처리의 상한이 되는 이유, 느린 DB 쿼리가 스레드 풀을 말리는 이유가 이 구조에서
나온다.

그래서 이번에 한 건 "완전히 다른 종류의 서버"를 배운 게 아니라, 평소 쓰던 애플리케이션 서버의 맨 아래
한 층을 손으로 다시 깔아본 것에 가깝다.

## 처음 버전의 결함: 두 번째 접속이 먹통이다

처음 버전에는 결함이 있었다. `s.handleConn(conn)` 을 같은 goroutine 에서 그냥 호출한다는 점이다.

`Accept` 는 새 연결이 올 때까지 블로킹하고, `handleConn` 도 그 연결이 끊길 때까지 루프를 돈다. 그러니
첫 연결이 살아 있는 동안 메인 루프는 다음 `Accept` 로 돌아가지 못한다. 두 번째 클라이언트는 accept
조차 안 된다.

글로 읽으면 그런가 싶은데, 직접 연결 두 개를 붙여보면 몸으로 느껴진다. 재현해봤다.

```text
# 순차 버전 — 연결 2개를 순서대로 붙인다
[18:04:22.638] 연결1 hello → HELLO         # 정상 응답
[18:04:24.445] 연결2 ping  →               # 1.5초를 기다려도 응답이 없다
[18:04:24.445] 연결1 을 끊는다
[18:04:24.446] 연결2      → PING           # 끊은 지 1ms 만에 도착
```

마지막 두 줄의 타임스탬프가 핵심이다. 연결1 을 끊은 지 **1ms 만에** 연결2 의 응답이 왔다. 연결2 의
접속 요청은 진작에 OS 의 accept 큐에 들어와서 기다리고 있었고, 코드가 `Accept()` 를 다시 부르지
못하고 있었을 뿐이라는 뜻이다. 첫 연결이 끊겨 `handleConn` 이 return 하자마자 메인 루프가 다음
`Accept` 로 돌아갔고, 기다리던 연결이 그 즉시 잡혔다.

## go 한 단어

고치는 방법은 아주 간단했다.

`s.handleConn(conn)` 을 `go s.handleConn(conn)` 으로 바꾼다.

이 한 단어로 메인 goroutine 은 `handleConn` 이 끝나길 기다리지 않고 즉시 다음 `Accept` 로 돌아간다.
각 연결은 자기만의 goroutine 에서 처리된다. 아까 그 먹통 시나리오를 다시 돌려봤다.

```text
# go 버전 — 같은 시나리오
[18:04:52.756] 연결1 hello → HELLO
[18:04:53.064] 연결2 ping  → PING          # 연결1 을 안 끊었는데 즉시 응답
[18:04:53.064] 연결1 world → WORLD         # 두 연결이 독립적으로 동작
```

이번엔 연결1 을 끊지 않아도 연결2 가 바로 `PING` 을 받는다. 연결1 에 `world` 를 더 보내도 `WORLD` 가
돌아오고, 두 연결이 서로 간섭 없이 독립적으로 산다.

그러면 연결마다 goroutine 을 하나씩 던지는 건, 스레드로 같은 행위를 하는 것보다 왜 쌀까.

찾아보니 핵심은 `conn.Read` 가 블로킹처럼 보여도 진짜로 OS 스레드를 붙잡고 자는 게 아니라는 데 있었다. 읽을
데이터가 없으면 Go 런타임이 그 소켓을 epoll/kqueue(netpoller)에 걸어두고 goroutine 만 park 시킨다.
그 goroutine 을 돌리던 OS 스레드는 잠들지 않고 다른 goroutine 을 집어 계속 일한다. 그래서 연결 만
개가 전부 Read 대기 중이어도 실제 OS 스레드는 몇 개면 된다. 아직 이 부분은 충분한 이해가 부족하여, 다음 글감으로 남겨둔다.

물론 이걸로 운영 서버가 되는 건 아니다. 연결 수 제한, 타임아웃, graceful shutdown, 프로토콜 파싱,
상태 저장소... 여전히 직접 얹어야 할 게 산더미다. 지금은 "다중 연결을 받는다"는 최소 조건 하나를
넘긴 것뿐이다.

## 만들고 나서 보이는 것

에코 서버 하나 만든 게 대단한 일은 아니다. 대문자로 돌려주는 장난감이다. 그런데 만들고 나니 평소 안
보이던 층이 눈에 들어온다.

전에는 요청이 오면 컨트롤러가 실행된다, 정도로만 알았다. 이제는 그 앞에 리스닝 소켓이 있고, accept
루프가 있고, 연결마다 처리기가 붙고, 그 위에서 프로토콜이 바이트 스트림을 파싱한다는 계층이 구체적으로
그려진다. Spring 이 가려주던 게 뭐였는지 손으로 만져보고 나서야 감이 왔다.

다음 챕터는 이 위에 RESP(Redis 직렬화 프로토콜) 파서를 얹어 진짜 명령을 주고받는 단계다. 지금은 한
줄을 대문자로 바꾸는 게 전부지만, 그 자리에 명령 파싱과 처리가 들어가면 이 장난감이 조금씩 Redis 를
닮아가지 않을까 기대된다.
