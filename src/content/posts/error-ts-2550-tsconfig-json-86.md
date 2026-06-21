---
title: 'ERROR: TS2550 tsconfig.json이 무시되는 이유와 해결 방법'
description: >-
  TypeScript를 쓰다 보면 동일한 코드임에도 실행 방식에 따라 오류가 발생하는 경우가 있다. 이번 글에서는 npm run dev에서만
  findIndex 같은 ES2015 메서드가 인식되지 않는 TS2550 오류를 파헤치고, monorepo 환경에서 자주 겪는 tsconfig
  무시
pubDate: '2025-09-12T14:25:07+09:00'
dateSource: html-visible
slug: error-ts-2550-tsconfig-json-86
tags:
  - tsconfig.json
  - error
  - ts2550
  - build
category: Language/TypeScript
draft: false
legacy:
  tistoryId: '86'
  sourceHtml: 86/86.html
  sourceHash: 'sha256:36812ca2c84edfdbb26164258b341bd96bc7f39bb84be49da4c442288678b20d'
---

목차

* * *

### npm run dev에서만 TS2550 오류가 발생하는 이유

TypeScript를 쓰다 보면 동일한 코드임에도 실행 방식에 따라 오류가 발생하는 경우가 있다. 이번 글에서는 npm run dev에서만 findIndex 같은 ES2015 메서드가 인식되지 않는 **TS2550 오류**를 파헤치고, monorepo 환경에서 자주 겪는 **tsconfig 무시 문제**까지 확장해 보겠습니다.

#### 문제 상황

코드:

```typescript
const i = user.findIndex((u) => u.name === name);
```

직접 실행하면 정상 동작한다.

```typescript
tsc --target es2015 main.ts  # 정상 컴파일
```

하지만 package.json에 다음과 같이 스크립트를 등록해 실행하면 에러가 발생한다.

```typescript
{
  "scripts": {
    "dev": "tsc main.ts && node main.js"
  }
}
```

결과:

```typescript
repository.impl.v1.ts:21:24

error TS2550: Property 'findIndex' does not exist on type '{ userId: number; name: string; }[]'. Do you need to change your target library?
Try changing the 'lib' compiler option to 'es2015' or later.

21         const i = user.findIndex((u) => u.name === name);
                          ~~~~~~~~~
Found 1 error in repository.impl.v1.ts:21
```

#### 원인 분석

핵심은 **tsconfig.json이 적용되지 않는다**는 점이다.

-   tsc --target es2015 main.ts  
    → 명령행에서 **target을 직접 강제**했기 때문에 문제 없음.
-   tsc main.ts  
    → **파일을 직접 지정하면 tsconfig.json이 무시**된다.  
    → 따라서 TypeScript 기본 target(ES3/ES5 수준)으로 컴파일.  
    → ES2015에 추가된 findIndex를 알 수 없어 오류 발생.

정리하면, **npm run dev 스크립트가 tsconfig.json을 사용하지 않아서** 생긴 문제이다.

#### 해결 방법

1\. 프로젝트 단위로 tsconfig 사용

package.json:

```typescript
{
  "scripts": {
    "dev": "tsc -p tsconfig.json && node dist/main.js"
  }
}
```

```typescript
{
  "compilerOptions": {
    "target": "es2016",
    "lib": ["es2016", "dom"],
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

이제 npm run dev에서도 findIndex 오류가 사라집니다.

2\. 명령행에서 옵션 강제 (임시 방편)

```typescript
{
  "scripts": {
    "dev": "tsc --target es2015 main.ts && node main.js"
  }
}
```

빠른 해결은 가능하지만, **설정이 분산**되어 유지보수가 어렵다. 팀 프로젝트나 규모 있는 코드베이스라면 반드시 tsconfig.json 기반으로 통일하는 게 좋다.

### Monorepo 환경에서 자주 발생하는 tsconfig 무시 문제

Monorepo(멀티 패키지 구조)에서는 루트와 패키지별 tsconfig가 섞이면서 이런 문제가 자주 발생한다.

#### 전형적인 증상

-   루트에 tsconfig.json이 있음에도, 패키지 빌드 시 적용되지 않음.
-   Jest, ts-node, webpack 등 툴이 각자 다른 tsconfig를 참조해 타입이 다르게 잡힘.
-   특정 패키지에서만 findIndex, includes, Promise 같은 최신 API가 없다고 에러 발생.

#### 원인

-   tsc file.ts처럼 **파일 단위 컴파일**을 하면 루트 tsconfig가 무시됨.
-   툴 체인에서 **tsconfig 경로를 명시하지 않아** 루트가 아닌 기본값/로컬 tsconfig를 사용하는 경우.

#### 해결

1.  **루트에 tsconfig.base.json** 두고 모든 패키지가 이를 extends:

```typescript
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "es2016",
    "lib": ["es2016", "dom"],
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

```typescript
// packages/app/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

2\. **툴체인 설정에서 tsconfig 경로를 고정**

-   ts-node: --project tsconfig.json
-   jest (ts-jest): globals.ts-jest.tsconfig = '<rootDir>/tsconfig.json'
-   webpack(ts-loader): configFile: 'tsconfig.json'

이렇게 하면 monorepo 환경에서도 **항상 동일한 tsconfig**가 적용되어 일관성을 확보할 수 있다.

### 마무리

-   tsc main.ts는 tsconfig.json을 무시하기 때문에 최신 ECMAScript 기능을 인식하지 못한다.
-   해결책은 **항상 -p tsconfig.json으로 프로젝트 단위 컴파일**하는 것이다.
-   Monorepo에서는 루트와 패키지별 tsconfig를 extends로 정리하고, 툴체인마다 경로를 고정해 주어야 재발을 막을 수 있다.

### 공식 문서 참고

-   TypeScript Handbook - tsconfig.json
-   Compiler Options - project
-   Compiler Options - target
-   Project References
