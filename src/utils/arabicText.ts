// Arabic diacritics (tashkeel) Unicode range + tatweel
const DIACRITICS = /[ؐ-ًؚ-ٰٟ]/g;
const TATWEEL = /ـ/g;

export function stripDiacritics(text: string): string {
  return text.replace(DIACRITICS, '').replace(TATWEEL, '');
}

// Normalize letter variations so minor pronunciation differences still match
export function normalizeArabic(text: string): string {
  return stripDiacritics(text)
    .replace(/[أإآٱ]/g, 'ا') // alef variants
    .replace(/ة/g, 'ه')      // ta marbuta
    .replace(/ى/g, 'ي')      // alef maqsura
    .trim();
}

// Compare expected Quranic word against what was recognized
// Takes only the first recognized word to handle when recognition captures extra words
export function wordsMatch(expected: string, recognized: string): boolean {
  if (!recognized.trim()) return false;
  const e = normalizeArabic(expected);
  const r = normalizeArabic(recognized.split(/\s+/)[0]);
  return e === r;
}
