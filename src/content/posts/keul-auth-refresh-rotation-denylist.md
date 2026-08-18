---
title: "[PROJECT] 인증은 로그인 성공이 아니라 탈취 이후를 설계하는 일이다"
description: "소셜 로그인 구현은 흔하다. 이 글은 그 다음 — refresh token이 탈취돼 재사용될 때, 탈퇴한 사용자의 access token이 살아 있을 때, 같은 email로 계정이 잘못 합쳐질 때 어디서 끊을 것인가를 코드와 테스트로 고정한 기록이다. 한계까지 같이 적었다."
pubDate: "2026-07-09T19:30:00+09:00"
dateSource: manual
slug: keul-auth-refresh-rotation-denylist
tags:
  - auth
  - oauth
  - oidc
  - jwt
  - redis
  - security
category: Project/끌올
draft: true
---

포트폴리오에서 소셜 로그인은 흔하다. provider SDK 붙이고, JWT 발급하고, 보호 API 호출까지 확인하면 보통 거기서 끝난다.

끌올(개인 콘텐츠 아카이빙 서비스)의 인증을 만들면서는 그 선에서 멈추지 않기로 했다. 붙이는 것보다 신경 쓴 건 이거였다.

**토큰이 탈취되거나, 재사용되거나, 계정이 잘못 합쳐졌을 때 — 어디서 끊을 것인가.**

끌올은 링크와 이미지를 저장하는 개인화 서비스다. 계정이 잘못 식별되면 남의 콘텐츠가 섞이고, 탈퇴한 사용자의 access token이 살아 있으면 탈퇴 후에도 보호 API에 접근할 수 있다. 그래서 구현 기준을 처음부터 이렇게 잡았다.

```text
1. email 자동 병합 금지
2. access token은 짧게, 즉시 차단 가능하게
3. refresh token은 family 단위 rotation + 재사용 탐지
4. OTP는 replay / 남용 / 로그 노출을 각각 차단
5. 성공 케이스가 아니라 오용 케이스를 테스트로 고정
```

전체 흐름은 단순하다. 외부 IdP(Kakao/Google/Apple)의 `id_token`은 **로그인 순간에만** 검증하고, 이후 세션은 끌올 자체 access/refresh 토큰으로 관리한다.

```text
App ──(id_token + nonce)──> POST /auth/social
        │
        ▼
  IdTokenVerifier (iss / aud / sig / exp / nonce)
        │
        ▼
  AccountResolver ── (provider, provider_id) 로 식별
        │
        ▼
  TokenIssuance ──> accessToken(900s) + refreshToken(30d)
                          │
                          └─> Redis: refresh family / current jti
```

## 1. id_token은 왜 서버가 다시 검증하나

클라이언트가 IdP 로그인에 성공해서 `id_token`을 들고 왔다. 그럼 그걸 믿으면 되지 않나?

안 된다. `id_token`은 클라이언트를 거쳐서 온다. 서버 입장에서 이 토큰은 "누가 만들었는지, 나한테 온 게 맞는지, 지금 이 로그인 시도에서 나온 건지"를 전부 다시 물어야 하는 외부 입력이다. 검증 항목 하나하나가 막는 공격이 다르다.

| 검증 | 막는 것 |
|---|---|
| signature (JWKS 공개키) | 토큰 위조 |
| iss | 다른 발급자가 만든 토큰 |
| aud | **다른 앱에 발급된 정상 토큰의 재사용** (audience confusion) |
| exp | 만료 토큰 재사용 |
| nonce | 이전 로그인에서 캡처한 토큰의 replay |

이 중 aud가 실무에서 은근히 까다로웠다. Kakao는 네이티브 앱 키·REST 키·JS 키마다 `aud`가 다르다. 단일 값 비교로 짜면 플랫폼 하나가 로그인이 안 된다.

```kotlin
JWT.require(Algorithm.RSA256(key, null))
    .withIssuer("https://kauth.kakao.com")
    .withAnyOfAudience(*allowedAudiences.toTypedArray()) // 네이티브/REST/JS 중 하나면 통과
    .acceptLeeway(60)
    .build()
    .verify(idToken)

val nonce = decoded.getClaim("nonce").asString()
if (nonce == null || nonce != expectedNonce) {
    throw InvalidIdTokenException("invalid nonce")
}
```

여기서 하나 자백. **Kakao verifier는 nonce까지 검증하는데, Google verifier에는 nonce 검증이 아직 빠져 있다.** provider별 검증 수준이 다른 건 그 자체로 구멍이다. 개선 항목 표에 올려뒀다.

## 2. 계정 식별 — email을 버렸다

처음엔 email 병합이 단순해 보였다. Kakao와 Google이 같은 email을 내려주면 같은 사람으로 보면 되니까.

그런데 email은 식별키로 쓰기엔 근거가 약하다. provider마다 없을 수 있고, 검증 상태도 제각각이다. 결정적으로 — **email 자동 병합은 계정 소유권 검증을 우회하는 경로가 될 수 있다.** 어떤 provider에서 검증 안 된 email을 들고 오면, 그 email의 기존 계정에 올라타는 시나리오가 생긴다.

