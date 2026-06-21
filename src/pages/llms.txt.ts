import type { APIContext } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { postHref } from '../lib/slug';

// /llms.txt — GEO 보조. 발행 글 목록을 LLM 친화적 마크다운으로 정적 제공.
export async function GET(context: APIContext) {
  const site = (context.site?.toString() ?? 'https://logcat-io.github.io/').replace(/\/$/, '');
  const posts = await getPublishedPosts();

  const header = [
    '# LogCat',
    '',
    '> 소심한 엔지니어의 개발기록 — 신중하고 꼼꼼하게 남기는 백엔드 엔지니어 LogCat 의 로그.',
    '> Kotlin / Spring / Kafka 로 분산 시스템과 데이터 파이프라인을 다룬 글을 정리합니다.',
    '',
    `사이트: ${site}/`,
    '',
    '## Posts',
    '',
  ].join('\n');

  const lines = posts.map((post) => {
    const url = `${site}${postHref(post.data.slug)}`;
    const summary = post.data.description.replace(/\s+/g, ' ').trim();
    return `- [${post.data.title}](${url}): ${summary}`;
  });

  const body = header + lines.join('\n') + '\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
