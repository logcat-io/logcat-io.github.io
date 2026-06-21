---
title: 'DB 개인정보 암호화 시스템 구축기: AES‑256‑GCM + Blind Index'
description: >-
  개인 프로젝트를 진행하다 보면 전화번호, 빌링키 같은 민감한 데이터를 DB에 저장해야 하는 순간이 온다. 개인정보보호법이나 정보통신망법을
  따져보면 양방향 암호화가 필수인 항목들이 꽤 많다. 공부 삼아 직접 암호화 모듈을 설계하고 구현해 봤는데, 생각보다 고려할 것이 많았다.
pubDate: '2026-03-22T18:01:45+09:00'
dateSource: html-visible
slug: db-aes-256-gcm-blind-index-99
tags:
  - Java
  - 보안
  - 암호화
  - 암복호화
  - encrypt
  - aes-256
  - AES-256-GCM
  - Blind
  - Index
  - '@Convert'
category: Spring Framework/Spring & Spring Boot
draft: false
legacy:
  tistoryId: '99'
  sourceHtml: 99/99.html
  sourceHash: 'sha256:c4745b7ca30118e96cb5122fa8ccfb7ea1bd37199df860ffe3d07e7acd6e6a74'
---

> 사이드 프로젝트에서 전화번호, 결제 정보 등 민감 데이터를 다루면서 DB 암호화의 필요성을 느꼈다. 단순히 암호화만 하면 되는 줄 알았는데, 검색은 어떻게 하지? 마이그레이션은? NestJS 서버와 같은 DB를 쓰는데 호환은? 하나씩 해결해 나간 과정을 정리한다.

## 들어가며

개인 프로젝트를 진행하다 보면 전화번호, 빌링키 같은 민감한 데이터를 DB에 저장해야 하는 순간이 온다. 개인정보보호법이나 정보통신망법을 따져보면 양방향 암호화가 필수인 항목들이 꽤 많다. 공부 삼아 직접 암호화 모듈을 설계하고 구현해 봤는데, 생각보다 고려할 것이 많았다.

특히 이런 문제들이 까다로웠다:

-   **검색 불가**: AES-GCM은 랜덤 IV를 사용하므로 `WHERE phone = ?` 검색이 안 된다
-   **기존 데이터 전환**: 이미 저장된 평문 데이터를 서비스 중단 없이 암호화해야 한다
-   **크로스 플랫폼**: Java(Spring Boot)와 NestJS(Node.js)가 같은 DB를 공유하므로 양쪽 모두 암복호화가 가능해야 한다

이 글에서는 AES-256-GCM 암호화, SHA-256 Blind Index 검색, JPA Converter 자동화, 무중단 마이그레이션, NestJS 호환까지 전체 과정을 다룬다.

## Crypto 모듈은 무엇을 하는가

한 문장으로 요약하면: **DB에 저장되는 민감 데이터를 필드 레벨에서 자동 암복호화하고, 암호화된 상태에서도 검색이 가능하게 해주는 모듈**이다.

| 기능 | 설명 |
| --- | --- |
| **양방향 암호화** | AES-256-GCM으로 암호화하여 DB에 저장, 조회 시 복호화 |
| **Blind Index 검색** | SHA-256 + pepper 해시 컬럼으로 `WHERE hash = ?` 검색 |
| **JPA 자동 처리** | `@Convert` 어노테이션 한 줄로 서비스 코드 수정 없이 적용 |
| **키 로테이션** | 버전 접두사(`1:`, `2:`)로 다중 키 관리 |
| **레거시 호환** | 마이그레이션 과도기에 평문/암호문 혼재 처리 |
| **크로스 플랫폼** | Java ↔ NestJS(Node.js) 동일 암복호화 포맷 |

### 기술 스택

