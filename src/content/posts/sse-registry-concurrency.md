---
title: "[PROJECT] 화면이 안 바뀌는데 에러가 안 난다 — SSE 레지스트리의 동시성"
description: >-
  배송 상태를 SSE로 흘려보내는 걸 만들었다. 잘 돌아갔다. 그런데 같은 배송을 두 명이 보면 어떻게 되지,
  하고 생각해 보니 한 명은 프레임을 못 받는다. 거기서부터 하나씩 따라간 기록이다.
pubDate: "2026-08-15T22:10:00+09:00"
dateSource: manual
slug: sse-registry-concurrency
tags:
  - SSE
  - ConcurrentHashMap
  - concurrency
  - kotlin
  - spring
category: Project/실시간 배송 추적
series:
  name: "실시간 배송 추적"
  order: 1
draft: false
---

배송 상태가 바뀌면 화면에 바로 뜨는 걸 만들고 있다. SSE로 붙였고, 띄워 보니 잘 된다.

그런데 만들어 놓고 나니 계속 걸리는 게 있었다. **이거 나 혼자 테스트해서 되는 거 아닌가?**

## 일단 제일 단순하게

배송 ID로 연결을 찾아야 하니 맵이 필요하다. 제일 먼저 떠오르는 모양은 이거다.

```kotlin
private val emitters = ConcurrentHashMap<UUID, SseEmitter>()

fun register(deliveryId: UUID, emitter: SseEmitter) {
    emitters[deliveryId] = emitter
}
```

배송 하나에 화면 하나. 동작한다. 브라우저 열고 상태 바꾸면 바로 뜬다.

## 그런데 같은 배송을 두 명이 보면?

여기서 걸렸다. 배송 하나를 볼 사람이 정말 한 명인가?

- 구매자가 앱에서 본다
- 그 사람이 PC 로도 연다
- CS 문의가 들어와서 상담사가 관리자 화면에서 같은 배송을 연다
- 판매자도 본다

**한 명이 아니다.** 그리고 이건 예외적인 상황이 아니라 그냥 정상 케이스다.

그러면 위 코드에서 무슨 일이 일어나나.

```text
14:02  구매자가 열었다        → emitters[D] = emitterA
14:05  상담사가 열었다        → emitters[D] = emitterB   ← emitterA 를 덮어썼다
14:06  기사가 DELIVERING 전이 → emitters[D] 는 emitterB 뿐
14:06  상담사 화면: 바뀐다
       구매자 화면: 아무 일도 안 일어난다
```

제일 나쁜 건 **구매자 연결이 끊기지 않는다**는 점이다. 끊겼으면 브라우저가 재연결이라도 했을 텐데, 소켓은 멀쩡하고 서버가 그냥 그 연결을 잊었다. 예외도 없고 로그도 안 남는다.

"화면이 안 바뀌어요"라는 제보가 와도 재현이 안 된다. 혼자 테스트하면 항상 되니까.

그리고 하나 더. **`ConcurrentHashMap`을 썼는데도 안 막혔다.** 스레드를 안 쓰고 `register`를 두 번 부르기만 해도 재현된다. 동시성 문제가 아니라 **"한 배송에 연결이 하나"라고 가정한 것**이 문제다.

값을 집합으로 바꾼다.

```kotlin
private val emitters = ConcurrentHashMap<UUID, MutableSet<SseEmitter>>()
```

## Set으로 바꿨다 — 그런데 동시에 붙으면?

집합으로 만들면 "키가 없으면 만들고, 있으면 추가"를 해야 한다. 순진하게 짜면 이렇게 된다.

```kotlin
fun register(deliveryId: UUID, emitter: SseEmitter) {
    val set = emitters[deliveryId]                   // ①
    if (set == null) {
        emitters[deliveryId] = mutableSetOf(emitter) // ②
    } else {
        set.add(emitter)                             // ③
    }
}
```

여기서 또 걸렸다. 웹 서버는 요청을 여러 스레드로 처리하는데, **두 사람이 같은 배송을 동시에 열면?**

