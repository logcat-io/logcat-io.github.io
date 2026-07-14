---
title: "[GO] 왜 redis-cli는 내가 만든 tinyredis에도 붙을까"
description: "TCP 에코 서버 다음 단계로 RESP 파서를 붙이면서, redis-cli는 tinyredis에 붙는데 nc PING은 protocol error가 나는 이유를 wire protocol 관점에서 정리한 기록."
pubDate: "2026-07-14T15:19:06+09:00"
dateSource: manual
slug: redis-cli-tinyredis-resp
tags:
  - Go
  - Redis
  - RESP
  - TCP
  - Protocol
category: Language/Go
series:
  name: "Go로 만드는 tinyredis"
  order: 2
draft: false
---

요즘 Go 로 Redis 를 흉내내서 만들어보고 있다. 이름은 `tinyredis` 다.

[앞 글](/posts/go-tcp-echo-server-floor/)에서는 `net.Listen` 으로 TCP 서버를 열고, 연결마다 goroutine 을 붙여 한 줄을 읽고 쓰는 데까지 만들었다. 입력한 줄을 대문자로 돌려주는 작은 에코 서버였다.

이번에는 그 위에 RESP 파서를 얹었다. 한 줄 텍스트를 대문자로 바꾸는 서버에서, `PING`, `SET`, `GET`, `DEL`, `EXISTS` 를 알아듣는 작은 Redis 흉내로 넘어간 셈이다. 그리고 처음으로 진짜 `redis-cli` 를 내 서버에 붙여봤다.

여기서 좀 이상한 느낌이 들었다.

나는 Redis 를 만든 게 아니다. 그냥 Go 로 TCP 서버 하나 만들고, 몇 개 명령만 흉내냈을 뿐이다. 그런데 `redis-cli` 는 별 의심 없이 붙는다.

반대로 `nc` 로 같은 포트에 붙어서 `PING` 을 치면 바로 깨진다.

```bash
$ nc -v localhost 6379
Connection to localhost port 6379 [tcp/*] succeeded!
PING
-ERR protocol error
```

같은 서버, 같은 포트, 같은 `PING` 인데 왜 하나는 되고 하나는 안 될까.

알고 보면 이유는 단순했다. `redis-cli` 는 Redis 라는 제품에 붙는 게 아니라, TCP 위에서 RESP 를 말할 줄 아는 서버에 붙는다. 내 tinyredis 가 그 말을 조금 알아듣기 시작했기 때문에 붙은 것이다.

## RESP 가 뭔데

RESP 는 REdis Serialization Protocol 의 약자다. Redis 클라이언트와 서버가 TCP 위에서 주고받는 바이트의 모양을 정한 규칙, 그러니까 Redis 의 wire protocol 이다.

규칙의 뼈대는 두 개다. 모든 데이터는 **첫 바이트로 타입을 구분**하고, 각 부분은 `\r\n`(CRLF) 으로 끝난다. RESP2 기준 타입은 다섯 개가 전부다.

```text
+OK\r\n                             Simple String
-ERR unknown command\r\n            Error
:1\r\n                              Integer
$3\r\nfoo\r\n                       Bulk String (길이를 먼저 준다)
*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n    Array
```

방향도 정해져 있다. 요청은 Bulk String 으로 이루어진 Array 형태로 보내는 게 표준이다. `PING` 도 `SET foo bar` 도 전부 배열이다. 응답은 명령에 따라 다섯 가지 타입 중 하나로 돌아온다. `SET` 은 `+OK`, `GET` 은 Bulk String, 없는 키는 `$-1\r\n`(null bulk) 이다.

역사도 짧게만 보면, 이 프로토콜은 Redis 1.2 에서 들어와 2.0 부터 표준이 됐다. 위에 적은 게 RESP2 다. Redis 6 부터는 `HELLO 3` 으로 전환하는 RESP3 이 생겨 map, double 같은 타입이 추가됐지만, 연결의 기본값은 지금도 RESP2 다. tinyredis 가 구현한 것도 RESP2 의 서브셋이다. 요청 파서는 Array of Bulk Strings 형태만 읽고, 응답 쪽은 다섯 가지 타입을 쓴다.

## nc 는 텍스트를 그대로 보낸다

`nc` 부터 보자.

`nc` 는 Redis 클라이언트가 아니다. TCP 연결을 열고, stdin 으로 들어온 바이트를 그대로 소켓에 흘려보내는 도구에 가깝다. 내가 터미널에서 이렇게 치면:

