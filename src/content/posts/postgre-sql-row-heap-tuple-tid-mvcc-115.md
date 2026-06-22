---
title: "[DATABASE] PostgreSQL은 row를 바로 읽지 않는다: heap tuple, TID, MVCC를 연결해서 보기"
description: PostgreSQL storage를 공부하면서 가장 먼저 정리해야 할 감각은 이것이었다.
pubDate: '2026-05-30T21:55:54+09:00'
dateSource: html-visible
slug: postgre-sql-row-heap-tuple-tid-mvcc-115
tags:
  - PostgreSQL
  - storage
  - index
  - mvcc
  - hot
  - update
  - internals
  - vm
category: Computer Science/Database
draft: false
legacy:
  tistoryId: '115'
  sourceHtml: 115/115.html
  sourceHash: 'sha256:76ea1e47087d48bb435056380e3795ec8999f4777f07cfe07eb219cead381a43'
---

PostgreSQL storage를 공부하면서 가장 먼저 정리해야 할 감각은 이것이었다.

> PostgreSQL에서 우리가 row라고 부르는 것은, 내부적으로는 snapshot에 따라 visible하다고 판단된 heap tuple version이다.

SQL을 쓸 때는 당연히 row 단위로 생각한다.

```
SELECT *
FROM users
WHERE id = 1;
```

겉으로 보면 `users` 테이블에서 `id = 1`인 row 하나를 읽는 작업이다. 그런데 PostgreSQL 내부로 들어가면 흐름이 조금 달라진다. PostgreSQL 인덱스는 row 전체를 저장하지 않는다. 인덱스 leaf에는 인덱스 대상 컬럼 값들과, 그 값을 가진 heap tuple 위치(TID)만 들어 있다. heap에는 하나의 logical row에 대한 여러 tuple version이 남아 있을 수 있다. 그리고 최종적으로 어떤 tuple version이 지금 트랜잭션에서 row처럼 보일지는 `xmin`, `xmax`, snapshot으로 판단한다.

이 글은 오늘 정리한 PostgreSQL의 relation, fork, heap page, tuple, TID, visibility map을 하나의 읽기 흐름으로 연결해본 기록이다.

## 1\. PostgreSQL은 table과 index를 relation이라고 부른다

PostgreSQL에서는 table, index 같은 database object를 `relation`이라고 부른다. 여기서 relation은 논리적인 개념에 가깝다. 실제 디스크에는 하나의 relation이 여러 물리 파일로 나뉘어 저장될 수 있고, PostgreSQL은 이 물리 파일 단위를 `fork`라고 부른다. table relation을 기준으로 보면 보통 다음 fork를 먼저 이해하면 된다.

```
table relation
  - main fork: 실제 heap data
  - fsm fork : free space map
  - vm fork  : visibility map
```

`main fork`는 실제 데이터가 들어 있는 주 파일이다. table의 main fork를 table 관점에서 보면 heap table 또는 heap file이라고 이해할 수 있다.

`fsm`은 page 안에 빈 공간이 얼마나 남았는지 찾는 데 쓰인다. 새 tuple을 넣을 때 모든 page를 처음부터 훑을 수는 없으니, 어디에 공간이 있을지 빠르게 찾기 위한 보조 구조가 필요하다.

`vm`은 visibility map이다. 이름 때문에 tuple별 가시성 정보를 저장한다고 오해하기 쉬운데, 그렇게 보면 안 된다. visibility map은 page 단위 요약 정보다. “이 page 안의 tuple들이 모두 visible한가”, “freeze 관점에서 처리되었는가” 같은 정보를 page 단위 bit로 들고 있다.

실제 tuple 하나하나가 지금 내 snapshot에서 보이는지는 여전히 tuple header의 transaction metadata와 snapshot으로 계산한다. visibility map은 그 계산을 매번 피하거나 줄일 수 있게 도와주는 최적화 구조에 가깝다.

같은 개념이 index에도 그대로 적용된다. 인덱스도 하나의 relation이고, 이 relation 역시 main / fsm fork 를 가진다. 차이점은 heap table의 main fork에는 row version들이 들어 있고, index relation의 main fork에는 B-tree 노드들(내부 노드, leaf 노드)이 들어 있다는 점이다.  
  
