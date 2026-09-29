import type { Db } from './db';
import { hostToUnicode } from './idn';

// User-entered chart annotations for traffic events that are not Google algorithm
// updates — domain merges (подклейка донора в сайт), migrations, anything worth a
// vertical marker. Rows are keyed by bare host (no scheme, no sc-domain: prefix, no
// www) so they match the property regardless of how it is registered in GSC.
//
// Reads are live per request: a row added straight into SQLite shows up on refresh,
// no restart needed.

export type SiteEventType = 'merge';

export interface SiteEvent {
  id: number;
  siteHost: string;
  date: string; // ISO YYYY-MM-DD
  type: SiteEventType;
  note: string; // shown verbatim as the chart label, e.g. "← donordomain.com"
  addedAt: number; // when the row was entered, ms
}

/** Display config per type — chart line color + human label. */
export const SITE_EVENT_TYPES: Record<SiteEventType, { color: string; label: string }> = {
  merge: { color: '#131722', label: 'Merge' }
};

/** Bare lowercase host of a GSC siteUrl ("sc-domain:Example.com", "https://www.x/").
 *  www. is stripped: events are entered as bare domains, and www/non-www are the same
 *  site for annotation purposes. */
export function hostOfSite(siteUrl: string): string {
  const raw = siteUrl.startsWith('sc-domain:') ? siteUrl.slice('sc-domain:'.length) : siteUrl;
  try {
    return new URL(raw).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
  }
}

interface EventRow {
  id: number;
  site_host: string;
  date: string;
  type: string;
  note: string;
  added_at: number;
}

const COLS = 'id, site_host, date, type, note, added_at';

function toEvent(r: EventRow): SiteEvent {
  return {
    id: r.id, siteHost: r.site_host, date: r.date, type: r.type as SiteEventType,
    note: r.note, addedAt: r.added_at
  };
}

export function listSiteEvents(db: Db): SiteEvent[] {
  const rows = db.prepare(`SELECT ${COLS} FROM site_events ORDER BY date, id`).all() as EventRow[];
  return rows.map(toEvent);
}

/** Events of one property, matched by host, oldest first. */
export function listSiteEventsForSite(db: Db, siteUrl: string): SiteEvent[] {
  const host = hostOfSite(siteUrl);
  return listSiteEvents(db).filter((e) => e.siteHost === host);
}

export function addSiteEvent(
  db: Db,
  input: { siteHost: string; date: string; type?: SiteEventType; note?: string }
): SiteEvent | null {
  const host = hostOfSite(input.siteHost);
  const type = input.type ?? 'merge';
  const note = input.note ?? '';
  const res = db
    .prepare('INSERT OR IGNORE INTO site_events (site_host, date, type, note, added_at) VALUES (?, ?, ?, ?, ?)')
    .run(host, input.date, type, note, Date.now());
  if (res.changes === 0) return null; // exact duplicate — unique index said no
  return findSiteEvent(db, { siteHost: host, date: input.date, type, note });
}

export function findSiteEvent(
  db: Db,
  key: { siteHost: string; date: string; type: SiteEventType; note: string }
): SiteEvent | null {
  const row = db
    .prepare(`SELECT ${COLS} FROM site_events WHERE site_host = ? AND date = ? AND type = ? AND note = ?`)
    .get(key.siteHost, key.date, key.type, key.note) as EventRow | undefined;
  return row ? toEvent(row) : null;
}

// ─── Glued domains (подклейка) via the API ─────────────────────────────────────

export class GluedError extends Error {}

/** Bare punycode host, or null when the input is not a domain. Accepts what people
 *  paste: a URL, `sc-domain:`, www., a port, upper case, Cyrillic. */
export function normalizeDomain(input: string): string | null {
  let raw = (input ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('sc-domain:')) raw = raw.slice('sc-domain:'.length);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname; // the WHATWG parser lower-cases and punycodes
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  // At least one dot and a letter TLD: "localhost" or a bare word is not a site.
  if (!/^(?:[a-z0-9-]+\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host)) return null;
  return host;
}

/** Донор из подписи события, или null, если подпись — не домен.
 *  Форма на странице сайта рисует «←» только в поле ввода, а в базу кладёт домен как
 *  есть: «donor.com». Сид и API пишут «← donor.com». Обе записи — одна и та же склейка,
 *  и судить о ней надо одинаково. */
export function donorOf(note: string): string | null {
  const bare = (note ?? '').trim().replace(/^(?:←|<-)\s*/, '');
  if (!bare || /\s/.test(bare)) return null;
  return normalizeDomain(bare);
}

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Record that `donor` was 301-glued into `site` on `date`. Written as the same merge
 *  event the site page writes, labelled "← donor", so it lands on the site chart, the
 *  dashboard and portfolio pulse. A repeat returns the existing row: an agent may
 *  safely retry. */
export function addGluedDomain(
  db: Db,
  input: { site: string; donor: string; date?: string }
): { created: boolean; event: SiteEvent } {
  const site = normalizeDomain(input.site);
  if (!site) throw new GluedError('site: not a domain');
  const donor = normalizeDomain(input.donor);
  if (!donor) throw new GluedError('donor: not a domain');
  if (donor === site) throw new GluedError('donor is the site itself');
  const date = (input.date ?? '').trim() || new Date().toISOString().slice(0, 10);
  if (!isRealDate(date)) throw new GluedError('date must be a real YYYY-MM-DD');

  // Подпись — для глаз, поэтому в юникоде: «← пример.рф», а не «← xn--e1afmkfd.xn--p1ai».
  // Она выводится из нормализованного punycode, значит одинаковый донор даёт одинаковую
  // подпись в любом написании — и повтор распознаётся.
  // Та же склейка могла быть внесена формой без стрелки или в другом написании домена:
  // повтор узнаётся по донору, а не по буквам подписи.
  const same = listSiteEvents(db).find(
    (e) => e.siteHost === site && e.date === date && e.type === 'merge' && donorOf(e.note) === donor
  );
  if (same) return { created: false, event: same };

  const note = `← ${hostToUnicode(donor)}`;
  const created = addSiteEvent(db, { siteHost: site, date, type: 'merge', note });
  if (created) return { created: true, event: created };
  const existing = findSiteEvent(db, { siteHost: site, date, type: 'merge', note });
  if (!existing) throw new GluedError('could not record the event');
  return { created: false, event: existing };
}

export function deleteSiteEvent(db: Db, id: number): void {
  db.prepare('DELETE FROM site_events WHERE id = ?').run(id);
}

// ─── Chart projection ─────────────────────────────────────────────────────────

/** Shape TrendChart.svelte consumes: a vertical line + label at `date`. */
export interface ChartEvent {
  date: string; // ISO YYYY-MM-DD
  label: string;
  color: string;
}

export function toChartEvents(events: SiteEvent[]): ChartEvent[] {
  return events.map((e) => ({
    date: e.date,
    label: e.note || SITE_EVENT_TYPES[e.type]?.label || e.type,
    color: SITE_EVENT_TYPES[e.type]?.color ?? SITE_EVENT_TYPES.merge.color
  }));
}
