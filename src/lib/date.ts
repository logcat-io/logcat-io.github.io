const kstDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatKstDate(date: Date): string {
  return kstDateFormatter.format(date).replace(/\.\s?/g, '.').replace(/\.$/, '');
}

export function toRssDate(date: Date): Date {
  return date;
}
