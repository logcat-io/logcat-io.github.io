---
title: "[GO] TTL 만료는 두 번 지운다 - lazy 삭제와 sweeper"
description: "SET EX 10초가 지나도 서버에서는 아무 일도 일어나지 않는다. 만료를 이벤트가 아니라 판정으로 설계하고, lazy와 sweeper로 역할을 나누고, RWMutex 승격 없음에 데인 기록."
pubDate: "2026-07-17T22:40:00+09:00"
dateSource: manual
slug: tinyredis-ttl-lazy-sweeper
tags:
  - Go
  - Redis
  - TTL
  - RWMutex
  - concurrency
category: Language/Go
series:
  name: "Go로 만드는 tinyredis"
  order: 4
draft: true
---


Go로 만들고 있는 미니 Redis(tinyredis)에 TTL을 붙인 얘기다.
[지난 글](/posts/tinyredis-resp-parser-guards/)까지가 프로토콜 얘기였다면, 이번엔 만료다.

`SET session abc EX 10` 을 구현하면서 알게 된 게 하나 있다.
10초가 지나는 순간, 서버에서는 **아무 일도 일어나지 않는다.**

***

## 키마다 타이머를 달면 안 되나

처음 떠오르는 직관은 이거다. `SET ... EX 10` 이 들어오면 `time.AfterFunc(10*time.Second, ...)` 로
타이머를 걸고, 10초 뒤 콜백에서 지운다. 만료를 "이벤트"로 다루는 방식이다.

키 몇 개짜리 장난감에서는 이게 편리하다. 코드도 직관적이다.

문제는 규모와 관리다.
키 10만 개면 러닝 타이머 10만 개가 힙에 쌓인다.
`SET` 으로 같은 키를 덮어쓰면 기존 타이머를 찾아서 취소해야 하고,
`DEL` 도 마찬가지고, TTL 없는 SET으로 덮으면 또 취소해야 한다.
타이머의 생명주기가 키의 생명주기를 계속 따라다니는 관리 코드가 자란다.

Redis는 이 길로 가지 않았다. tinyredis도 다르게 갔다.

## 만료는 이벤트가 아니라 판정이다

tinyredis의 entry는 값과 만료 시각만 들고 있다.

```go
type entry struct {
	value    string
	expireAt time.Time // IsZero: 만료 시각이 설정되지 않았다 → TTL 없음
}

func (e entry) expired(now time.Time) bool {
	return !e.expireAt.IsZero() && now.After(e.expireAt)
}
```

`SET ... EX 10` 은 `now + 10s` 를 적어둘 뿐이다. 타이머도 콜백도 없다.
"이 키는 죽었는가"는 시각을 비교하는 순수 함수 판정이 됐다.

TTL 없음을 별도 bool이나 `*time.Time` 없이 `time.Time` 의 zero value로 표현한 것도
작지만 마음에 드는 결정이다. `entry{value: v}` 라고만 쓰면 자동으로 "TTL 없는 키"가 된다.
Go의 zero value를 유효한 상태로 설계하면 초기화 실수가 표현 불가능해진다.

지우는 행위는 별도의 두 경로가 맡는다.

- **lazy(수동)**: 읽을 때 만료면 없다고 답하고, 그 김에 지운다
- **sweeper(능동)**: 백그라운드에서 주기적으로 훑어서 지운다

왜 둘 다 필요한가. 하나만 있으면 각각 구멍이 있다.

lazy만 있으면 다시는 안 읽히는 키가 영원히 남는다.
로그아웃한 유저의 세션 토큰 수백만 개가 만료된 채로 메모리를 잡고 있는 그림이다.
sweeper만 있으면 sweep 주기 사이에 만료된 키가 GET에 그대로 보인다.
"TTL 지났는데 값이 조회된다"는 정합성 버그다.

정합성은 lazy가 책임지고, 메모리 회수는 sweeper가 책임진다.
같은 삭제인데 지키는 것이 다르다.

***

## lazy 삭제 - 생각보다 안 쉬웠다

GET 경로에서 만료 키를 지우는 코드. 여기서 한 번 데였다.

store는 `sync.RWMutex` 로 보호된다. GET은 읽기니까 RLock으로 들어간다.
그런데 만료 키를 발견해서 지우려면 write lock이 필요하다.
자연스럽게 "RLock을 Lock으로 승격하면 되지"라고 생각하게 되는데,

**Go의 RWMutex에는 승격이 없다.**

RLock을 쥔 채 Lock을 부르면 승격이 아니라, 자기가 쥔 read lock이 풀리기를
자기가 기다리는 데드락이 된다.

"그럼 처음부터 Lock을 잡으면 되잖아"가 다음 생각인데, 이건 GET의 성격과 안 맞다.
GET의 절대다수는 만료 안 된 키를 읽는 정상 조회다.
그 다수 경로를 write lock으로 바꾸면 모든 GET이 서로를 밀어내며 직렬화된다.
드물게 일어나는 삭제 때문에 항상 일어나는 읽기가 비싸지게 되는 것이다.
읽기는 싼 락으로 두고, 만료를 발견한 드문 경우에만 비싼 락을 잡는 쪽이 맞다고 생각했다.

그래서 락을 완전히 놓았다가 다시 잡는다. 그러면 새 문제가 생긴다.
락을 놓은 그 틈에 다른 goroutine이 같은 키를 새로 SET할 수 있다.
판정했을 때의 세계와 행동할 때의 세계가 다른 시점이 된 것이다.
재확인 없이 지우면 방금 태어난 산 키를 지워버린다.