그래서 식별키를 provider가 서명으로 보증하는 값으로 고정했다.

```text
회원 식별키 = oauth_accounts(provider, provider_id)   ← unique
users.email = nullable 부가정보                        ← unique 없음
```

트레이드오프는 명확하다. 같은 사용자가 같은 email로 Kakao와 Google에 각각 가입하면 자동으로 합쳐지지 않는다. 편의를 버리고 소유권 보증을 택했다. 계정 연결 기능은 "재인증 후 명시적 연결"로 풀어야 하는 별도 문제고, 아직 목록 조회까지만 있다.

같은 email·다른 provider가 서로 다른 user로 풀리는 건 통합 테스트로 고정했다 (`sameEmailDifferentProvider_resolvesDistinctUsers`).

## 3. access token — stateless의 대가를 정면으로 냈다

JWT의 장점은 서버가 상태를 안 들고 있어도 된다는 것이다. 그런데 이 장점은 그대로 단점이 된다. **한 번 발급한 토큰은 만료 전까지 서버가 못 죽인다.**

로그아웃했는데 토큰이 살아 있다. 탈퇴했는데 보호 API가 열린다. 개인화 서비스에서 이건 수용이 안 된다.

그래서 access token에 `jti`(토큰 고유 ID)를 넣고, 즉시 차단이 필요한 순간에만 Redis denylist에 등록한다.

```text
denylist:jti:{accessJti} -> "1"
TTL = access token 잔여 수명 (900초 이하)
```

```kotlin
val claims = tokenIssuer.parseAccess(token)

if (accessDenylist.isDenied(claims.jti)) {
    throw UnauthenticatedException("...")
}

AuthContext.set(claims.userId, claims.jti)
```

denylist는 무한히 자라지 않는다. access TTL이 900초라 등록된 항목도 900초면 자연 소멸한다. "차단해야 할 토큰"만, "그 토큰이 살아 있을 수 있는 시간"만큼만 들고 있는 것이다.

대가도 분명하다. 보호 API 매 요청마다 Redis 조회가 1회 붙는다. "완전 stateless"라는 JWT의 장점을 일부 반납한 트레이드오프고, 그럴 가치가 있다고 판단했다 — 로그아웃·탈퇴 즉시 차단은 개인화 서비스에서 협상 대상이 아니다.

인터셉터엔 사소해 보이지만 아픈 디테일이 하나 더 있다.

```kotlin
override fun afterCompletion(...) {
    AuthContext.clear() // ThreadLocal 누수 방지 — 톰캣 스레드 재사용 시 이전 user_id 잔존 위험
}
```

ThreadLocal을 요청 끝에서 안 지우면, 톰캣이 스레드를 재사용할 때 **이전 요청의 user_id가 다음 요청에 잔존**할 수 있다. 인증 컨텍스트에서 이건 데이터 섞임 사고다.

## 4. refresh rotation + family — 탈취를 "막는" 게 아니라 "들키게" 만든다

refresh token은 30일짜리 bearer token이다. 들고 있으면 권한이다. 탈취를 100% 막을 방법은 없다.

그래서 목표를 바꿨다. 못 막으면, **들키게 만든다.** OAuth 2.0 Security BCP가 권고하는 rotation + 재사용 탐지가 정확히 이 장치다.

원리는 이렇다. refresh할 때마다 새 토큰을 발급하고 이전 토큰은 무효가 된다. 만약 어딘가에서 토큰이 복제됐다면 — 정상 클라이언트와 공격자 중 **한쪽은 반드시 구 토큰을 쓰게 된다.** 그 순간이 탐지 지점이다.

끌올은 refresh token 원문을 Redis에 저장하지 않는다. 로그인 1회 = family 1개로 묶고, family별 "현재 유효한 jti" 하나만 저장한다.

```text
rt:family:{familyId}:current -> { "jti": "{currentJti}" }
rt:user:{userId}:families    -> Set<familyId>
```

```kotlin
fun execute(command: RefreshCommand): AuthSession {
    val claims = tokenIssuer.parseRefresh(command.refreshToken)
    val stored = refreshTokens.currentJti(claims.familyId)
        ?: throw InvalidRefreshTokenException("no family")

    if (!MessageDigest.isEqual(
            stored.toString().toByteArray(),
            claims.jti.toString().toByteArray()
        )
    ) {
        refreshTokens.revokeFamily(claims.familyId)   // 단순 실패가 아니라 탈취 신호
        throw RefreshTokenReusedException()
    }

    return tokenIssuance.issueWithExistingFamily(...) // 내부에서 current jti 교체(rotate)
}
```

들어온 토큰의 `jti`가 current와 다르다? 그건 "이미 rotate된 구 토큰이 다시 들어왔다"는 뜻이다. 이때는 요청 하나를 거절하는 게 아니라 **family 전체를 닫는다.** 정상 사용자든 공격자든 그 계보의 토큰은 전부 죽고, 재로그인만 남는다. 불편하지만, 탈취 가능성 앞에서 세션을 살려두는 것보다 낫다고 봤다.

