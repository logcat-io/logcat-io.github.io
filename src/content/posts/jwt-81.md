---
title: '? JWT 로그인 구현하기'
description: 사용자 인증은 모든 웹 서비스의 핵심이다.
pubDate: '2025-08-07T18:58:22+09:00'
dateSource: html-visible
slug: jwt-81
tags:
  - 파이썬
  - JWT
  - JSON
  - Web
  - Token
  - 사용자
  - 인증
category: Python Framework/FastAPI
draft: false
legacy:
  tistoryId: '81'
  sourceHtml: '81/81-[FastAPI]-?-JWT-로그인-구현하기.html'
  sourceHash: 'sha256:2a9d4af19127a628172ef96bef78881b281fe11c53fbe5a739eb0ae6a959e387'
---

목차

* * *

사용자 인증은 모든 웹 서비스의 핵심이다.  
FastAPI에서는 **JWT (JSON Web Token)**를 활용하여 인증 기능을 간결하면서도 강력하게 구현할 수 있다.

이 글에서는 JWT 토큰 **생성 → 검증 → 로그인 구현**까지 실전 예제로 설명한다. 또한 FastAPI의 HTTPException과 status를 활용한 예외 처리도 함께 다룬다.

## JWT란?

**JWT (Json Web Token)**는 클라이언트와 서버 간에 **서로 신뢰할 수 있는 방식으로 정보를 주고받기 위한 토큰 포맷**이다.

JWT는 다음과 같은 구조를 가진다.

```bash
Header.Payload.Signature
```

예시 payload:

```bash
{
  "id": 123,
  "exp": 1723042151
}
```

## 준비 사항

JWT 처리를 위해 python-jose 라이브러리를 사용한다. 설치는 아래와 같다.

```bash
pip install "python-jose[cryptography]" fastapi
```

비밀번호 비교를 위해 passlib도 함께 사용하는 것을 권장한다.

```bash
pip install passlib[bcrypt]
```

## JWT 토큰 생성 함수

```python
from datetime import datetime, timedelta, timezone
from jose import jwt

SECRET_KEY = "THIS_IS_SUPER_SECRET_KEY"
ALGORITHM = "HS256"

def create_access_token(payload: dict, expires_delta: timedelta = timedelta(hours=6)) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

-   payload: 토큰에 담을 사용자 정보 (user\_id, 권한 등)
-   exp: 토큰 만료 시간 (UTC 기준)
-   jwt.encode: 서명된 JWT 토큰을 생성한다

## JWT 토큰 검증 함수

```python
from fastapi import HTTPException, status
from jose import JWTError, jwt

def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
```

-   jwt.decode: JWT를 복호화한다
-   실패 시 JWTError가 발생하며, HTTP 401 에러로 처리한다

## 로그인 함수 구현

다음은 실제 로그인 로직이다.  
사용자가 이메일과 비밀번호로 로그인하면 아래 절차를 따른다.

1.  이메일로 사용자 조회
2.  비밀번호 검증
3.  JWT 토큰 발급

```bash
from fastapi import HTTPException, status

class AuthService:
    def __init__(self, user_repo, crypt):
        self.user_repo = user_repo  # 사용자 조회를 위한 repository
        self.crypt = crypt          # 암호화 비교 유틸 (예: passlib)

    def login(self, email: str, password: str) -> str:
        user = self.user_repo.find_by_email(email)

        if user is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")

        if not self.crypt.verify(password, user.password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")

        return create_access_token(payload={"id": user.id})
```

-   반환 결과

```bash
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDFLMjFYSFJBOTNaUVJSS1BaQlJQRzFZRVgiLCJleHAiOjE3NTQ1ODAzMDV9.0NqjJBlT4MT4DDAn-xGfm4dF8ZFyFsoFTukSNZHDzus",
  "token_type": "bearer"
}
```

## 공식 문서 참고

-   FastAPI - JWT 보안 가이드  
    [https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
-   python-jose GitHub  
    [https://github.com/mpdavis/python-jose](https://github.com/mpdavis/python-jose)
-   passlib (비밀번호 해시 라이브러리)  
    [https://passlib.readthedocs.io/](https://passlib.readthedocs.io/)

## 마무리 요약

<table style="border-collapse: collapse; width: 100%;" border="1" data-end="3133" data-start="2818" data-ke-align="alignLeft"><tbody data-end="3133" data-start="2934"><tr data-end="2985" data-start="2934"><td data-col-size="sm" data-end="2949" data-start="2934">토큰 생성</td><td data-end="2985" data-start="2949" data-col-size="sm">create_access_token() 함수 사용</td></tr><tr data-end="3037" data-start="2986"><td data-col-size="sm" data-end="3001" data-start="2986">토큰 검증</td><td data-end="3037" data-start="3001" data-col-size="sm">decode_access_token() 함수 사용</td></tr><tr data-end="3080" data-start="3038"><td data-col-size="sm" data-end="3052" data-start="3038">로그인 구현</td><td data-end="3080" data-start="3052" data-col-size="sm">이메일 조회 및 비밀번호 검증</td></tr><tr data-end="3133" data-start="3081"><td data-col-size="sm" data-end="3096" data-start="3081">예외 처리</td><td data-end="3133" data-start="3096" data-col-size="sm">HTTPException과 status 활용</td></tr></tbody></table>

FastAPI에서 JWT 인증을 직접 구현하면 비교적 단순하면서도 유연하게 확장할 수 있다.