```text
T1: ① emitters[D] → null
T2: ① emitters[D] → null          (아직 T1이 안 넣었다)
T1: ② emitters[D] = {emitterA}
T2: ② emitters[D] = {emitterB}    ← {emitterA} 를 통째로 덮어씀
```

**1:1 맵일 때와 똑같은 증상으로 되돌아왔다.** 확률만 낮아졌을 뿐이라 오히려 더 나쁘다. `ConcurrentHashMap`은 **개별 연산**이 안전한 거지 **연산 여러 개를 묶은 것**이 안전한 게 아니다.

여기서 하나 짚고 넘어가자면, 이건 다중 인스턴스 얘기가 아니다. **인스턴스가 하나여도** 스레드가 여럿이라 일어난다. 인스턴스가 여러 대인 건 각자 자기 맵을 들고 있는 별개 문제고, 이 코드로는 못 푼다.

그리고 ③은 죄가 없다. **키가 처음 만들어지는 순간에만 터진다**는 뜻이라, 두 번째 구독자부터는 안 터진다. 그래서 재현이 더 어렵다.

## `compute`로 묶었다

읽고 만들고 넣는 걸 하나로 묶어야 한다.

```kotlin
fun register(deliveryId: UUID, emitter: SseEmitter) {
    emitters.compute(deliveryId) { _, current ->
        (current ?: ConcurrentHashMap.newKeySet()).also { it.add(emitter) }
    }
}
```

`compute`는 **그 키에 대해 원자적으로** 실행된다. 람다가 도는 동안 같은 키를 건드리는 다른 스레드는 대기한다. 원자성이 **키 단위지 맵 전체가 아니라는** 것도 마음에 들었다. 배송 A의 등록이 배송 B를 막을 이유가 없으니까.

### 그럼 이건 어떤가

쓰면서 "이렇게 해도 되지 않나" 싶었던 게 둘 있었다.

```kotlin
emitters.getOrPut(deliveryId) { newKeySet() }.add(emitter)
```

이름만 보면 원자적일 것 같은데 아니다. Kotlin의 `getOrPut`은 `MutableMap` 확장이고 **inline으로 `get` → `put`**이다. 위의 ①②와 똑같이 터진다. 이름이 원자성을 약속하는 것처럼 보여서 더 위험하다.

```kotlin
val set = emitters.computeIfAbsent(deliveryId) { newKeySet() }
set.add(emitter)
```

이건 생성이 원자적이라 동시 등록은 막는다. 그런데 **제거와 겹치면 구멍이 생긴다.**

```text
T1: computeIfAbsent(D) → 집합 S 반환, 키 락 해제
T2: remove(D, 마지막 구독자) → S 가 비어서 키 삭제
T1: S.add(emitter)  → 맵에서 이미 떨어져 나간 S 에 넣는다 → 유실
```

**증상이 또 똑같다.** 연결은 살아 있는데 프레임만 안 온다. 원인만 다르다.

그래서 `compute` 안에서 `.also { it.add(emitter) }`까지 끝낸다. 집합 갱신을 같은 원자 단위에 넣어야 제거와 상호 배타가 된다.

## 꺼내온 Set은 누가 지키나

등록은 정리됐는데, 이번엔 보내는 쪽이 걸렸다.

```kotlin
fun send(deliveryId: UUID, event: DeliveryStatusEvent) {
    val targets = emitters[deliveryId] ?: return   // compute 밖
    targets.forEach { ... }
}
```

맵에서 꺼낸 뒤 그 집합을 순회한다. **맵이 지켜주는 건 엔트리 조작까지**고, 꺼낸 객체 내부를 만지는 건 맵 소관이 아니다. 순회하는 동안 다른 스레드가 `register`로 같은 집합에 `add`하면?

값이 `LinkedHashSet`이면 `ConcurrentModificationException`이 난다. `ConcurrentHashMap.newKeySet()`은 안 던진다. 대신 **weakly consistent**다 — 순회 중 붙은 구독자가 이번 순회에 포함될 수도, 안 될 수도 있다.

이건 받아들이기로 했다. **프레임 하나가 방금 붙은 구독자에게 갔는지 안 갔는지는 중요하지 않고, 다음 프레임엔 확실히 가니까.** 도메인이 허용하면 되는 성질이다.

