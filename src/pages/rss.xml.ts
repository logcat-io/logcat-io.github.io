import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { postHref } from '../lib/slug';
import { toRssDate } from '../lib/date';

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();

  return rss({
    title: 'LogCat',
    description: 'Backend engineering notes by LogCat.',
    site: context.site ?? 'https://logcat-io.pages.dev',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: toRssDate(post.data.pubDate),
      link: postHref(post.data.slug),
      categories: post.data.tags,
    })),
  });
}