Visibility map(vm) fork는 heap relation에만 존재하고 인덱스에는 없다. VM이 “heap page가 all-visible인지”를 알려주고, 이 정보를 index-only scan 최적화에 활용하기 때문이다.

## 2\. heap table은 page 배열이다

PostgreSQL heap table은 고정 크기 page의 배열로 볼 수 있다. 보통 PostgreSQL은 8KB block size로 빌드되지만, 이 값은 compile-time 설정이므로 실제 서버에서는 `SHOW block_size;`로 확인하는 편이 정확하다.

heap page 안에는 대략 다음 요소가 있다.

```
heap page
  - page header
  - line pointer 배열
  - free space
  - tuple data
```

여기서 `line pointer`는 page 안의 tuple 위치를 가리키는 작은 슬롯이다. PostgreSQL의 tuple 위치를 말할 때 자주 나오는 `ctid`도 결국 이 구조와 연결된다.

`ctid`는 다음 두 값으로 구성된 물리 위치다.

```
ctid = (block number, offset number)

block number : heap page 번호
offset number: page 안의 line pointer 번호
```

예를 들어 `ctid = (12, 4)`라면 12번 heap page의 4번 line pointer가 가리키는 tuple이라는 뜻이다. 이 값은 물리 위치다. 그래서 애플리케이션의 영구 식별자로 쓰면 안 된다. UPDATE, VACUUM, page 정리 등으로 tuple의 물리 상태는 달라질 수 있다. `id` 같은 business key나 primary key와 `ctid`는 역할이 다르다.

## 3\. tuple은 row 그 자체가 아니라 row version이다

PostgreSQL에서 page 안에 저장되는 데이터 단위를 heap tuple이라고 부른다. 여기서 조심해야 할 점이 있다. heap tuple을 애플리케이션에서 보는 row 하나와 1:1로 고정해서 생각하면 MVCC를 이해하기 어렵다. PostgreSQL의 heap tuple은 row의 한 버전이다.

예를 들어 다음처럼 값이 바뀐다고 해보자.

```
UPDATE accounts
SET balance = 900
WHERE id = 1;
```

PostgreSQL은 보통 기존 tuple을 제자리에서 덮어쓰는 방식으로 이해하면 안 된다. 새 tuple version을 만들고, 기존 tuple에는 이 version의 생명이 끝났다는 정보를 남기는 식으로 생각해야 한다.

단순화하면 흐름은 이렇다.

```
old tuple
  - xmax 설정

new tuple
  - xmin = update transaction id
```

그래서 하나의 logical row가 시간에 따라 여러 heap tuple version으로 존재할 수 있다.

```
logical row: account id = 1

heap tuple version A: balance = 1000
heap tuple version B: balance = 900
heap tuple version C: balance = 850
```

어떤 트랜잭션은 아직 version A를 봐야 할 수 있고, 다른 트랜잭션은 version C를 봐야 할 수 있다. PostgreSQL은 이 차이를 snapshot으로 판단한다.

이때 중요한 metadata가 `xmin`, `xmax`, `t_ctid`다.

-   `xmin`: 이 tuple version을 만든 transaction id
-   `xmax`: 이 tuple version을 삭제하거나 대체하는 데 관여한 transaction id
-   `t_ctid`: tuple의 현재 위치 또는 update chain과 관련된 tuple id

학습할 때는 `xmin`과 `xmax`를 먼저 잡는 편이 좋다. `xmin`은 “이 tuple은 누가 만들었는가”이고, `xmax`는 “이 tuple은 누가 더 이상 현재 version이 아니게 만들었는가”에 가깝다.

물론 실제 visibility 판단은 단순히 숫자 크기만 비교하지 않는다. transaction의 commit 여부, 현재 snapshot에서 active였는지, isolation level 등이 같이 들어간다.

그래도 출발점은 이렇다.

> PostgreSQL은 tuple에 붙은 transaction metadata와 현재 snapshot을 비교해서, 지금 이 트랜잭션에서 보이는 row version을 고른다.

## 4\. 인덱스 leaf에는 row가 아니라 TID가 있다

PostgreSQL도 내부적으로 B-tree 인덱스를 사용한다. 하지만 InnoDB의 clustered index와 같은 식으로 생각하면 헷갈린다.

