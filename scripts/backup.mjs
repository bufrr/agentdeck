import { access, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expandHome } from '../src/org.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP_PREFIX = 'agentdeck-';
const BACKUP_RE = /^agentdeck-\d{8}T\d{6}Z(?:-\d{3})?$/;

function dateStamp(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function uniqueBackupPath(backupDir, stamp) {
  let candidate = path.join(backupDir, `${BACKUP_PREFIX}${stamp}`);
  if (!await exists(candidate)) return candidate;
  for (let index = 1; index < 1000; index += 1) {
    candidate = path.join(backupDir, `${BACKUP_PREFIX}${stamp}-${String(index).padStart(3, '0')}`);
    if (!await exists(candidate)) return candidate;
  }
  throw new Error(`Could not create unique backup path for ${stamp}`);
}

async function copyIfExists(source, target, copied) {
  if (!source || !await exists(source)) return;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  copied.push({ source, file: path.basename(target) });
}

function vacuumInto(sourceDb, targetDb) {
  const db = new DatabaseSync(sourceDb);
  try {
    db.exec(`VACUUM INTO ${sqlString(targetDb)}`);
  } finally {
    db.close();
  }
}

async function pruneBackups(backupDir, keep) {
  if (!Number.isInteger(keep) || keep < 1) return [];
  if (!await exists(backupDir)) return [];
  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP_RE.test(entry.name)) continue;
    const fullPath = path.join(backupDir, entry.name);
    // Only count completed backups (manifest.json is written last) toward the
    // retention window, so a partial/failed directory cannot evict good backups.
    if (!await exists(path.join(fullPath, 'manifest.json'))) continue;
    const info = await stat(fullPath);
    backups.push({ name: entry.name, path: fullPath, mtimeMs: info.mtimeMs });
  }
  backups.sort((a, b) => b.name.localeCompare(a.name) || b.mtimeMs - a.mtimeMs);
  const deleted = [];
  for (const backup of backups.slice(keep)) {
    await rm(backup.path, { recursive: true, force: true });
    deleted.push(backup.path);
  }
  return deleted;
}

export async function createBackup(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const backupDir = path.resolve(expandHome(options.backupDir || process.env.GTD_BACKUP_DIR || path.join(rootDir, 'data/backups')));
  const dbFile = path.resolve(expandHome(options.dbFile || process.env.GTD_DB_FILE || path.join(rootDir, 'data/gtd.sqlite')));
  const exportFile = path.resolve(expandHome(options.exportFile || process.env.GTD_EXPORT_FILE || '~/org/gtd/agentdeck-export.org'));
  const currentFile = path.resolve(expandHome(options.currentFile || process.env.GTD_CURRENT_FILE || '~/org/gtd/current.org'));
  const archiveFile = path.resolve(expandHome(options.archiveFile || process.env.GTD_ARCHIVE_FILE || '~/org/gtd/archive.org'));
  const passwordFile = path.resolve(expandHome(options.passwordFile || process.env.GTD_BASIC_PASSWORD_FILE || path.join(rootDir, 'data/basic-password')));
  const keep = Number(options.keep || process.env.GTD_BACKUP_KEEP || 30);
  const stamp = dateStamp(options.now || new Date());

  if (!await exists(dbFile)) throw new Error(`SQLite database does not exist: ${dbFile}`);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = await uniqueBackupPath(backupDir, stamp);

  // Build the backup in a side directory and only rename it into its final
  // name once it is complete, so a failure mid-backup never leaves a partial
  // directory behind (which retention would otherwise count and let evict
  // healthy backups).
  const incomingPath = path.join(backupDir, `.incoming-${path.basename(backupPath)}`);
  await rm(incomingPath, { recursive: true, force: true });
  await mkdir(incomingPath, { recursive: true, mode: 0o700 });

  const copied = [];
  try {
    const dbTarget = path.join(incomingPath, 'gtd.sqlite');
    vacuumInto(dbFile, dbTarget);
    copied.push({ source: dbFile, file: 'gtd.sqlite' });
    await copyIfExists(exportFile, path.join(incomingPath, 'agentdeck-export.org'), copied);
    await copyIfExists(currentFile, path.join(incomingPath, 'current.org'), copied);
    await copyIfExists(archiveFile, path.join(incomingPath, 'archive.org'), copied);
    await copyIfExists(passwordFile, path.join(incomingPath, 'basic-password'), copied);

    const manifest = {
      createdAt: new Date(options.now || Date.now()).toISOString(),
      backupPath,
      files: copied,
      retention: { keep },
    };
    await writeFile(path.join(incomingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(incomingPath, backupPath);
  } catch (error) {
    await rm(incomingPath, { recursive: true, force: true });
    throw error;
  }

  const deleted = await pruneBackups(backupDir, keep);
  return { ok: true, backupPath, files: copied, deleted };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  createBackup()
    .then((result) => {
      console.log(`Backup created: ${result.backupPath}`);
      console.log(`Files: ${result.files.map((file) => file.file).join(', ')}`);
      if (result.deleted.length) console.log(`Pruned: ${result.deleted.length}`);
    })
    .catch((error) => {
      console.error(`Backup failed: ${error.message}`);
      process.exitCode = 1;
    });
}
