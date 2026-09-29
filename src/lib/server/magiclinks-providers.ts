import type { Db } from './db';
import { magicLinksClient, POST_UNIT_MINOR, type MagicLinksError } from './magiclinks';
import { magic369Client, type Magic369Error } from './magic369';

// Два провайдера покупок ссылок. Идентификаторы едут в UI и в историю покупок
// (magiclinks_purchases.provider), поэтому это закрытый список, а не строки.

export const PROVIDER_FIELDLINK = 'fieldlink';
export const PROVIDER_MAGIC369 = 'magic369';

export type MagicProviderId = typeof PROVIDER_FIELDLINK | typeof PROVIDER_MAGIC369;

export const MAGIC_PROVIDER_IDS: MagicProviderId[] = [PROVIDER_FIELDLINK, PROVIDER_MAGIC369];

export function isMagicProviderId(v: unknown): v is MagicProviderId {
  return v === PROVIDER_FIELDLINK || v === PROVIDER_MAGIC369;
}

export interface MagicProviderInfo {
  id: MagicProviderId;
  name: string;
  /** Единица баланса для подписи сумм в интерфейсе. */
  unit: string;
  configured: boolean;
  balanceMinor: number | null;
  /** Текущая цена одного размещения, minor units; null, если не узнали. */
  priceMinor: number | null;
  error: string | null;
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
            priceMinor: POST_UNIT_MINOR as number | null,
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
      configured: fl.configured,
      balanceMinor: fl.balanceMinor,
      priceMinor: fl.priceMinor,
      error: fl.error
    },
    {
      id: PROVIDER_MAGIC369,
      name: 'Magic 369',
      unit: 'ток.',
      configured: m.configured,
      balanceMinor: m.balanceMinor,
      priceMinor: m.priceMinor,
      error: m.error
    }
  ];
}

/** Хоть один провайдер с ключом: от него зависит кнопка покупки в striking. */
export function anyMagicProviderConfigured(db: Db): boolean {
  return !!magicLinksClient(db) || !!magic369Client(db);
}