정리하면 둘은 각자 다른 걸 막는다.

| | 막는 것 |
|---|---|
| `compute` / `computeIfPresent` | 맵 엔트리의 생성·갱신 경쟁 |
| `newKeySet()` | 꺼내온 집합의 동시 add/remove/순회 |

하나만 해서는 안 된다.

## 그럼 순회도 `compute` 안에 넣으면 되지 않나

여기까지 오니 자연스럽게 그 생각이 들었다. 어차피 원자적으로 하는 게 안전하면, 보내는 것도 감싸면 되는 거 아닌가.

안 된다. 감싸면 **전송이 끝날 때까지 그 배송 키가 통째로 잠긴다.** 전송은 소켓 I/O라 느릴 수 있고, 그동안 같은 배송에 새로 붙는 연결이 전부 대기한다. `compute` 람다는 짧고 순수해야 한다 — 네트워크·DB·블로킹은 밖에서.

`newKeySet()`이 순회 안전성을 주니까 락 없이 돌 수 있다. **약한 일관성을 받아들이고 락을 안 잡는 것**, 그게 이 자료구조를 고른 진짜 이유다.

같은 이유로 실패한 emitter도 순회가 끝난 뒤에 지운다.

```kotlin
val failed = mutableListOf<SseEmitter>()
targets.forEach { emitter ->
    try { emitter.send(...) } catch (e: Exception) { failed.add(emitter) }
}
failed.forEach { remove(deliveryId, it) }
```

이 패턴은 보통 `ConcurrentModificationException` 때문에 쓰는데, 여기선 `newKeySet()`이 이미 그걸 없앴다. 남은 이유는 **`compute` 재진입**이다. `ConcurrentHashMap` javadoc은 람다 안에서 같은 맵을 갱신하지 말라고 하고, 같은 키를 재귀적으로 갱신하면 `IllegalStateException: Recursive update`가 날 수 있다고 한다.

다만 솔직히, **이건 아직 내가 돌려서 확인한 게 아니다.** javadoc을 읽고 그렇게 이해한 것이고 실제로 예외가 나는지 스레드가 물리는지는 안 봤다. 운영에서 둘은 증상이 완전히 다르다 — 하나는 즉시 500이고 하나는 스레드가 물려 서서히 죽는다. 따로 확인하려고 남겨 뒀다.

## 띄워 놓고 확인한 것들

여기까지가 상상해서 다듬은 부분이고, 실제로 붙여 보면서 정한 것도 있다.

### 연결만 해서는 아무것도 안 나간다

스트림을 열어도 클라이언트가 받는 건 0바이트다. 상태 변경이 한 번 일어나야 그때 헤더(`Content-Type: text/event-stream`)와 프레임이 같이 나온다.

당연한 결과다. **보낼 이벤트가 없으니 나갈 게 없다.**

다만 그래서 **클라이언트는 스트림이 열렸는지 알 수 없다.** 연결 직후 확인용 이벤트를 한 번 쏠지는 아직 안 정했다. 중간 프록시가 응답 없는 연결을 먼저 끊을 수도 있어서, 인프라를 정한 뒤에 판단하려고 미뤄 뒀다.

### 끊긴 연결은 다음 이벤트가 아니라 그다음에 걷힌다

이건 예상과 달랐다.

연결을 강제로 죽인 직후에는 `onCompletion`도 `onError`도 안 불린다. TCP 입장에선 아직 살아 있어서, 서버는 그 소켓에 써 봐야 안다. 그런데 **닫힌 소켓에 대한 첫 write는 성공한다.** 버퍼에 들어가기 때문이다.

```text
→ 상태 변경 1회차   아무 일 없음
→ 상태 변경 2회차   Broken pipe → 제거
```

콜백을 다 걸어도 이 경로는 안 잡힌다. 그래서 전송 실패 시 즉시 제거하는 경로를 따로 뒀다.

### `remove`는 중복을 택했다

