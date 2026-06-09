import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSourceSnapshot, twitterSnapshotFromApi } from '../src/source-fetch.js';

const twitterArticleFixture = {
  status: {
    text: 'TLDR: short tweet preview.',
    author: {
      screen_name: 'raikucom',
      name: 'Raiku',
    },
    article: {
      title: 'Solana glow-up explained',
      content: {
        blocks: [
          { text: 'TLDR: short article intro.' },
          { text: 'Full section one with implementation detail that should be backed up.' },
          { text: 'Full section two with more article content beyond the preview.' },
        ],
      },
    },
  },
};

test('twitterSnapshotFromApi stores complete Twitter article content as raw backup', () => {
  const snapshot = twitterSnapshotFromApi(twitterArticleFixture);

  assert.equal(snapshot.title, 'Solana glow-up explained');
  assert.equal(snapshot.author, 'raikucom');
  assert.match(snapshot.summary, /TLDR: short article intro/);
  assert.match(snapshot.rawText, /Article:/);
  assert.match(snapshot.rawText, /Full section one with implementation detail/);
  assert.match(snapshot.rawText, /Full section two with more article content/);
  assert.match(snapshot.rawText, /Metadata JSON:/);
  assert.ok(snapshot.rawText.length > snapshot.summary.length);
});

test('fetchSourceSnapshot prefers FXTwitter article blocks over tweet preview', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://api.fxtwitter.com/2/status/123');
    return {
      ok: true,
      async json() {
        return twitterArticleFixture;
      },
    };
  };
  try {
    const snapshot = await fetchSourceSnapshot({
      url: 'https://x.com/raikucom/status/123',
      type: 'twitter',
    }, { skipTargetGuard: true });
    assert.equal(snapshot.type, 'twitter');
    assert.equal(snapshot.title, 'Solana glow-up explained');
    assert.match(snapshot.summary, /TLDR: short article intro/);
    assert.match(snapshot.rawText, /Full section one with implementation detail/);
    assert.match(snapshot.rawText, /Full section two with more article content/);
    assert.match(snapshot.rawText, /\"text\": \"TLDR: short tweet preview/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSourceSnapshot blocks private network targets by default', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('private network fetch should not be attempted');
  };
  try {
    const snapshot = await fetchSourceSnapshot({
      url: 'http://127.0.0.1/private',
      type: 'article',
    });
    assert.match(snapshot.summary, /Private network source fetch is not allowed/);
    assert.equal(snapshot.rawText, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSourceSnapshot rejects redirects to private network targets', async () => {
  const originalFetch = globalThis.fetch;
  const fetches = [];
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    assert.equal(String(url), 'https://public.test/start');
    return {
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://127.0.0.1/private' }),
    };
  };
  try {
    const snapshot = await fetchSourceSnapshot({
      url: 'https://public.test/start',
      type: 'article',
    }, {
      lookup: async () => [{ address: '93.184.216.34' }],
    });
    assert.match(snapshot.summary, /Private network source fetch is not allowed/);
    assert.equal(fetches.length, 1);
    assert.equal(snapshot.rawText, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSourceSnapshot rejects oversized responses before reading body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' ? '32' : 'text/plain';
      },
    },
    async text() {
      throw new Error('oversized body should not be read');
    },
  });
  try {
    const snapshot = await fetchSourceSnapshot({
      url: 'https://example.com/large',
      type: 'article',
    }, { allowPrivate: true, maxBytes: 8 });
    assert.match(snapshot.summary, /Response too large/);
    assert.equal(snapshot.rawText, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
