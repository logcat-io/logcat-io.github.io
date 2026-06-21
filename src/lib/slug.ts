export function postHref(slug: string): string {
  return `/posts/${slug}/`;
}

// 제목 단어 조각·불용어 잡태그 (정규화 결과 기준) — 태그 색인/링크에서 제외
const TAG_BLOCKLIST = new Set([
  'and', 'vs', 'the', 'to', 'of', 'a', 'is',
  '성공과', '실패를', '결정하는', '원리', '문제', '생성', '1-의',
]);

// 한/영 동의어 통합 — 같은 개념의 한글·영문 태그를 한 키로 병합해 색인 일관성 확보
const TAG_ALIAS: Record<string, string> = {
  자바: 'java',
  코틀린: 'kotlin',
  스프링: 'spring',
  멱등성: 'idempotency',
  동시성: 'concurrency',
  트랜잭션: 'transaction',
  직렬화: 'serialization',
  네트워크: 'network',
  보안: 'security',
  인증: 'auth',
};

export function normalizeTag(tag: string): string {
  // URL-safe 태그 키: 유니코드 letter/number(한글 포함)만 유지하고
  // %·공백·./등 URL에서 깨지는 문자는 하이픈으로. getAllTags·getPostsByTag·
  // tag 라우트 param·tagHref 가 모두 이 값을 공유하므로 링크/정적경로가 항상 일치한다.
  // 블록리스트는 빈 문자열로 제외, 동의어는 한 키로 병합.
  const n = tag
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (TAG_BLOCKLIST.has(n)) return '';
  return TAG_ALIAS[n] ?? n;
}

export function tagPathPart(tag: string): string {
  return encodeURIComponent(normalizeTag(tag));
}

export function tagHref(tag: string): string {
  return `/tags/${tagPathPart(tag)}/`;
}
