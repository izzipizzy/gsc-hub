import type { MagicLinksRow } from './magiclinks';
import { rowsToCsv } from './csv';

/** Preserve the six post columns and seven historical link columns. */
export function fieldlinkCsv(type: string | undefined, rows: MagicLinksRow[]): string {
  const links = type === 'links' || (!type && rows.some((r) => r.input?.tier || r.result?.donor));
  const subject = links && rows.some((r) => r.input?.contentHint);
  const header = links
    ? ['URL акцептора', 'Анкор', 'Язык', 'Тариф', 'Статус', 'Донор', 'Текст размещения']
    : ['URL акцептора', 'Анкор', 'Ключевые слова для статьи', 'Язык', 'Статус', 'URL публикации'];
  if (subject) header.push('Content subject');
  return rowsToCsv(header, rows, (r) => {
    const line = links
      ? [r.input?.targetUrl ?? '', r.input?.anchor ?? '', r.input?.language ?? '', r.input?.tier ?? '', r.status, r.result?.donor ?? '', r.result?.text ?? '']
      : [r.input?.targetUrl ?? '', r.input?.anchor ?? '', r.input?.titleKeyword ?? '', r.input?.language ?? '', r.status, r.result?.destination ?? r.result?.source ?? ''];
    if (subject) line.push(r.input?.contentHint ?? '');
    return line;
  });
}
