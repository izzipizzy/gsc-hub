// GSC возвращает country как ISO 3166-1 alpha-3 (lowercase): 'rus', 'usa', 'deu'.
// Google SERP принимает alpha-2 в параметре `gl`. Маппинг закрывает все ISO-страны.

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  afg: 'AF', ala: 'AX', alb: 'AL', dza: 'DZ', asm: 'AS', and: 'AD', ago: 'AO', aia: 'AI', ata: 'AQ', atg: 'AG',
  arg: 'AR', arm: 'AM', abw: 'AW', aus: 'AU', aut: 'AT', aze: 'AZ', bhs: 'BS', bhr: 'BH', bgd: 'BD', brb: 'BB',
  blr: 'BY', bel: 'BE', blz: 'BZ', ben: 'BJ', bmu: 'BM', btn: 'BT', bol: 'BO', bes: 'BQ', bih: 'BA', bwa: 'BW',
  bvt: 'BV', bra: 'BR', iot: 'IO', brn: 'BN', bgr: 'BG', bfa: 'BF', bdi: 'BI', cpv: 'CV', khm: 'KH', cmr: 'CM',
  can: 'CA', cym: 'KY', caf: 'CF', tcd: 'TD', chl: 'CL', chn: 'CN', cxr: 'CX', cck: 'CC', col: 'CO', com: 'KM',
  cog: 'CG', cod: 'CD', cok: 'CK', cri: 'CR', civ: 'CI', hrv: 'HR', cub: 'CU', cuw: 'CW', cyp: 'CY', cze: 'CZ',
  dnk: 'DK', dji: 'DJ', dma: 'DM', dom: 'DO', ecu: 'EC', egy: 'EG', slv: 'SV', gnq: 'GQ', eri: 'ER', est: 'EE',
  swz: 'SZ', eth: 'ET', flk: 'FK', fro: 'FO', fji: 'FJ', fin: 'FI', fra: 'FR', guf: 'GF', pyf: 'PF', atf: 'TF',
  gab: 'GA', gmb: 'GM', geo: 'GE', deu: 'DE', gha: 'GH', gib: 'GI', grc: 'GR', grl: 'GL', grd: 'GD', glp: 'GP',
  gum: 'GU', gtm: 'GT', ggy: 'GG', gin: 'GN', gnb: 'GW', guy: 'GY', hti: 'HT', hmd: 'HM', vat: 'VA', hnd: 'HN',
  hkg: 'HK', hun: 'HU', isl: 'IS', ind: 'IN', idn: 'ID', irn: 'IR', irq: 'IQ', irl: 'IE', imn: 'IM', isr: 'IL',
  ita: 'IT', jam: 'JM', jpn: 'JP', jey: 'JE', jor: 'JO', kaz: 'KZ', ken: 'KE', kir: 'KI', prk: 'KP', kor: 'KR',
  kwt: 'KW', kgz: 'KG', lao: 'LA', lva: 'LV', lbn: 'LB', lso: 'LS', lbr: 'LR', lby: 'LY', lie: 'LI', ltu: 'LT',
  lux: 'LU', mac: 'MO', mdg: 'MG', mwi: 'MW', mys: 'MY', mdv: 'MV', mli: 'ML', mlt: 'MT', mhl: 'MH', mtq: 'MQ',
  mrt: 'MR', mus: 'MU', myt: 'YT', mex: 'MX', fsm: 'FM', mda: 'MD', mco: 'MC', mng: 'MN', mne: 'ME', msr: 'MS',
  mar: 'MA', moz: 'MZ', mmr: 'MM', nam: 'NA', nru: 'NR', npl: 'NP', nld: 'NL', ncl: 'NC', nzl: 'NZ', nic: 'NI',
  ner: 'NE', nga: 'NG', niu: 'NU', nfk: 'NF', mkd: 'MK', mnp: 'MP', nor: 'NO', omn: 'OM', pak: 'PK', plw: 'PW',
  pse: 'PS', pan: 'PA', png: 'PG', pry: 'PY', per: 'PE', phl: 'PH', pcn: 'PN', pol: 'PL', prt: 'PT', pri: 'PR',
  qat: 'QA', reu: 'RE', rou: 'RO', rus: 'RU', rwa: 'RW', blm: 'BL', shn: 'SH', kna: 'KN', lca: 'LC', maf: 'MF',
  spm: 'PM', vct: 'VC', wsm: 'WS', smr: 'SM', stp: 'ST', sau: 'SA', sen: 'SN', srb: 'RS', syc: 'SC', sle: 'SL',
  sgp: 'SG', sxm: 'SX', svk: 'SK', svn: 'SI', slb: 'SB', som: 'SO', zaf: 'ZA', sgs: 'GS', ssd: 'SS', esp: 'ES',
  lka: 'LK', sdn: 'SD', sur: 'SR', sjm: 'SJ', swe: 'SE', che: 'CH', syr: 'SY', twn: 'TW', tjk: 'TJ', tza: 'TZ',
  tha: 'TH', tls: 'TL', tgo: 'TG', tkl: 'TK', ton: 'TO', tto: 'TT', tun: 'TN', tur: 'TR', tkm: 'TM', tca: 'TC',
  tuv: 'TV', uga: 'UG', ukr: 'UA', are: 'AE', gbr: 'GB', usa: 'US', umi: 'UM', ury: 'UY', uzb: 'UZ', vut: 'VU',
  ven: 'VE', vnm: 'VN', vgb: 'VG', vir: 'VI', wlf: 'WF', esh: 'EH', yem: 'YE', zmb: 'ZM', zwe: 'ZW'
};

// Дефолтный SERP-язык по стране. Покрываем основные; остальные — 'en'.
const ALPHA2_TO_HL: Record<string, string> = {
  RU: 'ru', UA: 'uk', BY: 'be', KZ: 'kk', UZ: 'uz', KG: 'ky', TJ: 'tg', TM: 'tk', AZ: 'az', AM: 'hy', GE: 'ka', MD: 'ro',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  IT: 'it', SM: 'it', VA: 'it',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', UY: 'es', PY: 'es', BO: 'es', EC: 'es', CR: 'es', CU: 'es', DO: 'es', GT: 'es', HN: 'es', NI: 'es', PA: 'es', SV: 'es', PR: 'es',
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt',
  NL: 'nl', PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', GR: 'el', HR: 'hr', RS: 'sr', SI: 'sl', MK: 'mk', AL: 'sq', BA: 'bs',
  SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is', EE: 'et', LV: 'lv', LT: 'lt',
  TR: 'tr', IL: 'he', IR: 'fa', SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar', JO: 'ar', LB: 'ar', SY: 'ar', IQ: 'ar', YE: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', SD: 'ar',
  JP: 'ja', KR: 'ko', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', TH: 'th', VN: 'vi', ID: 'id', MY: 'ms', PH: 'fil',
  IN: 'en', PK: 'en', BD: 'bn', LK: 'si', NP: 'ne'
};

export function googleSerpUrl(query: string, alpha3: string): string | null {
  if (!query) return null;
  const code = alpha3.toLowerCase();
  const gl = ALPHA3_TO_ALPHA2[code];
  if (!gl) return null; // unknown / 'zzz' / empty — no link
  const hl = ALPHA2_TO_HL[gl] ?? 'en';
  const params = new URLSearchParams({ q: query, gl, hl });
  return `https://www.google.com/search?${params.toString()}`;
}
