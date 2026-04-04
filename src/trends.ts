import Parser from 'rss-parser';
import { fetchOpenGraphImageUrl } from './media.js';
import { getXClient } from './x-client.js';

export type TrendItem = {
  topic: string;
  source: string;
  score: number;
  url?: string;
  imageUrl?: string;
  summary: string;
  category: 'ai' | 'crypto' | 'web3' | 'tech' | 'general';
  signal: 'trend' | 'market' | 'news' | 'community';
  angleHint: string;
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
  id?: string;
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
  'gamma',
  'claude',
  'claude code',
  'cursor',
  'perplexity',
  'windsurf',
  'copilot',
  'gemini',
  'midjourney',
  'runway',
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

const X_SEARCH_QUERIES = [
  {
    query:
      '(AI OR "artificial intelligence" OR OpenAI OR Anthropic OR Claude OR "Claude Code" OR Gamma OR Cursor OR Perplexity OR Windsurf OR Copilot OR GPT OR LLM OR agents) lang:en -is:retweet',
    category: 'ai' as const,
    angleHint: 'liga o fato com distribuicao, produto ou confianca',
  },
  {
    query:
      '("source code" OR leak OR leaked OR jailbreak OR "prompt leak" OR breach OR outage) (Claude OR OpenAI OR Anthropic OR Cursor OR Perplexity OR Gamma OR Copilot OR AI) lang:en -is:retweet',
    category: 'ai' as const,
    angleHint: 'trata como incidente ou vazamento: explica o que isso muda em confianca, produto e vantagem competitiva',
  },
  {
    query:
      '(launch OR released OR rollout OR pricing OR feature OR agent OR workspace) (Gamma OR Claude OR "Claude Code" OR Cursor OR Perplexity OR Copilot OR OpenAI OR Anthropic) lang:en -is:retweet',
    category: 'ai' as const,
    angleHint: 'olha para produto, distribuicao e quem ganha com esse movimento',
  },
  {
    query:
      '(bitcoin OR ethereum OR solana OR crypto OR ETF OR defi OR onchain) lang:en -is:retweet',
    category: 'crypto' as const,
    angleHint: 'escreve como leitura de mercado, sem parecer boletim',
  },
  {
    query:
      '(web3 OR blockchain OR developers OR startup OR chips OR cloud) lang:en -is:retweet',
    category: 'tech' as const,
    angleHint: 'nao repita a manchete. escreva como se voce tivesse uma leitura propria do fato',
  },
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

const FALLBACK_TOPICS: TrendItem[] = [
  {
    topic: 'Bitcoin price action',
    source: 'Fallback',
    score: 1,
    summary: 'Leitura de mercado sobre Bitcoin quando as fontes do dia vierem fracas.',
    category: 'crypto',
    signal: 'market',
    angleHint: 'escreve como leitura de mercado, sem parecer boletim',
  },
  {
    topic: 'Ethereum ecosystem',
    source: 'Fallback',
    score: 1,
    summary: 'Gancho evergreen sobre Ethereum e infraestrutura.',
    category: 'crypto',
    signal: 'market',
    angleHint: 'nao resuma a manchete. escreva como se voce tivesse uma leitura propria do fato',
  },
  {
    topic: 'AI agents',
    source: 'Fallback',
    score: 1,
    summary: 'Tema recorrente de produto, distribuicao e confianca em IA.',
    category: 'ai',
    signal: 'trend',
    angleHint: 'liga o fato com distribuicao, produto ou confianca',
  },
  {
    topic: 'Web3 development',
    source: 'Fallback',
    score: 1,
    summary: 'Infra e construcao de produto em web3.',
    category: 'web3',
    signal: 'trend',
    angleHint: 'puxa para comportamento de mercado ou da comunidade',
  },
  {
    topic: 'DeFi protocols',
    source: 'Fallback',
    score: 1,
    summary: 'Tema evergreen de protocolos, liquidez e narrativa.',
    category: 'crypto',
    signal: 'market',
    angleHint: 'escreve como leitura de mercado, sem parecer boletim',
  },
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

function extractFeedImageUrl(item: Record<string, unknown>, baseUrl?: string): string | undefined {
  const maybeStrings = [
    (item.enclosure as { url?: string } | undefined)?.url,
    (item.image as { url?: string } | undefined)?.url,
    (item.thumbnail as string | undefined),
    (item['media:thumbnail'] as { $?: { url?: string } } | undefined)?.$?.url,
    (item['media:content'] as { $?: { url?: string } } | undefined)?.$?.url,
  ];

  for (const candidate of maybeStrings) {
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate, baseUrl).toString();
    } catch {
      continue;
    }
  }

  const content = [item.content, item['content:encoded']]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const imageMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);

  if (!imageMatch?.[1]) {
    return undefined;
  }

  try {
    return new URL(imageMatch[1], baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isRelevantTopic(topic: string): boolean {
  const lowered = topic.toLowerCase();
  return (
    NICHE_KEYWORDS.some((keyword) => lowered.includes(keyword)) &&
    !NOISY_PATTERNS.some((pattern) => lowered.includes(pattern))
  );
}

function classifyCategory(text: string): TrendItem['category'] {
  const lowered = text.toLowerCase();
  if (/(bitcoin|ethereum|solana|defi|altcoin|token|crypto|etf|dex)/.test(lowered)) return 'crypto';
  if (/(web3|blockchain|onchain|wallet|layer2|layer 2)/.test(lowered)) return 'web3';
  if (/(ai|openai|gpt|llm|agent|agents|anthropic|model|claude|gamma|cursor|perplexity|windsurf|copilot|gemini|midjourney|runway)/.test(lowered)) return 'ai';
  if (/(tech|developer|startup|software|chip|semiconductor|cloud)/.test(lowered)) return 'tech';
  return 'general';
}

function pickAngleHint(text: string, signal: TrendItem['signal']): string {
  const lowered = text.toLowerCase();
  if (/(leak|leaked|source code|prompt leak|breach|outage|incident|jailbreak|exposed)/.test(lowered)) {
    return 'trata como incidente ou vazamento. explica o impacto em confianca, governanca e moat de produto';
  }
  if (/(gamma|claude|claude code|cursor|perplexity|windsurf|copilot|openai|anthropic|gemini|midjourney|runway)/.test(lowered)) {
    return 'traduz o movimento de produto e mostra o que isso muda em distribuicao, ux, confianca ou moat';
  }
  if (/(raises|funding|launch|ships|debuts|rolls out|release)/.test(lowered)) {
    return 'transforma o fato em leitura de segunda ordem sobre quem ganha com isso';
  }
  if (/(etf|price|surge|falls|rally|volume|market cap|inflows|outflows)/.test(lowered)) {
    return 'escreve como leitura de mercado, sem parecer boletim';
  }
  if (/(hiring|community|reddit|users|adoption)/.test(lowered) || signal === 'community') {
    return 'puxa para comportamento de mercado ou da comunidade';
  }
  if (/(ai|model|agent|llm|openai|anthropic)/.test(lowered)) {
    return 'liga o fato com distribuicao, produto ou confianca';
  }
  return 'nao repita a manchete. escreva como se voce tivesse uma leitura propria do fato';
}

function dedupeAndRank(candidates: TrendItem[], limit = 5): TrendItem[] {
  const merged = new Map<string, TrendItem>();

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
      ...candidate,
      topic: normalized,
    });
  }

  const ranked = [...merged.values()]
    .filter((item) => isRelevantTopic(item.topic))
    .sort((a, b) => {
      const aBoost = a.category === 'ai' ? 3 : a.category === 'tech' ? 1 : 0;
      const bBoost = b.category === 'ai' ? 3 : b.category === 'tech' ? 1 : 0;
      return b.score + bBoost - (a.score + aBoost);
    });

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
  const selected: TrendItem[] = [];

  for (const item of ranked) {
    if (selected.length >= limit) {
      break;
    }

    const used = usedPerSource.get(item.source) ?? 0;
    const sourceLimit = maxPerSource[item.source] ?? 1;

    if (used >= sourceLimit) {
      continue;
    }

    selected.push(item);
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

async function fetchXSignals(): Promise<TrendItem[]> {
  const client = getXClient();
  if (!client) {
    console.warn('X source unavailable, skipping X search signals');
    return [];
  }

  const candidates: TrendItem[] = [];

  for (const config of X_SEARCH_QUERIES) {
    try {
      const response = (await client.v2.search(config.query, {
        max_results: 10,
        'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
        expansions: ['author_id'],
        'user.fields': ['username', 'name', 'verified'],
      })) as unknown as {
        _realData?: {
          data?: Array<{
            id: string;
            text: string;
            author_id?: string;
            public_metrics?: {
              like_count?: number;
              retweet_count?: number;
              reply_count?: number;
              quote_count?: number;
            };
          }>;
          includes?: {
            users?: Array<{
              id: string;
              username?: string;
              name?: string;
              verified?: boolean;
            }>;
          };
        };
      };

      const users = new Map(
        (response._realData?.includes?.users ?? []).map((user) => [user.id, user]),
      );

      for (const post of response._realData?.data ?? []) {
        const metrics = post.public_metrics ?? {};
        const score =
          (metrics.like_count ?? 0) * 1 +
          (metrics.retweet_count ?? 0) * 3 +
          (metrics.reply_count ?? 0) * 4 +
          (metrics.quote_count ?? 0) * 4;

        const author = post.author_id ? users.get(post.author_id) : undefined;
        const topic = normalizeTopic(post.text).slice(0, 180);

        if (!topic || !isRelevantTopic(topic)) {
          continue;
        }

        candidates.push({
          topic,
          source: 'X',
          score: Math.max(6, Math.min(12, Math.round(score / 10) + 6)),
          url: author?.username ? `https://x.com/${author.username}/status/${post.id}` : undefined,
          imageUrl: undefined,
          summary: `Post em alta no X${author?.username ? ` por @${author.username}` : ''} com sinais recentes de engajamento.`,
          category: config.category,
          signal: 'community',
          angleHint: config.angleHint,
        });
      }
    } catch (error) {
      console.error('X search fetch error:', config.query, error);
    }
  }

  return candidates;
}

async function fetchGoogleTrendTopics(): Promise<TrendItem[]> {
  const candidates: TrendItem[] = [];

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
              url: item.link,
              imageUrl: extractFeedImageUrl(item as Record<string, unknown>, item.link),
              summary: 'Sinal de busca subindo agora no Google Trends.',
              category: classifyCategory(item.title),
              signal: 'trend',
              angleHint: pickAngleHint(item.title, 'trend'),
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

async function fetchRedditTopics(): Promise<TrendItem[]> {
  const candidates: TrendItem[] = [];

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
              url: item.link,
              imageUrl: extractFeedImageUrl(item as Record<string, unknown>, item.link),
              summary: item.contentSnippet || 'Discussao de comunidade ganhando tracao no Reddit.',
              category: classifyCategory(item.title),
              signal: 'community',
              angleHint: pickAngleHint(item.title, 'community'),
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

async function fetchNewsTopics(): Promise<TrendItem[]> {
  const candidates: TrendItem[] = [];

  await Promise.all(
    NEWS_RSS_FEEDS.map(async ({ url, source, score }) => {
      try {
        const feed = await parseFeed(url);
        for (const item of feed.items.slice(0, 6)) {
          if (item.title) {
            const baseImageUrl = extractFeedImageUrl(item as Record<string, unknown>, item.link);
            const imageUrl = baseImageUrl || (item.link ? await fetchOpenGraphImageUrl(item.link) : undefined);
            candidates.push({
              topic: item.title,
              source,
              score,
              url: item.link,
              imageUrl,
              summary: item.contentSnippet || `Noticia recente em ${source}.`,
              category: classifyCategory(item.title),
              signal: 'news',
              angleHint: pickAngleHint(item.title, 'news'),
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

async function fetchHackerNewsTopics(): Promise<TrendItem[]> {
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
        url: undefined,
        imageUrl: undefined,
        summary: 'Assunto em destaque na front page do Hacker News.',
        category: classifyCategory(hit.title as string),
        signal: 'community',
        angleHint: pickAngleHint(hit.title as string, 'community'),
      }));
  } catch (error) {
    console.error('Hacker News fetch error:', error);
    return [];
  }
}

async function fetchCoinGeckoTopics(): Promise<TrendItem[]> {
  const candidates: TrendItem[] = [];

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
        url: `https://www.coingecko.com/en/coins/${item.name.toLowerCase().replace(/\s+/g, '-')}`,
        imageUrl: undefined,
        summary: `${item.name} apareceu entre os ativos em alta observacao na CoinGecko.`,
        category: classifyCategory(item.name),
        signal: 'market',
        angleHint: pickAngleHint(item.name, 'market'),
      });

      if (item.market_cap_rank && item.market_cap_rank <= 200) {
        candidates.push({
          topic: `${item.name} market cap rank spotlight`,
          source: 'CoinGecko',
          score: 6,
          url: `https://www.coingecko.com/en/coins/${item.name.toLowerCase().replace(/\s+/g, '-')}`,
          imageUrl: undefined,
          summary: `${item.name} ganhou destaque de ranking e pode puxar narrativa de mercado.`,
          category: classifyCategory(item.name),
          signal: 'market',
          angleHint: pickAngleHint(item.name, 'market'),
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
        url: `https://www.coingecko.com/en/coins/${coin.id ?? coin.name.toLowerCase().replace(/\s+/g, '-')}`,
        imageUrl: undefined,
        summary: `${coin.name} mexeu ${change}% nas ultimas 24h e entrou no radar de movers.`,
        category: classifyCategory(coin.name),
        signal: 'market',
        angleHint: pickAngleHint(`${coin.name} ${change}%`, 'market'),
      });
    }
  } catch (error) {
    console.error('CoinGecko movers fetch error:', error);
  }

  return candidates;
}

export async function fetchTrends(): Promise<TrendItem[]> {
  const candidateGroups = await Promise.all([
    fetchXSignals(),
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
    selectedTopics: result.map((item) => item.topic),
  });

  return result;
}
