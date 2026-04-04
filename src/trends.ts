import Parser from 'rss-parser';

type TrendCandidate = {
  topic: string;
  source: string;
  score: number;
};

type HackerNewsHit = {
  title?: string;
};

type CoinGeckoTrendingResponse = {
  coins?: Array<{
    item?: {
      name?: string;
      symbol?: string;
      market_cap_rank?: number;
    };
  }>;
};

type CoinGeckoMarketCoin = {
  name?: string;
  symbol?: string;
  price_change_percentage_24h?: number;
};

const parser = new Parser();

const DEFAULT_HEADERS = {
  'User-Agent': 'x-auto-bot/1.0 (+https://railway.app)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
};

const NICHE_KEYWORDS = [
  'crypto',
  'bitcoin',
  'ethereum',
  'web3',
  'ai',
  'tech',
  'nft',
  'blockchain',
  'defi',
  'solana',
  'token',
  'gpt',
  'openai',
  'startup',
  'coding',
  'developer',
  'llm',
  'altcoin',
  'layer 2',
  'layer2',
  'agent',
  'agents',
];

const GOOGLE_TRENDS_FEEDS = [
  'https://trends.google.com/trending/rss?geo=US&hl=en',
  'https://trends.google.com/trending/rss?geo=BR',
];

const REDDIT_RSS_FEEDS = [
  'https://www.reddit.com/r/CryptoCurrency/hot/.rss',
  'https://www.reddit.com/r/web3/hot/.rss',
  'https://www.reddit.com/r/technology/hot/.rss',
];

const NEWS_RSS_FEEDS = [
  { url: 'https://cryptopanic.com/news/feed/', source: 'CryptoPanic', score: 7 },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', score: 6 },
  { url: 'https://techcrunch.com/feed/', source: 'TechCrunch', score: 5 },
];

const FALLBACK_TOPICS = [
  'Bitcoin price action',
  'Ethereum ecosystem',
  'AI agents',
  'Web3 development',
  'DeFi protocols',
];

const NOISY_PATTERNS = [
  'megathread',
  'daily discussion',
  'weekly discussion',
  'discussion',
  'crypto discussion',
  'jobs',
  'career',
  'hiring',
  'looking for work',
];

function normalizeTopic(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/[|•]+/g, ' ')
    .replace(/\s+-\s+Reddit$/i, '')
    .replace(/\s+-\s+TechCrunch$/i, '')
    .trim();
}

function isRelevantTopic(topic: string): boolean {
  const lowered = topic.toLowerCase();
  return (
    NICHE_KEYWORDS.some((keyword) => lowered.includes(keyword)) &&
    !NOISY_PATTERNS.some((pattern) => lowered.includes(pattern))
  );
}