| 항목 | 사양 |
| --- | --- |
| 암호화 알고리즘 | AES-256-GCM (AEAD) |
| 런타임 | Java 17 + Spring Boot 3 + JPA/Hibernate |
| 크로스 플랫폼 | NestJS (Node.js) 동일 암복호화 호환 |
| 키 관리 | 환경변수 주입 (AWS Secrets Manager 등) |
| 해시 알고리즘 | SHA-256 + pepper (Blind Index) |

### 패키지 구조

```java
core-module/src/main/java/com/example/core/crypto/
├── config/
│   ├── CryptoProperties.java        # @ConfigurationProperties: 키, pepper 설정
│   └── CryptoConfig.java            # @EnableConfigurationProperties
├── key/
│   └── KeyManager.java              # @Component: 키 저장/조회 도메인 객체
├── service/
│   ├── EncryptionService.java       # @Service: AES-256-GCM 암복호화
│   └── HashService.java             # @Service: SHA-256 + pepper 해시
├── converter/
│   └── SensitiveDataEncryptConverter.java  # JPA AttributeConverter
├── support/
│   └── CryptoServiceHolder.java     # 정적 홀더 (Converter → Spring Bean 접근)
└── exception/
    ├── CryptoException.java         # 암복호화 실패 예외
    └── KeyNotFoundException.java    # 키 버전 미존재 예외
```

모듈을 core에 두었다. 암호화는 도메인 비즈니스 로직이 아니라 인프라 계층이기 때문이다. domain 모듈에 넣어도 순환 의존성은 발생하지 않지만, 공통 유틸리티와 같은 성격이므로 core가 적합하다고 판단했다.

### 클래스 역할 요약

| 클래스 | 계층 | 역할 |
| --- | --- | --- |
| `CryptoProperties` | config | `@ConfigurationProperties(prefix = "crypto")`. 키, pepper, 현재 버전 바인딩 |
| `CryptoConfig` | config | `@EnableConfigurationProperties`로 설정 활성화 |
| `KeyManager` | key | Base64 디코딩 → `SecretKeySpec` 변환. 불변 `Map`으로 버전별 키 관리. 기동 시 32바이트 검증 |
| `EncryptionService` | service | AES-256-GCM 암복호화. `encrypt()`, `decrypt()`, `decryptIfNeeded()` 제공 |
| `HashService` | service | `SHA-256(normalizedValue + pepper)` → Base64 해시 생성 |
| `SensitiveDataEncryptConverter` | converter | JPA `AttributeConverter`. write 시 `encrypt()`, read 시 `decryptIfNeeded()` |
| `CryptoServiceHolder` | support | 정적 홀더. Hibernate가 직접 생성하는 Converter에서 Spring Bean에 접근 |
| `CryptoException` | exception | 암복호화 실패 예외. `BusinessException`과 분리하여 보안 정보 미노출 |
| `KeyNotFoundException` | exception | `CryptoException` 하위. 요청된 키 버전이 없을 때 |

## 데이터 흐름

### Write 경로 (INSERT/UPDATE)

```
평문 ("01012345678")
  │
  ├── @Convert(SensitiveDataEncryptConverter)
  │     └── EncryptionService.encrypt()
  │           └── "1:Base64(IV|CT|AuthTag)" → DB phone 컬럼 저장
  │
  └── PhoneHashUtil.hashPhone()
        └── SHA-256(normalized + pepper)
              └── Base64 해시 → DB phone_hash 컬럼 저장
```

### Read 경로 (SELECT)

```
DB phone 컬럼
  │
  └── @Convert(SensitiveDataEncryptConverter)
        └── EncryptionService.decryptIfNeeded()
              ├── 암호문 ("1:...") → decrypt() → 평문
              └── 레거시 평문 ("01012345678") → 그대로 반환
```

### Search 경로 (WHERE)

```
검색어 ("010-1234-5678")
  │
  └── PhoneHashUtil.hashPhone()
        └── normalize → "01012345678"
              └── SHA-256 + pepper → "aB3x..."
                    └── WHERE phone_hash = 'aB3x...'  (인덱스 사용)
```

### 레거시 평문 호환 (마이그레이션 과도기)

