#!/usr/bin/env python3
# 헤딩 부실 글에 ## 섹션 헤딩을 앵커 기준으로 삽입(멱등, NBSP 정규화 매칭). hash-map은 상단 * * * 제거.
import os, re

POSTS = os.path.join(os.path.dirname(__file__), '..', 'src', 'content', 'posts')
def norm(s): return s.replace('\xa0', ' ')

EDITS = {
 'jsp-60.md': {'rm_top_div': False, 'ins': [
   ('서블릿? JSP?', '## 서블릿과 JSP란 무엇인가'),
   ('그렇다면 왜 스프링 MVC와 서블릿', '## 왜 스프링 MVC 뒤에 서블릿이 있나'),
   ('그럼 서블릿은 HTML에 대한 처리를', '## 서블릿은 HTML을 못 그리나 — JSP의 역할'),
   ('그런데 JSP 코드는 자바 코드가 아님에도', '## JSP가 서블릿처럼 동작하는 이유'),
   ('그럼 알아본 것은 지식이지만', '## 서블릿·JSP만으로 TODO 앱을 만들며'),
 ]},
 'getter-35.md': {'rm_top_div': False, 'ins': [
   ('원인은 DTO 객체에 getter를', '## 원인은 getter 누락'),
   ('객체를 **JSON으로** 변환', '## Jackson은 자바빈 규약을 따른다'),
   ('따라서 Jackson이 객체를 JSON으로 직렬화하는', '## 해결 — getter를 제공하라'),
 ]},
 'hash-map-61.md': {'rm_top_div': True, 'ins': [
   ('자바를 사용하다 보면 **Map 자료구조**를', '## HashMap과 Hashtable의 차이'),
   ('map은 수학 함수에서 대응 관계를 지칭', '## 해시 함수와 버켓'),
   ('하지만 위의 코드에서는 서로 다른 해시 코드를', '## 해시 충돌을 해결하는 두 가지 방법'),
   ('하지만 Separate Chainig도 자바의 버전에 따라서', '## Java 8: 링크드 리스트에서 트리로'),
   ('해시 버켓의 개수가 적다면 메모리 사용을', '## 버켓 resize와 보조 해시 함수'),
 ]},
 'tcp-ip-31.md': {'rm_top_div': False, 'ins': [
   ('애플리케이션이 데이터 송수신을 의뢰하는 OS의', '## 프로토콜 스택과 소켓의 정체'),
   ('소켓을 생성했으면 바로 데이터를 송수신', '## 접속(connect)은 왜 필요한가'),
   ('접속을 하기 위해서 Port 번호와 IP', '## 제어 정보와 패킷, 그리고 TCP 헤더'),
   ('다음으로 접속하는 과정에서 대해서 자세히', '## 3-way Handshake로 연결하기'),
   ('드디어 서로의 존재를 알고 연결되었다', '## 데이터 송신 — 버퍼, MTU와 MSS'),
   ('시퀀스 번호는 수신 측에서 중요한 정보다', '## 시퀀스 번호와 수신 확인 응답'),
   ('이러한 낭비되는 시간을 줄이기 위해서 TCP는', '## 윈도우 제어로 속도 높이기'),
   ('모든 데이터의 송수신이 끝나면 소켓을 말소', '## 소켓 말소, 그리고 남은 의문'),
 ]},
}

DIV = re.compile(r'^\s*(\*\s*\*\s*\*|\*\*\*|-\s*-\s*-)\s*$')

for fn, cfg in EDITS.items():
    path = os.path.join(POSTS, fn)
    text = open(path, encoding='utf-8').read()
    head, body = text[4:].split('\n---\n', 1)  # frontmatter 보존
    lines = body.split('\n')

    # 상단 첫 헤딩 이전의 첫 디바이더 제거
    if cfg['rm_top_div']:
        for i, ln in enumerate(lines):
            if ln.startswith('## '): break
            if DIV.match(ln):
                del lines[i]
                if i < len(lines) and lines[i].strip() == '' and i > 0 and lines[i-1].strip() == '':
                    del lines[i]  # 빈 줄 중복 정리
                print(f'{fn}: 상단 디바이더 제거')
                break

    # 헤딩 삽입 (앵커 포함 줄 앞에)
    done = 0
    for anchor, heading in cfg['ins']:
        if any(l.strip() == heading for l in lines):  # 멱등
            continue
        na = norm(anchor)
        for i, ln in enumerate(lines):
            if na in norm(ln) and not ln.startswith('#'):
                lines.insert(i, heading); lines.insert(i+1, ''); done += 1
                break
        else:
            print(f'  !! 앵커 못 찾음: {fn} <- {anchor!r}')
    print(f'{fn}: 헤딩 {done}개 삽입')

    open(path, 'w', encoding='utf-8').write('---\n' + head + '\n---\n' + '\n'.join(lines))
