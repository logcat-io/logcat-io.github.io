---
title: "[WEB] HTTP QUERY 메서드: Go에선 문자열 한 줄, Spring에선 벽"
description: "레거시에서 URL이 너무 길어 잘리던 경험에서 출발해 RFC 10008 QUERY 메서드를 붙여봤다. 처음엔 문서를 대충 보고 만들어 틀렸고, RFC를 제대로 읽어 상태 코드·Accept-Query까지 고친 기록."
pubDate: "2026-07-05T22:29:18+09:00"
dateSource: manual
slug: rfc-10008-http-query
tags:
  - web
  - http
  - query
  - rfc
  - go
  - spring
category: Computer Science/Network
draft: false
---

예전 회사에서 선임이 레거시 이야기를 해준 적이 있다. 모든 조회 데이터를 URL에 실어서 넘기는 오래된 JSP 페이지였는데, 파라미터가 계속 붙다 보니 **URL이 너무 길어져서 뒤가 잘려 나가는** 문제가 있었다고. 그땐 "그럴 수밖에 없던 상황에서 어떻게 대처했을까" 하고 넘겼다.

[RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html)로 표준이 된 `QUERY` 메서드를 보다가 그 이야기가 떠올랐다. QUERY가 정확히 그 문제를 겨냥한 메서드였기 때문이다. 그래서 직접 붙여봤는데, 처음엔 문서를 대충 보고 만들어서 꽤 틀렸다. 그 과정을 그대로 적는다.

## URL에 다 넣는 건 물리적 천장이 있다

조회 조건을 전부 URL에 넣는 방식(GET)은 편하지만 길이 한계가 있다. 브라우저도, 서버도, 중간 프록시도 요청 라인(request line)을 무한정 받지 않는다. 흔히 쓰는 웹서버들은 요청 라인을 8KB 안팎에서 자르고, 넘으면 `414 URI Too Long` 으로 거절하거나 그냥 잘라 버린다. 그 레거시가 겪은 게 이거였다.

그렇다고 POST로 보내면 body는 실을 수 있는데, 이 요청이 조회인지 뭔가를 바꾸는 명령인지 메서드만 봐선 알 수 없다. 캐시도, 자동 재시도도 걸 수 없다.

`QUERY`는 이 사이를 메운다. RFC 10008의 표현을 빌리면, 요청에 담긴 내용을 **safe하고 idempotent하게 처리한 뒤 그 결과를 응답**하는 메서드다. **body를 싣는데도 "이건 조회다"라는 계약이 메서드 수준에 박혀 있다.** POST로 조회하던 걸 HTTP가 공식적으로 이름 붙여준 셈이다.

## Go: 라우팅은 문자열 한 줄이면 끝

붙여보기 전엔 막연히 "Go가 QUERY를 지원해야 되는 거 아닌가" 싶었다. 아니었다. `net/http`는 메서드를 문자열로 취급한다. 서버는 문자열 하나 비교하면 끝이다.

```go
if r.Method != "QUERY" {
    http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    return
}
```

클라이언트도 `http.NewRequest` 첫 인자에 `"QUERY"` 를 넘기면 그만이다. 돌려보면 그대로 왕복한다. 표준에 없던 새 메서드인데 라이브러리 특별 지원이 하나도 안 필요했다. HTTP 메서드가 "확장 가능한 토큰"이라는 걸 코드로 확인한 셈이다.

여기까지 보고 "됐다" 싶었다. 그게 함정이었다.

## 된다 ≠ 맞다: 문서를 안 보고 만들었다

왕복이 되는 걸 보고 나서야 RFC를 제대로 읽었다. 내 첫 데모는 "QUERY 흉내"만 냈지 규칙은 거의 안 지키고 있었다.

- **body를 읽기만 하고 결과는 하드코딩이었다.** RFC는 "요청의 content와 media type이 곧 질의"라고 한다(§2). 그런데 내 서버는 어떤 body가 와도 같은 결과를 뱉었다. 조회라고 부르기 민망하다.
- **Content-Type을 안 봤다.** body가 곧 질의라 서버가 못 읽는 포맷이면 실패시켜야 한다(§2, MUST). 내 서버는 Content-Type 없이 `not-json` 을 보내도 태연히 200을 줬다.
- **상태 코드가 항상 200이었다.** 뭐가 잘못됐는지 클라이언트가 알 방법이 없었다.
- **`Accept-Query`를 반대로 썼다.** 짜고 나서야 보인 실수다. 클라이언트에서 `Accept-Query` 를 **요청 헤더로** 보냈는데, RFC에서 이건 **서버가 내려주는 응답 헤더**다(§3). 서버가 "나는 이런 query format을 받는다"고 알리는 용도로, `Accept-Post`·`Accept-Patch` 와 같은 계열이다. 클라이언트가 원하는 응답 포맷은 `Accept` 가 이미 표현하니, 클라이언트가 `Accept-Query` 를 보낼 자리는 없다.

정리하면, 새 메서드 이름만 붙였지 QUERY의 의미는 하나도 구현 안 한 거였다.

## RFC를 읽고 다시 만들었다

조항(§2.1, §3)을 하나씩 따라가며 고쳤다.

**상태 코드를 구분했다.** QUERY 상태 코드의 핵심은 실패의 종류를 나누는 거다. 특히 "문법이 틀림(400)"과 "문법은 맞는데 값이 처리 불가(422)"를 가르는 게 포인트다.

