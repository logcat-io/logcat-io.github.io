---
title: 이미지 캐시를 활용한 이미지 빌드 시간 개선하기
description: >-
  프로젝트를 진행하면서 애플리케이션을 수동으로 배포하는 과정이 생산성에 영향을 주게 되어, Github Actions와 도커를 활용하여
  CICD 파이프라인을 구축했다. 이때 애플리케이션을 도커 이미지로 빌드한 뒤 배포를 수행하였는데, 이미지 레이어의 캐시를 통해서 빌드 시간을
  단축했던 경
pubDate: '2024-03-06T10:43:19+09:00'
dateSource: html-visible
slug: post-76
tags:
  - docker
  - 도커
  - 이미지
  - image
  - 레이어
  - layer
  - cache
  - 빌드
  - 속도
  - 개선
  - gadle
  - build
  - optimization
category: Infra/Dcoker
cover: /images/posts/post-76/screenshot-2024-03-06-at-11-18-18-am.png
draft: false
legacy:
  tistoryId: '76'
  sourceHtml: '76/76-[Docker]-이미지-캐시를-활용한-이미지-빌드-시간-개선하기.html'
  sourceHash: 'sha256:f8f14a0f79cc779a96e4b335f3a65e30270b83e65fa56b06bed653d7ac0ce8c6'
---

목차

* * *

## 들어가며

프로젝트를 진행하면서 애플리케이션을 수동으로 배포하는 과정이 생산성에 영향을 주게 되어, Github Actions와 도커를 활용하여 CICD 파이프라인을 구축했다. 이때 애플리케이션을 도커 이미지로 빌드한 뒤 배포를 수행하였는데, 이미지 레이어의 캐시를 통해서 빌드 시간을 단축했던 경험에 대해서 작성하려고 한다.

코드 푸시부터 도커 이미지를 빌드하는 프로세스를 먼저 살펴보면 다음과 같다.

![](/images/posts/post-76/screenshot-2024-03-06-at-11-18-18-am.png)

깃헙에 소스코드가 푸시되면 Github actions의 Workflow가 순차적으로 동작한다. 가장 먼저 애플리케이션의 테스트와 빌드가 실행된다. 그리고 빌드가 성공적으로 끝나면 도커 이미지를 생성하고, 도커 허브에 이미지를 푸시하게 된다.  
  

## 도커 이미지

애플리케이션이 동작하기 위해서는 다양한 요소가 필요하다. 애플리케이션의 실행에 필요한 OS 시스템, 언어, 라이브러리, 애플리케이션 소스코드 등 다양한 요소가 필요하다.  
  
**도커 이미지**는 이러한 요소에 대한 특정 시점의 **스냅샷** 혹은 **압축 파일**이라고 생각할 수 있다. 요소에 대한 압축 파일이기 때문에 이미지는 실행 가능한 소프트웨어와 실행에 필요한 환경을 모두 갖추었다고 말할 수 있다. 이렇게 애플리케이션이 동작하기 위해서 필요한 환경을 포함하고 있는 도커는 컨테이너라는 격리된 공간에서 실행될 수 있다.  
  
뿐만 아니라 이미지는 자신에 대한 여러 메타데이터 정보도 포함한다. 이 메타데이터에는 빌드 이력과 이미지 레이어에 대한 정보가 들어있다. 아래에서는 **이미지 레이어**에 대해서 차근차근 알아볼 것이다.

### 이미지 빌드

먼저, 도커 이미지를 만들기 위해서는 빌드 명령어를 사용하는데, _Dockerfile_이 명시된 곳에서 이미지 빌드 작업을 수행할 수 있다.

```shell
docker build -t sampleproject:1.0.0 .
```

