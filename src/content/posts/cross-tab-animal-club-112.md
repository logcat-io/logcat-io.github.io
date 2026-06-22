---
title: "[PROJECT] 여러 브라우저 탭이 서로 상호작용하는 Cross-tab Animal Club 구현기"
description: >-
  브라우저에서 같은 HTML 파일을 여러 탭이나 창으로 열었을 때, 각 창이 서로의 존재와 위치를 알고 상호작용한다면 꽤 재미있는 장난감을
  만들 수 있다.
pubDate: '2026-05-24T22:42:19+09:00'
dateSource: html-visible
slug: cross-tab-animal-club-112
tags:
  - javascript
  - web
  - Canvas
  - Frontend
  - interactive
  - BroadcastChannel
  - animation
  - real-time
  - ui
category: Project
cover: /images/posts/cross-tab-animal-club-112/broadcastchannel.gif
draft: false
legacy:
  tistoryId: '112'
  sourceHtml: 112/112.html
  sourceHash: 'sha256:7c847ba96493a426e5460242a70e12ac5d8ef2572372b7da86bc26d1500b945d'
---

브라우저에서 같은 HTML 파일을 여러 탭이나 창으로 열었을 때, 각 창이 서로의 존재와 위치를 알고 상호작용한다면 꽤 재미있는 장난감을 만들 수 있다.

![](/images/posts/cross-tab-animal-club-112/broadcastchannel.gif)

`Cross-tab Animal Club`은 이 아이디어를 바탕으로 만든 작은 브라우저 실험이다. 각 탭에는 동물 캐릭터가 하나씩 배정되고, 여러 창을 열면 서로의 위치를 기준으로 선이 연결된다. 여기에 술래잡기, 간식 폭죽, 우다다 모드, 특정 친구에게 별 던지기 같은 상호작용을 추가했다.

이 프로젝트에서 중점적으로 봐야 할 기술적 포인트는 다음과 같다.

-   서버 없이 탭 간 상태를 동기화하는 `BroadcastChannel`
-   브라우저 창 위치를 기준으로 한 전역 좌표계 설계
-   canvas 기반 애니메이션 루프
-   탭 생존 여부 관리
-   특정 탭 A가 특정 탭 B에게 별을 던지는 이벤트 모델

## 서버 없이 탭끼리 통신하기

탭 간 통신에는 `BroadcastChannel` API를 사용했다.

```
const CHANNEL_NAME = 'cross-tab-animal-club-v1';
const channel = new BroadcastChannel(CHANNEL_NAME);
```

같은 채널 이름을 사용하는 탭들은 서로 메시지를 주고받을 수 있다. 별도의 서버, WebSocket, localStorage polling 없이도 같은 브라우저 안의 여러 탭 또는 창 사이에서 상태를 공유할 수 있다.

메시지는 공통 함수로 보낸다.

```
function sendEvent(type, payload = {}) {
  channel.postMessage({
    type,
    tabId: TAB_ID,
    ts: performance.now(),
    ...payload
  });
}
```

각 탭은 고유한 `TAB_ID`를 가지고, 메시지를 받을 때 자기 자신이 보낸 메시지는 무시한다.

```
channel.onmessage = (event) => {
  const data = event.data;
  if (!data || data.tabId === TAB_ID) return;
};
```

이 구조 덕분에 모든 탭은 같은 채널에 참여하지만, 각 탭은 자신의 상태와 다른 탭의 상태를 분리해서 관리할 수 있다.

## 탭 상태를 주기적으로 공유하기

각 탭은 일정 간격으로 자신의 상태를 `pulse` 이벤트로 broadcast한다.

```
function pulse() {
  sendEvent('pulse', {
    center: getGlobalCenter(),
    cat: myCat,
    party: ownParty,
    score: scores.get(TAB_ID) || 0,
    game: {
      active: tagGameActive,
      taggerId,
      scores: serializeScores(),
      stateAt: gameStateAt
    }
  });
}

setInterval(pulse, BROADCAST_MS);
```

여기서 가장 중요한 값은 `center`다. 이 값은 현재 브라우저 창의 중심 좌표이며, 단순한 canvas 내부 좌표가 아니라 화면 전체를 기준으로 한 전역 좌표다.

다른 탭에서 `pulse`를 받으면 `peers` Map에 저장한다.

```
peers.set(data.tabId, {
  center: data.center,
  cat: normalizeCat(data.cat),
  party: Boolean(data.party),
  score: Number(data.score) || 0,
  ts: performance.now()
});
```

