#!/usr/bin/env node
/**
 * clean-tags.mjs — 1회성 태그 정리 (deterministic · frontmatter-only)
 *
 * 목적: 336개로 오염된 태그를 의미있는 셋으로 줄인다.
 *   오염원: ① 카테고리가 슬러그 태그로 박힘(language-java, computer-science-database,
 *           spring-framework-spring-and-spring-boot, project-reliable-webhook-dispatcher,
 *           python-framework-fast-api 등)
 *           ② 한글 프로젝트명이 단어 조각으로(배송/권역/시스템)
 *
 * 동작(글마다):
 *   (a) 그 글의 `category` 를 정규화한 값, 그리고 category 를 슬래시/공백으로 분해한
 *       각 세그먼트의 정규화값 셋을 만든다.
 *   (b) `tags` 중 정규화했을 때 그 셋에 들어가는 태그를 제거한다.
 *   (c) 남은 태그를 정규화 키 기준 dedupe(첫 등장 표기 유지).
 *
 * 안전장치: gray-matter 로 frontmatter 만 파싱→수정→재직렬화. 본문(content)은
 *   바이트 그대로 보존. tags 외 다른 필드는 절대 안 건드린다.
 *
 * 실행: nvm use 22.22.3 && node scripts/clean-tags.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const matter = require('gray-matter');
const slugifyMod = await import('@sindresorhus/slugify');
const slugify = slugifyMod.default ?? slugifyMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');
const DRY = process.argv.includes('--dry-run');

// lib/slug.ts normalizeTag 와 동일한 규칙 — 링크/라우트가 공유하는 키.
function normalizeTag(tag) {
  return String(tag)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// category → 제거 후보 정규화 키 셋(normalizeTag 키 공간으로 통일):
//   - 전체 category 의 정규화값 (language-java)
//   - 슬래시/공백/앰퍼샌드 분해 세그먼트의 정규화값 (language, java, computer, science, database, 배송, 권역, 시스템 …)
//   - importer 가 @sindresorhus/slugify 로 만들던 슬러그(& → and, camelCase 분해)도 같은 키 공간으로
//     다시 정규화해 추가 → spring-framework-spring-and-spring-boot, python-framework-fast-api,
//     language-type-script 같은 importer 산 카테고리 슬러그 태그도 제거된다.
function categoryRemovalSet(category) {
  const set = new Set();
  if (!category) return set;
  const add = (v) => {
    const n = normalizeTag(v);
    if (n) set.add(n);
  };
  add(category);
  add(slugify(String(category), { separator: '-' }));
  for (const seg of String(category).split(/[\/\s&]+/)) {
    add(seg);
    add(slugify(seg, { separator: '-' }));
  }
  return set;
}

function distinctTagSet(files) {
  const set = new Set();
  for (const { data } of files) {
    if (data.draft === true) continue;
    for (const t of data.tags || []) {
      const n = normalizeTag(t);
      if (n) set.add(n);
    }
  }
  return set;
}

function main() {
  const fileNames = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));

  // 전(前) 통계용 파싱
  const before = fileNames.map((f) => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
    return { f, raw, data: matter(raw).data };
  });
  const beforeDistinct = distinctTagSet(before).size;

  let changed = 0;
  let removedTotal = 0;
  const afterParsed = [];

  for (const { f, raw, data } of before) {
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const removeSet = categoryRemovalSet(data.category);

    // (b) 카테고리 오염 제거 + (c) 정규화 키 dedupe
    const seen = new Set();
    const kept = [];
    let removedHere = 0;
    for (const t of tags) {
      const n = normalizeTag(t);
      if (!n) {
        removedHere++;
        continue;
      }
      if (removeSet.has(n)) {
        removedHere++;
        continue;
      }
      if (seen.has(n)) {
        removedHere++;
        continue;
      }
      seen.add(n);
      kept.push(t);
    }

    const isChanged = removedHere > 0 || kept.length !== tags.length;
    if (isChanged) {
      changed++;
      removedTotal += removedHere;
      // gray-matter 로 frontmatter 만 교체 — content 는 그대로.
      const parsed = matter(raw);
      parsed.data.tags = kept;
      const out = matter.stringify(parsed.content, parsed.data);
      if (!DRY) fs.writeFileSync(path.join(POSTS_DIR, f), out, 'utf8');
    }

    afterParsed.push({ f, data: { ...data, tags: kept } });
  }

  const afterDistinct = distinctTagSet(afterParsed).size;

  const line = '─'.repeat(54);
  console.log(`\n${line}\n  clean-tags ${DRY ? '(DRY-RUN)' : ''} — ${fileNames.length} files\n${line}`);
  console.log(`  files changed        : ${changed}`);
  console.log(`  tag entries removed  : ${removedTotal}`);
  console.log(`  distinct tags BEFORE : ${beforeDistinct}`);
  console.log(`  distinct tags AFTER  : ${afterDistinct}`);
  console.log(`\n  ${DRY ? 'DRY-RUN — 파일 안 씀.' : 'frontmatter tags 재작성 완료 (본문 불변).'}\n`);
}

main();
