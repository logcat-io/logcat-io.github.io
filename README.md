# LogCat

소심한 엔지니어의 개발기록. Kotlin / Spring / Kafka 로 분산 시스템과 데이터 파이프라인을 다룬 글을 모은 블로그입니다.

- 프레임워크: [Astro](https://astro.build)
- 디자인: 순수 흑백(monochrome) Swiss Pixel — 손코딩 비트맵 스프라이트, 이미지/SVG/이모지 없음
- 배포: GitHub Pages (GitHub Actions 자동 배포)
- 공개 URL: <https://logcat-io.github.io>

## 사전 준비 — Node 22 필수

Astro 6 은 Node 20 을 지원하지 않습니다. **반드시 Node 22 로 작업하세요.**

```bash
nvm use 22.22.3   # 없으면  nvm install 22.22.3
node -v           # v22.22.3 확인
npm install       # 최초 1회
```

## 새 글 쓰기

1. 스캐폴드 생성 — 제목만 주면 `src/content/posts/<slug>.md` 가 만들어집니다.

   ```bash
   npm run new "글 제목"
   ```

   - `slug`: 영문 제목 슬러그(라틴이 빈약하면 날짜 기반 `post-YYYYMMDD`)
   - frontmatter: `title` / `description`(20자 이상) / `pubDate`(현재 KST) / `dateSource: manual` / `slug` / `tags: []` / `draft: false`
   - 같은 파일이 있으면 덮어쓰지 않고 경고만 합니다.

2. 생성된 `.md` 를 편집합니다. `description` 은 꼭 20자 이상으로 채우세요(스키마 검증).

3. 로컬 미리보기:

   ```bash
   npm run dev          # http://localhost:4321
   ```

4. 배포 — `main` 에 push 하면 GitHub Actions 가 자동 빌드/배포합니다.

   ```bash
   git add .
   git commit -m "post: 글 제목"
   git push
   ```

## 빌드 / 미리보기

```bash
npm run build     # dist/ 정적 생성 (경고 없이 통과해야 함)
npm run preview   # 빌드 결과 로컬 확인
```

## 태그 정리 (1회성 유지보수)

태그가 카테고리 슬러그/제목 조각으로 오염되면 정리 스크립트를 돌립니다. **frontmatter 의 `tags` 만**
재작성하고 본문은 건드리지 않습니다.

```bash
node scripts/clean-tags.mjs --dry-run   # 전/후 distinct 수만 출력
node scripts/clean-tags.mjs             # 실제 적용
```

- 글의 `category` 정규화값 / 분해 세그먼트와 일치하는 태그 제거 + dedupe
- 표시·색인은 `src/lib/posts.ts` 의 `MIN_TAG_COUNT`(현재 2) 이상 등장한 태그만 노출

## Tistory 글 가져오기 (importer)

티스토리 백업 HTML → Astro `.md` 로 변환합니다. 결정적·idempotent·감사 가능하게 설계됨.

```bash
# 입력: ~/Downloads/ditto-dev-1-1/<id>/<*.html>
node scripts/import-tistory.mjs --dry-run    # 파일 안 씀, 리포트만
node scripts/import-tistory.mjs              # src/content/posts/*.md 생성 (draft:true)
node scripts/import-tistory.mjs --force      # 슬러그/해시 변경 강제 반영
```

- 날짜는 원본 `.box-info .date` 에서만 추출(없으면 draft 유지, 임의 생성 금지)
- 코드블록은 원본 `<pre><code>` textContent 보존(펜스 수 == pre 수 invariant)
- 슬러그는 `scripts/migration-manifest.json` 에 freeze
- `category` 는 별도 필드로만 두고 `tags` 에는 박지 않습니다(태그 슬러그 오염 방지)

## 구조 개요

```
src/
├── components/      SEO·PostCard·Tag·PixelSprite 등
├── content/
│   ├── posts/       글 (.md, frontmatter + 본문)
│   └── ...
├── content.config.ts  posts 컬렉션 스키마(zod)
├── layouts/         Base.astro · Post.astro
├── lib/             posts.ts(쿼리·태그) · slug.ts · date.ts · reading-time.ts
├── pages/
│   ├── index.astro       홈
│   ├── about.astro       소개
│   ├── posts/            아카이브
│   ├── tags/             태그 색인 · 태그별 글
│   ├── rss.xml.ts        RSS 피드
│   └── llms.txt.ts       /llms.txt (GEO 보조)
├── data/sprites.ts  손코딩 픽셀 비트맵
└── styles/global.css

public/
├── robots.txt       AI 크롤러 허용 + sitemap 경로
scripts/
├── new-post.mjs     새 글 스캐폴드 (npm run new)
├── clean-tags.mjs   태그 정리(1회성)
└── import-tistory.mjs  티스토리 importer
```

## SEO / GEO

- 메타: title / description / canonical(절대 URL) / Open Graph / Twitter Card, 글은 `article:*`
- JSON-LD: 홈 = WebSite + Blog, 글 = BlogPosting(`@astrojs` 런타임 JS 없이 빌드시 정적)
- `robots.txt` 가 GPTBot/ClaudeBot/PerplexityBot 등 AI 크롤러를 명시적으로 허용
- `/sitemap-index.xml`(@astrojs/sitemap), `/rss.xml`(@astrojs/rss), `/llms.txt` 제공

## 제약

- 순수 흑백 유지 — 색 액센트 추가 금지
- 외부 JS 런타임 추가 금지 — 메타/JSON-LD 는 모두 빌드시 정적 생성
