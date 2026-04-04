const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'ao',
  'as',
  'at',
  'com',
  'como',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'for',
  'is',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'of',
  'on',
  'or',
  'os',
  'para',
  'por',
  'pra',
  'que',
  'the',
  'to',
  'um',
  'uma',
]);

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTopicFingerprint(...parts: Array<string | undefined>): string {
  const tokens = parts
    .flatMap((part) => normalizeText(part || '').split(' '))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

  return [...new Set(tokens)].sort().slice(0, 8).join(' ');
}

export function buildUrlFingerprint(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return undefined;
  }
}

export function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(buildTopicFingerprint(left).split(' ').filter(Boolean));
  const rightTokens = new Set(buildTopicFingerprint(right).split(' ').filter(Boolean));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
}
