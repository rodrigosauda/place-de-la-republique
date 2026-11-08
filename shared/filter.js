// shared/filter.js
// Very small bad-word filter for names, slogans and chat (used by the server,
// so nobody can bypass it). It is NOT perfect: add words to the list as you
// see them. Matching ignores upper/lower case and accents.

const BAD_WORDS = [
  // English
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut',
  // French
  'pute', 'putain', 'salope', 'connard', 'connasse', 'enculé', 'encule', 'pd', 'pédé', 'pede',
  'nègre', 'negre', 'bougnoule', 'youpin', 'tapette', 'batard', 'bâtard', 'fdp', 'ntm',
  // Portuguese / Spanish
  'porra', 'caralho', 'puta', 'viado', 'buceta', 'cabrón', 'cabron', 'maricón', 'maricon',
];

// Remove accents so "enculé" and "encule" are the same.
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PATTERNS = [...new Set(BAD_WORDS.map(normalize))].map(
  (w) => new RegExp(`(^|[^a-z0-9])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^a-z0-9])`, 'g'),
);

// Returns the text with bad words replaced by ***.
export function cleanText(text) {
  const plain = normalize(text);
  // Find bad word positions in the normalized text, then mask the same
  // positions in the original (normalize() keeps one char per base letter
  // for the common accented characters we care about).
  const mask = new Array(text.length).fill(false);
  let changed = false;
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(plain))) {
      const start = m.index + m[1].length;
      for (let i = start; i < start + m[2].length && i < mask.length; i++) mask[i] = true;
      changed = true;
    }
  }
  if (!changed || plain.length !== text.length) {
    // If lengths differ (rare characters), fall back to masking on the normalized text.
    if (!changed) return text;
    return plain.replace(/./g, (c, i) => (mask[i] ? '*' : c));
  }
  return [...text].map((c, i) => (mask[i] ? '*' : c)).join('');
}

// Strips control characters and angle brackets, trims, limits length, filters words.
export function sanitize(text, maxLength) {
  const s = String(text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, maxLength);
  return cleanText(s);
}
