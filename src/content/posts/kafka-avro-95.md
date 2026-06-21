---
title: Kafka에서 Avro를 사용하는 이유
description: Kafka 환경에서 데이터를 주고받을 때 직렬화(Serialization) 과정은 필수이다.
pubDate: '2025-11-04T20:30:53+09:00'
dateSource: html-visible
slug: kafka-avro-95
tags:
  - avro
  - spring
  - event
  - streaming
  - seialization
  - distribution
  - platform
category: Infra/Kafka
draft: false
legacy:
  tistoryId: '95'
  sourceHtml: '95/95-[Kafka]-Kafka에서-Avro를-사용하는-이유.html'
  sourceHash: 'sha256:a690f60df77d4e29ed583577f73691710d0c8d0d53d8c89baee27875d0cbb341'
---

들어가며

Kafka 환경에서 데이터를 주고받을 때 **직렬화(Serialization)** 과정은 필수이다.

만약, 직렬화에 대해서 모른다면 다음의 글을 먼저 읽어보는 것을 추천한다.

[2023.08.20 - \[Language/Java\] - \[JAVA\] 직렬화(Serialization)란?](https://ditto-dev.tistory.com/34)

프로듀서는 객체를 바이트 배열로 변환해 토픽에 전송하고, 컨슈머는 이를 다시 객체로 복원(deserialize)한다. 이 과정에서 단순히 “객체 → 바이트” 변환만 필요하다면 **커스텀 시리얼라이저(Custom Serializer)** 를 직접 구현할 수도 있다.

하지만 시스템이 확장되고 데이터 구조가 바뀌기 시작하면 프로듀서와 컨슈머 간의 결합도, 유지보수성, 호환성 문제가 드러나게 된다. 이러한 이유로 **Avro, Protobuf, JSON Schema**와 같은 범용 직렬화 라이브러리를 조합해서 사용하는 것이 일반적이다.

이번 글에서는 **Avro 와 커스텀 시리얼라이저** 를 비교하면서, 왜 범용 직렬화 라이브러리를 조합하는 것이 일반적인지 알아보려고 한다.

### 커스텀 시리얼라이저의 예시와 한계

「Kafka 핵심 가이드」에서는 아래와 같은 CustomerSerializer 예시를 통해 Kafka에서 직접 직렬화를 구현하는 방법을 소개하고 있다.

```java
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.apache.kafka.common.errors.SerializationException;
import org.apache.kafka.common.serialization.Serializer;

public class CustomerSerializer implements Serializer<Customer> {

    @Override
    public void configure(final Map<String, ?> configs, final boolean isKey) {
        // Nothing
    }

    /**
     * 직렬화 포맷:
     * 4 byte int  -> customerId
     * 4 byte int  -> name 길이 (UTF-8 bytes)
     * N byte      -> name 실제 데이터
     */
    @Override
    public byte[] serialize(final String topic, final Customer data) {
        try {
            if (data == null) return null;

            byte[] serializedName;
            int stringSize;

            if (data.getName() != null) {
                serializedName = data.getName().getBytes(StandardCharsets.UTF_8);
                stringSize = serializedName.length;
            } else {
                serializedName = new byte[0];
                stringSize = 0;
            }

            ByteBuffer buffer = ByteBuffer.allocate(4 + 4 + stringSize);
            buffer.putInt(data.getCustomerId());
            buffer.putInt(stringSize);
            buffer.put(serializedName);

            return buffer.array();
        } catch (Exception e) {
            throw new SerializationException("Error when serializing Customer to byte[]", e);
        }
    }

    @Override
    public void close() {
        // Nothing
    }
}
```

이 코드는 단순하고 명확하다. 하지만 시간이 지나면서 다음과 같은 한계가 분명하게 드러난다.

#### 한계점

-   **스키마 변경에 취약하다.**  
    예를 들어 customerId 타입이 int → long으로 변경되면 기존 메시지를 더 이상 읽을 수 없게 된다.
-   **필드 추가나 구조 변경 시 전체 수정이 필요하다.**  
    Customer 객체에 새로운 필드가 추가되면, 프로듀서와 컨슈머의 Serializer와 Deserializer 코드를 모두 수정해야 한다.
-   **언어 확장성이 낮다.**  
    Java에 종속된 구조이기 때문에, 다른 언어(Python, Go 등)에서 동일한 메시지를 사용하기 어렵다.
-   **디버깅이 어렵다.**  
    메시지가 순수 바이트 형태이므로 구조를 확인하기 어렵고, 포맷 문서화가 되어 있지 않다.

이처럼 커스텀 시리얼라이저는 데이터 구조가 조금만 바뀌어도 전체 시스템을 다시 빌드하고 배포해야 하는 **강결합 구조**를 만든다.

### Avro를 통한 스키마 관리의 장점

이러한 문제를 해결하기 위해 Kafka에서는 **Avro**를 조합해서 사용하는 것이 일반적이다.

Avro는 **스키마 기반 직렬화 포맷**을 지원하여 서로 다른 서비스 간의 호환성을 검증한다.

#### Avro의 주요 장점

-   **스키마 기반 구조 정의**  
    JSON 형태의 스키마로 데이터 구조를 명시적으로 관리할 수 있다.
-   **스키마 진화(Schema Evolution)**  
    새로운 필드를 추가하거나 기본값을 지정할 때, 기존 스키마와의 하위 호환성을 유지할 수 있다.
-   **언어 독립성**  
    동일한 스키마 파일을 사용하여 다양한 언어(Java, Python, Go 등)에서 직렬화/역직렬화가 가능하다.
-   **운영 및 디버깅 용이성**  
    데이터가 구조적으로 정의되어 있으므로 모니터링이나 디코딩이 쉽다.

결과적으로 Avro를 사용하면 프로듀서가 스키마를 변경하더라도 하위 호환성이 유지되는 한 컨슈머는 아무런 수정 없이 그대로 동작할 수 있다. 즉, Avro는 단순한 직렬화 도구가 아니라 **서비스 간의 인터페이스(Contract)를 관리하는 표준화된 체계**이다.

비교 요약

<table style="border-collapse: collapse; width: 100%;" border="1" data-ke-align="alignLeft"><tbody><tr><td>데이터 포맷</td><td>코드 내부 정의</td><td>표준 스키마(JSON 기반)</td></tr><tr><td>스키마 호환성</td><td>수동 관리</td><td>자동 검증 (Schema Registry)</td></tr><tr><td>언어 확장성</td><td>낮음</td><td>높음</td></tr><tr><td>유지보수성</td><td>변경 시 전면 수정 필요</td><td>하위 호환 시 수정 불필요</td></tr><tr><td>배포 결합도</td><td>프로듀서·컨슈머 동시 배포</td><td>독립적 배포 가능</td></tr><tr><td>디버깅 용이성</td><td>낮음</td><td>높음</td></tr></tbody></table>

### 나의 인사이트

Kafka를 공부하면서 처음에는 “그냥 JSON으로 직렬화하면 되지 않을까?”라고 생각했다. 하지만 CustomerSerializer 예제를 따라 구현해보니 데이터 구조가 바뀌는 순간 시스템 전체가 영향을 받는다는 점을 체감했다.

스키마를 코드로 관리하는 것은 생각보다 취약한 방식이었다. 반면 Avro는 **스키마를 독립적으로 관리**하고, **변경의 안정성**을 자동으로 보장해주는 체계를 제공한다. 결국 Avro는 단순한 직렬화 도구가 아니라 **데이터 구조의 진화(Versioning)를 안전하게 관리하는 계약서**와 같다. 이는 장기적으로 분산 환경에서의 유연성과 안정성을 동시에 확보할 수 있을 것이다.

### 참고 자료

-   **Kafka 핵심 가이드 (O’Reilly)**
-   [Apache Avro 공식 문서](https://avro.apache.org/)