```text
PING
```

tinyredis 입장에서는 대략 이런 바이트가 들어온다.

```text
PING\n
```

사람 눈에는 Redis 명령처럼 보인다. 하지만 이번에 붙인 RESP 파서는 이걸 명령으로 보지 않는다. tinyredis 의 `ReadCommand` 는 요청을 딱 한 형태만 받도록 만들었다.

```text
Array of Bulk Strings
```

`PING` 하나만 보내도 RESP 로는 이렇게 와야 한다.

```text
*1\r\n$4\r\nPING\r\n
```

쪼개서 보면 이렇다.

```text
*1      배열 원소 1개
$4      길이 4짜리 bulk string
PING    실제 명령 이름
```

각 줄의 끝은 `\r\n` 이다. 그냥 `\n` 이 아니다.

내 파서는 줄을 읽을 때 CRLF 로 끝나는지부터 검사하고, 첫 줄에서는 `*` 를 기대한다.

```go
func ReadCommand(r *bufio.Reader) ([]string, error) {
    line, err := readLine(r) // \r\n 으로 끝나는 한 줄. 아니면 ErrProtocol
    if err != nil {
        return nil, err
    }
    if len(line) == 0 || line[0] != '*' {
        return nil, fmt.Errorf("%w: expected array, got %q", ErrProtocol, line)
    }

    // ...
}
```

그래서 `nc` 로 보낸 `PING\n` 은 사실 두 군데서 걸린다. 터미널의 엔터는 `\n` 만 보내니 먼저 라인 엔딩 검사에서 탈락한다. 설령 `PING\r\n` 으로 맞춰 보내도, 이번엔 첫 바이트가 `*` 가 아니라서 다시 걸린다. 어느 쪽이든 `ErrProtocol` 이다.

서버 루프는 이 에러를 보고 `-ERR protocol error` 를 한 번 쓰고 연결을 닫는다.

```go
func (s *Server) serveLoop(reader *bufio.Reader, writer *bufio.Writer) {
    for {
        args, err := resp.ReadCommand(reader)
        if err != nil {
            if errors.Is(err, resp.ErrProtocol) {
                _ = resp.WriteError(writer, "ERR protocol error")
                _ = writer.Flush()
            }
            return
        }

        if err := s.dispatch(writer, args); err != nil {
            return
        }
        if err := writer.Flush(); err != nil {
            return
        }
    }
}
```

여기서 중요한 건 `nc` 라서 안 된다는 게 아니다.

RESP 를 안 맞췄기 때문에 안 된다.

## nc 도 RESP 를 맞추면 된다

같은 `nc` 라도 RESP 바이트를 직접 만들어 보내면 정상으로 처리된다.

```bash
$ printf '*1\r\n$4\r\nPING\r\n' | nc -v localhost 6379
Connection to localhost port 6379 [tcp/*] succeeded!
+PONG
```

이 실험 하나면 앞의 의문이 거의 닫힌다.

`nc` 는 프로토콜을 모른다. 내가 `PING\n` 을 주면 그대로 보내고, `*1\r\n$4\r\nPING\r\n` 을 주면 그것도 그대로 보낸다. 서버가 이해하는 쪽은 후자다.

그럼 `redis-cli` 는 무엇을 해준 걸까.

## redis-cli 는 내가 친 명령을 RESP 로 바꿔준다

`redis-cli` 로 같은 서버에 붙으면 자연스럽게 동작한다.

```bash
$ redis-cli -p 6379
127.0.0.1:6379> PING
PONG
```

터미널에는 `PING` 이라고 쳤지만, wire 에 그대로 `PING\n` 이 흐르는 건 아니다. `redis-cli` 가 명령과 인자를 RESP 배열로 인코딩해서 보낸다.

`PING` 은:

```text
*1\r\n$4\r\nPING\r\n
```

`SET foo bar` 는:

```text
*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n
```

그리고 서버가 돌려준 응답도 다시 사람이 읽기 좋은 형태로 보여준다.

```text
+PONG\r\n        -> PONG
+OK\r\n          -> OK
$3\r\nbar\r\n    -> "bar"
$-1\r\n          -> (nil)
:1\r\n           -> (integer) 1
```

그래서 `redis-cli` 가 붙는다는 건 내 서버가 진짜 Redis 라는 뜻이 아니다.