```
DB: phone = "01012345678" (평문)

조회 시:
  convertToEntityAttribute("01012345678")
    → ":" 미포함 → 평문 판단 → 그대로 반환

재저장 시:
  convertToDatabaseColumn("01012345678")
    → 항상 encrypt() → "1:GCM암호문..."
    → 자연스럽게 암호화로 전환
```

## 엔티티에 암호화 적용하는 방법

가장 고민했던 부분이다. 전화번호를 다루는 서비스 코드가 90곳이 넘었는데, 각 곳에서 `encrypt()`/`decrypt()`를 직접 호출하면 대규모 수정이 필요하고 누락 위험도 컸다.

**JPA `@Convert`를 선택한 이유:**

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| 서비스 레이어 수동 호출 | 명시적 | 90곳+ 수정 필요, 누락 시 평문 저장 버그 |
| **JPA AttributeConverter** | 엔티티 1줄 추가, 서비스 코드 수정 없음 | Spring Bean 주입 불가 → 정적 홀더 필요 |
| Hibernate EventListener | 유연한 이벤트 기반 | 설정 복잡, 디버깅 난이도 높음 |
| DB 레벨 TDE | 앱 코드 변경 없음 | DB 접근 권한 탈취 시 무력화 |

결국 `@Convert`를 선택했다. 서비스 코드 변경 없이 엔티티 필드에 어노테이션만 추가하면 되기 때문이다.

### 엔티티 적용 예시

```
@Entity
@Table(name = "orders")
public class Order extends BaseTimeEntity {

    @Convert(converter = SensitiveDataEncryptConverter.class)
    @Column(name = "customer_phone", nullable = false, length = 200)
    private String customerPhone;

    // 해시 컬럼: @Convert 없음. 서비스 레이어에서 직접 세팅.
    @Column(name = "customer_phone_hash", length = 100)
    private String customerPhoneHash;
}
```

핵심 포인트:

-   `customer_phone`에만 `@Convert`를 건다. 저장 시 자동 암호화, 조회 시 자동 복호화.
-   `customer_phone_hash`에는 `@Convert`를 걸지 않는다. 해시는 서비스 레이어에서 평문을 받아 계산해야 하는데, Converter 시점에는 이미 암호문이기 때문이다.
-   컬럼 길이를 200으로 확장했다. 암호문은 평문보다 훨씬 길다. (Base64 + IV + AuthTag 오버헤드)

### 서비스 코드 — 변경 없음

```
// 암호화 적용 전후로 이 코드는 변경하지 않았다
order.setCustomerPhone("01012345678");     // → DB에 암호문 저장
String phone = order.getCustomerPhone();    // → 평문 반환
```

수정이 필요한 곳은 전화번호로 **검색**하는 로직뿐이다. `WHERE phone = ?`를 `WHERE phone_hash = ?`로 바꾸는 작업.

## 설정

### application.yml (공통)

```
crypto:
  current-key-version: ${CRYPTO_CURRENT_KEY_VERSION:1}
  keys:
    1: ${CRYPTO_KEY_V1}
  pepper: ${CRYPTO_PEPPER}
```

### application-local.yml (로컬 개발용)

```
crypto:
  current-key-version: 1
  keys:
    1: "TCiKML3d8ILkQyJfBPOa5JAx06n30+cZlt4rT09sQ/0="  # openssl rand -base64 32
  pepper: "rk3wXFKemN0KgDX7VnVA6GWmeejevRJUaPHCsZb2/ZA="  # openssl rand -base64 32
```

### CryptoProperties.java

```
@Getter
@EqualsAndHashCode
@AllArgsConstructor
@ConfigurationProperties(prefix = "crypto")
public class CryptoProperties {
    private int currentKeyVersion;
    private Map<Integer, String> keys;
    private String pepper;
}
```

**환경변수 가이드:**

