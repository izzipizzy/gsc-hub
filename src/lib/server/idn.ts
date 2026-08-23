// Punycode decoding, per RFC 3492.
//
// `new URL()` normalises an international hostname to its ASCII form, so a
// property registered as https://пример.рф/ reaches the app as
// xn--e1afmkfd.xn--p1ai. A brand term derived from that never appears in a real
// query, while the same site registered as sc-domain:пример.рф keeps its
// Unicode spelling — so the two forms of one site would split differently.
//
// Node's own `punycode` module is deprecated and warns on import, and the
// algorithm is small and fixed, so it lives here.
//
// The hostname arrives from a Google API response or a stored account row.
// Neither is a place to assume well-formed input, so the decoder is bounded and
// its arithmetic is checked: RFC 3492 requires that, and without it a chain of
// continuation digits drives the working exponent to Infinity, after which the
// bias loop divides Infinity by 35 forever — synchronously, on the only thread
// this process has.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';
const MAX_CODE_POINT = 0x10ffff;
// RFC 3492's maxint: the point past which the reference implementation reports
// overflow rather than continuing.
const MAX_INT = 0x7fffffff;
// DNS limits. A real label cannot exceed these, so anything longer is not input
// worth spending time on.
const MAX_LABEL_LENGTH = 63;
const MAX_HOST_LENGTH = 253;

class DecodeError extends Error {}

function digitValue(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26; // 0-9
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41; // A-Z
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61; // a-z
  return BASE; // not a digit
}

function adaptBias(delta: number, numPoints: number, firstTime: boolean): number {
  if (!Number.isFinite(delta) || delta < 0) throw new DecodeError('bad delta');
  // Math.floor, not >>1: the shift coerces to a signed 32-bit integer, which
  // turns a large delta negative rather than halving it.
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/** Decodes one punycode label body — everything after the xn-- prefix. */
function decodeLabel(input: string): string {
  // An ACE prefix with no body is not a hostname label, whatever Bootstring
  // alone would make of it.
  if (input === '') throw new DecodeError('empty body');

  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;

  const lastDelimiter = input.lastIndexOf(DELIMITER);
  const basic = lastDelimiter > 0 ? input.slice(0, lastDelimiter) : '';
  for (const ch of basic) {
    if (ch.codePointAt(0)! > 0x7f) throw new DecodeError('non-basic code point');
  }
  const output = [...basic].map((c) => c.codePointAt(0)!);

  let index = lastDelimiter > 0 ? lastDelimiter + 1 : 0;
  if (index >= input.length) throw new DecodeError('no encoded part');

  while (index < input.length) {
    const oldI = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new DecodeError('truncated');
      const digit = digitValue(input.codePointAt(index)!);
      index += 1;
      if (digit >= BASE) throw new DecodeError('bad digit');
      if (digit > Math.floor((MAX_INT - i) / w)) throw new DecodeError('overflow');
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) throw new DecodeError('overflow');
      w *= BASE - t;
    }
    const outLength = output.length + 1;
    bias = adaptBias(i - oldI, outLength, oldI === 0);
    if (Math.floor(i / outLength) > MAX_INT - n) throw new DecodeError('overflow');
    n += Math.floor(i / outLength);
    i %= outLength;
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) {
      throw new DecodeError('not a Unicode scalar value');
    }
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

/**
 * Hostname in its Unicode form, normalised to NFC.
 *
 * Labels that are not punycode, or that do not decode, are returned as they
 * came — a hostname we cannot read is still a hostname, and throwing here would
 * take down a page over a brand label.
 */
export function hostToUnicode(host: string): string {
  // A fully-qualified name may carry a trailing dot; it is one octet of DNS
  // syntax, not part of the length budget and not a label to decode.
  const trailingDot = host.endsWith('.');
  const body = trailingDot ? host.slice(0, -1) : host;
  if (body.length > MAX_HOST_LENGTH) return host;
  return body
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label.normalize('NFC');
      if (label.length > MAX_LABEL_LENGTH) return label;
      try {
        // NFC so that a decoded "e + combining acute" matches the same word
        // typed precomposed. Punycode preserves code points; it does not
        // promise a normal form.
        return decodeLabel(label.slice(4)).normalize('NFC');
      } catch {
        return label;
      }
    })
    .join('.') + (trailingDot ? '.' : '');
}