적어도 `redis-cli` 가 보내는 RESP 요청을 읽고, 기대하는 RESP 응답을 돌려줄 만큼은 Redis 처럼 보인다는 뜻이다.

## tinyredis 가 Redis 처럼 보이는 지점

`dispatch` 는 복잡하지 않다. RESP 파서가 `[]string{"SET", "foo", "bar"}` 같은 형태로 명령을 넘기면, 서버는 첫 번째 인자를 명령 이름으로 보고 처리한다.

```go
func (s *Server) dispatch(w *bufio.Writer, args []string) error {
    cmd := strings.ToUpper(args[0])
    switch cmd {
    case "PING":
        if len(args) == 2 {
            return resp.WriteBulkString(w, args[1])
        }
        return resp.WriteSimpleString(w, "PONG")

    case "SET":
        if len(args) != 3 {
            return wrongArity(w, "set")
        }
        s.store.Set(args[1], args[2])
        return resp.WriteSimpleString(w, "OK")

    case "GET":
        if len(args) != 2 {
            return wrongArity(w, "get")
        }
        v, ok := s.store.Get(args[1])
        if !ok {
            return resp.WriteNullBulk(w)
        }
        return resp.WriteBulkString(w, v)

    // DEL, EXISTS ...
    }
}
```

여기서 `store` 는 RESP 를 모른다. 그냥 key-value 저장소다. `Get` 은 `(string, bool)` 을 돌려주고, 그 `false` 를 `$-1\r\n` 로 바꾸는 건 server 계층의 일이다.

```text
TCP connection
  -> resp.ReadCommand
  -> []string{"GET", "foo"}
  -> dispatch
  -> store.Get("foo")
  -> resp.WriteBulkString / WriteNullBulk
```

이 흐름만 맞추면 `redis-cli` 입장에선 충분하다. 내부가 공식 Redis 인지, Go map 인지, 나중에 TTL 이 붙은 entry 구조체인지까지는 모른다. 클라이언트가 보는 건 wire protocol 뿐이다.

## TCP 는 명령 경계를 모른다

RESP 를 직접 만들면서 제일 크게 배운 건 사실 `redis-cli` 보다 TCP 쪽이었다.

처음엔 "클라이언트가 한 번 `write` 하면 서버도 한 번 `read` 하겠지" 같은 막연한 생각이 있었다. 틀렸다. TCP 는 바이트를 순서대로 전달할 뿐, 어디까지가 명령 하나인지 모른다.

`SET foo bar` 가 한 번에 올 수도 있고:

```text
*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n
```

1바이트씩 쪼개져 올 수도 있다.

그래서 bulk string 본문을 읽을 때 `Read` 한 번으로 끝내면 안 된다. 요청한 길이를 다 채울 때까지 읽어야 한다.

```go
buf := make([]byte, size+2)
if _, err := io.ReadFull(r, buf); err != nil {
    return "", err
}
if buf[size] != '\r' || buf[size+1] != '\n' {
    return "", fmt.Errorf("%w: bulk string not terminated by CRLF", ErrProtocol)
}
```

파서 테스트에는 이걸 강제로 깨뜨리는 케이스가 있다.

```go
func TestReadCommand_fragmentedInput(t *testing.T) {
    input := "*3\r\n$3\r\nSET\r\n$5\r\nhello\r\n$5\r\nworld\r\n"
    r := bufio.NewReaderSize(iotest.OneByteReader(strings.NewReader(input)), 16)

    got, err := ReadCommand(r)
    if err != nil {
        t.Fatalf("ReadCommand() error = %v", err)
    }
    want := []string{"SET", "hello", "world"}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("ReadCommand() = %v, want %v", got, want)
    }
}
```

`OneByteReader` 는 한 번에 1바이트씩만 준다. 로컬에서 잘 붙던 파서도 여기서 많이 깨진다. `io.ReadFull` 을 쓰는 이유가 이 테스트 하나로 분명해진다.

결국 RESP 파서는 문자열 파서가 아니라 프레이밍 코드에 가깝다. 경계 없는 TCP 스트림 위에서 "명령 한 건"이라는 경계를 다시 만들어준다.

## Redis 는 왜 JSON 이 아니라 RESP 일까

처음엔 막연히 Redis 도 TCP 위에서 JSON 같은 걸 주고받는 줄 알았다. 지금 생각하면 Redis 가 굳이 그럴 이유가 별로 없다.