```
# 키 생성 (반드시 32 바이트 랜덤)
openssl rand -base64 32

# 필요한 환경변수
CRYPTO_KEY_V1                # AES-256 키 (Base64, 32 bytes)
CRYPTO_PEPPER                # 해시용 pepper (Base64, KEY와 다른 값)
CRYPTO_CURRENT_KEY_VERSION   # 현재 키 버전 (기본값 1)
```

환경별로 다른 키를 사용하는 것이 필수다. local/dev/prod 키를 절대 공유하면 안 된다. 운영 키는 AWS Secrets Manager 등 외부에서 주입한다.

* * *

## 절대 하면 안 되는 것

이 부분은 구현하면서 실수하기 쉬운 포인트를 정리한 것이다. 특히 첫 번째 항목은 실제로 보안 취약점으로 이어질 수 있다.

| 금지 사항 | 위험 | 올바른 방법 |
| --- | --- | --- |
| Write 경로에서 `isLegacyPlaintext()` 사용 | 공격자가 `"1:fakeCipher"` 입력 시 암호화 우회 | Write는 항상 `encrypt()` 호출 |
| 키/평문/암호문/해시값 로그 출력 | 로그 수집 시스템에 영구 보관되어 유출 | 메타데이터만 로그 (`keyVersion`, 오류 유형) |
| 키를 UTF-8 문자열로 사용 | 44자 Base64 → UTF-8 → 44 bytes (32가 아님!) | `Base64.getDecoder().decode()` 후 32바이트 검증 |
| IV 재사용 또는 고정값 사용 | GCM에서 동일 키+IV 재사용 시 키 복원 가능 | 매번 `buildIv()`로 새 IV 생성 |
| ECB 모드 사용 | 같은 평문 → 같은 암호문 (패턴 노출) | GCM 모드만 사용 |
| `CryptoException`을 `BusinessException`으로 변경 | 에러 코드가 API 응답에 노출 → 공격 벡터 제공 | 별도 `RuntimeException`으로 유지 |

### Write 경로 보안 규칙 상세

이 규칙은 설계 초기에 확립했는데, 이유가 명확하다:

```
공격 시나리오:
  1. 공격자가 API에 "1:fakeCiphertext" 입력
  2. write 경로에서 isLegacyPlaintext("1:fakeCiphertext") → false
  3. "이미 암호문이니 암호화 불필요"로 판단 → 그대로 DB 저장
  4. 결과: 암호화 우회 성공
```

따라서 각 메서드의 사용 가능 경로를 엄격히 분리했다:

| 메서드 | 사용 가능 경로 | 이유 |
| --- | --- | --- |
| `encrypt()` | Write 전용 | 항상 암호화, 판별 없음 |
| `decrypt()` | 암호문 전용 | "version:Base64" 포맷 필수 |
| `decryptIfNeeded()` | Read + Migration 전용 | 레거시 평문 호환 |
| `isLegacyPlaintext()` | Read 전용 | Write에서 절대 사용 금지 |

## 암호문 포맷

### 저장 형식

```
"version:Base64(IV | Ciphertext | AuthTag)"

예: "1:sE3ZT2uyABCD...=="
```

-   `version`: 암호화에 사용된 키 버전 (정수). 키 로테이션 시 복호화할 키를 식별
-   `Base64`: IV + CT + AuthTag를 결합한 바이트 배열의 Base64 인코딩

### 바이트 레이아웃

```
Offset  Length  내용
0       4       IV - Unix timestamp 초 (big-endian, unsigned)
4       8       IV - SecureRandom bytes
12      N       Ciphertext (N = 평문 바이트 길이)
12+N    16      AuthTag (GCM 자동 생성, 128 bits)

최소 길이: IV(12) + CT(0) + AuthTag(16) = 28 bytes
```

### AES-256-GCM 파라미터

| 파라미터 | 값 | 근거 |
| --- | --- | --- |
| 키 길이 | 32 bytes (256 bits) | NIST SP 800-132 |
| IV 길이 | 12 bytes (96 bits) | GCM 권장 (NIST SP 800-38D) |
| AuthTag 길이 | 16 bytes (128 bits) | GCM 최대 강도 |
| 패딩 | NoPadding | GCM은 스트림 암호 모드, 패딩 불필요 |

