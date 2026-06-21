---
title: 'Kafka 기초 정리 (메시지 큐, 파티션, DLT, 클러스터 구조)'
description: >-
  기존의 모놀리식 애플리케이션을 MSA로 마이그레이션하면서 이벤트 기반 통신이 필요하게되었다. 이를 위해 Redis, RabbitMQ,
  Kafka 등의 다양한 도구가 있겠지만, MSA 구조에서 많은 장점을 가진 Kafka를 이번 구현에서 선택했다.
pubDate: '2025-11-01T15:13:43+09:00'
dateSource: html-visible
slug: kafka-dlt-94
tags:
  - Kraft
  - DLT
  - Message
  - Queue
  - spring
category: Infra/Kafka
draft: false
legacy:
  tistoryId: '94'
  sourceHtml: 94/94.html
  sourceHash: 'sha256:dbdd0151b75ad5ea27825faeca1c15ae24b5c4c0a0ade2897823044502b9efb0'
---

들어가며

기존의 모놀리식 애플리케이션을 MSA로 마이그레이션하면서 이벤트 기반 통신이 필요하게되었다. 이를 위해 Redis, RabbitMQ, Kafka 등의 다양한 도구가 있겠지만, MSA 구조에서 많은 장점을 가진 Kafka를 이번 구현에서 선택했다.

Kafka는 **대규모 데이터를 빠르게 처리할 수 있는 분산 메시징 플랫폼**이다. 단순한 메시지 큐 이상의 기능을 제공하며, **비동기 이벤트 기반 시스템**을 구성할 때 자주 사용된다.

## 중점적으로 봐야 하는 내용

-   Kafka는 메시지를 **토픽(topic)** 단위로 관리한다.
-   토픽은 **여러 개의 파티션(partition)** 으로 구성되어 병렬 처리 성능을 높인다.
-   Kafka는 **컨슈머 그룹(consumer group)** 단위로 오프셋(offset)을 관리해 메시지 중복 없이 안정적인 처리를 지원한다.
-   장애 시에도 **레플리케이션(replication)** 을 통해 데이터 유실을 방지한다.
-   최신 Kafka는 **Zookeeper 없이도 운영 가능한 KRaft 모드**를 지원한다.

## 본론

### 1\. 메시지 큐(Message Queue)

메시지 큐는 **데이터를 일시적으로 저장**하는 비동기 처리용 저장소이다. Producer가 메시지를 큐에 넣고, Consumer가 꺼내서 처리한다.

**Producer → Kafka Broker(Queue) ← Consumer**

Kafka는 메시지를 “토픽(topic)”으로 분류해 관리한다. **토픽 = 메시지의 카테고리** 개념으로 보면 된다.

### 2\. Kafka의 기본 구성 요소

구성 요소설명

<table style="border-collapse: collapse; width: 100%;" border="1" data-end="1430" data-start="1179" data-ke-align="alignLeft"><tbody data-end="1430" data-start="1216"><tr data-end="1254" data-start="1216"><td data-col-size="sm" data-end="1231" data-start="1216"><b>Producer</b></td><td data-col-size="sm" data-end="1254" data-start="1231">Kafka로 메시지를 전송하는 주체</td></tr><tr data-end="1293" data-start="1255"><td data-col-size="sm" data-end="1270" data-start="1255"><b>Consumer</b></td><td data-col-size="sm" data-end="1293" data-start="1270">Kafka의 메시지를 소비하는 주체</td></tr><tr data-end="1352" data-start="1294"><td data-col-size="sm" data-end="1315" data-start="1294"><b>Consumer Group</b></td><td data-col-size="sm" data-end="1352" data-start="1315">여러 Consumer를 묶은 단위로, 메시지의 오프셋을 공유</td></tr><tr data-end="1385" data-start="1353"><td data-col-size="sm" data-end="1365" data-start="1353"><b>Topic</b></td><td data-col-size="sm" data-end="1385" data-start="1365">메시지를 저장하는 논리적 단위</td></tr><tr data-end="1430" data-start="1386"><td data-col-size="sm" data-end="1399" data-start="1386"><b>Offset</b></td><td data-col-size="sm" data-end="1430" data-start="1399">각 파티션에서 메시지의 고유 번호 (0부터 시작)</td></tr></tbody></table>

-   Consumer Group은 offset을 기록해 어디까지 메시지를 읽었는지 추적한다.  
    **\--from-beginning --group** 옵션 사용 시: offset 기록이 없으면 처음부터 읽는다. offset 기록이 있다면, 마지막 읽은 지점 이후부터 읽는다.

### 3\. 파티션(Partition)

Kafka의 핵심은 **파티션을 통한 병렬 처리**이다.

-   하나의 토픽은 여러 파티션으로 구성된다.
-   하나의 파티션은 하나의 Consumer만 읽을 수 있다.
-   한 Consumer는 여러 파티션을 읽을 수 있다.
-   **파티션 내에서는 메시지 순서가 보장**된다.

