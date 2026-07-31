---
title: "[GO] implements가 없는데 의존성이 뒤집힌다 - 인터페이스는 소비자가 소유한다"
description: "PostgresRepo가 있는 패키지는 service를 import하지 않는데 main에서 한 줄로 연결된다. Go의 암묵적 인터페이스 구현이 컴파일 시점에 어떻게 검사되고, 소비자 소유 인터페이스가 패키지 의존성을 어떻게 끊는지 정리했다."
pubDate: "2026-08-01T01:22:44+09:00"
dateSource: manual
slug: go-implicit-interface-dependency-inversion
tags:
  - Go
  - interface
  - dependency-inversion
  - architecture
  - testing
category: Language/Go
draft: false
---

Java나 Spring 코드에서는 구현 클래스가 어떤 인터페이스를 구현하는지 선언부에 드러난다.

```java
class PostgresRepo implements PostRepository {
    // ...
}
```

Go에는 `implements`가 없다. `@Repository`나 DI 컨테이너도 필요하지 않다. 그런데 다음 한 줄은 컴파일된다.

```go
var posts PostRepository = repo
```

`repo`의 concrete type이 `*PostgresRepo`라면 컴파일러는 이 대입에서 묻는다.

```text
*PostgresRepo의 method set에
PostRepository가 요구하는 메서드가 전부 있는가?
```

이름과 시그니처가 모두 맞으면 대입은 통과한다. `PostgresRepo` 선언 어디에도 `PostRepository`라는 이름을 쓸 필요가 없다.

이 작은 차이 덕분에 인터페이스를 구현 패키지가 아니라 **그 동작이 필요한 소비자 패키지**에 둘 수 있다.

## 구현한다고 선언하지 않아도 구현된다

먼저 패키지를 나누지 않은 작은 예부터 보자.

```go
type PostRepository interface {
	GetByID(ctx context.Context, id int64) (*Post, error)
}

type memoryRepo struct {
	data map[int64]*Post
}

func (r *memoryRepo) GetByID(ctx context.Context, id int64) (*Post, error) {
	post, ok := r.data[id]
	if !ok {
		return nil, errors.New("post not found")
	}
	return post, nil
}

type stubRepo struct{}

func (stubRepo) GetByID(ctx context.Context, id int64) (*Post, error) {
	return &Post{ID: id, Title: "테스트 글"}, nil
}
```

`memoryRepo`와 `stubRepo`에는 `implements PostRepository` 같은 선언이 없다. 그래도 둘 다 같은 자리에 들어간다.

```go
repos := []PostRepository{
	&memoryRepo{data: map[int64]*Post{
		1: {ID: 1, Title: "메모리 글"},
	}},
	stubRepo{},
}

for _, repo := range repos {
	service := &PostService{posts: repo}
	title, err := service.Title(ctx, 1)
	// ...
}
```

Go에서 인터페이스 만족 여부는 타입이 가진 method set으로 결정된다. 메서드 이름, 매개변수 타입, 반환 타입이 인터페이스와 맞으면 그 타입은 인터페이스를 구현한다.

`var posts PostRepository = repo`에서만 특별한 검사가 일어나는 건 아니다. concrete value가 interface value로 들어가는 모든 정적 지점에서 같은 관계를 검사한다.

```go
var posts PostRepository = repo        // 변수 대입
NewPostService(repo)                   // 인터페이스 매개변수
[]PostRepository{repo}                 // 인터페이스 슬라이스 원소
return repo                            // 반환 타입이 PostRepository인 함수
```

하나라도 빠졌거나 시그니처가 다르면 그 지점에서 컴파일이 멈춘다.

```text
cannot use repo (variable of type *PostgresRepo) as PostRepository value:
    *PostgresRepo does not implement PostRepository
    (wrong type for method GetByID)
```

런타임에 DI 컨테이너가 구현체 목록을 찾는 과정이 아니다. 평범한 대입과 함수 호출을 컴파일러가 검사하는 것이다.

## 인터페이스는 구현자가 아니라 소비자가 가진다

`PostRepository`를 어디에 둘지가 더 중요하다.

저장소 구현을 만드는 `storage/postgres` 패키지에 인터페이스부터 정의하고 싶어질 수 있다.

```text
storage/postgres
├── PostRepository interface
└── Repository struct
```

이렇게 두면 서비스는 저장소 패키지가 정한 추상화에 의존한다. PostgreSQL 구현이 `Save`, `Delete`, `FindAll`, `Count`를 제공한다는 이유로 인터페이스도 커지기 쉽다. 글 제목 하나만 필요한 서비스 테스트가 쓰지 않는 메서드까지 전부 구현해야 한다.

반대로 서비스가 실제로 필요한 동작만 자기 패키지에 둔다.