연결이 끝나는 경로는 셋이다. 정상 종료, 타임아웃, 에러. **어느 콜백이 언제 불릴지는 컨테이너 구현에 달려 있다.**

그래서 가정하지 않기로 했다. 세 콜백을 전부 걸고 전송 실패 경로까지 더한다. `remove`는 없는 emitter를 지워도 아무 일이 안 일어나니 중복은 안전하다. **누락되면 힙에 죽은 연결이 영원히 남고, 중복되면 아무 일도 안 일어난다.** 비대칭이라 중복 쪽을 골랐다.

실제로 죽은 구독자 하나가 걷히는 순간의 로그다.

```text
22:03:20.407  [exec-9]  sending error: Broken pipe
22:03:20.407  [exec-1]  removed
22:03:20.408  [exec-9]  removed
22:03:20.408  [exec-1]  removed
```

의도한 대로 세 번 불렸다. 그런데 여기서 하나 더 보인다 — **스레드가 둘이다.** `exec-9`는 전송 실패 경로, `exec-1`은 컨테이너 콜백이고 1ms 안에 같이 들어왔다.

중복이 순차가 아니라 **동시**였다. 그러면 멱등성만으로는 부족하고 제거 자체가 원자적이어야 한다.

```kotlin
fun remove(deliveryId: UUID, emitter: SseEmitter) {
    emitters.computeIfPresent(deliveryId) { _, set ->
        set.remove(emitter)
        if (set.isEmpty()) null else set    // null 반환 = 키 자체를 삭제
    }
}
```

`isEmpty()` 검사와 키 삭제를 밖에서 하면 "비었다고 판단한 직후 다른 스레드가 add"하는 창이 생긴다. 방금 등록한 구독자가 통째로 사라진다. **또 같은 증상이다.**

그리고 `null`을 안 돌려주면 빈 집합이 키마다 남는다. emitter는 다 걷혔는데 맵만 자라는, 구독자 수로는 안 잡히는 누수다.

## 여기까지 하고 남은 것

돌아보면 이 글은 **`Map` 하나로 시작해서 "이러면 어떻게 되지"를 다섯 번 물은 기록**이다. 그리고 다섯 번 다 증상이 같았다 — 연결은 살아 있는데 프레임만 안 온다. 원인만 매번 달랐다.

그런데 여기서 푼 건 **인스턴스 하나 안의 스레드 안전성**이 전부다.

인스턴스를 두 벌 띄우면 각자 자기 메모리에 자기 맵을 들고 있다. 사용자가 A에 붙어 있는데 이벤트가 B에서 발행되면 못 받는다. `compute`를 아무리 잘 써도 못 푼다. 애초에 다른 문제다.

나는 다중 인스턴스 자체는 겪었다. 오토스케일링으로 늘었다 줄었다 하는 API 서버였고 문제가 난 적은 없다. **문제가 없었던 건 그게 stateless였기 때문이다.** 어느 인스턴스가 요청을 받든 결과가 같으니 인스턴스 수는 신경 쓸 일이 아니었다.

SSE는 거기서 갈린다. 연결이 프로세스 메모리에 산다. **상태가 생기는 순간 "어느 인스턴스냐"가 갑자기 중요해진다.**

다음에 뭘 할지는 아직 안 정했다. 다만 솔직히 말하면 **나는 Kafka를 한번 제대로 써보고 싶다.** 돌아가는 걸 본 적은 있지만 내가 토픽을 설계하고 파티션 키를 정해 본 적은 없어서, 이 프로젝트를 시작한 이유 중 하나가 그거다.

그런데 그게 위험하다. **쓰고 싶다는 이유로 먼저 깔면 도구가 문제를 정의하게 된다.** 인스턴스를 늘려 본 적이 없어서 뭐가 먼저 깨지는지도 아직 모르는데, 답을 정해 놓고 거기 맞는 문제를 찾는 꼴이 된다.

안 겪은 문제에 도구부터 고르면, 다음에 비슷한 상황을 만났을 때 **그게 정말 필요했는지 판단할 근거가 안 남는다.** 그래서 일단 두 벌 띄워 보려고 한다. 깨지는 걸 보고 나서 정한다.
