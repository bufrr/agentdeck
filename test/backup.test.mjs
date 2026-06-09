import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
  await mkdir(path.join(backupDir, 'agentdeck-20260601T000000Z'), { recursive: true });
  await mkdir(path.join(backupDir, 'agentdeck-20260602T000000Z'), { recursive: true });
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