### IV 생성 전략

```
private byte[] buildIv() {
    byte[] iv = new byte[12];

    long tsLong = System.currentTimeMillis() / 1000L;
    int ts = (int) (tsLong & 0xFFFFFFFFL);  // unsigned, 2106년까지 안전
    iv[0] = (byte) (ts >> 24);
    iv[1] = (byte) (ts >> 16);
    iv[2] = (byte) (ts >> 8);
    iv[3] = (byte) (ts);

    byte[] rnd = new byte[8];
    SECURE_RANDOM.nextBytes(rnd);
    System.arraycopy(rnd, 0, iv, 4, 8);

    return iv;
}
```

왜 순수 랜덤 12바이트가 아닌 `timestamp(4) + random(8)` 복합 구조를 선택했는가:

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| 순수 랜덤 12바이트 | 단순 | Birthday Problem: 2^48회 후 50% 충돌 |
| 카운터 기반 | 충돌 불가 | 분산 환경에서 카운터 동기화 필요 |
| **timestamp(4) + random(8)** | 같은 초에 2^64회 이상 암호화해야 충돌. 분산 환경 안전 | 시계 역행 시 이론적 위험 (random 8바이트로 상쇄) |

timestamp가 시간 축 분리를 보장하므로, 동일 random이 생성될 확률이 극소화된다. unsigned 처리(`& 0xFFFFFFFFL`)로 2106년까지 안전하다.

## 테스트

테스트는 Mock을 사용하지 않고 실제 암복호화를 수행하는 방식으로 작성했다. 암호화 모듈에서 Mock을 쓰면 실제 바이트 레이아웃 검증이 불가능하기 때문이다.

### 핵심 테스트 케이스

```java
@Test
@DisplayName("전화번호 암호화→복호화 원문 일치")
void shouldEncryptAndDecryptPhoneNumber() {
    String encrypted = encryptionService.encrypt("01012345678");
    String decrypted = encryptionService.decrypt(encrypted);
    assertEquals("01012345678", decrypted);
}

@Test
@DisplayName("같은 평문 두 번 암호화 → 암호문 다름 (IV 랜덤성)")
void shouldProduceDifferentCiphertextForSamePlaintext() {
    String enc1 = encryptionService.encrypt("01012345678");
    String enc2 = encryptionService.encrypt("01012345678");
    assertNotEquals(enc1, enc2);
}

@Test
@DisplayName("AuthTag 1비트 변조 → 복호화 실패")
void shouldFailOnAuthTagTampering() {
    String encrypted = encryptionService.encrypt("01012345678");
    String[] parts = encrypted.split(":", 2);
    byte[] combined = Base64.getDecoder().decode(parts[1]);
    combined[combined.length - 1] ^= 1;  // 마지막 바이트 1비트 변조
    String tampered = parts[0] + ":" + Base64.getEncoder().encodeToString(combined);
    assertThrows(CryptoException.class, () -> encryptionService.decrypt(tampered));
}
```

### 해시 테스트

```java
@Test
@DisplayName("같은 입력 → 같은 해시 (결정적)")
void shouldProduceSameHashForSameInput() {
    String hash1 = hashService.hash("01012345678");
    String hash2 = hashService.hash("01012345678");
    assertEquals(hash1, hash2);
}

@Test
@DisplayName("다른 pepper → 다른 해시")
void shouldProduceDifferentHashWithDifferentPepper() {
    // pepper1과 pepper2로 각각 HashService 생성
    String hash1 = hashService1.hash("01012345678");
    String hash2 = hashService2.hash("01012345678");
    assertNotEquals(hash1, hash2);
}
```

## 전체 테스트 목록

