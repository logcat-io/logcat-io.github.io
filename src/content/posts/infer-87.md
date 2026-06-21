---
title: infer
description: >-
  타입스크립트를 조금만 깊게 쓰다 보면 infer라는 정체불명의 키워드를 보게 된다. ReturnType, Parameters,
  ConstructorParameters 같은 공식 유틸리티 타입들의 핵심에도 항상 숨어 있는 존재이다.
pubDate: '2025-09-13T13:05:22+09:00'
dateSource: html-visible
slug: infer-87
tags:
  - infer
  - conditional
  - types
category: Language/TypeScript
draft: false
legacy:
  tistoryId: '87'
  sourceHtml: '87/87-[TypeScript]-infer.html'
  sourceHash: 'sha256:ba48a3fdf436d120f70d6bd402ef9d49dc1f44b8da3247b74a1b64a48d4bae43'
---

목차

* * *

타입스크립트를 조금만 깊게 쓰다 보면 infer라는 정체불명의 키워드를 보게 된다. ReturnType, Parameters, ConstructorParameters 같은 공식 유틸리티 타입들의 핵심에도 항상 숨어 있는 존재이다.

이번 글에서는 infer에 대해서 정리하고, infer가 실제로 **타입스크립트 타입 시스템의 강력한 추론 엔진** 역할을 어떻게 하는지 살펴보려고 한다.

### infer 란?

infer는 **조건부 타입(Conditional Types)** 내부에서만 사용할 수 있는 키워드이다.

문법은 다음과 같다:

```typescript
T extends SomeType<infer U> ? U : Fallback
```

여기서 핵심은 infer U.

-   타입스크립트에게 "여기서 타입을 추론해서 U라는 이름으로 쓰겠다"라고 지시하는 것이다.
-   함수의 매개변수, 반환 타입, 제네릭 인자 등 어떤 위치든 가능하다.

### 공식 유틸리티 타입 보기

타입스크립트가 기본 제공하는 유틸리티 타입들 대부분이 infer로 구현되어 있다. 몇 가지 예시를 직접 보자.

#### ReturnType

```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;
```

함수 타입이면 반환 타입 R을 추출한다. 아니면 any이다.

```typescript
type A = ReturnType<() => number>;  // number
```

#### Parameters

```typescript
type Parameters<T> = T extends (...args: infer P) => any ? P : never;
```

함수의 매개변수 타입들을 P라는 튜플로 추출한다.

```typescript
type A = Parameters<(x: string, y: number) => void>;
// [x: string, y: number]
```

#### ConstructorParameters

```typescript
type ConstructorParameters<T extends new (...args: any) => any> =
    T extends new (...args: infer P) => any ? P : never;
```

생성자 함수의 매개변수 타입들을 추출한다.

```typescript
class User {
  constructor(public id: number, public name: string) {}
}

type Params = ConstructorParameters<typeof User>;
// [id: number, name: string]
```

#### InstanceType

```typescript
type InstanceType<T extends new (...args: any) => any> =
    T extends new (...args: any) => infer R ? R : any;
```

생성자 함수가 만들어내는 인스턴스 타입을 추출한다.

```typescript
type UserInstance = InstanceType<typeof User>;
// User
```

### 활용 예제

#### 깊은 Promise 풀기

비동기 함수에서 흔히 생기는 Promise<Promise<Promise<T>>> 같은 중첩을 풀어내려면 재귀적 infer가 유용하다.

```typescript
type DeepAwaited<T> = T extends Promise<infer U> ? DeepAwaited<U> : T;

type A = DeepAwaited<Promise<Promise<string>>>;  
// string
```

#### 배열/튜플의 마지막 원소 타입 구하기

```typescript
type Last<T extends any[]> = T extends [...infer _, infer L] ? L : never;

type A = Last<[number, string, boolean]>;  
// boolean
```

**...infer \_** 를 사용해 앞부분은 무시하고 마지막 원소만 추출할 수 있다.

#### 함수 합성 유틸리티 만들기

두 함수가 연결될 때, 첫 번째 함수의 반환 타입과 두 번째 함수의 매개변수 타입이 맞아야 한다. 이를 타입으로 보장할 수 있다.

```typescript
type Compose<A, B> = 
  A extends (x: infer X) => infer Y ?
  B extends (y: Y) => infer Z ?
  (x: X) => Z : never : never;

type F1 = (x: number) => string;
type F2 = (y: string) => boolean;

type Composed = Compose<F1, F2>;
// (x: number) => boolean
```

### infer의 제약과 주의할 점

-   **조건부 타입 안에서만 사용 가능**: infer는 독립적으로 존재할 수 없다. 반드시 extends 조건문 안에서 등장해야 한다.
-   **추론이 여러 후보로 갈리면 분배**: 유니온 타입에 대해서는 각각 추론을 시도한 뒤 유니온으로 합쳐진다.

```typescript
type Element<T> = T extends (infer U)[] ? U : never;

type A = Element<string[] | number[]>;
// string | number
```

## 마무리

정리하자면,

-   infer는 타입스크립트가 추론한 타입에 이름을 붙여 재활용할 수 있게 한다.
-   공식 유틸리티 타입의 핵심이자, 타입 시스템에서 "타입을 프로그래밍"할 수 있게 해주는 도구이다.
-   재귀적 추론, 튜플 조작, 함수 합성 등 다양한 고급 패턴에서 활용할 수 있다.

infer는 처음엔 낯설지만, 익숙해지고 나면 타입스크립트의 타입 시스템이 얼마나 강력하고 표현력이 풍부한지 실감하게 된다.

### 공식 문서 참고

-   [TypeScript HandBook - Infering Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
