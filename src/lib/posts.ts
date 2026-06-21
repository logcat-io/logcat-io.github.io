import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { normalizeTag } from './slug';

export type PostEntry = CollectionEntry<'posts'>;

// 의미있는 태그 최소 등장 수. 1회성 태그(롱테일)는 페이지·링크에서 제외해
// 깔끔한 ~수십개 수준의 색인만 노출한다.
export const MIN_TAG_COUNT = 2;

export async function getPublishedPosts(): Promise<PostEntry[]> {
  const posts = await getCollection('posts', ({ data }) => data.draft !== true);

  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// 정규화 키 → count 맵. 한 글 안에서 같은 키가 중복돼도 1번만 센다.
async function rawTagCounts(): Promise<Map<string, number>> {
  const posts = await getPublishedPosts();
  const counts = new Map<string, number>();

  for (const post of posts) {
    const seen = new Set<string>();
    for (const rawTag of post.data.tags) {
      const tag = normalizeTag(rawTag);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return counts;
}

// count >= MIN_TAG_COUNT 인 태그만 반환(페이지/색인/링크 대상).
export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
  const counts = await rawTagCounts();

  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_TAG_COUNT)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// 정규화 키 기준의 "의미있는 태그" 셋. PostCard·Post 에서 글의 태그 중
// 페이지가 실제로 존재하는(count>=MIN) 것만 노출해 링크가 깨지지 않게 한다.
export async function getSignificantTagSet(): Promise<Set<string>> {
  const counts = await rawTagCounts();
  const set = new Set<string>();
  for (const [tag, count] of counts) {
    if (count >= MIN_TAG_COUNT) set.add(tag);
  }
  return set;
}

// 한 글의 태그 중 의미있는(count>=MIN) 것만, 정규화 canonical 키로 통일해서 반환.
// (자바→java, 멱등성→idempotency 등 동의어 병합 + 영문 통일 — 카드·아카이브·상세 일관)
export function significantTagsOf(post: PostEntry, significant: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawTag of post.data.tags) {
    const key = normalizeTag(rawTag);
    if (!key || seen.has(key) || !significant.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export async function getPostsByTag(tag: string): Promise<PostEntry[]> {
  const normalized = normalizeTag(tag);
  const posts = await getPublishedPosts();

  return posts.filter((post) => post.data.tags.some((candidate) => normalizeTag(candidate) === normalized));
}
