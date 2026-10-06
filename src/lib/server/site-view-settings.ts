import type { Db } from './db';
import { siteHostname } from '../utils/url-filters';
import { STRIKING_SORT_KEYS, type StrikingSortKey, type SortDirection } from '../utils/striking-sort';

export interface SiteViewSettings {
  days: number;
  geo: string;
  sort: StrikingSortKey;
  dir: SortDirection;
  tab: string;
}
const DEFAULTS: SiteViewSettings = { days: 28, geo: '', sort: 'impressions', dir: 'desc', tab: 'overview' };
const TABS = ['overview', 'keywords', 'cannibal', 'ctr', 'branded', 'decay', 'health'];

export function getSiteViewSettings(db: Db, site: string): SiteViewSettings {
  const row = db.prepare('SELECT settings FROM site_view_settings WHERE site_host = ?').get(siteHostname(site)) as { settings: string } | undefined;
  return { ...DEFAULTS, ...(row ? JSON.parse(row.settings) : {}) };
}

export function saveSiteViewSettings(db: Db, site: string, patch: Record<string, unknown>): SiteViewSettings {
  const values: Partial<SiteViewSettings> = {};
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'days':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 480) throw new Error('days: 1..480');
        values.days = value; break;
      case 'geo':
        if (typeof value !== 'string' || !/^[a-z0-9_-]{0,64}$/i.test(value)) throw new Error('invalid geo');
        values.geo = value; break;
      case 'sort':
        if (!(STRIKING_SORT_KEYS as readonly unknown[]).includes(value)) throw new Error('invalid sort');
        values.sort = value as StrikingSortKey; break;
      case 'dir':
        if (value !== 'asc' && value !== 'desc') throw new Error('invalid direction');
        values.dir = value; break;
      case 'tab':
        if (typeof value !== 'string' || !TABS.includes(value)) throw new Error('invalid tab');
        values.tab = value; break;
      default: throw new Error('unknown setting');
    }
  }
  return db.transaction(() => {
    const next = { ...getSiteViewSettings(db, site), ...values };
    db.prepare('INSERT INTO site_view_settings (site_host, settings) VALUES (?, ?) ON CONFLICT(site_host) DO UPDATE SET settings = excluded.settings')
      .run(siteHostname(site), JSON.stringify(next));
    return next;
  })();
}

export function chooseGeo(requested: string, saved: string, bindings: { geo: string }[]): string {
  return [requested, saved].find((geo) => geo && bindings.some((b) => b.geo === geo)) ?? bindings[0]?.geo ?? '';
}
