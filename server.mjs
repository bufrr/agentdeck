import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGtdStore } from './src/db.js';
import { expandHome } from './src/org.js';
import { fetchSourceSnapshot } from './src/source-fetch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.GTD_PORT || 8787);
const HOST = process.env.GTD_HOST || '127.0.0.1';

const config = {
  currentFile: process.env.GTD_CURRENT_FILE || '~/org/gtd/current.org',
  archiveFile: process.env.GTD_ARCHIVE_FILE || '~/org/gtd/archive.org',
  dbFile: process.env.GTD_DB_FILE || path.join(__dirname, 'data/gtd.sqlite'),
  exportFile: process.env.GTD_EXPORT_FILE || '~/org/gtd/agentdeck-export.org',
  autoExport: process.env.GTD_AUTO_EXPORT !== '0',
  allowPrivateFetch: process.env.GTD_ALLOW_PRIVATE_FETCH === '1',
  days: Number(process.env.GTD_REVIEW_DAYS || 7),
  staleDays: Number(process.env.GTD_STALE_DAYS || 14),
};

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readOrCreatePasswordFile(file) {
  const target = expandHome(file);
  if (existsSync(target)) return readFileSync(target, 'utf8').trim();
  mkdirSync(path.dirname(target), { recursive: true });
  const password = randomBytes(24).toString('base64url');
  writeFileSync(target, `${password}\n`, { mode: 0o600 });
  try {
    chmodSync(target, 0o600);
  } catch {
    // Best effort; the initial write mode is the important protection.
  }
  return password;
}

function loadAuthConfig() {
  const required = truthy(process.env.GTD_REQUIRE_AUTH);
  const user = process.env.GTD_BASIC_USER || 'agentdeck';
  const password = process.env.GTD_BASIC_PASSWORD
    || (process.env.GTD_BASIC_PASSWORD_FILE ? readOrCreatePasswordFile(process.env.GTD_BASIC_PASSWORD_FILE) : '');
  if (required && !password) {
    throw new Error('GTD_REQUIRE_AUTH=1 requires GTD_BASIC_PASSWORD or GTD_BASIC_PASSWORD_FILE');
  }
  return { required, user, password };
}

const auth = loadAuthConfig();
const store = await createGtdStore(config);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuth(header = '') {
  const match = String(header).match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(req) {
  if (!auth.required) return true;
  const credentials = parseBasicAuth(req.headers.authorization);
  return Boolean(credentials)
    && safeEqual(credentials.user, auth.user)
    && safeEqual(credentials.password, auth.password);
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'www-authenticate': 'Basic realm="AgentDeck", charset="UTF-8"',
    'cache-control': 'no-store',
  });
  res.end('Authentication required');
}

function logServerError(context, error) {
  console.error(`${context}: ${error?.stack || error?.message || error}`);
}

function publicErrorFor(error) {
  const message = String(error?.message || '');
  if (/not found/i.test(message)) return { status: 404, error: 'Not found' };
  if (/required|invalid|unsupported|too large|must be|refusing|cannot find/i.test(message)) {
    return { status: 400, error: 'Invalid request' };
  }
  return { status: 500, error: 'Internal server error' };
}

async function withAutoExport(result) {
  if (!config.autoExport) return result;
  try {
    return { ...result, export: await store.writeOrgExport() };
  } catch (error) {
    logServerError('Auto-export failed', error);
    return { ...result, export: { ok: false, error: 'Export failed' } };
  }
}

async function sendMutationJson(res, status, result) {
  sendJson(res, status, await withAutoExport(result));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let target = pathname === '/' ? '/index.html' : pathname;
  target = decodeURIComponent(target);
  const file = path.normalize(path.join(PUBLIC_DIR, target));
  if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    await readFile(file);
    res.writeHead(200, {
      'content-type': MIME.get(path.extname(file)) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function route(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (!isAuthorized(req)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, store.readState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      const body = await readBody(req);
      const result = store.addTask(body);
      await sendMutationJson(res, 201, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sources') {
      const body = await readBody(req);
      const result = store.addSource(await fetchSourceSnapshot(body, { allowPrivate: config.allowPrivateFetch }));
      sendJson(res, 201, result);
      return;
    }

    const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
    if (req.method === 'PATCH' && sourceMatch) {
      const body = await readBody(req);
      sendJson(res, 200, store.updateSource(sourceMatch[1], body));
      return;
    }

    if (req.method === 'DELETE' && sourceMatch) {
      sendJson(res, 200, store.deleteSource(sourceMatch[1]));
      return;
    }

    const sourceTaskMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/tasks$/);
    if (req.method === 'POST' && sourceTaskMatch) {
      const body = await readBody(req);
      await sendMutationJson(res, 201, store.createTaskFromSource(sourceTaskMatch[1], body));
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/api/tasks/reorder') {
      const body = await readBody(req);
      await sendMutationJson(res, 200, store.reorderTasks(body.ids));
      return;
    }

    const updateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === 'PATCH' && updateMatch) {
      const body = await readBody(req);
      await sendMutationJson(res, 200, store.updateTask(updateMatch[1], body));
      return;
    }

    if (req.method === 'DELETE' && updateMatch) {
      await sendMutationJson(res, 200, store.deleteTask(updateMatch[1]));
      return;
    }

    const stateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/state$/);
    if (req.method === 'PATCH' && stateMatch) {
      const body = await readBody(req);
      const result = store.updateTaskState(stateMatch[1], body.todo);
      await sendMutationJson(res, 200, result);
      return;
    }

    const focusMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/focus$/);
    if (req.method === 'PATCH' && focusMatch) {
      const body = await readBody(req);
      await sendMutationJson(res, 200, store.setTaskFocus(focusMatch[1], body.focus));
      return;
    }

    const logbookMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/logbook$/);
    if (req.method === 'POST' && logbookMatch) {
      await sendMutationJson(res, 200, store.moveToLogbook(logbookMatch[1]));
      return;
    }

    const copyMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/copy$/);
    if (req.method === 'POST' && copyMatch) {
      await sendMutationJson(res, 200, store.copyTask(copyMatch[1]));
      return;
    }

    const convertProjectMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/convert\/project$/);
    if (req.method === 'POST' && convertProjectMatch) {
      await sendMutationJson(res, 200, store.convertToProject(convertProjectMatch[1]));
      return;
    }

    const trashMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/trash$/);
    if (req.method === 'POST' && trashMatch) {
      await sendMutationJson(res, 200, store.moveToTrash(trashMatch[1]));
      return;
    }

    const restoreMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/restore$/);
    if (req.method === 'POST' && restoreMatch) {
      await sendMutationJson(res, 200, store.restoreTask(restoreMatch[1]));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/export/org') {
      const text = store.exportOrgText();
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(text),
      });
      res.end(text);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/export/org') {
      sendJson(res, 200, await store.writeOrgExport());
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    logServerError(`${req.method} ${url?.pathname ?? req.url} failed`, error);
    const response = publicErrorFor(error);
    sendJson(res, response.status, { ok: false, error: response.error });
  }
}

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    logServerError('route', error);
    try {
      sendJson(res, 400, { ok: false, error: 'Invalid request' });
    } catch {
      // Response may already be sent; nothing more we can safely do.
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`AgentDeck app: http://${HOST}:${PORT}`);
  console.log(`SQLite DB: ${store.dbFile}`);
  console.log(`Org seed: ${expandHome(config.currentFile)}`);
  console.log(`Org export: ${store.exportFile}${config.autoExport ? ' (auto)' : ''}`);
  if (auth.required) console.log(`Auth: basic (${auth.user})`);
});
