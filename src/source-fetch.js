export function limitText(value = '', max = 100_000) {
  const text = String(value || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 10_000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'gtd-source-fetcher/1.0',
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSourceSnapshot(input) {
  const rawUrl = String(input.url || '').trim();
  const url = new URL(rawUrl);
  const type = sourceTypeForUrl(url.href, input.type);
  const base = {
    ...input,
    url: url.href,
    type,
    title: String(input.title || titleFromUrl(url.href)).trim(),
    status: input.status || 'unread',
  };
  if (input.fetch === false || input.rawText) return base;
  try {
    if (type === 'twitter') {
      const statusId = twitterStatusId(url.href);
      if (statusId) {
        const response = await fetchWithTimeout(`https://api.fxtwitter.com/2/status/${statusId}`, {
          headers: { accept: 'application/json' },
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
      const response = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, {
        headers: { accept: 'application/json' },
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
        rawText: input.rawText || '',
        fetchedAt: new Date().toISOString(),
      };
    }
    const response = await fetchWithTimeout(url.href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
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
      rawText: input.rawText || '',
    };
  }
}