InnoDB는 primary key clustered index leaf에 row data가 같이 조직된다. secondary index leaf에는 secondary key와 primary key 값이 있고, 필요한 컬럼이 없으면 primary key로 clustered index를 다시 찾아간다.

하지만 PostgreSQL은 다르다. heap과 index가 분리되어 있다. PostgreSQL B-tree index leaf에는 보통 index key와 heap tuple의 위치를 가리키는 TID가 들어 있다. leaf 엔트리 하나를 구조체처럼 적어 보면 대략 { index\_key\_columns..., TID } 형태다. 여기서 index\_key\_columns에는 인덱스 대상 컬럼 값들이, TID에는 (heap block 번호, line pointer offset)이 들어간다. heap tuple의 나머지 컬럼 값들은 모두 heap main fork 쪽에만 있고, 인덱스에는 절대 저장되지 않는다.

```
B-tree index leaf
  key = 1
  tid = (heap block id, offset id)
```

이 TID는 heap page 안의 특정 line pointer, 더 정확히는 특정 heap tuple 위치를 가리킨다.

그래서 `WHERE id = 1` 조회를 단순화하면 이런 흐름이 된다. 여기서 핵심은 인덱스를 탔다고 끝이 아니라는 점이다. 일반적인 PostgreSQL index scan은 heap fetch와 visibility check가 이어진다. 그래서 PostgreSQL 실행 계획에서 `Index Scan`을 볼 때는 “인덱스를 사용했으니 모든 것이 인덱스 안에서 끝났다”고 생각하면 안 된다. 실제로는 index page를 읽고, heap page를 찾아가고, tuple visibility를 확인하는 비용이 붙을 수 있다.

## 5\. t\_ctid를 따라가는 흐름은 언제나 같은 방식이 아니다

처음 PostgreSQL MVCC를 배울 때는 “인덱스로 tuple을 찾고, `t_ctid`를 따라 최신 version으로 이동한다”고 이해하기 쉽다. 큰 방향은 도움이 되지만, 그대로 외우면 위험하다. PostgreSQL update에는 HOT update라는 중요한 최적화가 있다. HOT update는 index key를 바꾸지 않는 update가 같은 heap page 안에서 새 tuple version을 만들 수 있을 때 가능하다. 이 경우 새 index entry를 만들지 않아도 된다. 기존 index entry는 여전히 root tuple을 가리키고, heap page 안에서는 t\_ctid로 연결된 chain을 따라가며 visible한 version을 찾을 수 있다. 다만 HOT은 “같은 page 안에 새 tuple을 둘 수 있고, 인덱스 key가 바뀌지 않는 경우”에만 적용되기 때문에, 모든 UPDATE가 HOT로 처리되는 것은 아니다.

단순화하면 이렇다.

```
index entry
  -> root heap tuple
      -> newer tuple version
          -> newer tuple version
```

이때 `t_ctid`는 update chain을 따라가는 데 관여한다. 하지만 모든 UPDATE가 HOT update는 아니다. index key가 바뀌거나 같은 page 안에 새 tuple을 둘 공간이 부족하면 HOT update가 되지 않을 수 있다. 그런 경우에는 새 tuple version에 대한 index entry가 필요해진다.

그래서 더 정확한 표현은 이렇다.

> PostgreSQL index scan은 TID로 heap tuple 위치를 찾아가 visibility를 확인한다.  
> HOT chain이 있는 경우에는 page 안의 tuple chain을 따라가 visible한 version을 찾을 수 있다.  
> 하지만 모든 update가 하나의 t\_ctid chain만으로 처리되는 것은 아니다.

이 정도로 이해해야 PostgreSQL의 index scan, HOT update, vacuum, bloat가 한 그림 안에 들어온다.

## 6\. visibility map은 tuple visibility의 원본이 아니다

visibility map은 헷갈리기 쉬운 구조다.

이름만 보면 각 tuple이 어떤 transaction에서 보이는지 저장해두는 구조처럼 보인다. 하지만 visibility map은 그런 구조가 아니다.

visibility map은 heap page 단위의 요약 비트맵이다. 대표적으로 “이 page의 모든 tuple이 앞으로 진행 중인 어떤 트랜잭션에서도 더 이상 가시성 논쟁이 없는 상태인지(=이미 충분히 오래 전에 커밋되어, 모두에게 visible하다고 볼 수 있는지)”를 빠르게 판단하는 데 도움을 준다. 이 정보가 특히 중요한 곳이 `Index Only Scan`이다.

