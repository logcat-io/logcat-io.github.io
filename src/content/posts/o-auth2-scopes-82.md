---
title: "[FASTAPI] OAuth2 Scopes"
description: 'FastAPI는 Python 기반의 최신 웹 프레임워크로, 속도와 직관성을 동시에 제공하는 것으로 유명한 프레임워크이다.'
pubDate: '2025-08-10T14:31:30+09:00'
dateSource: html-visible
slug: o-auth2-scopes-82
tags:
  - JWT
  - oauth2
  - 인증
  - api
  - 보안
  - Scopes
category: Python Framework/FastAPI
draft: false
legacy:
  tistoryId: '82'
  sourceHtml: '82/82-[FastAPI]-?-OAuth2-Scopes.html'
  sourceHash: 'sha256:fb9d17d727114e2ed5165dbdfd1ce3658a57c8348e483fa139c1c061cefa7f69'
---

FastAPI는 Python 기반의 최신 웹 프레임워크로, 속도와 직관성을 동시에 제공하는 것으로 유명한 프레임워크이다.  
그중에서도 **OAuth2 Scopes** 기능은 보안과 권한 관리에서 매우 중요한 역할을 한다.

## OAuth2 Scopes란?

**OAuth2 Scopes**는 "누가 무엇을 할 수 있는지"를 세분화해서 정의하는 **권한 단위**이다.  
즉, 단순히 "로그인 성공"만으로 모든 API 접근을 허용하는 것이 아니라,  
**각 API 엔드포인트마다 세부 권한을 지정**할 수 있게 해주는 개념이다.

> 예시:
> 
> -   users:read → 사용자 정보를 읽을 수 있는 권한
> -   users:write → 사용자 정보를 수정할 수 있는 권한
> -   items → 아이템 데이터를 읽는 권한
> -   Google API 예시: [https://www.googleapis.com/auth/drive](https://www.googleapis.com/auth/drive)

이렇게 스코프를 정의하면, **토큰이 어떤 스코프를 포함하느냐에 따라 접근을 제어**할 수 있다.

## FastAPI에서 OAuth2 Scopes 정의하기

FastAPI에서는 OAuth2PasswordBearer를 사용할 때 scopes 매개변수를 통해 스코프를 정의한다.

```python
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="token",
    scopes={
        "me": "Read information about the current user.",
        "items": "Read items."
    },
)
```

여기서 scopes 딕셔너리의 key는 스코프 이름, value는 설명이다.  
이 정보는 **OpenAPI 문서**에도 반영되어 Swagger UI에서 확인할 수 있다.

## 스코프 검증 로직 작성하기

스코프 검증은 보통 사용자 인증 단계에서 수행된다.  
FastAPI는 SecurityScopes 객체를 통해 **요청된 경로에 필요한 스코프 목록**을 제공한다.

```python
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import SecurityScopes

async def get_current_user(
    security_scopes: SecurityScopes,
    token: str = Depends(oauth2_scheme)
):
    # 필요한 스코프 문자열 구성 (예: Bearer scope="me items")
    if security_scopes.scopes:
        authenticate_value = f'Bearer scope="{security_scopes.scope_str}"'
    else:
        authenticate_value = "Bearer"

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": authenticate_value},
    )

    # 여기서 JWT 토큰 검증 및 사용자 조회 로직 실행
    user = fake_decode_token(token)

    # 사용자 또는 스코프 검증 실패 시 예외 발생
    for scope in security_scopes.scopes:
        if scope not in user.scopes:
            raise credentials_exception

    return user
```

여기서 중요한 점은 다음과 같다.

-   security\_scopes.scopes → 경로에서 요구한 스코프 목록
-   토큰에 포함된 스코프와 비교하여 부족하면 401 에러를 발생시킨다.

## 경로별 스코프 지정하기

FastAPI는 Security()를 사용해 **엔드포인트마다 요구 스코프를 선언**할 수 있다.

```python
from fastapi import APIRouter, Security

@app.get("/users/me")
async def read_users_me(
    current_user = Security(get_current_user, scopes=["me"])
):
    return current_user

@app.get("/users/me/items")
async def read_own_items(
    current_user = Security(get_current_user, scopes=["items"])
):
    return [{"item_id": "Foo", "owner": current_user.username}]
```

-   /users/me → me 스코프 필요
-   /users/me/items → items 스코프 필요

이렇게 하면 경로별로 접근 제어를 정밀하게 설정할 수 있다.

## 실제 인증 흐름 예시

1.  **로그인 요청**
    -   클라이언트가 아이디/비밀번호로 /token 엔드포인트에 로그인 요청
    -   요청 시 필요한 스코프를 함께 요청 (scope=me items)
2.  **토큰 발급**
    -   서버는 해당 스코프를 포함한 JWT 액세스 토큰 발급
3.  **API 호출**
    -   클라이언트가 Authorization 헤더(Bearer <token>)로 API 호출
4.  **스코프 검증**
    -   FastAPI가 엔드포인트에 필요한 스코프와 토큰의 스코프를 비교
5.  **허용 또는 거부**
    -   스코프가 모두 충족되면 응답, 아니면 401 Unauthorized

## 장점

-   **보안 강화**: 불필요한 권한을 최소화 (최소 권한 원칙)
-   **API 문서 자동화**: OpenAPI/Swagger UI에서 스코프를 명확히 표시
-   **확장성**: 권한 구조를 계층적으로 설계 가능

## 마무리

OAuth2 Scopes는 처음에는 조금 복잡하게 느껴질 수 있지만, 한 번 구조를 잡아두면 API 보안 설계가 훨씬 깔끔해진다.  
FastAPI는 이를 매우 직관적인 방식으로 지원하므로, 보안이 중요한 서비스라면 꼭 적용해보는 것을 추천한다.