이렇게 하면 현재 탭은 다른 모든 탭의 위치, 캐릭터, 파티 상태, 점수를 알고 있게 된다.

## 브라우저 창을 기준으로 한 전역 좌표계

이 프로젝트에서 가장 중요한 구현 포인트는 좌표계다.

각 브라우저 창의 canvas 좌표는 모두 다르다. 예를 들어 A 탭에서 `x: 200, y: 200`인 위치는 B 탭에서도 같은 화면 위치를 의미하지 않는다. 그래서 탭 간에는 로컬 좌표가 아니라 전역 좌표를 공유해야 한다.

현재 창의 중심은 다음처럼 계산한다.

```
function getGlobalCenter() {
  return {
    x: window.screenX + window.innerWidth / 2,
    y: window.screenY + getChromeTopOffset() + window.innerHeight / 2
  };
}
```

그리고 다른 탭에서 받은 전역 좌표는 현재 창의 로컬 좌표로 다시 변환한다.

```
function globalToLocal(point) {
  return {
    x: point.x - window.screenX,
    y: point.y - window.screenY - getChromeTopOffset()
  };
}
```

반대로 현재 창 안에서 클릭한 지점을 다른 탭에 보내야 할 때는 로컬 좌표를 전역 좌표로 바꾼다.

```
function localToGlobal(point) {
  return {
    x: window.screenX + point.x,
    y: window.screenY + getChromeTopOffset() + point.y
  };
}
```

이 좌표 변환이 있기 때문에 여러 창을 화면 위에 흩어 놓아도 캐릭터의 위치, 연결선, 별의 이동 경로가 자연스럽게 이어진다. 결국 이 좌표계 덕분에 창을 아무렇게나 옮겨도 '하나의 우주 안에 있는 탭들' 처럼 보이게 된다.

## 닫힌 탭 정리하기

탭이 닫히면 더 이상 `pulse`를 보내지 않는다. 따라서 마지막 수신 시간이 오래된 peer는 자동으로 제거한다.

```
function cleanupPeers(now) {
  for (const [id, peer] of peers) {
    if (now - peer.ts > STALE_MS) {
      peers.delete(id);
      trails.delete(id);
    }
  }
}
```

이 처리가 없으면 이미 닫힌 탭의 캐릭터가 화면에 계속 남게 된다. 실시간 동기화에서 생존 여부 관리는 작지만 중요한 부분이다.

## Canvas 애니메이션 루프

렌더링은 전체 화면 canvas 하나로 처리한다.

```
<canvas id="stage"></canvas>
```

배경, 캐릭터, 연결선, 파티클, 별의 이동까지 모두 canvas에 직접 그린다. 애니메이션 루프는 `requestAnimationFrame`으로 구성했다.

```javascript
function animate(now) {
  cleanupPeers(now);
  updateThrowTargetOptions();

  const partyActive =
    ownParty ||
    now < remotePartyUntil ||
    Array.from(peers.values()).some(peer => peer.party);

  fadeTrails(partyActive);
  updateParticles(partyActive);
  updateStarFlights(now);

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  drawBackdrop(now, partyActive);

  // 연결선, 파티클, 별, 캐릭터 렌더링

  requestAnimationFrame(animate);
}
```

이 루프에서 상태 정리, 물리적 효과 업데이트, 화면 렌더링을 한 번에 처리한다.

## 캐릭터와 메뉴바 동기화

각 탭은 시작할 때 캐릭터 목록에서 하나를 랜덤으로 배정받는다.

```
const myCat = catRoster[Math.floor(Math.random() * catRoster.length)];
```

처음에는 메뉴바 로고가 고정된 값이었지만, 현재는 이 탭에 배정된 캐릭터와 연결했다.

```
menuLogoEl.textContent = myCat.face;
```

이렇게 하면 메뉴를 접었을 때도 현재 창이 어떤 캐릭터인지 바로 알 수 있다.

## 특정 친구에게 별 던지기

별 던지기는 이 프로젝트에서 가장 상호작용성이 강한 기능이다.

현재 탭은 `peers` Map을 보고 받을 수 있는 친구 목록을 드롭다운으로 만든다.

```javascript
function updateThrowTargetOptions() {
  const entries = [...peers.entries()]
    .map(([id, peer]) => [id, normalizeCat(peer.cat)])
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
}
```

사용자가 특정 친구를 선택하고 `별 던지기`를 누르면, 현재 탭의 중심을 시작점으로, 선택한 탭의 중심을 도착점으로 하는 이벤트를 만든다.

