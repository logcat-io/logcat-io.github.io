#!/usr/bin/env python3
# 1회성 콘텐츠 정리: 제목 [PREFIX] 정규화(All-caps) + '? ' 아티팩트 제거 + category 오타 + 상단 목차/디바이더 제거
import re, sys, os

POSTS = os.path.join(os.path.dirname(__file__), '..', 'src', 'content', 'posts')

PREFIX = {
 'annotation-57.md':'[JAVA]','aws-saa-c03-6-77.md':'[AWS]','background-tasks-vs-celery-83.md':'[FASTAPI]',
 'benchmark-124.md':'[PROJECT]','build-boot-jar-46.md':'[SPRING]','chunk-size-my-sql-buffer-pool-116.md':'[DATABASE]',
 'confinement-104.md':'[JAVA]','cross-tab-animal-club-112.md':'[PROJECT]','db-aes-256-gcm-blind-index-99.md':'[SPRING]',
 'dbms-39.md':'[DATABASE]','error-ts-2550-tsconfig-json-86.md':'[TYPESCRIPT]','getter-35.md':'[SPRING]',
 'go-80.md':'[GO]','go-map-swiss-table-group-probing-growth-111.md':'[GO]','graceful-shutdown-stuck-recovery-121.md':'[PROJECT]',
 'hash-map-61.md':'[JAVA]','infer-87.md':'[TYPESCRIPT]','inno-db-postgre-sql-rdbms-125.md':'[DATABASE]',
 'io-vs-cpu-84.md':'[CS]','jdbc-paging-item-reader-96.md':'[SPRING BATCH]','job-step-79.md':'[SPRING BATCH]',
 'jsp-60.md':'[SERVLET]','jsp-maven-tomcat-10.md':'[JSP]','jvm-class-loading-metaspace-100.md':'[JAVA]',
 'jwt-81.md':'[FASTAPI]','kafka-avro-95.md':'[KAFKA]','kafka-dlt-94.md':'[KAFKA]',
 'mvcc-my-sql-inno-db-postgre-sql-113.md':'[DATABASE]','my-sql-row-buffer-pool-lru-scan-pollution-114.md':'[DATABASE]',
 'non-access-modifier-41.md':'[JAVA]','o-auth2-scopes-82.md':'[FASTAPI]','outbox-118.md':'[PROJECT]',
 'pending-claim-119.md':'[PROJECT]','post-101.md':'[JAVA]','post-103.md':'[PROJECT]','post-106.md':'[PROJECT]',
 'post-108.md':'[PROJECT]','post-109.md':'[PROJECT]','post-122.md':'[PROJECT]','post-123.md':'[PROJECT]',
 'post-29.md':'[NETWORK]','post-74.md':'[JPA]','post-76.md':'[DOCKER]','post-90.md':'[JAVA]',
 'postgre-sql-row-heap-tuple-tid-mvcc-115.md':'[DATABASE]','redis-1-optimistic-lock-upsert-oversell-0-kotlin-110.md':'[REDIS]',
 'request-param-name-for-argument-of-type-java-72.md':'[SPRING]','sealed-class-107.md':'[KOTLIN]',
 'select-for-update-pg-locks-126.md':'[DATABASE]','serialization-34.md':'[JAVA]','skip-locked-claim-token-120.md':'[PROJECT]',
 'spring-batch-6-chunk-6-0-1-97.md':'[SPRING BATCH]','spring-boot-redisson-73.md':'[SPRING]','string-43.md':'[JAVA]',
 'string-constant-pool-45.md':'[JAVA]','synchronized-102.md':'[JAVA]','tcp-ip-31.md':'[NETWORK]',
 'this-escape-105.md':'[JAVA]','view-98.md':'[DATABASE]','vs-88.md':'[TYPESCRIPT]',
 'web-flux-tomcat-nio-92.md':'[SPRING]','webhook-retry-117.md':'[PROJECT]',
}

DIV = re.compile(r'^\s*(\*\s*\*\s*\*|\*\*\*|-\s*-\s*-|---|___)\s*$')

def parse_title(fm_lines):
    """frontmatter 라인에서 title 값과 그 라인 범위(start,end exclusive) 반환"""
    for i, ln in enumerate(fm_lines):
        m = re.match(r'^title:(.*)$', ln)
        if not m: continue
        rest = m.group(1).strip()
        # 블록 스칼라 (>- , > , | , |-)
        if rest and rest[0] in '>|':
            j = i + 1; parts = []
            while j < len(fm_lines) and (fm_lines[j].startswith((' ', '\t')) or fm_lines[j].strip() == ''):
                if fm_lines[j].strip() == '':
                    # 블록 끝일 수도 있으니 다음에 들여쓰기 라인 더 있는지 확인
                    k = j + 1
                    if k < len(fm_lines) and fm_lines[k].startswith((' ', '\t')):
                        parts.append(''); j += 1; continue
                    else:
                        break
                parts.append(fm_lines[j].strip()); j += 1
            value = ' '.join(p for p in parts if p)
            return i, j, value
        # 단일/이중 인용
        if rest.startswith("'") and rest.endswith("'") and len(rest) >= 2:
            return i, i+1, rest[1:-1].replace("''", "'")
        if rest.startswith('"') and rest.endswith('"') and len(rest) >= 2:
            return i, i+1, rest[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        return i, i+1, rest
    return None

def yaml_dq(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

def process(fn, path):
    text = open(path, encoding='utf-8').read()
    assert text.startswith('---\n'), fn
    inner, body = text[4:].split('\n---\n', 1)
    fm = inner.split('\n')
    changes = []

    # --- 제목 ---
    pt = parse_title(fm)
    if pt:
        i, j, val = pt
        new = val
        new = re.sub(r'^\s*\?\s+', '', new)              # '? ' 아티팩트 제거
        new = new.strip()
        pref = PREFIX.get(fn)
        if pref and not new.startswith('['):
            new = f'{pref} {new}'
        if new != val:
            fm[i:j] = [f'title: {yaml_dq(new)}']
            changes.append(f'title: {val!r} -> {new!r}')

    # --- category 오타 ---
    for k, ln in enumerate(fm):
        if ln.strip() == 'category: Infra/Dcoker':
            fm[k] = 'category: Infra/Docker'; changes.append('category Dcoker->Docker')

    # --- 상단 목차 + 디바이더 제거 ---
    blines = body.split('\n'); out = []; m = 0; removed = False
    while m < len(blines):
        if not removed and blines[m].strip() == '목차':
            m += 1
            while m < len(blines) and blines[m].strip() == '': m += 1   # 빈 줄
            if m < len(blines) and DIV.match(blines[m]): m += 1          # 짝 디바이더
            removed = True
            changes.append('상단 목차+디바이더 제거')
            continue
        out.append(blines[m]); m += 1
    body = '\n'.join(out)
    # 선두 빈 줄 정리: 본문은 빈 줄 1개로 시작
    body = re.sub(r'^\n+', '\n', body)

    if changes:
        open(path, 'w', encoding='utf-8').write('---\n' + '\n'.join(fm) + '\n---\n' + body)
    return changes

total = 0
for fn in sorted(os.listdir(POSTS)):
    if not fn.endswith('.md'): continue
    ch = process(fn, os.path.join(POSTS, fn))
    if ch:
        total += 1
        print(f'• {fn}')
        for c in ch: print(f'    {c}')
print(f'\n변경된 파일: {total}')
