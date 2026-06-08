import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addTask, groupEntries, parseOrg, updateTaskState } from '../src/org.js';

const sample = `#+TITLE: Current Work

* Inbox
** TODO Raw captured thing
   :PROPERTIES:
   :Created: [2026-05-01 Fri 09:00]
   :END:

* Tasks
** TODO Call bank :shallow:
   :PROPERTIES:
   :Effort: 0:30
   :Created: [2026-05-01 Fri 09:00]
   :END:

* Work
** NEXT Ship API :work:
   :PROPERTIES:
   :Effort: 1:00
   :Created: [2026-05-01 Fri 09:00]
   :END:
*** TODO Write tests
*** DONE Draft patch
   CLOSED: [2026-06-06 Sat 10:00]

* Part-Time
** TODO Design part time flow :parttime:

* Learning
** TODO Study Solana :learning:

* Ideas
** Learn the shortcuts
`;

test('parseOrg extracts headings, areas, and subtask progress', () => {
  const entries = parseOrg(sample, '/tmp/current.org');
  const ship = entries.find((entry) => entry.title === 'Ship API');
  assert.equal(ship.todo, 'NEXT');
  assert.equal(ship.area, 'work');
  assert.equal(ship.subtasks.total, 2);
  assert.equal(ship.subtasks.done, 1);
  assert.equal(ship.subtasks.percent, 50);
  assert.equal(entries.find((entry) => entry.title === 'Learn the shortcuts').section, 'Ideas');
});

test('groupEntries builds GTD lists', () => {
  const entries = parseOrg(sample, '/tmp/current.org').map((entry) => ({ ...entry, isCurrent: true }));
  const groups = groupEntries(entries, { now: new Date(2026, 5, 7), days: 7, staleDays: 14 });
  assert.equal(groups.next.length, 1);
  assert.equal(groups.actions.some((entry) => entry.title === 'Call bank'), true);
  assert.equal(groups.areas.work.length, 2);
  assert.equal(groups.areas.parttime.length, 1);
  assert.equal(groups.areas.learn.length, 1);
  assert.equal(groups.inbox.length, 1);
  assert.equal(groups.someday.length, 1);
  assert.ok(groups.stale.length >= 2);
});

test('addTask inserts into the selected area and creates a backup', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-'));
  const currentFile = path.join(dir, 'current.org');
  await writeFile(currentFile, sample, 'utf8');
  await addTask({ currentFile }, { title: 'review js app', area: 'learn' });
  const text = await readFile(currentFile, 'utf8');
  assert.match(text, /\* Learning[\s\S]*\*\* TODO Review JS App :deep:learning:/);
  const backupDir = path.join(dir, 'backups');
  const backups = await readdir(backupDir);
  assert.equal(backups.length, 1);
  const backup = await readFile(path.join(backupDir, backups[0]), 'utf8');
  assert.match(backup, /Current Work/);
});

test('updateTaskState mutates a current task and adds CLOSED when done', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-'));
  const currentFile = path.join(dir, 'current.org');
  await writeFile(currentFile, sample, 'utf8');
  const entry = parseOrg(sample, currentFile).find((item) => item.title === 'Call bank');
  await updateTaskState({ currentFile }, entry.id, 'DONE');
  const text = await readFile(currentFile, 'utf8');
  assert.match(text, /\*\* DONE Call bank :shallow:/);
  assert.match(text, /CLOSED: \[\d{4}-\d{2}-\d{2}/);
});
