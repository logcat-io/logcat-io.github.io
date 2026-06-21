#!/usr/bin/env node
/**
 * 마이그레이션 글의 헤딩 계층 교정 (1회성).
 * Tistory 글들이 h3/h4 부터 시작하거나 h3가 h2보다 먼저 나오는 등 outline이 깨져 있어,
 * 문서 순서대로 스택 rebaser 로 "최상위=h2, 건너뜀 없음, 역순 없음" 유효 계층으로 재매핑한다.
 * 코드블록(``` ... ```) 안의 `#` 는 절대 건드리지 않는다.
 *
 * 실행: node scripts/normalize-headings.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');

function rebase(body) {
  const stack = []; // { orig, out }
  const remap = (seg) =>
    seg.replace(/^(#{1,6})[ \t]+(\S.*)$/gm, (_m, hashes, text) => {
      const orig = hashes.length;
      let out;
      if (stack.length === 0) {
        out = 2;
        stack.push({ orig, out });
      } else {
        while (stack.length && stack[stack.length - 1].orig > orig) stack.pop();
        const top = stack[stack.length - 1];
        if (top && top.orig === orig) {
          out = top.out;
        } else if (top && top.orig < orig) {
          out = Math.min(top.out + 1, 6);
          stack.push({ orig, out });
        } else {
          out = 2;
          stack.push({ orig, out });
        }
      }
      return '#'.repeat(out) + ' ' + text;
    });
  // 펜스 코드블록을 분리해 보호: 홀수 인덱스(코드)는 그대로 둔다.
  return body
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 === 1 ? part : remap(part)))
    .join('');
}

let changed = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.md')) continue;
  const fp = path.join(DIR, f);
  const raw = fs.readFileSync(fp, 'utf-8');
  const m = raw.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!m) continue;
  const [, front, body] = m;
  const next = front + rebase(body);
  if (next !== raw) {
    fs.writeFileSync(fp, next, 'utf-8');
    changed++;
  }
}
console.log(`heading 계층 교정: ${changed}개 글 수정`);