```go
// internal/service/post_service.go
package service

type PostRepository interface {
	GetByID(ctx context.Context, id int64) (*post.Post, error)
}

type PostService struct {
	posts PostRepository
}

func NewPostService(posts PostRepository) *PostService {
	return &PostService{posts: posts}
}

func (s *PostService) Title(ctx context.Context, id int64) (string, error) {
	p, err := s.posts.GetByID(ctx, id)
	if err != nil {
		return "", err
	}
	return p.Title, nil
}
```

서비스가 원하는 계약은 메서드 하나다. PostgreSQL이 무엇을 할 수 있는지가 아니라, 서비스가 무엇을 필요로 하는지가 인터페이스의 크기를 정한다.

Go 공식 코드 리뷰 가이드도 인터페이스는 일반적으로 구현 패키지가 아니라 사용하는 패키지에 두고, 구현 패키지는 concrete type을 반환하라고 권한다. 인터페이스를 미리 만들지 말고 실제 사용 지점이 생겼을 때 정의하라는 기준도 같은 방향이다.

## 패키지로 나누면 의존성 방향이 보인다

같은 코드를 실제 패키지 구조로 옮겨보자.

```text
example/
├── cmd/api/main.go
└── internal/
    ├── post/post.go
    ├── service/post_service.go
    └── storage/postgres/repository.go
```

도메인 타입은 `internal/post`에 둔다.

```go
// internal/post/post.go
package post

type Post struct {
	ID    int64
	Title string
}
```

서비스는 도메인 타입을 사용하고, 자신이 소비할 인터페이스를 정의한다.

```go
// internal/service/post_service.go
package service

import (
	"context"

	"example/internal/post"
)

type PostRepository interface {
	GetByID(ctx context.Context, id int64) (*post.Post, error)
}

type PostService struct {
	posts PostRepository
}

func NewPostService(posts PostRepository) *PostService {
	return &PostService{posts: posts}
}

func (s *PostService) Title(ctx context.Context, id int64) (string, error) {
	p, err := s.posts.GetByID(ctx, id)
	if err != nil {
		return "", err
	}
	return p.Title, nil
}
```

PostgreSQL 구현은 `service`를 import하지 않는다. 같은 `post.Post` 타입을 반환하는 메서드만 제공한다.

```go
// internal/storage/postgres/repository.go
package postgres

import (
	"context"

	"example/internal/post"
)

type Repository struct {
	// db *sql.DB
}

func New() *Repository {
	return &Repository{}
}

func (r *Repository) GetByID(ctx context.Context, id int64) (*post.Post, error) {
	// 실제 코드에서는 DB를 조회한다.
	return &post.Post{ID: id, Title: "PostgreSQL에서 읽은 글"}, nil
}
```

둘을 아는 곳은 조립을 맡은 `main`뿐이다.

```go
// cmd/api/main.go
package main

import (
	"context"
	"fmt"

	"example/internal/service"
	"example/internal/storage/postgres"
)

func main() {
	repo := postgres.New()

	var posts service.PostRepository = repo
	postService := service.NewPostService(posts)

	title, err := postService.Title(context.Background(), 1)
	if err != nil {
		panic(err)
	}
	fmt.Println(title)
}
```

import 방향을 그리면 이렇다.

```text
                cmd/api (main)
                /            \
               v              v
          service          postgres
               \              /
                v            v
                    post
```

- `main`은 `service`와 `postgres`를 둘 다 알고 조립한다.
- `service`는 `postgres`를 모른다.
- `postgres`도 `service.PostRepository`를 모른다.
- 둘은 메서드 시그니처에 쓰이는 `post` 도메인 타입만 공유한다.

컴파일 의존성 그래프에 `service ↔ postgres` 간선이 없다. 고수준 정책인 서비스가 PostgreSQL이라는 저수준 세부사항을 직접 참조하지 않고, 자신이 정한 작은 계약에만 의존한다.

이 지점에서 의존성이 뒤집힌다.

## Post 타입을 service에 두면 다시 묶인다

패키지만 나눴다고 끝나지는 않는다. 아래 인터페이스에서 `Post`가 `service.Post`라면 문제가 생긴다.

```go
package service

type PostRepository interface {
	GetByID(ctx context.Context, id int64) (*Post, error)
}
```

`postgres.Repository.GetByID`도 똑같은 반환 타입을 가져야 한다. 그러려면 구현 패키지가 `service.Post`를 import해야 한다.

```text
postgres ──imports──> service
```

인터페이스 이름은 몰라도 반환 타입 때문에 다시 상위 패키지에 묶인다. 그래서 예제에서는 양쪽이 공유할 핵심 타입을 `internal/post`에 분리했다.

