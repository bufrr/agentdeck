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
    });
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
