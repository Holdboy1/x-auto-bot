const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type RemoteImage = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
};

function normalizeImageUrl(candidate: string | undefined, baseUrl?: string): string | undefined {
  if (!candidate) {
    return undefined;
  }

  const decoded = candidate.replace(/&amp;/gi, '&').trim();

  try {
    if (decoded.startsWith('//')) {
      return `https:${decoded}`;
    }

    if (baseUrl) {
      return new URL(decoded, baseUrl).toString();
    }

    return new URL(decoded).toString();
  } catch {
    return undefined;
  }
}

export function extractOpenGraphImageUrl(html: string, pageUrl: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const imageUrl = normalizeImageUrl(match?.[1], pageUrl);
    if (imageUrl) {
      return imageUrl;
    }
  }

  return undefined;
}

export async function fetchOpenGraphImageUrl(pageUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'x-auto-bot/1.0 (+https://railway.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return undefined;
    }

    const html = await response.text();
    return extractOpenGraphImageUrl(html, response.url || pageUrl);
  } catch {
    return undefined;
  }
}

export async function fetchRemoteImage(imageUrl: string): Promise<RemoteImage | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'x-auto-bot/1.0 (+https://railway.app)',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_MIME_TYPES.has(contentType)) {
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      return null;
    }

    return {
      buffer,
      mimeType: contentType as RemoteImage['mimeType'],
    };
  } catch {
    return null;
  }
}
