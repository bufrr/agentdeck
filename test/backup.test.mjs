import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup } from '../scripts/backup.mjs';

test('createBackup snapshots SQLite and companion files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-backup-'));
  const dbFile = path.join(dir, 'gtd.sqlite');
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const exportFile = path.join(dir, 'agentdeck-export.org');
  const passwordFile = path.join(dir, 'basic-password');
  const backupDir = path.join(dir, 'backups');

  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL);
    INSERT INTO tasks(id, title) VALUES('task-1', 'Backup Me');
  `);
  db.close();
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '* Archive\n', 'utf8');
  await writeFile(exportFile, '* Export\n', 'utf8');
  await writeFile(passwordFile, 'secret\n', 'utf8');

  const result = await createBackup({
    rootDir: dir,
    dbFile,
    currentFile,
    archiveFile,
    exportFile,
    passwordFile,
    backupDir,
    now: new Date('2026-06-09T04:30:00Z'),
    keep: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(path.basename(result.backupPath), 'agentdeck-20260609T043000Z');
  assert.deepEqual(result.files.map((file) => file.file).sort(), [
    'agentdeck-export.org',
    'archive.org',
    'basic-password',
    'current.org',
    'gtd.sqlite',
  ]);
  const backupDb = new DatabaseSync(path.join(result.backupPath, 'gtd.sqlite'), { readOnly: true });
  assert.equal(backupDb.prepare('SELECT title FROM tasks WHERE id = ?').get('task-1').title, 'Backup Me');
  backupDb.close();
  assert.equal(await readFile(path.join(result.backupPath, 'current.org'), 'utf8'), '* Work\n');
  const manifest = JSON.parse(await readFile(path.join(result.backupPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.some((file) => file.file === 'gtd.sqlite'), true);
});

test('createBackup prunes only AgentDeck timestamped backup directories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-backup-'));
  const dbFile = path.join(dir, 'gtd.sqlite');
  const backupDir = path.join(dir, 'backups');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY)');
  db.close();
  for (const name of ['agentdeck-20260601T000000Z', 'agentdeck-20260602T000000Z']) {
    await mkdir(path.join(backupDir, name), { recursive: true });
    await writeFile(path.join(backupDir, name, 'manifest.json'), '{}\n', 'utf8');
  }
  await mkdir(path.join(backupDir, 'manual-keep'), { recursive: true });

  const result = await createBackup({
    rootDir: dir,
    dbFile,
    backupDir,
    now: new Date('2026-06-03T00:00:00Z'),
    keep: 2,
  });

  assert.equal(result.deleted.length, 1);
  assert.equal(path.basename(result.deleted[0]), 'agentdeck-20260601T000000Z');
  assert.equal(path.basename(result.backupPath), 'agentdeck-20260603T000000Z');
  assert.equal((await stat(path.join(backupDir, 'manual-keep'))).isDirectory(), true);
});

test('createBackup leaves no partial directory when it fails mid-backup', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-backup-'));
  const dbFile = path.join(dir, 'gtd.sqlite');
  const backupDir = path.join(dir, 'backups');
  // Exists but is not a valid SQLite database, so VACUUM INTO throws after the
  // backup directory has been created.
  await writeFile(dbFile, 'not a sqlite database', 'utf8');

  await assert.rejects(createBackup({
    rootDir: dir,
    dbFile,
    backupDir,
    currentFile: path.join(dir, 'current.org'),
    archiveFile: path.join(dir, 'archive.org'),
    exportFile: path.join(dir, 'agentdeck-export.org'),
    passwordFile: path.join(dir, 'basic-password'),
    now: new Date('2026-06-10T10:00:00Z'),
    keep: 5,
  }));

  const entries = await readdir(backupDir);
  const stray = entries.filter((name) => name.startsWith('agentdeck-') || name.startsWith('.incoming'));
  assert.deepEqual(stray, [], `no partial backup directory should remain, found: ${entries.join(', ')}`);
});

test('createBackup pruning ignores partial (manifest-less) backup directories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-backup-'));
  const dbFile = path.join(dir, 'gtd.sqlite');
  const backupDir = path.join(dir, 'backups');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY)');
  db.close();
  // Two completed backups (manifest present) plus one partial directory whose
  // name sorts newest. If the partial counted toward `keep`, the middle
  // complete backup would be wrongly evicted.
  for (const name of ['agentdeck-20260601T000000Z', 'agentdeck-20260602T000000Z']) {
    await mkdir(path.join(backupDir, name), { recursive: true });
    await writeFile(path.join(backupDir, name, 'manifest.json'), '{}\n', 'utf8');
  }
  await mkdir(path.join(backupDir, 'agentdeck-20260610T235959Z'), { recursive: true });

  const result = await createBackup({
    rootDir: dir,
    dbFile,
    backupDir,
    currentFile: path.join(dir, 'current.org'),
    archiveFile: path.join(dir, 'archive.org'),
    exportFile: path.join(dir, 'agentdeck-export.org'),
    passwordFile: path.join(dir, 'basic-password'),
    now: new Date('2026-06-03T00:00:00Z'),
    keep: 2,
  });

  // Completed backups are 0601, 0602, 0603(new); keep=2 evicts only the oldest.
  assert.deepEqual(result.deleted.map((p) => path.basename(p)), ['agentdeck-20260601T000000Z']);
  // The middle complete backup survives (it would be evicted if the partial counted).
  assert.equal((await stat(path.join(backupDir, 'agentdeck-20260602T000000Z'))).isDirectory(), true);
  // The partial directory is neither counted nor pruned.
  assert.equal((await stat(path.join(backupDir, 'agentdeck-20260610T235959Z'))).isDirectory(), true);
});
