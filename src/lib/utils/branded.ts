// Shared between the matcher and the editor that types the terms, so the UI
// cannot promise one rule while the server applies another.
//
// Terms this short match as whole words only: "co" sits inside discount and
// coffee, "app" inside happy and apple, "one" inside money and phone. From four
// characters up a term is distinctive enough that a glued occurrence — say
// "ikealogin" — is a real branded query rather than an accident.
export const SHORT_TERM_MAX = 3;

/** One normal form for terms and queries alike, so "é" matches "é". */
export function normalizeForMatch(s: string): string {
  return s.normalize('NFC').toLowerCase();
}
