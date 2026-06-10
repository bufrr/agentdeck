import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
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

async function startServer({ env = {}, currentFile: seed = '* Inbox\n' } = {}) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'agentdeck-server-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const currentFile = path.join(tmp, 'current.org');
  const archiveFile = path.join(tmp, 'archive.org');
  const dbFile = path.join(tmp, 'gtd.sqlite');
  await writeFile(currentFile, seed, 'utf8');
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
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });

  const stop = async () => {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
      setTimeout(resolve, 1_000);
    });
    await rm(tmp, { recursive: true, force: true });
  };

  return { server, baseUrl, tmp, port, getOutput: () => output, stop };
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

test('server hides raw API error details from clients', async () => {
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });

  try {
    assert.equal(await waitForStatus(`${baseUrl}/api/state`, server), 200);
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { ok: false, error: 'Invalid request' });
    assert.doesNotMatch(JSON.stringify(body), /Task title is required|gtd\.sqlite|\/tmp\//);
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

test('server survives a malformed Host header (no pre-auth crash)', async () => {
  const ctx = await startServer({
    env: {
      GTD_REQUIRE_AUTH: '1',
      GTD_BASIC_USER: 'agent',
      GTD_BASIC_PASSWORD: 'secret',
    },
  });
  const { server, baseUrl, port } = ctx;
  try {
    assert.equal(await waitForStatus(`${baseUrl}/api/state`, server), 401);

    const rawResponse = await new Promise((resolve, reject) => {
      const socket = netConnect(port, '127.0.0.1', () => {
        socket.write('GET /api/state HTTP/1.1\r\nHost: foo bar\r\nConnection: close\r\n\r\n');
      });
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => { buffer += chunk; });
      socket.on('end', () => resolve(buffer));
      socket.on('error', reject);
      setTimeout(() => resolve(buffer), 2_000);
    });
    // Defense in depth: the malformed request gets the normal 400 path, not a reset.
    assert.match(rawResponse, /HTTP\/1\.1 400/);

    // The process must still be alive and serving after the bad request.
    assert.equal(server.exitCode, null, 'server process should still be running');
    const authenticated = await fetch(`${baseUrl}/api/state`, {
      headers: { authorization: basic('agent', 'secret') },
    });
    assert.equal(authenticated.status, 200);
  } catch (error) {
    const output = ctx.getOutput();
    if (output) process.stderr.write(`\n--- server output ---\n${output}--- end server output ---\n`);
    throw error;
  } finally {
    await ctx.stop();
  }
});
