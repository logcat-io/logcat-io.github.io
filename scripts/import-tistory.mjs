#!/usr/bin/env node
/**
 * Tistory backup → Astro `.md` migration (deterministic · idempotent · audited)
 *
 * 입력 : ~/Downloads/ditto-dev-1-1/<tistoryId>/<*.html> + <id>/img/*
 * 출력 : src/content/posts/<slug>.md   (frontmatter draft:true)
 *        public/images/posts/<slug>/*  (이미지 복사, 경로 재작성)
 *        scripts/migration-manifest.json (slug/날짜/hash freeze)
 *
 * 플래그: --dry-run  --force  --limit=N
 * 실행  : nvm use 22.22.3 && node scripts/import-tistory.mjs --dry-run
 *
 * 계약(FINAL §4): 날짜=.box-info .date(없으면 draft 유지·임의생성 금지),
 *   코드블록=원본 <pre><code> textContent(이중 디코드 금지)+펜스수==pre수 invariant,
 *   슬러그 freeze, byte-copy 검증, 실패 격리.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const TurndownService = require('turndown')
const turndownGfm = require('turndown-plugin-gfm')
const cheerio = require('cheerio')
const yaml = require('js-yaml')
const slugifyMod = await import('@sindresorhus/slugify')
const slugify = slugifyMod.default ?? slugifyMod

// ---------- paths ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BACKUP = path.join(os.homedir(), 'Downloads', 'ditto-dev-1-1')
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts')
const IMG_ROOT = path.join(ROOT, 'public', 'images', 'posts')
const MANIFEST_PATH = path.join(__dirname, 'migration-manifest.json')

// ---------- flags ----------
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const FORCE = argv.includes('--force')
const LIMIT = (() => {
  const a = argv.find((x) => x.startsWith('--limit='))
  return a ? parseInt(a.split('=')[1], 10) : Infinity
})()

// ---------- helpers ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const ensureDir = (d) => { if (!DRY) fs.mkdirSync(d, { recursive: true }) }
const sanitizeFile = (name) => {
  const ext = path.extname(name).toLowerCase()
  const base = path.basename(name, path.extname(name))
  const s = slugify(base, { separator: '-' }) || sha256(name).slice(0, 8)
  return s + ext
}
const loadManifest = () => {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) }
  catch { return { version: 1, posts: {} } }
}
const yamlEscape = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
const stripInline = (s) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // 이미지 제거
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // 링크 → 텍스트만
  .replace(/[*_`>#|]/g, '')
  .replace(/\\([#\[\]()-])/g, '$1')             // turndown 이스케이프 해제
  .replace(/\s+/g, ' ')
  .trim()

// ---------- turndown (code-block aware) ----------
const td = new TurndownService({
  headingStyle: 'atx', codeBlockStyle: 'fenced', fence: '```',
  bulletListMarker: '-', emDelimiter: '_',
})
td.use(turndownGfm.gfm)
// <pre data-ke-type="codeblock" data-ke-language="java"><code>…</code></pre>
// textContent 기준(파서가 엔티티 디코드 완료) → List<T> 등 보존. 수동 디코드 금지.
td.addRule('tistoryCodeblock', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const codeEl = node.querySelector('code') || node
    const lang =
      node.getAttribute('data-ke-language') ||
      (codeEl.getAttribute && codeEl.getAttribute('data-ke-language')) || ''
    const code = (codeEl.textContent || '').replace(/\n+$/, '')
    return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`
  },
})

// ---------- date: ".box-info .date" 2026-03-31 16:51:39 (KST) ----------
function extractDate($) {
  const candidates = [
    $('.box-info .date').first().text(),
    $('.date').first().text(),
    $('meta[property="article:published_time"]').attr('content') || '',
  ]
  for (const raw of candidates) {
    const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
    if (m) {
      const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
      return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`, source: 'html-visible' }
    }
  }
  return { iso: null, source: null }
}

// ---------- slug (frozen) ----------
function makeSlug(title, id) {
  const base = slugify(title, { separator: '-' })
    .split('-').filter(Boolean)
    .filter((seg, i) => !(i === 0 && /^\d+$/.test(seg)))  // 선두 숫자 세그먼트 제거 ((2) 등)
    .slice(0, 8).join('-')
  const alpha = (base.match(/[a-z]/g) || []).length
  return alpha >= 2 ? `${base}-${id}` : `post-${id}`       // 라틴 빈약하면 post-id
}

// ---------- description (first real prose paragraph) ----------
function makeDescription(md, title) {
  for (const raw of md.split('\n')) {
    const l = raw.trim()
    if (!l || /^(#|!\[|```|-|\*|>|\|)/.test(l)) continue
    if (/\]\(https?:|^https?:\/\//.test(l)) continue       // 링크/URL 줄 skip
    const t = stripInline(l)
    if (t.length >= 20) return t.slice(0, 160).trim()
  }
  let fb = (title + ' — LogCat 백엔드 엔지니어링 개발 기록').trim()
  while (fb.length < 20) fb += ' ·'   // 스키마 description min(20) 보장
  return fb.slice(0, 160)
}

// ---------- main per-post ----------
function processFolder(dir, manifest, report) {
  const id = path.basename(dir)
  const htmlName = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.html'))
  if (!htmlName) { report.failed.push(`${id}: no .html`); return }
  const htmlPath = path.join(dir, htmlName)
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const sourceHash = 'sha256:' + sha256(html)
  const $ = cheerio.load(html, { decodeEntities: false })

  // --- title: strip [CATEGORY] prefix + trailing #hashtags ---
  let rawTitle = ($('.title-article').first().text() || $('title').first().text() || '').trim()
  let category = ($('.category').first().text() || '').trim() || undefined
  const pfx = rawTitle.match(/^\s*\[([^\]]+)\]\s*(.*)$/)
  let title = rawTitle
  if (pfx) { if (!category) category = pfx[1].trim(); title = pfx[2].trim() }
  title = title.replace(/(?:\s*#\S+)+\s*$/u, '').trim()    // 제목 끝 해시태그 제거(태그로 따로 수집)
  if (!title) { report.failed.push(`${id}: no title`); return }

  // --- 제외 글: 코테(Algorithm/*, BOJ) + 우테코(우아한테크코스 프리코스 회고) ---
  if (/^Algorithm\b/i.test(category || '') || category === 'BOJ') {
    report.skipped.push(`${id} (coding-test 제외)`); return
  }
  if (/우아한\s?테크코스|프리코스/u.test(title)) {
    report.skipped.push(`${id} (우테코 제외)`); return
  }

  // --- slug (frozen via manifest) ---
  const prior = manifest.posts[id]
  const slug = prior?.slug || makeSlug(title, id)

  // --- idempotency ---
  if (prior && prior.sourceHash === sourceHash && !FORCE) { report.skipped.push(`${id} (${slug})`); return }
  if (prior && prior.manual === true && !FORCE) { report.skipped.push(`${id} (manual-locked)`); return }
  if (prior && prior.slug && slug !== prior.slug && !FORCE) {
    report.failed.push(`${id}: slug drift ${prior.slug} → ${slug} (use --force)`); return
  }

  // --- date ---
  const { iso: pubDate, source: dateSource } = extractDate($)
  if (!pubDate) report.noDate.push(`${id} (${slug})`)

  // --- tags ---
  // category 는 tags 에 박지 않는다(슬러그 오염 방지). category 는 frontmatter 별도 필드로만 유지.
  const tagText = $('.article-view .tags, .tags').first().text() || ''
  const tags = [...new Set(tagText.split(/[#\s,]+/).map((t) => t.trim()).filter(Boolean))]

  // --- body container ---
  const $body = $('.article-view .contents_style').first().length
    ? $('.article-view .contents_style').first()
    : $('.contents_style').first()
  if (!$body.length) { report.failed.push(`${id}: no .contents_style`); return }
  $body.find('.tags').remove()
  // Tistory opengraph 링크카드 → 단순 링크로 치환(보일러플레이트 카드 텍스트 제거, 링크는 보존)
  $body.find('figure[data-ke-type="opengraph"]').each((_, el) => {
    const $f = $(el)
    const url = $f.attr('data-og-url') || $f.find('a').attr('href') || ''
    const t = ($f.attr('data-og-title') || $f.find('.og-title').text() || url || 'link').trim()
    $f.replaceWith(url ? `<p><a href="${url}">${t}</a></p>` : '')
  })

  const srcPreCount = $body.find('pre').length

  // --- images: copy + rewrite + byte-verify ---
  const imgDir = path.join(IMG_ROOT, slug)
  const images = []
  let missingImg = 0
  $body.find('img').each((_, el) => {
    const src = $(el).attr('src') || ''
    const m = src.match(/(?:\.\/)?img\/(.+)$/)
    if (!m) return
    const fileName = decodeURIComponent(m[1])
    const from = path.join(dir, 'img', fileName)
    const toName = sanitizeFile(fileName)
    const to = `/images/posts/${slug}/${toName}`
    if (fs.existsSync(from)) {
      if (!DRY) {
        ensureDir(imgDir); fs.copyFileSync(from, path.join(imgDir, toName))
        if (fs.statSync(from).size !== fs.statSync(path.join(imgDir, toName)).size)
          report.failed.push(`${id}: image byte mismatch ${fileName}`)
      }
      images.push({ from: `./img/${fileName}`, to })
    } else { missingImg++ }
    $(el).attr('src', to)
  })
  if (missingImg) report.missingImg.push(`${id}: ${missingImg} missing`)

  // --- convert ---
  const md = td.turndown($body.html() || '').trim()

  // --- invariant: fenced blocks == source <pre> ---
  const fenceCount = (md.match(/^```/gm) || []).length / 2
  if (Math.round(fenceCount) !== srcPreCount) report.codeMismatch.push(`${id}: pre=${srcPreCount} fences=${fenceCount}`)

  const description = makeDescription(md, title)
  const cover = images[0]?.to

  // --- frontmatter (js-yaml dump — 안전 직렬화, 손코딩 이스케이프 버그 제거) ---
  const data = { title, description }
  if (pubDate) data.pubDate = pubDate
  data.dateSource = dateSource || 'manual'
  data.slug = slug
  data.tags = tags
  if (category) data.category = category
  if (cover) data.cover = cover
  data.draft = true
  data.legacy = { tistoryId: id, sourceHtml: path.relative(BACKUP, htmlPath), sourceHash }
  const fm = '---\n' + yaml.dump(data, { lineWidth: -1, noRefs: true }) + '---\n\n'

  const outPath = path.join(POSTS_DIR, `${slug}.md`)
  if (!DRY) { ensureDir(POSTS_DIR); fs.writeFileSync(outPath, fm + md + '\n', 'utf-8') }

  manifest.posts[id] = {
    tistoryId: id, slug, sourceHash,
    pubDate: pubDate || null, dateSource: dateSource || null,
    output: path.relative(ROOT, outPath), images, manual: prior?.manual ?? false,
  }
  report.written.push(`${id} → ${slug}.md`)
}

// ---------- run ----------
function main() {
  if (!fs.existsSync(BACKUP)) { console.error(`백업 없음: ${BACKUP}`); process.exit(1) }
  const folders = fs.readdirSync(BACKUP)
    .map((f) => path.join(BACKUP, f))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => Number(path.basename(a)) - Number(path.basename(b)))
    .slice(0, LIMIT)

  const manifest = loadManifest()
  const report = { written: [], skipped: [], failed: [], noDate: [], missingImg: [], codeMismatch: [] }
  for (const dir of folders) {
    try { processFolder(dir, manifest, report) }
    catch (e) { report.failed.push(`${path.basename(dir)}: ${e.message}`) }
  }
  if (!DRY) fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  const line = '─'.repeat(54)
  console.log(`\n${line}\n  Tistory import ${DRY ? '(DRY-RUN)' : ''}  —  ${folders.length} folders\n${line}`)
  console.log(`  ✅ written       : ${report.written.length}`)
  console.log(`  ⏭  skipped       : ${report.skipped.length}`)
  console.log(`  ❌ failed        : ${report.failed.length}`)
  console.log(`  📅 no-date       : ${report.noDate.length}  (draft 유지·임의생성 안 함)`)
  console.log(`  🖼  missing-img   : ${report.missingImg.length}`)
  console.log(`  </> code-mismatch : ${report.codeMismatch.length}  (펜스수≠원본 pre수)`)
  const dump = (label, arr, n = 12) => {
    if (!arr.length) return
    console.log(`\n  ── ${label} ──`)
    arr.slice(0, n).forEach((x) => console.log(`     ${x}`))
    if (arr.length > n) console.log(`     … +${arr.length - n} more`)
  }
  dump('FAILED', report.failed)
  dump('CODE-MISMATCH (수동 검수)', report.codeMismatch)
  dump('NO-DATE (수동 보정)', report.noDate)
  dump('MISSING-IMG', report.missingImg)
  console.log(`\n  ${DRY ? 'DRY-RUN — 파일 안 씀.' : `manifest → ${path.relative(ROOT, MANIFEST_PATH)}`}\n`)
}

main()