| 테스트 파일 | 테스트 수 | 검증 대상 |
| --- | --- | --- |
| KeyManagerTest | 6 | 키 로딩, 32바이트 검증, 버전 관리 |
| EncryptionServiceTest | 13 | 암복호화, null 처리, 변조 감지 |
| IvGenerationTest | 3 | IV 길이, timestamp unsigned, 유일성 |
| HashServiceTest | 6 | 결정적 해시, pepper 영향, 정규화 |
| StorageFormatTest | 2 | 바이트 레이아웃, 크로스 플랫폼 포맷 |
| MigrationLogicTest | 3 | 레거시 판별, 멱등성 |

* * *

## 설계 결정 기록 (Decision Records)

### 왜 AES-256-GCM인가

| 후보 | 장점 | 단점 | 선택 |
| --- | --- | --- | --- |
| AES-256-CBC | 가장 널리 사용, 구현 단순 | 무결성 보장 없음. 패딩 오라클 공격 취약. 별도 HMAC 필요 | X |
| **AES-256-GCM** | 암호화 + 무결성 동시 보장(AEAD). 패딩 불필요. 1비트 변조 감지 | IV 재사용 시 보안 붕괴 | **O** |
| ChaCha20-Poly1305 | AES-NI 미지원 환경에서 빠름 | Java 표준 라이브러리 미포함. NestJS 호환 복잡 | X |

GCM을 선택한 결정적 이유는 **AuthTag**다. CBC를 쓰면 별도로 HMAC을 계산하고 검증하는 로직을 추가해야 하는데, GCM은 암호화 과정에서 AuthTag를 자동 생성한다. DB 레코드가 1비트라도 변조되면 `AEADBadTagException`이 발생하여 즉시 감지된다.

### 왜 SHA-256 + pepper인가 (Blind Index)

| 후보 | 장점 | 단점 | 선택 |
| --- | --- | --- | --- |
| HMAC-SHA256 | 키 기반 인증, 표준적 | pepper와 실질적 차이 없음. 키 관리 복잡도 증가 | X |
| **SHA-256 + pepper** | 단순. 결정적 해시. 인덱스 검색 O(log n) | pepper 탈취 시 전수 계산 가능 (전화번호 ~1억 공간) | **O** |
| bcrypt/argon2 | 전수 계산 저항성 | 느림(의도적). DB 검색 인덱스로 부적합 | X |

검색 인덱스용이므로 결정적 출력과 빠른 계산이 필수다. bcrypt는 의도적으로 느리게 설계된 알고리즘이라 매 검색마다 해시 계산에 수십ms가 걸린다. Blind Index에는 적합하지 않다.

**Blind Index의 구조적 한계는 인지하고 있다:**

```
한국 휴대전화 번호 공간: 010-0000-0000 ~ 010-9999-9999 ≈ 1억 개
SHA-256 해시 속도: GPU 1장 당 약 60억 회/초

DB + pepper 동시 탈취 시:
  1억 / 60억 = 약 0.017초 (GPU 1장)
  → 모든 전화번호 역산 가능
```

이것은 Blind Index 자체의 한계다. 방어 전략은 **pepper와 키를 안전하게 보호하는 것**이 핵심이다. DB만 탈취된 경우에는 해시에서 원본을 알 수 없다.

### 왜 JPA AttributeConverter인가

전화번호를 다루는 서비스 코드가 90곳 이상이었다. 각 곳에서 `encrypt()`/`decrypt()`를 직접 호출하는 방식은 대규모 수정 + 누락 위험이 있었다. `@Convert` 한 줄이면 서비스 코드 수정 없이 자동 암복호화가 된다. 대신 Hibernate가 Converter를 직접 `new`로 생성하므로 `@Autowired` 주입이 불가능한 문제가 있었다. 이를 `CryptoServiceHolder` 정적 홀더 패턴으로 해결했다:

```
@Component
public class CryptoServiceHolder {
    private static EncryptionService instance;

    public CryptoServiceHolder(final EncryptionService encryptionService) {
        CryptoServiceHolder.instance = encryptionService;
    }

    public static EncryptionService get() {
        if (instance == null) {
            throw new IllegalStateException("Spring Context 미초기화");
        }
        return instance;
    }
}
```

