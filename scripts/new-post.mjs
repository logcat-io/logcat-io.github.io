#!/usr/bin/env node
/**
 * new-post.mjs — 새 글 스캐폴드
 *
 * 사용: node scripts/new-post.mjs "글 제목"
 *   → src/content/posts/<slug>.md 생성 (frontmatter + 시작 템플릿)
 *
 * slug: 영문 제목 슬러그(라틴이 빈약하면 날짜 기반 post-YYYYMMDD).
 * 이미 같은 파일이 있으면 덮어쓰지 않고 경고만 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const slugifyMod = await import('@sindresorhus/slugify');
const slugify = slugifyMod.default ?? slugifyMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('사용법: npm run new "글 제목"');
  process.exit(1);
}

// ---- 현재 KST ISO (오프셋 +09:00 명시) ----
function kstIso(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const y = kst.getUTCFullYear();
  const mo = p(kst.getUTCMonth() + 1);
  const d = p(kst.getUTCDate());
  const h = p(kst.getUTCHours());
  const mi = p(kst.getUTCMinutes());
  const s = p(kst.getUTCSeconds());
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`, ymd: `${y}${mo}${d}` };
}

const { iso, ymd } = kstIso();

// ---- slug: 영문 슬러그, 라틴 빈약하면 날짜 기반 ----
function makeSlug() {
  const base = slugify(title, { separator: '-' });
  const alpha = (base.match(/[a-z0-9]/g) || []).length;
  if (base && alpha >= 2) return base;
  return `post-${ymd}`;
}

let slug = makeSlug();
let outPath = path.join(POSTS_DIR, `${slug}.md`);

// 충돌 시 경고하고 종료(덮어쓰기 금지)
if (fs.existsSync(outPath)) {
  console.error(`이미 존재함 — 덮어쓰지 않음: ${path.relative(ROOT, outPath)}`);
  console.error('제목을 바꾸거나 기존 파일을 직접 편집하세요.');
  process.exit(1);
}

const frontmatter = [
  '---',
  `title: ${JSON.stringify(title)}`,
  `description: ${JSON.stringify('한 줄 요약을 여기에 적습니다 — 최소 20자 이상.')}`,
  `pubDate: ${JSON.stringify(iso)}`,
  'dateSource: manual',
  `slug: ${slug}`,
  'tags: []',
  'draft: false',
  '---',
  '',
].join('\n');

const body = [
  `여기에 도입부를 적습니다. 무엇을, 왜 기록하는지 한두 문장으로.`,
  '',
  '## 헤딩 예시',
  '',
  '본문을 작성하세요. 코드 블록 예시:',
  '',
  '```kotlin',
  'fun main() {',
  '    println("LogCat")',
  '}',
  '```',
  '',
  '## 정리',
  '',
  '- 핵심 한 줄',
  '- 다음에 확인할 것',
  '',
].join('\n');

fs.mkdirSync(POSTS_DIR, { recursive: true });
fs.writeFileSync(outPath, frontmatter + body, 'utf8');

console.log(`생성됨: ${path.relative(ROOT, outPath)}`);
console.log(`  slug : ${slug}`);
console.log(`  pubDate : ${iso}`);
console.log('  편집 후  npm run dev  로 미리보기 하세요.');