```javascript
function throwStarToTarget(targetId) {
  const peer = peers.get(targetId);
  if (!peer) return;

  const payload = {
    id: crypto.randomUUID(),
    from: TAB_ID,
    to: targetId,
    start: getGlobalCenter(),
    end: peer.center,
    cat: myCat,
    targetCat,
    color: 'rgba(139, 92, 246, 0.94)',
    duration: 1050,
    eventAt: Date.now()
  };

  addStarFlight(payload);
  sendEvent('star', payload);
}
```

여기서도 `start`와 `end`는 전역 좌표다. 모든 탭은 같은 별 이벤트를 받지만, 각자 자기 창 기준의 로컬 좌표로 변환해서 렌더링한다.

별이 도착하면 대상 캐릭터 주변에 공전하는 별을 생성한다. 단일 `별 던지기`와 `모두에게 별 뿌리기`가 같은 도착 처리를 사용하므로, 별을 받은 친구에게는 항상 잠시 따라 도는 별이 붙는다. 전체 뿌리기에서는 발신자 주변에도 별 하나를 붙이고, `orbit-star` 이벤트를 별도로 broadcast해서 다른 탭에서도 발신자 주변의 공전 별을 볼 수 있게 했다.

```javascript
function addOrbitStar(id, ownerId, color, sourceCat) {
  orbitStars.push({
    id,
    ownerId,
    color,
    sourceCat: normalizeCat(sourceCat),
    startedAt: performance.now(),
    duration: 9200
  });
}
```

## 선을 따라 날아가는 별

별은 단순 직선으로 움직이지 않는다. 기존 연결선과 비슷한 2차 베지어 곡선을 따라 이동한다.

```javascript
function getCurvePoint(start, control, end, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
  };
}
```

별의 현재 위치는 진행률 `t`에 따라 계산된다.

```javascript
const point = getCurvePoint(path.start, path.control, path.end, t);
```

이 방식은 별을 단순히 A에서 B로 보내는 것보다 훨씬 자연스럽다. 기존 연결선의 흐름을 따라 별이 이동하기 때문에 탭 간 관계가 시각적으로 더 잘 드러난다.

연결선과 별의 궤적은 보라 계열로 맞췄다. 배경이 밝은 파스텔 우주 톤이기 때문에, `rgba(139, 92, 246, ...)` 같은 보라색을 중심으로 선과 glow를 구성하면 캐릭터 색상과 분리되면서도 우주 분위기와 잘 맞는다. 날아가는 오브젝트는 원형 공이 아니라 큰 별 벡터로 직접 그려서, 상호작용의 의미가 더 명확하게 보이도록 했다.

## 구현하면서 중요한 판단

이 프로젝트는 기능 자체보다 좌표와 상태를 어떻게 다루는지가 핵심이다.

각 탭은 독립된 브라우저 문서이기 때문에, 일반적인 DOM 상태 공유는 사용할 수 없다. 그래서 `BroadcastChannel`로 상태를 흘려보내고, 각 탭은 그 상태를 자신의 좌표계에 맞게 다시 해석한다.

즉, 구조는 다음과 같다.

1.  각 탭이 자기 상태를 전역 좌표로 broadcast한다.
2.  다른 탭은 그 상태를 받아 `peers`에 저장한다.
3.  렌더링 직전에 전역 좌표를 현재 창의 로컬 좌표로 변환한다.
4.  canvas 루프가 연결선, 캐릭터, 별, 파티클을 그린다.

이 구조를 잡아두면 기능을 추가하기 쉽다. 술래잡기, 간식 폭죽, 별 던지기는 모두 같은 메시지 모델 위에 얹은 이벤트다.

## 마무리

`Cross-tab Animal Club`은 작은 HTML 파일 하나로 만든 장난감이지만, 안에는 꽤 많은 브라우저 기술이 들어 있다.

특히 `BroadcastChannel`과 전역 좌표 변환을 조합하면 서버 없이도 여러 창이 하나의 공간에 있는 것처럼 보이게 만들 수 있다. 여기에 canvas 애니메이션을 더하면 단순한 상태 동기화를 넘어, 탭끼리 실제로 상호작용하는 느낌을 만들 수 있다.

브라우저 탭을 여러 개 열었을 뿐인데, 각 창이 하나의 캐릭터처럼 움직이고 서로에게 별을 던진다. 이 점이 이 프로젝트의 가장 재미있는 부분이다.