function dedupeAndRank(candidates: TrendCandidate[], limit = 5): string[] {
  const merged = new Map<string, TrendCandidate>();

  for (const candidate of candidates) {
    const normalized = normalizeTopic(candidate.topic);
    if (!normalized) {
      continue;
    }

    const existing = merged.get(normalized.toLowerCase());
    if (existing) {
      existing.score += candidate.score;
      continue;
    }

    merged.set(normalized.toLowerCase(), {
      topic: normalized,
      source: candidate.source,
      score: candidate.score,
    });
  }

  const ranked = [...merged.values()]
    .filter((item) => isRelevantTopic(item.topic))
    .sort((a, b) => b.score - a.score);

  const maxPerSource: Record<string, number> = {
    CoinGecko: 2,
    'Google Trends': 2,
    Reddit: 2,
    'Hacker News': 1,
    CryptoPanic: 2,
    CoinDesk: 2,
    TechCrunch: 2,
  };

  const usedPerSource = new Map<string, number>();
  const selected: string[] = [];

  for (const item of ranked) {
    if (selected.length >= limit) {
      break;
    }

    const used = usedPerSource.get(item.source) ?? 0;
    const sourceLimit = maxPerSource[item.source] ?? 1;

    if (used >= sourceLimit) {
      continue;
    }

    selected.push(item.topic);
    usedPerSource.set(item.source, used + 1);
  }

  return selected;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function parseFeed(url: string) {
  const xml = await fetchText(url);
  return parser.parseString(xml);
}

async function fetchGoogleTrendTopics(): Promise<TrendCandidate[]> {
  const candidates: TrendCandidate[] = [];

  await Promise.all(
    GOOGLE_TRENDS_FEEDS.map(async (url) => {
      try {
        const feed = await parseFeed(url);
        for (const item of feed.items.slice(0, 8)) {
          if (item.title) {
            candidates.push({
              topic: item.title,
              source: 'Google Trends',
              score: 7,
            });
          }
        }
      } catch (error) {
        console.error('Google Trends fetch error:', url, error);
      }
    }),
  );

  return candidates;
}

async function fetchRedditTopics(): Promise<TrendCandidate[]> {
  const candidates: TrendCandidate[] = [];

  await Promise.all(
    REDDIT_RSS_FEEDS.map(async (url) => {
      try {
        const feed = await parseFeed(url);
        for (const item of feed.items.slice(0, 5)) {
          if (item.title) {
            candidates.push({
              topic: item.title,
              source: 'Reddit',
              score: 5,
            });
          }
        }
      } catch (error) {
        console.error('Reddit RSS fetch error:', url, error);
      }
    }),
  );

  return candidates;
}

async function fetchNewsTopics(): Promise<TrendCandidate[]> {
  const candidates: TrendCandidate[] = [];

  await Promise.all(
    NEWS_RSS_FEEDS.map(async ({ url, source, score }) => {
      try {
        const feed = await parseFeed(url);
        for (const item of feed.items.slice(0, 6)) {
          if (item.title) {
            candidates.push({
              topic: item.title,
              source,
              score,
            });
          }
        }
      } catch (error) {
        if (url.includes('cryptopanic')) {
          console.warn('CryptoPanic RSS unavailable, continuing without it');
        } else {
          console.error('News RSS fetch error:', url, error);
        }
      }
    }),
  );

  return candidates;
}

async function fetchHackerNewsTopics(): Promise<TrendCandidate[]> {
  try {
    const data = await fetchJson<{ hits?: HackerNewsHit[] }>(
      'https://hn.algolia.com/api/v1/search?tags=front_page',
    );

    return (data.hits ?? [])
      .slice(0, 10)
      .filter((hit) => hit.title && isRelevantTopic(hit.title))
      .map((hit) => ({
        topic: hit.title as string,
        source: 'Hacker News',
        score: 4,
      }));
  } catch (error) {
    console.error('Hacker News fetch error:', error);
    return [];
  }
}

async function fetchCoinGeckoTopics(): Promise<TrendCandidate[]> {
  const candidates: TrendCandidate[] = [];

  try {
    const trending = await fetchJson<CoinGeckoTrendingResponse>(
      'https://api.coingecko.com/api/v3/search/trending',
    );

    for (const coin of trending.coins ?? []) {
      const item = coin.item;
      if (!item?.name || !item.symbol) {
        continue;
      }

      candidates.push({
        topic: `${item.name} (${item.symbol.toUpperCase()}) trending on CoinGecko`,
        source: 'CoinGecko',
        score: 9,
      });

      if (item.market_cap_rank && item.market_cap_rank <= 200) {
        candidates.push({
          topic: `${item.name} market cap rank spotlight`,
          source: 'CoinGecko',
          score: 6,
        });
      }
    }
  } catch (error) {
    console.error('CoinGecko trending fetch error:', error);
  }

  try {
    const movers = await fetchJson<CoinGeckoMarketCoin[]>(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h',
    );

    for (const coin of movers.slice(0, 10)) {
      if (!coin.name || !coin.symbol) {
        continue;
      }

      const change = typeof coin.price_change_percentage_24h === 'number'
        ? coin.price_change_percentage_24h.toFixed(1)
        : '0.0';

      candidates.push({
        topic: `${coin.name} (${coin.symbol.toUpperCase()}) 24h move ${change}%`,
        source: 'CoinGecko',
        score: 7,
      });
    }
  } catch (error) {
    console.error('CoinGecko movers fetch error:', error);
  }

  return candidates;
}

export async function fetchTrends(): Promise<string[]> {
  const candidateGroups = await Promise.all([
    fetchGoogleTrendTopics(),
    fetchRedditTopics(),
    fetchHackerNewsTopics(),
    fetchCoinGeckoTopics(),
    fetchNewsTopics(),
  ]);

  const candidates = candidateGroups.flat();
  const rankedTopics = dedupeAndRank(candidates, 5);
  const result = rankedTopics.length >= 3 ? rankedTopics : FALLBACK_TOPICS;

  console.log('Trend sources gathered:', {
    totalCandidates: candidates.length,
    selectedTopics: result,
  });

  return result;
}
