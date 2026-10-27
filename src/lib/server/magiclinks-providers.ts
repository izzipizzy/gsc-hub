import type { Db } from './db';
import { FIELDLINK_TIERS } from '$lib/utils/fieldlink';
import { magicLinksClient, type MagicLinksError } from './magiclinks';
import { magic369Client, type Magic369Error } from './magic369';

// Два провайдера покупок ссылок. Идентификаторы едут в UI и в историю покупок
// (magiclinks_purchases.provider), поэтому это закрытый список, а не строки.

export const PROVIDER_FIELDLINK = 'fieldlink';
export const PROVIDER_MAGIC369 = 'magic369';

export const MAGIC_PROVIDERS = [
  { id: PROVIDER_FIELDLINK, name: 'FieldLink', services: ['posts', 'links'] },
  { id: PROVIDER_MAGIC369, name: '369Team', services: ['posts', 'links'] }
] as const;
export type MagicProviderId = (typeof MAGIC_PROVIDERS)[number]['id'];
export const MAGIC_PROVIDER_IDS: MagicProviderId[] = MAGIC_PROVIDERS.map((p) => p.id);
export function isMagicProviderId(v: unknown): v is MagicProviderId {
  return MAGIC_PROVIDER_IDS.includes(v as MagicProviderId);
}

export function supportsMagicService(provider: MagicProviderId, service: 'posts' | 'links'): boolean {
  return MAGIC_PROVIDERS.find((p) => p.id === provider)!.services.some((supported) => supported === service);
}

export interface MagicProviderInfo {
  id: MagicProviderId;
  name: string;
  /** Единица баланса для подписи сумм в интерфейсе. */
  unit: string;
  services: readonly ('posts' | 'links')[];
  configured: boolean;
  balanceMinor: number | null;
  /** Текущая цена одного размещения, minor units; null, если не узнали. */
  priceMinor: number | null;
  error: string | null;
  linkPriceMinor?: number | null;
  linkTiers?: { id: string; traffic: string; priceMinor: number | null }[];
}

/** Живые балансы обоих провайдеров — по ним BuyLinks выбирает провайдера по умолчанию. */
export async function magicProviderInfos(db: Db): Promise<MagicProviderInfo[]> {
  const fieldlink = magicLinksClient(db);
  const m369 = magic369Client(db);

  const [fl, m] = await Promise.all([
    fieldlink
      ? fieldlink
          .balance()
          .then((b) => ({
            configured: true,
            balanceMinor: b.balanceMinor as number | null,
            priceMinor: Number.isInteger(b.prices?.post) && b.prices!.post > 0 ? b.prices!.post : null,
            linkPrices: b.prices ?? {},
            error: null as string | null
          }))
          .catch((e: MagicLinksError) => ({
            configured: true,
            balanceMinor: null,
            priceMinor: null,
            error: e.message
          }))
      : Promise.resolve({ configured: false, balanceMinor: null, priceMinor: null, error: null }),
    m369
      ? m369
          .balance()
          .then((b) => ({
            configured: true,
            balanceMinor: b.balanceMinor as number | null,
            priceMinor: b.priceMinor as number | null,
            linkPriceMinor: b.linkPriceMinor,
            error: null as string | null
          }))
          .catch((e: Magic369Error) => ({
            configured: true,
            balanceMinor: null,
            priceMinor: null,
            error: e.message
          }))
      : Promise.resolve({ configured: false, balanceMinor: null, priceMinor: null, error: null })
  ]);

  return [
    {
      id: PROVIDER_FIELDLINK,
      name: 'FieldLink',
      unit: 'кр.',
      services: MAGIC_PROVIDERS[0].services,
      configured: fl.configured,
      balanceMinor: fl.balanceMinor,
      priceMinor: fl.priceMinor,
      linkTiers: FIELDLINK_TIERS.map((tier) => {
        const prices = 'linkPrices' in fl ? fl.linkPrices : {};
        const price = prices[tier.id];
        return { id: tier.id, traffic: tier.traffic, priceMinor: Number.isInteger(price) && price > 0 ? price : null };
      }),
      error: fl.error
    },
    {
      id: PROVIDER_MAGIC369,
      name: '369Team',
      unit: 'ток.',
      services: MAGIC_PROVIDERS[1].services,
      configured: m.configured,
      balanceMinor: m.balanceMinor,
      priceMinor: m.priceMinor,
      linkPriceMinor: 'linkPriceMinor' in m ? m.linkPriceMinor : null,
      error: m.error
    }
  ];
}

/** Хоть один провайдер с ключом: от него зависит кнопка покупки в striking. */
export function anyMagicProviderConfigured(db: Db): boolean {
  return !!magicLinksClient(db) || !!magic369Client(db);
}