```bash
$ bin/kafka-topics.sh --bootstrap-server localhost:9092 \ --alter --topic test.topic --partitions 5
```

⚠️ 주의: 파티션 수는 늘릴 수 있지만 **줄일 수는 없다.** 줄이려면 마이그레이션 과정이 필요하다.

### 4\. 메시지 분배 방식

조건방식설명

<table style="border-collapse: collapse; width: 100%;" border="1" data-end="2157" data-start="1974" data-ke-align="alignLeft"><tbody data-end="2157" data-start="2014"><tr data-end="2099" data-start="2014"><td data-col-size="sm" data-end="2027" data-start="2014"><b>Key 없음</b></td><td data-col-size="sm" data-end="2062" data-start="2027">Sticky Partitioning (Kafka 2.4+)</td><td data-col-size="sm" data-end="2099" data-start="2062">일정량의 메시지가 채워질 때까지 같은 파티션에 저장 후 이동</td></tr><tr data-end="2157" data-start="2100"><td data-col-size="sm" data-end="2113" data-start="2100"><b>Key 있음</b></td><td data-col-size="sm" data-end="2126" data-start="2113">Hash 기반 분배</td><td data-col-size="sm" data-end="2157" data-start="2126">같은 key의 메시지는 항상 같은 파티션으로 전달</td></tr></tbody></table>

```bash
$ bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic email.send --from-beginning --property print.partition=true
```

### 5\. Lag(지연)

Lag는 **컨슈머가 아직 처리하지 못한 메시지 수**를 의미한다.

-   Producer의 메시지 생성 속도 > Consumer의 처리 속도 → Lag 발생
-   지속적인 Lag은 **처리 병목**의 신호

```bash
$ bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group email-send-group --describe
```

### 6\. Retry & DLT(Dead Letter Topic)

DLT는 **오류로 처리되지 못한 메시지를 저장하는 토픽**이다. 실패 메시지 유실 방지 및 사후 분석을 위해 사용된다.

-   실패 시 {기존토픽명}-dlt 형태로 저장
-   @RetryableTopic 어노테이션 사용 시 자동 생성 가능

활용 방안:

1.  DLT에 쌓인 메시지를 수동으로 재처리
2.  장애 로그 전송 및 알림 설정
3.  Producer 검증 로직 강화로 재발 방지

### 7\. 클러스터, 브로커, 레플리케이션

-   **Node**: Kafka가 설치된 서버
-   **Cluster**: 여러 Node가 묶인 시스템
-   **Broker**: 메시지를 저장하고 요청을 처리하는 Kafka 서버
-   **Controller**: 클러스터의 상태를 관리하는 역할

Kafka는 고가용성을 위해 **최소 3대 이상의 노드**로 구성하는 것이 일반적이다.

레플리케이션(replication):

-   파티션을 여러 노드에 복제해 데이터 안정성 확보
-   리더 파티션(Leader)과 팔로워 파티션(Follower)으로 구성
-   리더 장애 시 팔로워가 승격되어 서비스 지속

```bash
$ bin/kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic email.send --partitions 1 --replication-factor 3
```

필드 설명

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td><b>PartitionCount</b></td><td>파티션 개수</td></tr><tr><td><b>ReplicationFactor</b></td><td>복제본 개수</td></tr><tr><td><b>Leader</b></td><td>리더 파티션을 가진 노드</td></tr><tr><td><b>Replicas</b></td><td>복제본이 위치한 노드 목록</td></tr><tr><td><b>ISR (In-sync Replicas)</b></td><td>리더와 동기화된 복제본 목록</td></tr></tbody></table>

### 8\. KRaft (Kafka Raft)

기존 Kafka는 **Zookeeper**에 의존했지만, 최근에는 **KRaft(Kafka Raft)** 모드로 전환 중이다.

-   Raft 알고리즘 기반의 분산 합의 방식
-   Zookeeper 없이도 Controller와 Broker가 결합 가능 (Combine 모드)
-   메타데이터를 내부적으로 관리해 일관성 향상 및 구성 단순화

Zookeeper 한계:

-   통신 지연으로 인한 정합성 문제
-   Controller 변경 감지 어려움
-   별도 운영 부담

KRaft는 이를 모두 해결하기 위한 대안이다.

## 나의 인사이트

Kafka는 처음 보면 복잡하지만, **“메시지를 효율적으로 처리하기 위한 분산 큐”** 라고 생각하면 구조가 명확해진다. 특히 파티션, 레플리케이션, DLT 개념을 명확히 이해하면 운영 시 발생하는 문제(지연, 중복, 유실)를 예측할 수 있다. 다음 단계로는 **Kafka Streams** 나 **Outbox Pattern** 등을 공부하며 실시간 데이터 파이프라인에 적용해 볼 예정이다.

## 참고 자료

-   [Kafka 공식 문서 (Apache)](https://kafka.apache.org/documentation/)
-   [Spring for Apache Kafka](https://docs.spring.io/spring-kafka/reference/)
-   [Raft Consensus Algorithm Paper](https://raft.github.io/)