비교에 `==` 대신 `MessageDigest.isEqual`을 쓴 건 상수 시간 비교 습관이다. jti 비교에서 타이밍 차이가 실제 공격으로 이어질 가능성은 낮지만, 인증 경로의 비교 연산은 기본값을 상수 시간으로 두는 쪽이 마음이 편하다.

## 5. 이메일 OTP — 같은 계정 모델에 얹었다

보조 로그인으로 이메일 OTP가 들어왔을 때 별도 계정 테이블을 만들지 않았다. `oauth_accounts`에 `EMAIL` provider를 추가하고, `provider_id`에는 평문 email 대신 `SHA-256(lowercase(trim(email)))`을 넣었다. 식별과 unique 제약에는 해시로 충분하고, 식별자 컬럼에 평문 PII를 반복 저장할 이유가 없다.

```text
OTP TTL 300초 · 검증 성공 시 즉시 삭제(replay 차단) · 실패 5회 초과 시 폐기
발송 rate limit: email 기준 1분 1회·1시간 5회 / IP 기준 1분 5회·1시간 20회 (Redis Lua 원자 판정)
```

로그 노출도 별도로 막았다. OTP 경로 소스에서 `code/email/otp` 로그 보간 패턴이 0건인지 정적 테스트(`OtpPiiLogGuardTest`)로 잡아둔다 — 사람이 리뷰에서 놓쳐도 테스트가 잡는다.

## 6. 성공 케이스가 아니라 오용 케이스를 테스트했다

이 인증 구현에서 제일 힘을 준 부분이다. "로그인하면 토큰이 나온다"는 테스트는 아무것도 보증하지 않는다. 테스트는 실패 모드 기준으로 나눴다.

| 오용 시나리오 | 방어 | 
|---|---|
| rotation 이후 구 refresh token 재사용 | current jti 불일치 → family 전체 폐기 |
| 로그아웃·탈퇴 후 access token으로 접근 | jti denylist → 401 |
| access와 refresh를 바꿔 끼움 | claim `type`으로 파싱 경로 격리 |
| 위조·변조 JWT | 서명 검증 실패 |
| 같은 email, 다른 provider 자동 병합 | `(provider, provider_id)`만 식별키 |
| OTP 재사용 | 성공 즉시 삭제 |
| OTP 무차별 시도 | 5회 초과 폐기 + rate limit |
| OTP/email 로그 노출 | PII 로그 정적 가드 |

라이브 통합에서도 같은 흐름을 한 번에 돌렸다 — OTP 발송부터 `/me`, refresh rotation, 구 토큰 재사용 401, 로그아웃 후 401까지. 서버 전체 테스트는 338개다.

## 7. 한계 — 지금 이 구현이 못 하는 것

포트폴리오니까 잘한 것만 적고 싶지만, 그러면 이 글의 전제가 무너진다. 오용 시나리오로 설계했다면 자기 구현의 구멍도 같은 기준으로 열거해야 한다.

**제일 큰 구멍은 rotation 자체가 원자적이지 않다는 것이다.**

```kotlin
val stored = refreshTokens.currentJti(claims.familyId)  // ① GET
// ② 비교
tokenIssuance.issueWithExistingFamily(...)              // ③ SET (rotate)
```

같은 유효 토큰으로 동시에 refresh 요청 2개가 들어오면, 둘 다 ①에서 같은 current jti를 읽고, 둘 다 ②를 통과하고, 둘 다 ③에서 rotate한다. 토큰이 두 벌 발급되고 재사용 탐지는 발동하지 않는다. 공격이라기보다 정상 클라이언트의 네트워크 재시도에서 먼저 만날 경계인데, 어느 쪽이든 "재사용을 탐지한다"는 보증이 그 순간엔 깨진다. GET·비교·SET을 Redis Lua 스크립트 하나로 묶는 CAS가 맞는 방향이고, 다음 개선 1순위다.

나머지도 표로 남긴다.

| 개선 항목 | 왜 |
|---|---|
| refresh rotation Lua CAS 원자화 | 위 동시성 경계 제거 — 1순위 |
| Google nonce 검증 | provider별 검증 수준 불일치 해소 |
| logout-all의 access 처리 | family는 전부 닫지만 이미 발급된 access 무효화는 약함 |
| OTP Redis key PII 축소 | `otp:email:{email}` → 해시 기반 key |
| 실제 메일 발송 인프라 | 현재 sender는 no-op (발송 흐름만 검증됨) |
| JWT key rotation | HMAC 단일 secret → `kid` 기반 회전 |
| 계정 연결/해제 | 재인증 + 마지막 수단 해제 금지 + audit log |

## 마치며

인증을 "로그인이 되는가"로 검수하면 전부 초록불이었다. "탈취된 다음에도 설계가 유효한가"로 물으니 고칠 게 계속 나왔다.

질문을 바꾸는 것이 설계였다.
