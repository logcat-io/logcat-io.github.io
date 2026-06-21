import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(20),
    pubDate: z.coerce.date(),
    dateSource: z.enum(['html-meta', 'html-visible', 'backup-index', 'rss', 'manual']),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    category: z.string().optional(),
    series: z.object({ name: z.string(), order: z.number().optional() }).optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    cover: z.string().startsWith('/images/').optional(),
    coverAlt: z.string().optional(),
    legacy: z
      .object({ tistoryId: z.string(), sourceHtml: z.string(), sourceHash: z.string() })
      .optional(),
    draft: z.boolean().default(true),
  }),
});

export const collections = { posts };