Spring Context 초기화 시 생성자가 호출되면서 static 필드에 Bean을 저장한다. 이후 Converter에서`CryptoServiceHolder.get()`으로 접근한다.

### 왜 Base64 키인가

이 부분은 설계 초기에 실수하기 쉬운 영역이다.

```
// 잘못된 방법: UTF-8 인코딩
byte[] keyBytes = rawKey.getBytes(StandardCharsets.UTF_8);
// Base64 문자열 "K7gNU3sdo+OL..." → UTF-8 → 44 bytes (32가 아님!)
// → InvalidKeyException 발생

// 올바른 방법: Base64 디코딩
byte[] keyBytes = Base64.getDecoder().decode(rawKey);
// Base64 44자 → 디코딩 → 정확히 32 bytes
```

AES-256은 정확히 32 bytes 키를 요구한다. `openssl rand -base64 32`로 생성한 키는 32 raw bytes를 Base64로 인코딩한 44자 문자열이다. 이것을 `getBytes(UTF_8)`로 변환하면 44 bytes가 되어 키 길이 불일치 오류가 발생한다. 반드시 `Base64.getDecoder().decode()`를 사용해야 한다.

### 왜 CryptoException을 BusinessException과 분리했는가

프로젝트의 `BusinessException`은 에러 코드를 API 응답에 포함시키는 구조였다. 암호화 예외를 `BusinessException`으로 처리하면 `"KEY_NOT_FOUND"`, `"DECRYPTION_FAILED"` 같은 정보가 클라이언트에 노출된다. 이는 공격자에게 암호화 시스템의 내부 구조를 알려주는 셈이다.

`CryptoException`은 별도 `RuntimeException`으로 만들어 `GlobalExceptionHandler`에서 `"Internal Server Error"`로만 처리한다.

## 크로스 플랫폼 호환 (Java + NestJS)

Java(Spring Boot)와 NestJS(Node.js)가 같은 DB를 공유하는 구조였기 때문에, 양쪽에서 동일한 암복호화 포맷을 지원해야 했다. 이 부분이 설계에서 가장 신경 쓴 제약 조건 중 하나다.

### 호환 보장 요소

| 요소 | Java | Node.js |
| --- | --- | --- |
| 알고리즘 | `AES/GCM/NoPadding` | `aes-256-gcm` |
| 키 | `Base64.getDecoder().decode()` | `Buffer.from(b64, 'base64')` |
| IV 생성 | `ts >> 24` big-endian + `SecureRandom` | `iv.writeUInt32BE(ts >>> 0, 0)` + `randomBytes` |
| 저장 포맷 | `"version:Base64(IV|CT|AuthTag)"` | 동일 |
| AuthTag | Java는 CT+AuthTag 결합 반환 | Node.js는 `cipher.getAuthTag()` 별도 호출 |
| 해시 | `SHA-256(value + pepper)` → Base64 | `createHash('sha256').update(value).update(pepper).digest('base64')` |

## NestJS 암복호화 구현

```
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

encrypt(plainText: string): string {
  const iv = Buffer.alloc(IV_LENGTH);
  const ts = Math.floor(Date.now() / 1000) & 0xffffffff;
  iv.writeUInt32BE(ts >>> 0, 0);     // timestamp 4bytes (unsigned)
  randomBytes(8).copy(iv, 4);         // random 8bytes

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${version}:${Buffer.concat([iv, ct, authTag]).toString('base64')}`;
}