명령어의 마지막 \`.\` 은 _Dockerfile_의 위치 및 이미지에 포함시킬 자원이 위치한 경로를 의미한다. 경로가 \`**.\`** 이기 때문에 현재 위치에 _Dockerfile_이 있다는 것을 의미하고 도커에서는 이 디렉터리를 **빌드 컨텍스트**라고 한다. 만약, _Dockerfile_의 이름을 따로 지정하고 싶다면 아래의 명령어와 같이 _-f_ 옵션을 통해 _Dockerfile_의 이름을 명시할 수 있다.

```shell
docker build -f {{ 도커 파일 이름 }} -t sampleproject:1.0.0 .
```

명령어를 입력하고 이미지 빌드를 수행하면 다음과 같은 결과를 확인할 수 있다.

![](/images/posts/post-76/screenshot-2024-03-05-at-10-29-33-pm.png)

생성된 이미지는 **_docker image ls_** 명령어를 통해서 정상적으로 이미지가 생성된 것을 확인할 수 있다.

![](/images/posts/post-76/screenshot-2024-03-05-at-10-30-03-pm.png)

### 이미지 메타데이터

이미지는 실행 가능한 파일과 환경을 포함하고, 이미지에 대한 메타데이터 정보를 포함하고 있다고 설명했었다. 먼저, 이전에 생성했던 이미지의 메타데이터를 확인해 보자. 이미지의 메타 데이터를 확인할 수 있는 명령어는 아래와 같다.

```bash
docker image inspect {{이미지 이름}}:{{태그}} | {{이미지 ID}}​
```

메타데이터에는 이미지의 ID 및 생성일자, 태그 정보 등을 확인할 수 있다. 또한, 아래와 같이 _Dockerfile_에서 정의한 환경변수와 실행 명령어를 확인할 수 있다.  환경변수의 경우에는 애플리케이션의 실행에 사용될 수 있다. 

```bash
	...
	"Config": {
            "Hostname": "",
            "Domainname": "",
            "User": "",
            "AttachStdin": false,
            "AttachStdout": false,
            "AttachStderr": false,
            "ExposedPorts": {
                "8080/tcp": {}
            },
            "Tty": false,
            "OpenStdin": false,
            "StdinOnce": false,
            "Env": [
                "PATH=/usr/local/openjdk-17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "JAVA_HOME=/usr/local/openjdk-17",
                "LANG=C.UTF-8",
                "JAVA_VERSION=17.0.2",
                "DB_USERNAME=sample", // Dockerfile 에 명시한 ENV
                "DB_PASSWORD=sample" // Dockerfile 에 명시한 ENV
            ],
            "Cmd": [
                "-jar",
                "cicdproject.jar"
            ],
    ...
```

이외에도 다양한 정보가 있지만 이번에 관심 있게 살펴볼 데이터는 다음의 레이어 데이터이다.

### 이미지 레이어

도커의 이미지 레이어는 도커 문서에 다음과 같이 설명되어 있다.

> A Docker image is built up from **a series of layers**. **Each layer represents an instruction in the image's Dockerfile**. Each layer except the very last one is **read-only**.  
>   
> ([https://docs.docker.com/storage/storagedriver/#images-and-layers](https://docs.docker.com/storage/storagedriver/#images-and-layers "https://docs.docker.com/storage/storagedriver/#images-and-layers"))

이를 정리해 보면, 도커의 이미지는 **이미지 레이어가 중첩된 구조**의 **Layered File System**으로 구성되어 있다. 각 레이어는 **읽기 전용 레이어**로 구성되어 있고, **이전 레이어에 대한 일련의 파일 변경 사항**을 나타낸다.

> When you run a build, **the builder attempts to reuse layers from earlier builds**. If a layer of an image is unchanged, then **the builder picks it up from the build cache**.  
>   
> ([https://docs.docker.com/build/guide/layers/#cached-layers)](https://docs.docker.com/build/guide/layers/#cached-layers\))

그리고 빌드된 이미지의 **각 레이어는 도커 엔진의 캐시에 물리적인 파일로 저장**된다. 저장된 캐시 레이어를 이용하면 리소스를 효율적으로 사용하고, 이미지를 더 빠르게 빌드할 수 있다.

다음은 Dockerfile이 이미지의 레이어로 생성되는 것을 도식화한 것이다. 레이어는 _Dockerfile_에 작성된 각 명령어의 수행을 의미한다. 이때 모든 명령어에 대해서 레이어가 생성되는 것은 아니고, 파일 시스템에 변경을 야기하는 명령어에 대해서만 레이어가 생성된다. 기본적으로는 _WORKDIR_, _COPY_, _RUN_, _ENV 등_의 명령어가 있다. 단, 도커 엔진의 버전에 따라서 레이어가 생성되는 것이 조금씩 다르고, 반복적인 부분은 통합해서 레이어를 생성하는 경우가 있기 때문에 정확한 레이어 구성은 각 레이어가 저장된 파일을 확인하는 것이 정확하다.

![](/images/posts/post-76/screenshot-2024-03-06-at-11-17-41-am.png)

다시 이미지 레이어 설명으로 돌아와서, 각 레이어는 빌드 시에 도커의 캐시에 물리적으로 저장되고, 재사용된다고 설명했다. 그렇다면 실제로 캐싱된 레이어가 재사용되는지 확인해 보자.

먼저, 이전에 빌드한 이미지의 메타데이터 중에서 레이어 데이터를 확인하면 다음과 같다. 각 **해시값은 하나의 레이어를 의미**하고, 레이어는 총 5개의 층으로 구성된 것을 확인할 수 있다. 각 레이어는 위에서 설명한 것과 같이 _Dockerfile_에 작성된 베이스 이미지를 기반으로 명령어를 수행하고, 기존 파일 시스템에 변화를 주는 명령어를 기준으로 새로운 레이어가 생성되게 된다.

```bash
	...
 	"RootFS": {
            "Type": "layers",
            "Layers": [
                "sha256:f941f90e71a87df1d35c7a66a72fd3dda2c2884e1ad190da978321d548db23e2",
                "sha256:2f263e87cb115336990db64a3be249209e30c070bfa33be47dca80928e4f0ec6",
                "sha256:c82e5bf37b8a21c2e681da6e397fbb4f8095b3864cbad8d2a73f5ad2f69b6ff2",
                "sha256:b8f6aa2cf91b8fd2515eefe93d8a09f23b82ef6b2e5574339771c1bd1d79e56f",
                "sha256:3cd18d31d00da2564bb5f4ae7b46d3a368ab1c706a3d496b75194a340b461acb"
            ]
        },
    ...
```

캐싱된 레이어의 재사용을 테스트하기 위해서 간단하게 소스코드를 변경하고 이미지를 다시 빌드하였다. 빌드된 이미지의 레이어 메타데이터는 아래와 같다.

```bash
	...
		"Layers": [
                "sha256:f941f90e71a87df1d35c7a66a72fd3dda2c2884e1ad190da978321d548db23e2",
                "sha256:2f263e87cb115336990db64a3be249209e30c070bfa33be47dca80928e4f0ec6",
                "sha256:c82e5bf37b8a21c2e681da6e397fbb4f8095b3864cbad8d2a73f5ad2f69b6ff2",
                "sha256:b8f6aa2cf91b8fd2515eefe93d8a09f23b82ef6b2e5574339771c1bd1d79e56f",
                "sha256:01806abedbe30b2c42c463ee6ba4662e242a57906da6f1ca6a4956babfd1cd8d"
            ]
    ...
```

두 메타데이터를 비교해 보면 마지막 레이어를 제외하고는 모두 같은 레이어를 사용하고 있는 것을 확인할 수 있다.

```bash
"sha256:f941f90e71a87df1d35c7a66a72fd3dda2c2884e1ad190da978321d548db23e2",
"sha256:2f263e87cb115336990db64a3be249209e30c070bfa33be47dca80928e4f0ec6",
"sha256:c82e5bf37b8a21c2e681da6e397fbb4f8095b3864cbad8d2a73f5ad2f69b6ff2",
"sha256:b8f6aa2cf91b8fd2515eefe93d8a09f23b82ef6b2e5574339771c1bd1d79e56f",
```

즉, 실제로 기존에 캐싱된 레이어를 재사용하는지 확인할 수 있었다.

## 이미지 빌드 개선

이제 이미지의 빌드 시간을 개선해 보자. 위의 글에서 이미지 빌드 시 각 레이어는 도커 엔진에 캐싱되고, 동일한 레이어는 재사용되는 것을 확인할 수 있었다.  
  

_**그렇다면 빌드 로직에서 시간이 가장 많이 소요되는 부분을 미리 이미지 레이어로 생성해 두면 빌드 시간이 단축될 수 있을까?**_

  
애플리케이션의 소스코드는 그 자체로는 실행할 수 없다. 소스코드를 실행 가능한 프로그램으로 빌드하고 그 과정 속에서 의존성 라이브러리들을 설치하는 등의 과정이 필요하다. 그리고 이때 만들어진 결과 프로그램을 도커 이미지로 생성하게 되는 것이다. 

이때 애플리케이션의 빌드 과정에서 가장 시간이 많이 소요되는 작업은 의존성 트리를 생성하고, 필요한 의존성 라이브러리를 설치하는 과정이다. 이러한 과정을 빌드와 분리시켜 레이어로 캐싱해 둘 수 있다면 이미지 빌드 시간을 줄일 수 있을 것이다.

예제에는 스프링 부트 기반의 매우 간단한 애플리케이션을 준비했다. 먼저 아래의 _Dockerfile_을 보면 멀티 스테이지 빌드를 통해서 이미지를 빌드하게 된다.

```bash
FROM gradle:7.6.1-jdk17 AS build
WORKDIR /app
COPY . /app
RUN gradle clean build --no-daemon

FROM openjdk:17-jdk-slim
WORKDIR /app
COPY --from=build /app/build/libs/*.jar /app/simpleproject.jar
EXPOSE 8080
ENTRYPOINT ["java"]
CMD ["-jar", "simpleproject.jar"]
```

다음은 위의 Dockerfile과 같은 동작을 하지만 빌드 부분을 수정한 _Dockerfile_이다.

```bash
FROM gradle:7.6.1-jdk17 AS build
WORKDIR /app

COPY build.gradle settings.gradle ./
RUN gradle dependencies --no-daemon

COPY . /app
RUN gradle clean build --no-daemon
FROM openjdk:17-jdk-slim
WORKDIR /app
COPY --from=build /app/build/libs/*.jar /app/simpleproject.jar
EXPOSE 8080
ENTRYPOINT ["java"]
CMD ["-jar", "simpleproject.jar"]
```

기존의 _Dockerfile_과의 차이점은 _build.gradle_과 _settings.gradle_ 파일을 복사한 뒤, _gradle dependencies_ 명령어를 수행하는 부분이 추가되었다.

```bash
COPY build.gradle settings.gradle ./
RUN gradle dependencies --no-daemon
```

이는 _gradle_의 빌드 과정을 살펴보아야 하는데 _gradle_은 빌드 수행 시, 애플리케이션의 전체 의존성 트리를 렌더링 하기 위한 작업을 수행한다. 이때 애플리케이션이 커지고 복잡할수록 많은 시간이 소요된다.

![](/images/posts/post-76/screenshot-2024-03-06-at-11-00-14-am.png)

이렇게 시간이 많이 소요될 수 있는 부분을 별도의 레이어로 분리하면 캐싱을 통한 재사용의 이점을 가질 수 있기 때문에, 의존성 트리를 하위 레이어에서 미리 구성할 수 있도록 분리한 것이다.

하지만 주의해야 할 점이 있다. 레이어는 이전 레이어의 일련의 변경사항을 저장한다고 했다. 이는 중간 레이어의 변경은 이후 모든 레이어의 변경을 야기하기 때문에 변경 이후의 레이어는 모두 다시 생성되게 된다. 그렇기 때문에 무겁지만 자주 변경되는 레이어를 임의적으로 하단에 배치하면 캐싱의 이점을 가져갈 수 없다.

위에서 예시로 사용한 애플리케이션의 경우 의존성의 변경 빈도가 애플리케이션 소스 코드가 변경되는 빈도 보다 적기 때문에 의존성 트리를 렌더링 하는 부분을 분리하여 캐싱하는 것이 이미지 빌드 시간을 줄일 수 있을 것이다.

다음은 실제로 _gradle dependencies_ 명령어를 분리한 _Dockerfile_과 분리하지 않은 _Dockerfile_로 이미지를 빌드한 결과이다. 각각 초기 이미지 빌드 후 소스코드를 변경하여 다시 빌드한 결과를 비교한 것이다.

-   **_gradle dependencies_ 분리하지 않음**
    -   초기 이미지 빌드 시간:  **18.5s** 
    -   소스 코드 수정 후 이미지 빌드 시간:  **19.1s** 

![](/images/posts/post-76/edited-screenshot-2024-03-06-at-11-10-32-am.png)

![](/images/posts/post-76/edited-screenshot-2024-03-06-at-11-10-42-am.png)

-   **_gradle dependencies_ 분리**
    -   초기 이미지 빌드 시간: **23.5s** 
    -   소스 코드 수정 후 이미지 빌드 시간: **10.8s** 

![](/images/posts/post-76/edited-screenshot-2024-03-06-at-11-13-44-am.png)

![](/images/posts/post-76/edited-screenshot-2024-03-06-at-11-13-58-am.png)

**두 결과를 비교해 보면 의존성 트리 렌더링 레이어를 캐싱한 이미지가 소스코드 변경 시,**

**이미지 빌드 시간은 2배 이상 줄일 수 있었다.**

테스트에 사용한 애플리케이션은 정말 간단한 애플리케이션이지만, 애플리케이션이 커질수록 캐시를 통한 이미지 빌드는 배포 및 운영 시간을 단축하여 생산성을 높일 수 있을 것이다.

## 참고

-   [https://docs.gradle.org/current/userguide/core\_dependency\_management.html](https://docs.gradle.org/current/userguide/core_dependency_management.html)
-   [https://docs.gradle.org/current/userguide/build\_lifecycle.html](https://docs.gradle.org/current/userguide/build_lifecycle.html)
-   [https://docs.gradle.org/6.1/userguide/dependency\_resolution.html#sub:cache\_copy](https://docs.gradle.org/6.1/userguide/dependency_resolution.html#sub:cache_copy)
-   [https://docs.docker.com/build/guide/layers/](https://docs.docker.com/build/guide/layers/)
-   [https://docs.docker.com/storage/storagedriver/](https://docs.docker.com/storage/storagedriver/)