PostgreSQL에서 index에 필요한 컬럼이 모두 들어 있다고 해서 항상 heap 접근을 완전히 피할 수 있는 것은 아니다. tuple이 현재 snapshot에서 visible한지 확인해야 하기 때문이다. 그런데 visibility map이 어떤 heap page를 all-visible로 표시하고 있다면, PostgreSQL은 그 page의 tuple visibility를 heap까지 내려가 확인하지 않고도 index만으로 결과를 만들 수 있다. 이때 visibility map은 인덱스 옆에 붙어 있는 구조가 아니라, heap relation의 \_vm fork에 저장된 page 단위 비트맵이다. index-only scan은 “인덱스로부터 얻은 TID가 가리키는 heap page”의 VM bit를 확인해서, heap fetch를 생략할 수 있을지를 결정한다.

그래서 PostgreSQL의 index-only scan은 두 조건을 함께 봐야 한다.

```
1. 필요한 컬럼을 index에서 얻을 수 있는가
2. visibility map 덕분에 heap visibility check를 생략할 수 있는가
```

MySQL/InnoDB의 covering index와 PostgreSQL의 index-only scan을 같은 말처럼 쓰면 안 되는 이유가 여기에 있다. InnoDB에서는 secondary index에 필요한 컬럼이 모두 있으면 clustered index lookup을 줄일 수 있다. PostgreSQL에서는 필요한 컬럼이 index에 있어도 visibility 확인 때문에 heap fetch가 발생할 수 있다. visibility map 상태가 좋을수록 heap fetch를 줄이기 쉽다.

즉, InnoDB의 covering index는 “필요한 컬럼이 인덱스에 있느냐”에만 의존하지만, PostgreSQL의 index-only scan은 “필요한 컬럼이 인덱스에 있는지”와 “VM 기준으로 해당 heap page가 all-visible인지”라는 두 축 모두에 의존한다. VM이 충분히 채워져 있지 않으면, EXPLAIN 상으로는 index-only scan이어도 실제로는 heap을 꽤 자주 읽게 된다.

## 7\. InnoDB와 비교하면 차이가 더 선명해진다

둘 다 MVCC를 제공하지만, 버전을 저장하고 찾아가는 방식은 다르다.

인덱스 구조만 따로 떼어 보면, InnoDB의 secondary index leaf에는 “인덱스 컬럼 값 + 그 row의 primary key 값”이 저장된다. secondary index는 이 primary key를 통해 다시 clustered index(PK B-tree)를 타고 내려가 실제 row를 찾는다.  
  
PostgreSQL B-tree leaf에는 “인덱스 컬럼 값 + TID(ctid)”가 들어 있고, 이 TID로 heap page와 line pointer를 곧장 따라간다. PostgreSQL에는 InnoDB처럼 “table 자체가 PK B-tree인” clustered 테이블 구조가 없고, 테이블 데이터는 항상 heap에만 저장된다. 그래서 PostgreSQL의 모든 인덱스는 물리적으로는 secondary index이고, heap을 가리키는 보조 구조라는 점이 InnoDB와의 본질적인 차이다.  
  
같은 차이는 MVCC 구현을 볼 때도 그대로 드러난다. InnoDB는 primary key clustered index leaf에 현재 row 데이터를 저장하고, 과거 버전이 필요하면 undo 로그 체인(rollback pointer)을 따라가며 read view에 맞는 과거 상태를 재구성한다.  
  
반대로 PostgreSQL은 heap 각 페이지에 여러 tuple version을 그대로 보관하고, 인덱스 엔트리는 언제나 그중 하나를 가리키는 TID만 유지한다. 어떤 버전이 현재 스냅샷에서 visible한지는 snapshot과 visibility rule로 결정하고, 더 이상 어떤 트랜잭션에서도 보지 않을 버전은 VACUUM이 정리한다.

```
InnoDB

clustered index leaf
  -> current row
      -> undo로 older version 재구성
```

PostgreSQL은 heap 중심으로 보는 편이 자연스럽다. 여러 tuple version이 heap 안에 존재하고, index는 그 heap tuple 위치를 가리킨다. 읽는 쪽은 snapshot 기준으로 visible한 tuple version을 선택한다.

