import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_MAX_FETCH_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function limitText(value = '', max = 100_000) {
  const text = String(value || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

function privateIPv4(address) {
  const parts = String(address).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127
    || a === 192 && b === 0
    || a === 198 && (b === 18 || b === 19)
    || a >= 224;
}

function privateIPv6(address) {
  const value = String(address).toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) return privateIPv4(value.slice('::ffff:'.length));
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00;
}

function privateAddress(address) {
  const family = isIP(address);
  if (family === 4) return privateIPv4(address);
  if (family === 6) return privateIPv6(address);
  return true;
}

async function assertPublicFetchTarget(url, options = {}) {
  if (options.allowPrivate || options.skipTargetGuard) return;
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Source URL must be http or https');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Private network source fetch is not allowed');
  }
  const resolve = options.lookup || lookup;
  const resolved = isIP(host)
    ? [{ address: host }]
    : await resolve(host, { all: true, verbatim: true });
  const addresses = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
    throw new Error('Private network source fetch is not allowed');
  }
}

function decodeEntities(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripHtml(value = '') {
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '));
}

function sourceTypeForUrl(rawUrl, explicitType = '') {
  const type = String(explicitType || '').trim().toLowerCase();
  if (['twitter', 'article', 'youtube', 'pdf', 'github', 'doc', 'other'].includes(type)) return type;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'twitter';
    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
    if (host === 'github.com') return 'github';
    if (url.pathname.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (url.pathname.toLowerCase().match(/\.(md|txt|org)$/)) return 'doc';
    return 'article';
  } catch {
    return 'other';
  }
}

function titleFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const tail = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname);
    return tail.replace(/[-_]+/g, ' ').trim() || url.hostname;
  } catch {
    return rawUrl;
  }
}

function twitterStatusId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/status\/(\d+)/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function deepString(value, keys) {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const child of Object.values(value)) {
    const found = deepString(child, keys);
    if (found) return found;
  }
  return '';
}

function articleBlockText(data) {
  const blocks = data?.status?.article?.content?.blocks
    || data?.article?.content?.blocks
    || data?.article?.blocks;
  if (!Array.isArray(blocks)) return '';
  return limitText(blocks
    .map((block) => block?.text || block?.content?.text || '')
    .map((text) => String(text).trim())
    .filter(Boolean)
    .join('\n\n'));
}

function includesText(haystack, needle) {
  const normalizedHaystack = String(haystack || '').replace(/\s+/g, ' ').trim();
  const normalizedNeedle = String(needle || '').replace(/\s+/g, ' ').trim();
  return Boolean(normalizedNeedle) && normalizedHaystack.includes(normalizedNeedle);
}

export function twitterSnapshotFromApi(data, input = {}) {
  const articleText = articleBlockText(data);
  const tweetText = deepString(data, ['full_text', 'text', 'description']);
  const fallbackText = deepString(data, ['article_text']);
  const primaryText = articleText || fallbackText || tweetText;
  const title = deepString(data, ['title']) || (primaryText ? primaryText.slice(0, 90) : '');
  const author = deepString(data, ['screen_name', 'name', 'author_name']);
  const metadata = JSON.stringify(data, null, 2);
  const rawText = [
    articleText ? `Article:\n${articleText}` : '',
    tweetText && !includesText(articleText, tweetText) ? `Tweet:\n${tweetText}` : '',
    !articleText && fallbackText && !includesText(tweetText, fallbackText) ? `Article text:\n${fallbackText}` : '',
    metadata ? `Metadata JSON:\n${metadata}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    title,
    author: input.author || author,
    rawText: limitText(rawText || primaryText || metadata),
    summary: input.summary || limitText(primaryText, 700),
  };
}

async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10_000, headers = {} } = options;
  const fetchOptions = { ...options };
  for (const key of ['timeout', 'headers', 'allowPrivate', 'lookup', 'maxBytes', 'maxRedirects', 'skipTargetGuard']) {
    delete fetchOptions[key];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'user-agent': 'gtd-source-fetcher/1.0',
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithValidatedRedirects(rawUrl, options = {}) {
  let currentUrl = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicFetchTarget(currentUrl, options);
    const response = await fetchWithTimeout(currentUrl.href, {
      ...options,
      redirect: 'manual',
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('Source redirect missing Location header');
    if (hop === maxRedirects) throw new Error('Too many redirects while fetching source');
    currentUrl = new URL(location, currentUrl);
  }
  throw new Error('Too many redirects while fetching source');
}

async function readLimitedText(response, maxBytes = DEFAULT_MAX_FETCH_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error(`Response too large (${declaredLength} bytes)`);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`Response too large (${Buffer.byteLength(text, 'utf8')} bytes)`);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Response too large (${bytes} bytes)`);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

export async function fetchSourceSnapshot(input, options = {}) {
  const rawUrl = String(input.url || '').trim();
  const url = new URL(rawUrl);
  const type = sourceTypeForUrl(url.href, input.type);
  const base = {
    ...input,
    url: url.href,
    type,
    title: String(input.title || titleFromUrl(url.href)).trim(),
  };
  if (Object.hasOwn(input, 'status')) base.status = input.status;
  if (input.fetch === false || input.rawText) return base;
  try {
    if (type === 'twitter') {
      const statusId = twitterStatusId(url.href);
      if (statusId) {
        const response = await fetchWithValidatedRedirects(`https://api.fxtwitter.com/2/status/${statusId}`, {
          ...options,
          headers: { ...(options.headers || {}), accept: 'application/json' },
        });
        if (response.ok) {
          const data = await response.json();
          const snapshot = twitterSnapshotFromApi(data, input);
          return {
            ...base,
            title: input.title || snapshot.title || base.title,
            author: snapshot.author,
            rawText: snapshot.rawText,
            summary: snapshot.summary,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    }
    if (type === 'youtube') {
      const response = await fetchWithValidatedRedirects(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, {
        ...options,
        headers: { ...(options.headers || {}), accept: 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        return {
          ...base,
          title: input.title || data.title || base.title,
          author: input.author || data.author_name || '',
          summary: input.summary || 'Video source captured. Transcript is not fetched yet.',
          rawText: input.rawText || '',
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    if (type === 'pdf') {
      return {
        ...base,
        summary: input.summary || 'PDF source captured. Text extraction is not enabled yet.',
        fetchedAt: new Date().toISOString(),
      };
    }
    const response = await fetchWithValidatedRedirects(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const text = await readLimitedText(response, options.maxBytes || DEFAULT_MAX_FETCH_BYTES);
    if (contentType.includes('text/html') || /<html[\s>]/i.test(text)) {
      const title = decodeEntities(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || base.title);
      const rawText = limitText(stripHtml(text));
      return {
        ...base,
        title: input.title || title,
        rawText,
        summary: input.summary || limitText(rawText, 700),
        fetchedAt: new Date().toISOString(),
      };
    }
    const rawText = limitText(text);
    return {
      ...base,
      rawText,
      summary: input.summary || limitText(rawText, 700),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...base,
      summary: input.summary || `Captured URL. Fetch failed: ${error.message}`,
      ...(Object.hasOwn(input, 'rawText') ? { rawText: input.rawText || '' } : {}),
    };
  }
}