decrypt(stored: string): string {
  const [ver, b64] = stored.split(':', 2);  // 주의: split 첫 번째 ':'만 분리
  const combined = Buffer.from(b64, 'base64');
  const iv  = combined.subarray(0, 12);
  const tag = combined.subarray(-16);        // 뒤에서 16바이트 = AuthTag
  const ct  = combined.subarray(12, -16);    // 중간 = Ciphertext

  const decipher = createDecipheriv(ALGORITHM, keys[+ver], iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
}
```

Java와 Node.js의 핵심 차이는 **AuthTag 처리 방식**이다:

-   Java: `Cipher.doFinal()`이 `Ciphertext + AuthTag`를 하나의 바이트 배열로 반환
-   Node.js: `cipher.getAuthTag()`로 별도 호출, 복호화 시 `decipher.setAuthTag(tag)`로 설정

바이트 레이아웃은 동일하므로 `Buffer.concat([iv, ct, authTag])`로 결합하면 Java와 호환된다.

### TypeORM Transformer (NestJS 쪽 @Convert 대응)

```
import { ValueTransformer } from 'typeorm';
import { CryptoServiceHolder } from './crypto-service-holder';

export const SensitiveDataTransformer: ValueTransformer = {
  to(value: string | null): string | null {
    if (value == null || value === '') return null;
    return CryptoServiceHolder.get().encrypt(value);
  },

  from(value: string | null): string | null {
    if (value == null) return null;
    return CryptoServiceHolder.get().decryptIfNeeded(value);
  },
};
```

Java의 JPA `@Convert`와 동일한 역할이다. TypeORM에서는 `ValueTransformer`를 사용한다. 정적 홀더 패턴도 동일하게 적용했다.

```
// 엔티티 적용
@Column({
  name: 'customer_phone',
  length: 200,
  transformer: SensitiveDataTransformer,
})
customerPhone: string;
```

### 크로스 플랫폼 검증

```
CP01: Java 암호문 → Node.js 복호화 성공
CP02: Node.js 암호문 → Java 복호화 성공
CP03: 동일 입력 + 동일 pepper → Java/Node.js 해시값 일치
```

* * *

## 마치며

처음에는 "AES로 암호화하면 끝 아닌가?"라고 생각했는데, 실제로 구현해 보니 고려할 것이 정말 많았다.

**배운 점:**

1.  **암호화보다 검색이 더 어렵다.** AES-GCM 자체는 Java 표준 라이브러리로 금방 구현했지만, "암호화된 상태에서 검색을 어떻게 하지?"가 진짜 문제였다. Blind Index 패턴을 알기 전까지 꽤 고민했다.
2.  **JPA Converter의 위력.** 서비스 코드 90곳을 수정하는 대신 엔티티에 `@Convert` 한 줄 추가하는 것으로 해결했다. 다만 Hibernate가 Converter를 직접 new로 생성하는 문제 때문에 정적 홀더 패턴이 필요했다.
3.  **크로스 플랫폼 호환은 바이트 레이아웃이 핵심.** Java와 Node.js의 API가 달라도 바이트 레이아웃(IV 12 + CT + AuthTag 16)만 동일하면 상호 운용이 가능하다. 특히 Java의 `doFinal()`이 CT+AuthTag를 합쳐서 반환하는 것과 Node.js의 `getAuthTag()` 별도 호출 차이를 이해하는 데 시간이 걸렸다.
4.  **마이그레이션에서 Converter 충돌.** 배치에서 일반 JPA 조회를 하면 Converter가 자동 복호화하여 평문/암호문 구분이 불가능해진다. JPQL raw 조회로 Converter를 우회해야 한다는 것을 삽질 끝에 깨달았다.
5.  **보안은 디테일이다.** Write 경로에서 `isLegacyPlaintext()`를 사용하면 암호화 우회 취약점이 생긴다는 것, 키를 로그에 한 번이라도 출력하면 로그 수집 시스템 전체가 키를 보관하게 된다는 것. 이런 디테일들이 실제 보안을 결정한다.

암호화 모듈을 직접 만들어 보면서 NIST 표준 문서, GCM의 내부 동작, IV 충돌 확률 계산 같은 것들을 공부할 수 있었다. 사이드 프로젝트에서 이런 것들을 직접 구현해 보는 것이 가장 확실한 학습이라고 느꼈다.
