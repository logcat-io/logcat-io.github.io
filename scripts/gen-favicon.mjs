// 네브바 도트 고양이(catMini 스프라이트)를 favicon 으로 렌더링한다.
// 비트맵 → SVG(픽셀 rect) → sharp 로 16/32/180 PNG 래스터. 흑백 브랜드 유지(흰 배경 + 검정 픽셀).
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// src/data/sprites.ts 의 catMini 와 동일 (8w x 6h: 귀+머리+눈+턱)
const BITMAP = '10000001/11000011/11111111/11011011/11111111/01111110'.split('/');
const COLS = BITMAP[0].length; // 8
const ROWS = BITMAP.length; // 6

const INK = '#111111';
const BG = '#ffffff';

// 정사각 캔버스에 고양이를 가운데 정렬 (좌우/상하 여백 균형)
const SIDE = 12;
const offX = (SIDE - COLS) / 2; // 2
const offY = (SIDE - ROWS) / 2; // 3

const rects = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (BITMAP[r][c] === '1') {
      rects.push(`<rect x="${offX + c}" y="${offY + r}" width="1" height="1"/>`);
    }
  }
}

const svg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${SIDE} ${SIDE}" shape-rendering="crispEdges">` +
  `<rect width="${SIDE}" height="${SIDE}" fill="${BG}"/>` +
  `<g fill="${INK}">${rects.join('')}</g>` +
  `</svg>`;

// 스케일러블 favicon.svg (모던 브라우저 우선)
await writeFile(join(PUBLIC, 'favicon.svg'), svg(SIDE), 'utf8');

// PNG 래스터 (각 사이즈별로 SVG 를 해당 픽셀로 직접 렌더 → 선명)
const targets = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
];
for (const [name, px] of targets) {
  await sharp(Buffer.from(svg(px))).png().toFile(join(PUBLIC, name));
}

console.log('favicon 생성 완료:', ['favicon.svg', ...targets.map((t) => t[0])].join(', '));