```
PostgreSQL

index leaf
  -> TID
      -> heap tuple version
          -> xmin/xmax + snapshot으로 visibility 판단
```

이 차이는 운영에서도 다르게 나타난다.

InnoDB에서는 오래 열린 transaction 때문에 undo purge가 밀릴 수 있다. PostgreSQL에서는 오래 열린 transaction 때문에 vacuum이 dead tuple을 충분히 정리하지 못할 수 있다.

표면적으로는 둘 다 “오래 열린 transaction이 문제”다. 하지만 내부에서 쌓이는 비용은 다르다.

```
InnoDB
  오래된 read view 유지
  -> undo history가 오래 필요
  -> purge 지연

PostgreSQL
  오래된 snapshot 유지
  -> old tuple version을 아직 제거하면 안 됨
  -> vacuum 정리 지연
  -> dead tuple, bloat 증가 가능
```

같은 MVCC라는 단어를 쓰더라도, MySQL과 PostgreSQL의 관찰 지점이 달라지는 이유다.

## 8\. 조회 하나를 다시 보면

처음의 쿼리로 돌아가보자.

```
SELECT *
FROM users
WHERE id = 1;
```

이제 이 쿼리를 조금 다르게 볼 수 있다.

```
SQL 관점:
  id = 1인 row를 읽는다

PostgreSQL 내부 관점:
  1. relation의 index를 탐색한다
  2. index leaf에서 TID를 얻는다
  3. heap main fork의 특정 page로 간다
  4. line pointer를 통해 heap tuple을 찾는다
  5. tuple metadata와 snapshot으로 visibility를 판단한다
  6. visible한 tuple version을 row처럼 반환한다
```

이 흐름을 잡고 나면 PostgreSQL에서 왜 vacuum이 중요한지, 왜 index-only scan에 visibility map이 필요한지, 왜 `ctid`를 영구 key로 쓰면 안 되는지, 왜 update-heavy workload에서 bloat를 봐야 하는지가 이어진다.

PostgreSQL의 row는 그냥 디스크 어딘가에 있는 최신 값 하나가 아니다. heap page 안의 tuple version들 중에서, 현재 snapshot이 볼 수 있다고 판단한 결과다.

## 9\. 정리

오늘 정리한 내용을 한 문장으로 줄이면 이렇다.

> PostgreSQL은 index로 heap tuple 위치를 찾고, snapshot으로 그 tuple version이 지금 row처럼 보여도 되는지 판단한다.

이 관점에서 기억할 내용은 다음 정도면 충분하다.

-   PostgreSQL의 table과 index는 relation이고, relation은 fork라는 물리 파일 단위로 나뉠 수 있다.
-   table의 main fork는 heap data를 담고, 보통 heap table 또는 heap file로 이해할 수 있다.
-   heap table은 page 배열이고, page 안에는 line pointer와 tuple data가 있다.
-   heap tuple은 row 자체라기보다 row의 한 version이다.
-   `xmin`, `xmax`는 tuple version의 visibility 판단에 핵심으로 쓰인다.
-   PostgreSQL index leaf는 row data가 아니라 heap tuple 위치인 TID를 저장한다.
-   HOT update에서는 같은 page 안의 tuple chain을 따라 visible version을 찾을 수 있다.
-   visibility map은 tuple별 가시성 원본이 아니라 page 단위 최적화 정보다.
-   InnoDB는 current row와 undo chain, PostgreSQL은 heap tuple version과 snapshot visibility로 비교하면 차이가 선명하다.

PostgreSQL을 공부할 때 `EXPLAIN`만 보면 access path만 보인다. 그 뒤에서 index page, heap page, line pointer, tuple metadata, snapshot이 어떻게 이어지는지 같이 떠올려야 실제 성능과 MVCC 동작을 같은 그림 안에서 볼 수 있다.

## 참고

-   [PostgreSQL Documentation - Database File Layout](https://www.postgresql.org/docs/current/storage-file-layout.html)
-   [PostgreSQL Documentation - Storage Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html)
-   [PostgreSQL Documentation - Indexes and Index-Only Scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
-   [PostgreSQL Documentation - Visibility Map](https://www.postgresql.org/docs/current/storage-vm.html)
-   [PostgreSQL Documentation - MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)
