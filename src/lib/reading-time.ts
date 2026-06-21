const WORDS_PER_MINUTE = 220;
const KOREAN_CHARS_PER_MINUTE = 500;

export function estimateReadingTime(text = ''): number {
  const latinWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const koreanChars = text.match(/[가-힣]/g)?.length ?? 0;
  const minutes = latinWords / WORDS_PER_MINUTE + koreanChars / KOREAN_CHARS_PER_MINUTE;

  return Math.max(1, Math.ceil(minutes || 1));
}
