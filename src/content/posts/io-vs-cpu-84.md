---
title: IO 바운드 vs CPU 바운드 작업의 병렬 처리 방식
description: 데이터를 주고받는 시간이 더 오래 걸리는 작업.
pubDate: '2025-08-28T23:26:49+09:00'
dateSource: html-visible
slug: io-vs-cpu-84
tags:
  - OS
  - 비동기
  - 스레드
  - 멀티프로세싱
  - 프로그래밍
  - cpu
  - 바운드
  - IO
category: Computer Science
draft: false
legacy:
  tistoryId: '84'
  sourceHtml: '84/84-[OS]-IO-바운드-vs-CPU-바운드-작업의-병렬-처리-방식.html'
  sourceHash: 'sha256:8785bb5252edd7ffa9bc8748a3512564ff801d78009d4521ad9cda90010a6805'
---

목차

* * *

## 용어 정리

| 용어 | 의미 |
| --- | --- |
| **I/O 바운드 (Input/Output Bound)** | CPU가 계산하는 시간보다 외부 자원(디스크, 네트워크 등)에서  
데이터를 주고받는 시간이 더 오래 걸리는 작업. |
| **CPU 바운드 (CPU Bound)** | 외부 자원보다 CPU 연산에 더 많은 시간이 소요되는 작업. |
| **비동기 프로그래밍 (Asynchronous Programming)** | 하나의 스레드가 작업이 끝나길 기다리지 않고 다른 작업을 계속 수행할 수 있도록 하는 방식. |
| **스레드 (Thread)** | 하나의 프로세스 안에서 병렬로 작업을 수행할 수 있는 실행 단위. |
| **멀티프로세싱 (Multiprocessing)** | 여러 개의 프로세스를 만들어서 병렬로 작업을 수행.  
각 프로세스는 별도의 메모리 공간을 가짐. |

## 왜 I/O 바운드는 비동기 프로그래밍이 적합한가?

### I/O 바운드의 특징

-   네트워크 요청, 파일 읽기/쓰기, 데이터베이스 쿼리 등에서 대기 시간이 김
-   이 대기 시간 동안 CPU는 **실제로 놀고 있음**

### 비동기의 장점

-   비동기 프로그래밍에서는 하나의 스레드가 I/O 작업을 요청한 뒤 결과가 올 때까지 기다리지 않고 **다른 작업을 계속 수행**
-   이로 인해 **단일 스레드로도 많은 작업을 처리**할 수 있음
-   대표적으로 Python의 `asyncio`, JavaScript의 `async/await`, Node.js 등

### 예시

```
# 동기식 코드: 파일 읽기를 기다리는 동안 멈춤
data = read_file("big_file.txt")  # 시간이 오래 걸림
process(data)

# 비동기 코드: 파일 읽기를 기다리는 동안 다른 작업 수행
data = await read_file_async("big_file.txt")
process(data)
```

### 정리:

> I/O 바운드 작업은 CPU가 한가한 상태이므로, 비동기를 사용해서 CPU가 놀지 않도록 만드는 것이 효율적.

## 왜 CPU 바운드는 스레드나 멀티프로세싱이 적합한가?

### CPU 바운드의 특징

-   대규모 계산, 이미지 처리, 암호화, 인공지능 추론 등에서 CPU 연산이 집중적으로 필요
-   CPU가 계속 바쁘게 계산함 → 비동기로는 해결 안 됨

### 비동기는 무력함

-   비동기는 **I/O가 끝나기를 기다리는 동안 유용**하지만, CPU가 계속 계산하고 있는 상황에서는 **비동기로도 CPU가 막혀있음**
-   Python의 경우 특히, GIL(Global Interpreter Lock) 때문에 **동시에 여러 스레드가 실행되지 못함** (단일 스레드만 실행 가능)

### 해결 방법: 멀티프로세싱 or 스레드

-   **멀티프로세싱**: CPU 코어마다 별도 프로세스를 할당해서 병렬 연산 → 진짜 병렬 처리 가능
-   **스레딩**: 일부 언어에서는 GIL이 없거나 효율적이므로 스레딩으로도 CPU 바운드 병렬 가능 (예: Java, C++)
-   Python에서는 `multiprocessing` 모듈로 병렬 처리

### 예시

```
# CPU 바운드 작업을 여러 프로세스에 분산
from multiprocessing import Pool

def heavy_computation(x):
    return x ** 100000

with Pool(processes=4) as pool:
    results = pool.map(heavy_computation, range(100))
```

### 정리:

> CPU 바운드 작업은 CPU가 과부하 상태이므로, 여러 프로세스를 사용하여 작업을 분산시켜야 전체 성능이 향상됨.

## 요약 비교

| 구분 | I/O 바운드 | CPU 바운드 |
| --- | --- | --- |
| 대기 시간 | 네트워크, 파일 입출력 | 계산 및 연산 |
| 병목 원인 | 외부 리소스 | CPU 자체 |
| 해결 방식 | 비동기 (async/await) | 멀티스레딩 / 멀티프로세싱 |
| Python에서 추천 | `asyncio` | `multiprocessing` |
