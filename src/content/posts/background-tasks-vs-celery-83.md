---
title: '? BackgroundTasks vs Celery — 언제 뭐 쓰면 좋을까?'
description: >-
  FastAPI에서 비동기 백그라운드 작업을 할 때, 가볍게 BackgroundTasks를 쓸지, 아니면 Celery를 쓸지 고민한 적이 있을
  것이다.
pubDate: '2025-08-15T00:53:31+09:00'
dateSource: html-visible
slug: background-tasks-vs-celery-83
tags:
  - celery
  - BackgroundTasks
  - messaging
  - background
  - tasks
category: Python Framework/FastAPI
draft: false
legacy:
  tistoryId: '83'
  sourceHtml: 83/83.html
  sourceHash: 'sha256:b1813779ff7f9b9739d24e8990bbd303dddf0cee870643412da04e287907a107'
---

목차

* * *

FastAPI에서 비동기 백그라운드 작업을 할 때, 가볍게 BackgroundTasks를 쓸지, 아니면 Celery를 쓸지 고민한 적이 있을 것이다.

겉으로는 **“둘 다 요청 끝나고 뒤에서 뭔가 하는”** 느낌이지만, 스케일이나 내구성, 운영 복잡도에서 차이가 발생한다.

이번 글에서는 **언제 어떤 걸 쓰면 좋은지** 개인적인 견해를 정리해보려고 한다.

## 언제 어떤 걸 써야 하는지 요약

| 상황 | 추천 |
| --- | --- |
| API 응답 직후, 짧고 가벼운 작업 | **BackgroundTasks** |
| 몇 초~수시간짜리 작업,  
재시도/스케줄링 필요,  
유실되면 안 됨 | **Celery** |

## 비교 표

| 항목 | BackgroundTasks | Celery |
| --- | --- | --- |
| 실행 위치 | 요청 받은 앱 프로세스 안 | 별도의 워커 프로세스 |
| 내구성 | 프로세스 죽으면 작업 날아감 | 브로커에 저장돼서 안전 |
| 재시도 | 직접 구현해야 함 | 내장 지원 |
| 예약/스케줄링 | 없음 | celery beat 등 지원 |
| 작업 길이 | 수백 ms ~ 수 초 권장 | 분~시간 가능 |
| 확장성 | 앱 인스턴스 수에 종속 | 워커 증설로 수평 확장 |
| 운영 난이도 | 낮음 | 높음 (브로커/백엔드 필요) |

## BackgroundTasks

#### 장점

-   설정, 배포 심플함
-   응답 먼저 주고 작업 이어서 실행 → 사용자 경험 좋음
-   로컬/소규모 프로젝트에 적합

#### 단점

-   프로세스 죽으면 작업 소실
-   재시도, 예약 없음
-   장시간 작업 시 자원 경합 가능

## Celery

#### 장점

-   브로커 기반 내구성
-   실패 시 자동 재시도, 백오프
-   스케줄링, 우선순위 큐 등 강력한 기능
-   대량/장시간 작업에 강함

#### 단점

-   브로커(Redis, RabbitMQ) 필요 → 인프라 복잡
-   작은 작업엔 과함
-   러닝커브 있음

## 판단 가이드

1.  **작업 특성으로 결정**
    -   짧고, 유실돼도 괜찮음 → BackgroundTasks
    -   길고, 재시도/예약 필요 → Celery
2.  **트래픽 & 비용**
    -   초기/PoC → BackgroundTasks
    -   성장하며 실패/지연 늘어나면 Celery로 승격
3.  **인프라**
    -   단일 서버/DB → BackgroundTasks
    -   K8s, 수평 확장, 배치 작업 많음 → Celery
4.  **정합성**
    -   Celery는 멱등성(idempotency) 설계 필수
    -   DB 트랜잭션 종료 후 큐잉 (Outbox 패턴 고려)

### BackgroundTasks 안티패턴 & Celery 팁

#### BackgroundTasks 안티패턴

-   동영상 인코딩, 대량 메일 발송 등 몇 분 이상 걸리는 작업 넣기
-   롤링 업데이트 시 작업 날아가는 문제 무시

#### Celery 팁

-   브로커는 Redis(간단) / RabbitMQ(고급 라우팅)
-   모니터링은 Flower
-   큐를 목적별로 분리 (emails, images, default)
-   하드/소프트 타임리밋 설정
-   작업은 작게 쪼개기
-   멱등성 토큰으로 중복 실행 방지

## 코드 예시

#### BackgroundTasks

```python
from fastapi import FastAPI, BackgroundTasks

app = FastAPI()

def send_webhook(order_id: str):
    ...

@app.post("/orders")
def create_order(order: dict, bg: BackgroundTasks):
    order_id = save_order(order)
    bg.add_task(send_webhook, order_id)
    return {"ok": True, "order_id": order_id}
```

#### Celery

```python
# celery_app.py
from celery import Celery
celery = Celery(__name__, broker="redis://redis:6379/0", backend="redis://redis:6379/1")

@celery.task(bind=True, autoretry_for=(Exception,), retry_kwargs={"max_retries":5}, retry_backoff=True)
def send_bulk_email_task(batch_id: str):
    ...
```

```python
# api.py
from fastapi import FastAPI
from celery_app import send_bulk_email_task

app = FastAPI()

@app.post("/email/bulk")
def bulk_send(req: dict):
    task = send_bulk_email_task.delay(req["batch_id"])
    return {"task_id": task.id}
```

## 결론

-   **소규모** → BackgroundTasks로 시작해도 충분
-   **대규모, 신뢰성 필수, 재시도/스케줄링 필요** → Celery로 가야 함
-   현실 전략: **BackgroundTasks → 병목/유실/운영 이슈 발생 시 Celery로 승격**