```go
func (s *Store) Get(key string) (string, bool) {
	s.mu.RLock()
	e, ok := s.data[key]
	s.mu.RUnlock()

	if !ok {
		return "", false
	}
	if !e.expired(s.now()) {
		return e.value, true
	}
	// 락을 다시 잡는 사이에 다른 goroutine이 키를 새로 SET할 수 있다.
	// 반드시 재확인 후 지운다.
	s.mu.Lock()
	if e2, ok2 := s.data[key]; ok2 && e2.expired(s.now()) {
		delete(s.data, key)
	}
	s.mu.Unlock()
	return "", false
}
```

싼 락으로 낙관적으로 확인하고, 비싼 락을 잡은 뒤 같은 조건을 다시 확인하고, 그다음 행동한다.
double-checked locking의 일반형이다. 이 패턴을 책의 문장이 아니라
"승격이 없네?" → "그럼 놓았다 잡아야지" → "그 사이에 세계가 바뀌면?" 순서로 만나니까 훨씬 더 이해하기 수월했다.

참고로 EXISTS와 TTL도 `expired()` 판정은 하지만 지우지는 않는다.
죽은 키를 "안 보이게" 하는 건 판정만으로 충분해서, 실제 회수는 GET과 sweeper에 맡겼다.

## sweeper - 안 읽히는 키를 위해

```go
func (s *Store) RunSweeper(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweepOnce()
		}
	}
}
```

1초마다 (`-sweep-interval` 플래그, 기본 1s) `sweepOnce` 가 전체 맵을 write lock 잡고 순회하며
만료 키를 지운다. `ctx.Done()` 으로 서버 종료 시 같이 내려간다.

전체 순회는 정직하게 말하면 대가가 있는 선택이다.
맵이 수백만 키로 크면 write lock을 잡은 채 전체를 도는 동안 모든 요청이 멈춘다.
그래서 Redis는 전체 스캔을 안 한다 — TTL 있는 키 중 20개를 랜덤 샘플링해서 지우고,
그중 25% 이상이 만료 상태였으면 "아직 많이 남았다"고 보고 한 번 더 도는 방식이다.
전체를 안 보는 대신 통계적으로 만료 키 비율을 일정 수준 아래로 눌러둔다.

tinyredis는 학습 규모(키 수만 개)라 단순한 전체 스캔을 골랐다.
샘플링의 정밀함 대신 "한 번에 다 정리된다"는 단순함을 택한 트레이드오프고,
키가 커지면 제일 먼저 다시 봐야 할 지점이라는 것만 적어둔다.

***

## TTL 명령은 왜 올림(ceil)인가

TTL 명령은 남은 시간을 초 단위 정수로 답해야 한다. 여기 작은 함정이 있다.

남은 시간이 0.4초인 키를 생각해보자. 키는 아직 살아 있다. GET하면 값이 나온다.
그런데 버림(floor)으로 계산하면 TTL은 0을 답하게 된다.
클라이언트 입장에서는 "TTL이 0인데 GET은 된다"는 모순 상태를 보게 되는 것이다.
1초 미만이 남은 모든 구간에서 이 모순이 생긴다.

그래서 올림으로 갔다.

```go
return resp.WriteInteger(w, int64(math.Ceil(remaining.Seconds())))
```

올림이면 만료가 설정된 산 키의 TTL은 항상 1 이상이다.
살아 있으면 1 이상, TTL이 없으면 -1, 죽었거나 없으면 -2 — 응답의 의미가 겹치지 않는다.

물론 공짜는 아니다. 0.4초 남은 키가 "1초 남았다"고 답하니,
보고되는 값이 실제보다 최대 1초 길다.
클라이언트가 그 1초를 믿고 있다가 조금 일찍 키가 사라지는 쪽과,
살아 있는 키가 죽은 것처럼 0으로 보이는 쪽 — 덜 위험한 방향은 전자라고 판단했다.
초 단위 정수라는 응답 규약 자체가 가진 해상도 한계를 어느 쪽으로 접을지의 문제다.

## 만료가 스며드는 자리들

만료 시각 하나 넣었을 뿐인데 손대는 곳이 생각보다 많았다.

- **DEL의 반환값**: 만료된 키를 지우면 셈에서 뺀다. 클라이언트 입장에서 그 키는 이미 없는 키였으니까. 지운 개수가 아니라 "살아있는 키를 지운 개수"가 규약이다.
- **스냅샷**: SAVE할 때 만료 키를 거르고 쓴다. 안 거르면 죽은 키가 디스크에 저장됐다가 재시작할 때 부활한다. 로드할 때도 한 번 더 거른다 — 파일이 저장된 시점과 로드되는 시점 사이에 만료된 키가 있을 수 있어서다.

만료를 "지워졌는가"가 아니라 "죽었는가"로 정의한 덕에,
이 자리들이 전부 `expired(now)` 판정 한 번으로 정리된다.

***

키마다 타이머를 거는 방식도 키가 적고 정확한 만료 시점이 중요한 도메인에서는 여전히 일리가 있다.
Redis가 그 길을 버린 건 만료 정확도보다 키 수백만 개에서의
예측 가능한 비용이 더 중요한 워크로드라서다.

다음은 이 sweeper와 서버가 같이 내려가는 얘기, graceful shutdown이다.
`ctx.Done()` 한 줄이 왜 거기 있는지부터.