모든 프로젝트에 `domain` 패키지가 필요하다는 얘기는 아니다. 규모가 작으면 서비스와 타입을 같은 패키지에 두는 편이 단순할 수 있다. 다만 “storage의 service 컴파일 의존이 0”이라고 말하려면 메서드 시그니처에 등장하는 타입의 소유권까지 같이 봐야 한다.

## 테스트에서는 가짜 구현 하나면 된다

서비스 테스트는 PostgreSQL 드라이버나 DB 컨테이너를 알 필요가 없다.

```go
package service_test

type stubRepo struct {
	result *post.Post
	err    error
}

func (s stubRepo) GetByID(ctx context.Context, id int64) (*post.Post, error) {
	return s.result, s.err
}

func TestPostService_Title(t *testing.T) {
	repo := stubRepo{
		result: &post.Post{ID: 1, Title: "암묵적 구현"},
	}
	svc := service.NewPostService(repo)

	got, err := svc.Title(context.Background(), 1)
	if err != nil {
		t.Fatalf("Title() error = %v", err)
	}
	if got != "암묵적 구현" {
		t.Fatalf("Title() = %q, want %q", got, "암묵적 구현")
	}
}
```

`stubRepo`는 테스트 파일에서 필요한 메서드 하나만 맞췄다. 프로덕션 구현과 테스트 대역이 서로를 상속하지도 않고, 공통 base class를 공유하지도 않는다.

저장소를 memory에서 PostgreSQL로 바꿀 때도 서비스 코드는 그대로다. `main`에서 생성자만 바뀐다.

```go
// 이전
repo := memory.New()

// 이후
repo := postgres.New()

postService := service.NewPostService(repo)
```

바뀌는 범위가 조립 지점에 모인다.

## 컴파일러가 보장하지 않는 것도 있다

암묵적 구현이 계약의 모든 부분을 검사해주는 건 아니다.

컴파일러가 확인하는 건 method set이다. `GetByID`가 항상 올바른 글을 반환하는지, 없는 글을 어떤 에러로 표현하는지, 트랜잭션을 지키는지는 모른다. 시그니처가 맞아도 동작 계약은 틀릴 수 있다.

그래서 구현을 여러 개 교체할 계획이라면 같은 contract test를 각 구현에 돌리는 편이 낫다.

```text
memoryRepo     ─┐
postgresRepo    ├─> 같은 repository contract test
stubRepo       ─┘
```

pointer receiver도 자주 걸리는 부분이다.

```go
func (r *Repository) GetByID(...) (...) { ... }
```

이 메서드는 `*Repository`의 method set에는 들어가지만 `Repository`의 method set에는 들어가지 않는다.

```go
var _ service.PostRepository = postgres.Repository{}         // 컴파일 실패
var _ service.PostRepository = (*postgres.Repository)(nil)   // 통과
```

두 번째 형태는 흔히 쓰는 compile-time interface assertion이다. 다만 이 선언을 `postgres` 패키지 안에 두려면 그 패키지가 `service`를 import해야 한다. 구현 패키지가 소비자 인터페이스를 모르게 유지하려는 구조라면 `main`이나 별도 wiring test처럼 원래 두 패키지를 모두 아는 곳에 둔다.

그리고 interface value에 대한 type assertion은 런타임 검사일 수 있다.

```go
repo, ok := value.(service.PostRepository)
```

정적 wiring이 컴파일 타임에 안전하다는 말과, Go의 모든 인터페이스 검사가 컴파일 타임이라는 말은 다르다.

## 프레임워크 없이도 조립할 수 있다는 뜻

Go의 암묵적 인터페이스만 쓴다고 모든 코드가 저절로 Clean Architecture가 되는 건 아니다. 인터페이스를 구현자 쪽에 크게 정의하거나, 전역 concrete type을 서비스 곳곳에서 직접 참조하면 의존성은 그대로 꼬인다.

필요한 조건은 세 가지다.

- 인터페이스는 그 동작을 사용하는 소비자가 정의한다.
- 구현 패키지는 concrete type을 반환하고 소비자 인터페이스를 몰라도 된다.
- 둘을 아는 composition root에서 명시적으로 조립한다.

이 세 가지를 지키면 별도 DI 프레임워크 없이도 포트와 어댑터의 경계가 코드에 드러난다. Spring의 constructor injection과 목적은 비슷하지만, 구현체 탐색과 wiring은 컨테이너 대신 `main`의 평범한 Go 코드가 맡는다.

`var posts service.PostRepository = repo`는 단순한 대입 한 줄이다. 그 한 줄에서 `service`가 요구한 계약과 `postgres`가 같은 모양으로 제공한 method set이 처음 만난다.

서로를 import하지 않던 두 패키지가 컴파일러 앞에서만 연결된다.