```go
// Content-Type 검증
switch mediaType {
case "":
    http.Error(w, "Content-Type required", http.StatusBadRequest)          // 400: 없음
case queryFormat: // application/json — 통과
default:
    http.Error(w, "unsupported", http.StatusUnsupportedMediaType)          // 415: 미지원
}
// ... 이후 스키마 안 맞으면 400, limit 음수처럼 값이 처리 불가면 422
```

실제로 돌려서 확인한 결과다.

| 요청 | 상태 코드 |
|---|---|
| 정상 | 200 |
| Content-Type 없음 | 400 |
| 지원 안 하는 타입(`text/plain`) | 415 |
| JSON이지만 스키마 안 맞음 | 400 |
| `limit` 음수 (값이 처리 불가) | **422** |
| `Accept: application/xml` (못 주는 포맷) | 406 |

**body가 결과를 정하게 했다.** 이제 조회 조건을 body에서 뽑아 실제로 필터한다. 같은 엔드포인트인데 body에 따라 결과가 달라진다.

```
QUERY {"name":"admin"}  →  {"results":[{"name":"admin","email":"admin@example.com"}]}
QUERY {"name":"zzz"}    →  {"results":[]}
```

**Accept-Query를 제자리로 돌렸다.** 이제 서버가 응답에 `Accept-Query: application/json` 을 실어 지원 포맷을 알리고, 클라이언트는 그걸 **읽는다**(보내지 않는다). `OPTIONS` 로 미리 물어볼 수도 있다.

```
$ curl -i -X OPTIONS localhost:8080/contacts
HTTP/1.1 204 No Content
Allow: QUERY, OPTIONS
Accept-Query: application/json
```

## Spring이었다면: 라우팅부터 벽

Go에선 라우팅이 문자열 비교라 공짜였다. Spring에선 그 앞에서 막힌다. 프레임워크가 메서드를 "아는 것만" 받도록 설계돼 있어서다. 그런데 정확히 어디서 막히는지는 버전에 따라 다르다.

**한때 벽이던 곳(Spring 5까지):** `org.springframework.http.HttpMethod` 가 8개짜리 enum이라, `HttpMethod.valueOf("QUERY")` 는 `IllegalArgumentException` 이었다. 메서드 문자열 자체가 표현이 안 됐다.

**지금 진짜 벽(Spring 6 / Boot 3):** 6.0부터 `HttpMethod` 는 **enum이 아니라 class로 바뀌었다.** 확장 메서드(WebDAV 등)를 받으려고 연 것이다. 이제 `HttpMethod.valueOf("QUERY")` 는 예외 없이 통과한다. 막히는 건 그다음, **어노테이션 매핑 계층**이다. `@PostMapping`·`@RequestMapping(method = ...)` 은 `RequestMethod` enum 기준으로 핸들러를 고르는데, 이 enum엔 여전히 QUERY가 없다. 그래서 QUERY 요청은 매핑되는 핸들러가 없어 `HttpRequestMethodNotSupportedException` → **405** 로 떨어진다.

**벽이 사라진 게 아니라 이동했다.** Go는 메서드가 처음부터 열린 문자열이고, Spring은 6.0에서 `HttpMethod` 는 열었지만 매핑 계층(`RequestMethod`)은 아직 닫힌 enum이다.

지금 당장 쓰려면 필터에서 QUERY를 POST로 감싸 매핑 계층을 통과시키고, 원래 메서드를 헤더로 남겨 컨트롤러에서 확인한다.

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class QueryMethodFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                    FilterChain chain) throws ServletException, IOException {
        if (!"QUERY".equalsIgnoreCase(req.getMethod())) {
            chain.doFilter(req, res);
            return;
        }
        String ct = req.getContentType();
        if (ct == null || !ct.contains("application/json")) {
            res.sendError(415, "Unsupported Media Type");
            return;
        }
        HttpServletRequest wrapped = new HttpServletRequestWrapper(req) {
            @Override public String getMethod() { return "POST"; }        // 매핑 계층은 POST로 인식
            @Override public String getHeader(String name) {
                if ("X-Original-Method".equalsIgnoreCase(name)) return "QUERY";
                return super.getHeader(name);
            }
        };
        chain.doFilter(wrapped, res);
    }
}
```

어디까지나 우회다. 매핑 계층엔 POST로 보이니 진짜 의미(QUERY)는 헤더로 겨우 실어 나르고, Spring Security 같은 다른 필터도 이 요청을 POST로 본다. Spring이 공식 지원하면 결국 `RequestMethod` 쪽이 열리고 `@QueryMapping` 같은 게 생기는 방향이 될 것 같다.

## 정리

이번에 두 가지를 배웠다.

하나, **새 메서드를 받아들이는 비용은 프레임워크가 "메서드"를 어디까지 열어놨느냐가 정한다.** Go는 문자열 한 줄이면 됐고, Spring은 enum으로 닫아둔 흔적 때문에 필터로 우회해야 했다. 표준은 하나인데 도입 난이도는 생태계마다 달랐다.

둘, **"된다"와 "맞다"는 다르다.** 왕복만 되는 데모는 30분이면 만들지만, Content-Type 검증·상태 코드 구분·Accept-Query 방향 같은 RFC의 본론은 문서를 실제로 읽어야 나온다. 처음에 대충 만들어 틀렸고, 조항을 따라가며 고쳐서야 QUERY라고 부를 만한 게 됐다.

URL이 너무 길어 잘리던 그 레거시를, 이제는 QUERY로 어떻게 고쳐 쓸지 그림이 그려진다.
