---
title: "[WEB] Safari에서만 로그인이 안 된다? SameSite 쿠키의 함정"
description: "Safari에서만 OAuth 소셜 로그인이 튕기던 버그. 범인은 SameSite=Strict 쿠키였고, Lax로 바꿔 해결한 디버깅 기록."
pubDate: "2026-06-23T16:44:09+09:00"
dateSource: manual
slug: web-safari-same-site
tags: 
  - safari
  - web
  - security
  - cookie
  - samesite
  - itp
category: web
draft: false
---

프로덕션에서 이상한 버그가 하나 들어왔다.

> "Safari에서 로그인을 하면 계속 튕겨요."

Chrome, Firefox, Edge에서는 멀쩡히 되는데, Safari에서만 로그인이 안 된다. 처음엔 "설마 Safari 문제겠어" 싶었는데, 재현해보니 진짜였다. 원인을 파고들다 보니 `SameSite` 쿠키 속성 하나가 문제였다.

## 먼저 의심한 것들

크로스 사이트 쿠키 문제라고 생각했고, 아래 순서로 확인했다.

- `COOKIE_DOMAIN` 설정이 잘못됐나? → `sample.com`으로 잘 돼 있었다
- `credentials: 'include'` 빠진 건 아닌가? → 들어가 있었다
- CORS 헤더가 이상한가? → `Access-Control-Allow-Credentials: true`, Origin도 정확히 지정돼 있었다

다 정상이었다. 그럼 뭐가 문제였냐.

## 실제 Set-Cookie 헤더를 까보니

Safari 개발자 도구에서 `/auth/register` 응답 헤더를 확인했다.

```
Set-Cookie: user-access-token=eyJ...; 
  Max-Age=7200; 
  Domain=sample.com; 
  Path=/; 
  HttpOnly; 
  Secure; 
  SameSite=Strict   ← 이게 문제였다
```

**`SameSite=Strict`** 가 원인이었다.

## OAuth 플로우를 그려보면 바로 보인다

지금 서비스는 구글/네이버 소셜 로그인을 쓰고 있다. 로그인 플로우는 이렇다.

```
① sample.com      → "구글로 계속하기" 클릭
② api.sample.com  → 구글 OAuth URL로 302 리다이렉트
③ google.com        → 사용자 인증/동의
④ google.com        → api.sample.com/auth/callback 으로 302 리다이렉트
⑤ api.sample.com  → JWT 발급 + Set-Cookie 응답
⑥ sample.com      → 로그인 완료
```

문제는 **④ → ⑤** 구간이다.

`api.sample.com/auth/callback`으로 들어오는 요청의 출발지가 `google.com`이다. 브라우저 입장에서 이건 **cross-site 요청**이다.

여기서 `SameSite=Strict`의 규칙이 적용된다.

> `SameSite=Strict`: 출발지가 same-site가 아닌 모든 요청에는 쿠키를 포함하지 않는다.

⑤에서 서버가 `Set-Cookie`를 내려줘도, Safari에선 결국 그 쿠키가 자리잡지 못했다. 로그인 세션이 만들어질 리가 없다.

## Strict vs Lax, 뭐가 다른가

| 요청 유형 | Strict | Lax |
|---|---|---|
| same-site 요청 | O | O |
| 외부에서 탑레벨 GET 리다이렉트 | **X** | **O** |
| 외부에서 fetch / XHR / POST | X | X |

`Lax`는 **탑레벨 GET 네비게이션(리다이렉트 포함)** 에 한해서만 cross-site를 허용한다. OAuth 콜백이 정확히 이 케이스다.

`Strict`는 출발지가 같지 않으면 무조건 막는다. 보안 측면에서 가장 강력하지만, OAuth 같은 외부 리다이렉트 플로우와는 근본적으로 맞지 않는다.


## 왜 Chrome은 되고 Safari만 안 됐냐

엄밀히는 Strict 규칙을 브라우저가 다 똑같이 적용해야 한다. 그런데 SameSite + 리다이렉트는 생각보다 구현이 제각각인 영역이다. Firefox에는 "리다이렉트에서 Strict 쿠키를 안 보낸다"는 버그 리포트가 올라와 있을 정도다([Mozilla #1465402](https://bugzilla.mozilla.org/show_bug.cgi?id=1465402)). 명세 하나를 두고도 브라우저마다 결과가 갈린다.

우리 환경에선 Chrome·Firefox·Edge는 통과했고 Safari만 막혔다. Chrome이 왜 통과했는지까지 100% 규명하진 못했다.

확실히 말할 수 있는 건, Safari엔 `SameSite` 위에 **ITP(Intelligent Tracking Prevention)** 가 한 겹 더 있다는 거다. ITP는 외부 → 서비스 → 외부로 이어지는 bounce tracking 패턴을 추적으로 의심해서, 분류된 도메인의 cross-site 쿠키를 제약한다. `SameSite`와는 별개 레이어다. 그래서 같은 설정이어도 Safari에서 먼저 터질 여지가 크다. 다만 이번 케이스에서 ITP가 정확히 무엇을 했는지는 WebKit 공식 문서로 더 확인이 필요한 영역으로 남겨둔다.


## 해결: SameSite=Lax 로 변경

```
# 변경 전
SameSite=Strict

# 변경 후
SameSite=Lax
```

서버에서 쿠키를 생성하는 코드에서 `sameSite` 값 하나만 바꿨다.

## Lax로 바꾸면 보안이 약해지는 건 아닌가

`Lax`에서 추가로 허용되는 건 **"외부에서 탑레벨 GET 리다이렉트"** 뿐이다. 외부 사이트의 `fetch`, `XHR`, `<form POST>` 는 여전히 차단된다. 즉, CSRF 공격의 핵심 경로는 막혀 있다.

거기다 이미 이런 보안 레이어가 갖춰져 있다.

```
HttpOnly  → JS에서 쿠키 탈취 불가 (XSS 방어)
Secure    → HTTPS에서만 전송 (중간자 공격 방어)
JWT       → 만료 시간 존재 (탈취해도 유효 시간 제한)
```

`Lax` + `HttpOnly` + `Secure` 조합은 Google, GitHub를 포함한 대부분의 서비스가 실제로 사용하는 표준이다. OAuth 콜백 플로우가 있는 서비스라면 `Lax`가 사실상 정답이다.

## 정리

- `SameSite=Strict`는 OAuth 콜백 플로우와 근본적으로 맞지 않는다
- OAuth 콜백은 "외부(google.com)에서 탑레벨 GET 리다이렉트"라서, `Strict`면 이 cross-site 구간에서 쿠키가 막힌다 (`Lax`는 이 구간만 허용한다)
- `SameSite=Lax`로 변경하면 해결되고, 보안 측면에서도 충분하다
- Safari는 ITP 때문에 이런 문제가 더 먼저, 더 확실하게 터진다 — 항상 Safari도 별도로 테스트하자
