import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForStatus(url, server) {
  const deadline = Date.now() + 12_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited before readiness with code ${server.exitCode}`);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      return response.status;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Server did not become ready: ${lastError?.message || 'timeout'}`);
}

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

test('server enforces Basic auth when required', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'agentdeck-server-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const currentFile = path.join(tmp, 'current.org');
  const archiveFile = path.join(tmp, 'archive.org');
  const dbFile = path.join(tmp, 'gtd.sqlite');
  await writeFile(currentFile, '* Inbox\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GTD_PORT: String(port),
      GTD_HOST: '127.0.0.1',
      GTD_CURRENT_FILE: currentFile,
      GTD_ARCHIVE_FILE: archiveFile,
      GTD_DB_FILE: dbFile,
      GTD_AUTO_EXPORT: '0',
      GTD_REQUIRE_AUTH: '1',
      GTD_BASIC_USER: 'agent',
      GTD_BASIC_PASSWORD: 'secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });

  try {
    assert.equal(await waitForStatus(`${baseUrl}/api/state`, server), 401);
    const unauthenticated = await fetch(`${baseUrl}/api/state`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate') || '', /Basic realm="AgentDeck"/);

    const authenticated = await fetch(`${baseUrl}/api/state`, {
      headers: { authorization: basic('agent', 'secret') },
    });
    assert.equal(authenticated.status, 200);
    const state = await authenticated.json();
    assert.equal(state.storage.primary, 'sqlite');
  } catch (error) {
    if (output) process.stderr.write(`\n--- server output ---\n${output}--- end server output ---\n`);
    throw error;
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
      setTimeout(resolve, 1_000);
    });
    await rm(tmp, { recursive: true, force: true });
  }
});
