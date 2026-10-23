/** Current homepage-link tiers. Traffic is the provider's T metric, not DR. */
export const FIELDLINK_TIERS = [
  { id: 'traffic_0_1', traffic: '0–1', priceMinor: 100 },
  { id: 'traffic_2_24', traffic: '>1–<25', priceMinor: 200 },
  { id: 'traffic_25_249', traffic: '25–<250', priceMinor: 500 }
] as const;

export type FieldlinkTier = (typeof FIELDLINK_TIERS)[number]['id'];
export function isFieldlinkTier(value: unknown): value is FieldlinkTier {
  return FIELDLINK_TIERS.some((tier) => tier.id === value);
}

/** Historical IDs remain readable; never reinterpret their traffic ranges. */
export function fieldlinkTierLabel(value: string): string {
  const tier = FIELDLINK_TIERS.find((t) => t.id === value);
  return tier ? `${tier.priceMinor / 100} кр. · T ${tier.traffic}` : value;
}

export function fieldlinkAdmissionMessage(code?: string): string {
  const messages: Record<string, string> = {
    LINK_TRAFFIC_TIER_REQUIRED: 'Выбери тариф ссылки и получи новый расчёт.',
    LINK_TIER_COMING_SOON: 'Этот тариф ещё недоступен. Выбери тариф 1, 2 или 5 кредитов.',
    LINK_EDITOR_UNAVAILABLE: 'Сервис не подтвердил доступ к ссылкам. Проверь право links:write у ключа или обратись в FieldLink.',
    OTHER_POST_TOPIC_DISABLED: 'Эта тематика пока недоступна. Задание сохранено; запуск можно продолжить позже в FieldLink.'
  };
  return code ? messages[code] ?? `Сервис пока не разрешает запуск: ${code}.` : 'Сервис пока не разрешает запуск. Проверь задание в FieldLink.';
}
