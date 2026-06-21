import { OGImageRoute } from 'astro-og-canvas';
import { getCollection } from 'astro:content';

// 발행 글 + 사이트 기본 OG. 빌드타임에 제목 기반 흑백 OG 이미지를 생성한다.
const posts = await getCollection('posts', ({ data }) => data.draft !== true);

const pages: Record<string, { title: string; description: string }> = {
  site: { title: 'LogCat', description: '소심한 엔지니어의 개발기록' },
};
for (const p of posts) {
  pages[p.data.slug] = { title: p.data.title, description: p.data.description };
}

const route = await OGImageRoute({
  param: 'route',
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[255, 255, 255]],
    border: { color: [10, 10, 10], width: 18, side: 'inline-start' },
    padding: 72,
    font: {
      title: {
        color: [10, 10, 10],
        size: 60,
        weight: 'Bold',
        lineHeight: 1.3,
        families: ['Pretendard'],
      },
      description: {
        color: [90, 90, 90],
        size: 26,
        weight: 'Bold',
        lineHeight: 1.4,
        families: ['Pretendard'],
      },
    },
    fonts: ['./fonts/Pretendard-Bold.otf'],
  }),
});

export const getStaticPaths = route.getStaticPaths;
export const GET = route.GET;
