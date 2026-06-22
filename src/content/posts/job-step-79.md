---
title: "[SPRING BATCH] 동일한 Job과 Step이 반복 실행되지 않는 문제"
description: 티켓팅 프로젝트에서 배치 잡을 구현하면서 다음과 같은 예외를 마주하였다.
pubDate: '2024-05-18T15:55:52+09:00'
dateSource: html-visible
slug: job-step-79
tags: []
category: Spring Framework/Spring Batch
draft: false
legacy:
  tistoryId: '79'
  sourceHtml: 79/79.html
  sourceHash: 'sha256:2539e6439266cdb89f7720ce6d23d91e8691296ecd9c856eb4c80687d1600d6b'
---

## \# 문제

티켓팅 프로젝트에서 배치 잡을 구현하면서 다음과 같은 예외를 마주하였다.

```bash
java.lang.IllegalStateException: Failed to execute ApplicationRunner ...
Caused by: org.springframework.batch.core.repository.JobExecutionAlreadyRunningException: A job execution for this job is already running:
```

## \# 원인

스프링 배치는 기본적으로 잡과 스텝의 상태를 저장하고 이에 기반하여 **잡과 스텝의 실행을 1번 만 수행할 수 있도록 보장**한다. 배치 잡이 실행되면 **JobInstance**가 생성된다. 이때 **JobInstance**는 잡의 논리적 실행을 나타내며 두 가지 항목으로 식별되는데, 하나는 잡의 이름이고 하나는 잡이 실행될때 전달된 파라미터다. 그리고 이때 저장된 이름과 파라미터를 이용해서 실행되었던 잡인지 식별하게되고, 실행되었던 잡은 실행되지 않도록 하는 것이다. 이렇게 함으로써 다중으로 같은 잡이 실행되는 문제를 해결할 수 있다. 하지만 같은 잡 또는 스텝을 실행하야 하는 경우가 발생할 수 있다. 티켓팅 프로젝트에서도 동일한 스텝을 반복적으로 실행하는 경우와 테스트를 위해서 잡을 반복 실행하는 경우가 발생하였다.

## \# 문제 해결

스프링 배치에서는 잡과 스텝을 재시작 할 수 있는 다양한 방법을 제공한다. 먼저 잡을 재실행하는 방법으로는 파라미터에 실행 날짜를 전달하여 동작시키는 방법이 있지만, 여기에서는 **RunIdIncrement** 객체를 사용했다. **RunIdIncrement**를 적용하면 배치 잡 실행시 **run.id** 파라미터를 생성하고, 잡을 반복 호출시 **run.id**의 값을 증가시킨다. 이렇게 되면 지속적으로 파라미터가 변경되기 때문에 잡에 대한 반복호출이 가능해진다. **BATCH\_JOB\_EXECUTION\_PARAMS** 테이블에서 **run.id** 필드가 추가되고 잡을 실행시 값이 증가되는 것을 확인할 수 있다.

```java
return new JobBuilder("job", jobRepository)
    .start(step)
    .incrementer(new RunIdIncrementer())
    .build();
```

스텝의 경우 **allowStartIfComplete** 의 값을 **true** 로 설정하면 동일한 파라미터로 스텝을 실행해도 반복 실행이 가능하다.

```java
return new StepBuilder("step", jobRepository)
    .reader(reader)
    .processor(processor)
    .writer(writer)
    .allowStartIfComplete(true)
    .build();
```

## \# 참고

\- [https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/restart.html](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/restart.html)

\- [https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/launch/support/RunIdIncrementer.html](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/launch/support/RunIdIncrementer.html)