공식 문서는 RESP 의 설계 목표를 세 개로 적어놨다.

- 구현이 단순할 것
- 파싱이 빠를 것
- 사람이 읽을 수 있을 것

직접 파서를 만들고 나니 세 개가 다 몸으로 납득됐다.

**구현이 단순할 것.** Redis 클라이언트는 Redis 팀만 만드는 게 아니다. 언어별 커뮤니티도 만든다. 프로토콜이 얇아야 수십 개 언어에 클라이언트가 생기고, Redis 생태계는 그 위에서 굴러간다. 실제로 tinyredis 의 `resp.go` 는 파서와 직렬화를 합쳐 107줄이다. Go 를 배우는 중인 사람이 하루 만에 만들 수 있는 수준이면, 이 목표는 달성된 거다.

**파싱이 빠를 것.** 핵심은 Bulk String 의 길이 프리픽스다.

```text
$5\r\nhello\r\n
```

서버는 `$5` 를 읽고 다음 5바이트를 통째로 읽으면 된다. 본문 안에 `\r\n` 이 있어도, 임의의 바이너리가 있어도 상관없다. 이스케이프 처리가 아예 없다 (`binary-safe`). JSON 이라면 닫는 따옴표를 찾을 때까지 스캔하면서 `\"` 같은 이스케이프를 해석해야 한다. RESP 는 읽을 길이를 미리 알아서 버퍼도 정확히 그 크기로 잡는다.

**사람이 읽을 수 있을 것.** 앞의 `printf '*1\r\n$4\r\nPING\r\n' | nc` 실험이 가능했던 이유다. 길이 숫자만 빼면 전부 평문이라, 프로토콜을 눈으로 읽고 손으로 조립할 수 있다. 완전 바이너리 프로토콜이었다면 저 실험은 hex 덤프부터 시작했을 거다.

JSON 은 범용 포맷이라 장점이 많다. 사람이 익숙하고, 도구도 많고, 중첩 구조도 자연스럽다. 그런데 Redis 가 주고받는 기본 모양은 "명령 이름 + 인자 배열, 그리고 응답 하나"다. 그 정도라면 RESP 처럼 얇은 프로토콜이 더 잘 맞는다. JSON 이 나쁘다는 얘기가 아니라, Redis 가 풀려는 문제에는 RESP 가 더 좁고 직접적인 도구였다는 쪽에 가깝다.

## 실물 Redis 와 tinyredis 는 다르다

하나는 분명히 적어둬야 한다.

이 글의 `nc PING` 실험은 tinyredis 기준이다. 내가 만든 파서는 요청을 "Array of Bulk Strings" 형태로만 받는다. 그래서 `PING\n` 을 프로토콜 위반으로 본다.

실물 Redis 는 역사적 호환성과 디버깅 편의 때문에 인라인 명령 형태를 받아주는 경로가 있다. 그러니 "Redis 는 절대 `PING` 텍스트를 못 받는다"로 일반화하면 틀린 말이 된다.

여기서 확인한 건 더 좁다.

내 tinyredis 가 `redis-cli` 와 대화할 수 있는 이유는, `redis-cli` 가 보내는 RESP 요청을 tinyredis 가 읽고 RESP 응답을 돌려주기 때문이다. 반대로 `nc` 로 raw 텍스트를 보내면, tinyredis 의 RESP 파서가 기대하는 프레임이 아니어서 깨진다.

## 만들고 나서 보이는 것

전에는 `redis-cli` 를 Redis 전용 터미널 정도로만 봤다. 이제는 조금 다르게 보인다.

`redis-cli` 는 내가 친 명령을 RESP 로 인코딩하고, 서버 응답을 다시 사람이 읽을 수 있게 디코딩해 주는 클라이언트다. 그 맞은편에 있는 서버가 공식 Redis 인지 tinyredis 인지는 wire protocol 밖의 일이다.

이걸 직접 만들고 나니 다른 시스템도 비슷하게 보이기 시작했다. PostgreSQL wire protocol, Kafka protocol, HTTP/2 도 결국 같은 질문으로 볼 수 있다.

왜 이 시스템은 범용 JSON/HTTP 위에 안 올라가고 자기 프로토콜을 만들었을까.

tinyredis 는 아직 장난감이다. 그래도 `redis-cli` 가 붙는 순간, 장난감이 프로토콜을 말하기 시작했다는 느낌은 확실히 있었다.
