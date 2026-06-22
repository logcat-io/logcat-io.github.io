---
title: "[JAVA] 직렬화(Serialization)란?"
description: '이번에 채팅 앱 프로젝트를 진행하면서, Redis를 사용하게 되었습니다.'
pubDate: '2023-08-20T23:36:33+09:00'
dateSource: html-visible
slug: serialization-34
tags:
  - Serialization
  - 직렬화
category: Language/Java
draft: false
legacy:
  tistoryId: '34'
  sourceHtml: '34/34-[JAVA]-직렬화(Serialization)란?.html'
  sourceHash: 'sha256:5078f871f4c34dc56391a24005899b1f5c82c530a360393571bcaf338bf91ed7'
---

이번에 채팅 앱 프로젝트를 진행하면서, **Redis**를 사용하게 되었습니다.

```java

public class RedisTemplate<K, V> extends RedisAccessor implements RedisOperations<K, V>, BeanClassLoaderAware {
    	/**
	 * Sets the key **serializer** to be used by this template. Defaults to {@link #getDefaultSerializer()}.
	 * @param serializer the key serializer to be used by this template.
	 */
	public void setKeySerializer(RedisSerializer<?> serializer) {
		this.keySerializer = serializer;
	}
```

이때 **Serializer**에 대해서 접하게 되었는데, 쉽게 설명할 수 없어 이번 기회에 직렬화에 대해서 정리해 보겠습니다.

## 직렬화란?

자바 언어를 사용해서 개발을 하다 보면, 생성한 객체를 파일로 저장하는 경우와 네트워크를 통해서 외부 시스템으로 전달하는 경우 등을 생각해 볼 수 있습니다. 

  
_객체를 다른 시스템으로 전달할 수 있을까?_

  
이때, 자바 객체를 바로 저장하거나 전송할 수 없기 때문에 바이트(byte) 형태인 데이터 스트림으로 변환해야 합니다.  
그리고 이러한 변환을 **직렬화**라고 합니다. 반대로 바이트(byte) 형태인 데이터 스트림을 객체로 변환하는 것을 **역직렬화**라 합니다.

## 직렬화를 사용하는 방법

직렬화 과정은 인스턴스의 독립적이기 때문에 한 시스템에서 객체를 직렬화하고, 다른 시스템에서 역직렬화할 수 있습니다.  
이때 직렬화를 하기 위해서는  **java**.**io**.**Serializable**  인터페이스를 상속받아야 합니다.

```java
public interface Serializable {  
}
```

직렬화를 위한 **Pokemon** 객체를 생성해 보겠습니다.

```java
import java.io.Serializable;  
  
public class Pokemon implements Serializable {  
	private String name;  
	private String serialNo;  
	  
	public Pokemon(String name, String serialNo) {  
		this.name = name;  
		this.serialNo = serialNo;  
	}
    
    // Getter
    // Setter
	  
	@Override  
	public String toString() {  
		return "Pokemon{" +  
				"name='" + name + '\'' +  
				", serialNo='" + serialNo + '\'' +  
				'}';
	}  
}
```

자바 직렬화를 하는 방법은  **java**.**io**.**ObjectOutputStream**  객체를 이용할 수 있습니다.

```java
Pokemon ditto = new Pokemon("ditto", "no.132");  
  
byte[] serializedPokemon;  
  
try(ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {  
	try (ObjectOutputStream objectOutputStream =  new ObjectOutputStream(outputStream)) {  
		objectOutputStream.writeObject(ditto);  
		serializedPokemon = outputStream.toByteArray();  
	}  
} catch (IOException e) {  
	throw new RuntimeException(e);  
}  
  
// encoding to base64  
Base64.getEncoder().encodeToString(serializedPokemon);
```

**Pokemon** 객체를 바이트 배열(byte \[\]) 형태로 변환하였다. 마지막은 바이트 배열을 **Base64**로 인코딩하는 코드입니다.  
  
이렇게 변환된 데이터를 다시 객체로 변환하는 역직렬화는 다음과 같이 수행할 수 있습니다.

```java
String result = Base64.getEncoder().encodeToString(serializedPokemon);    
serializedPokemon = Base64.getDecoder().decode(result);  

try(ByteArrayInputStream inputStream = new ByteArrayInputStream(serializedPokemon)) {  
	try(ObjectInputStream objectInputStream = new ObjectInputStream(inputStream)) {  
		Object objectPokemon = objectInputStream.readObject();  
		Pokemon pokemon = (Pokemon) objectPokemon;  
	}  
} catch (IOException e) {  
	throw new RuntimeException(e);  
}
```

하지만 직렬화에 대해서 알고 있다면, **Pokemon** 객체에서 무언가 빠진 것이 있다는 것을 아실 겁니다.

```java
public class Pokemon implements Serializable {  
	private static final long serialVersionUID = 123456789L;
	private String name;  
	private String serialNo;

	...
```

  
  
바로  **serialVersionUID**  상수입니다. **serialVersionUID**는 해당 객체의 버전을 명시하는 데 사용됩니다. 그리고 데이터 스트림을 역직렬화할 때, 직렬화된 객체와의 버전이 일치하는지 확인하는 역할을 합니다.  
  
이는 하나의 시스템에서 직렬화한 데이터가 다른 시스템에서 역직렬화될 수 있기 때문입니다.

만약 다른 시스템의 객체가 변경되었다면, 직렬화된 객체와 구조가 달라질 수 있습니다. 이러한 변경을 확인하기 위해 **serialVersionUID** 상수를 이용하게 됩니다. 만약 역직렬화 시, 객체의 구조 변경으로 호환성의 문제가 있는 경우에는 **serialVersionUID** 상수 값을 변경하여 새로운 객체 버전으로 변경해야 합니다.

## 직렬화를 왜 사용해야 하는가?

일반적으로 대부분의 시스템에서는 JSON, CSV, 프로토콜 버퍼등으로 데이터를 교환하게 됩니다. 

  
_그렇다면 자바 직렬화를 왜 사용해야 할까?_

자바 직렬화는 자바 시스템 간의 데이터 교환에 적합하기 때문입니다. 자바 시스템 간의 데이터 교환 시 위에서 언급한 JSON, CSV 등의 데이터 교환방식을 사용할 수 있습니다. 하지만 이러한 방식의 데이터 교환은 객체로 변환하기 위한 별도의 처리가 필요하다. 만약 복잡한 객체로 변환하는 과정은 오류를 발생시킬 수 있는 위험이 있습니다.   
  
이때 자바 직렬화를 사용하면 별도의 작업 없이 객체로 바로 역직렬화가 가능합니다. 이때 직렬화 조건을 갖추었다면 별도로 데이터 타입을 검사하지 않아도 자동으로 맞춰지기 때문에 편리합니다.  
  
직렬화를 반드시 사용해야 하는 것은 아닙니다. 개발의 목적과 상황에 맞게 적절히 선택한다면 보다 편리한 개발을 할 수 있을 것입니다.

### 참고

-   [https://techblog.woowahan.com/2550/](https://techblog.woowahan.com/2550/)
-   [https://www.baeldung.com/java-serialization](https://www.baeldung.com/java-serialization)
-   자바의 정석
