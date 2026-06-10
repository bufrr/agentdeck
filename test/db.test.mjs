import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createGtdStore } from '../src/db.js';

const sample = `#+TITLE: Current Work

* Inbox
** TODO Raw captured thing
   :PROPERTIES:
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

* Ideas
** Learn the shortcuts
`;

test('SQLite store imports Org only as an initial seed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, sample, 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date(2026, 5, 7) });
  const state = store.readState();
  assert.equal(state.files.db, dbFile);
  assert.equal(state.storage.primary, 'sqlite');
  assert.equal(state.storage.org, 'import-export');
  assert.equal(state.groups.next.some((entry) => entry.title === 'Ship API'), true);
  assert.equal(state.groups.inbox.some((entry) => entry.title === 'Raw captured thing'), true);
  assert.equal(state.groups.stale.some((entry) => entry.title === 'Ship API'), true);
  assert.equal(state.groups.stale.some((entry) => entry.title === 'Learn the shortcuts'), false);

  await writeFile(currentFile, '* Work\n', 'utf8');
  const stateAfterOrgChange = store.readState();
  assert.equal(stateAfterOrgChange.groups.next.some((entry) => entry.title === 'Ship API'), true);
  store.close();
});

test('SQLite store owns UI create and status updates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');
  const original = await readFile(currentFile, 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date(2026, 5, 7) });
  const created = store.addTask({ title: 'write db migration', area: 'work' });
  assert.equal(created.title, 'Write Db Migration');
  let state = store.readState();
  assert.equal(state.groups.actions.some((entry) => entry.title === 'Write Db Migration'), true);

  store.updateTaskState(created.id, 'DONE');
  state = store.readState();
  assert.equal(state.groups.completed.some((entry) => entry.title === 'Write Db Migration'), true);
  assert.equal(await readFile(currentFile, 'utf8'), original);
  store.close();
});

test('SQLite store migrates old Twitter task list into source library', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Learning\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const legacy = store.addTask({
    title: 'read old x article',
    area: 'learn',
    tags: ['Solana', 'research', 'twitter', 'reading'],
    notes: [
      'Source: https://x.com/raikucom/status/2063974025844478189',
      'Tweet author: @raikucom',
      'Article: Solana glow-up explained',
      '',
      'Full fetched content.',
    ].join('\n'),
  });
  store.close();
  const db = new DatabaseSync(dbFile);
  db.prepare("UPDATE tasks SET list = 'twitter' WHERE id = ?").run(legacy.id);
  db.prepare("DELETE FROM meta WHERE key = 'twitter_list_migrated_to_sources'").run();
  db.close();

  const migratedStore = await createGtdStore({ currentFile, archiveFile, dbFile });
  const state = migratedStore.readState();
  const migratedTask = state.groups.actions.find((entry) => entry.id === legacy.id);
  assert.equal(migratedTask.title, 'Read Old X Article');
  assert.equal(migratedTask.list, 'next');
  assert.equal(state.groups.twitter, undefined);
  const source = state.sources.twitter.find((entry) => entry.url === 'https://x.com/raikucom/status/2063974025844478189');
  assert.equal(source.title, 'Solana glow-up explained');
  assert.equal(source.author, '@raikucom');
  assert.deepEqual(source.topics, ['Solana', 'research']);
  assert.equal(source.status, 'reading');
  assert.equal(source.taskIds.includes(legacy.id), true);
  migratedStore.close();
});

test('SQLite store owns source library and linked reading tasks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Learning\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const source = store.addSource({
    url: 'https://example.com/ai-workflow',
    type: 'article',
    title: 'AI workflow notes',
    summary: 'How to turn research sources into tasks.',
    rawText: 'Captured article body.',
    topics: ['AI', 'workflow'],
  });
  let state = store.readState();
  assert.equal(state.sources.inbox.some((entry) => entry.id === source.id), true);
  assert.equal(state.sources.counts.sourceInbox, 1);
  assert.equal(state.sources.articles.some((entry) => entry.title === 'AI workflow notes'), true);

  store.updateSource(source.id, { status: 'reading' });
  state = store.readState();
  assert.equal(state.sources.reading.some((entry) => entry.id === source.id), true);
  assert.equal(state.sources.inbox.some((entry) => entry.id === source.id), false);

  const task = store.createTaskFromSource(source.id);
  state = store.readState();
  const sourceAfterTask = state.sources.reading.find((entry) => entry.id === source.id);
  assert.equal(sourceAfterTask.taskIds.includes(task.id), true);
  const linkedTask = state.groups.actions.find((entry) => entry.id === task.id);
  assert.equal(linkedTask.title, 'Read: AI Workflow Notes');
  assert.deepEqual(linkedTask.tags, ['article', 'reading', 'AI', 'workflow']);
  assert.match(linkedTask.notes, /https:\/\/example.com\/ai-workflow/);

  store.updateSource(source.id, { status: 'processed' });
  state = store.readState();
  assert.equal(state.sources.processed.some((entry) => entry.id === source.id), true);
  store.close();
});

test('SQLite store preserves source status on duplicate imports without explicit status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Learning\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const source = store.addSource({
    url: 'https://example.com/reimport',
    type: 'article',
    title: 'Original source',
    status: 'processed',
    rawText: 'Original captured text.',
  });
  const duplicate = store.addSource({
    url: 'https://example.com/reimport',
    type: 'article',
    title: 'Refetched source',
  });
  assert.equal(duplicate.existing, true);
  let state = store.readState();
  const processed = state.sources.processed.find((entry) => entry.id === source.id);
  assert.equal(processed.title, 'Refetched source');
  assert.equal(processed.status, 'processed');
  assert.equal(processed.rawText, 'Original captured text.');
  assert.equal(state.sources.inbox.some((entry) => entry.id === source.id), false);
  store.close();
});

test('SQLite store backfills older task schemas before querying indexes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'TODO',
      area TEXT NOT NULL DEFAULT 'other',
      section TEXT NOT NULL DEFAULT 'Tasks',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO tasks(id, title, status, area, section, created_at, updated_at)
    VALUES('legacy-task', 'Legacy Task', 'TODO', 'work', 'Work', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
  `);
  db.close();

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  let state = store.readState();
  assert.equal(state.groups.next.some((entry) => entry.id === 'legacy-task'), true);
  store.moveToTrash('legacy-task');
  state = store.readState();
  assert.equal(state.groups.trash.some((entry) => entry.id === 'legacy-task'), true);
  store.close();
});

test('SQLite store exports current UI data as Org text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  const exportFile = path.join(dir, 'nested', 'export.org');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, exportFile });
  assert.equal(store.exportFile, exportFile);
  assert.equal(store.readState().files.export, exportFile);
  store.addTask({ title: 'export from ui', area: 'learn' });
  const text = store.exportOrgText();
  assert.match(text, /\* Learning[\s\S]*\*\* TODO Export From UI :deep:learning:/);
  await store.writeOrgExport();
  assert.match(await readFile(exportFile, 'utf8'), /Export From UI/);
  store.close();
});

test('SQLite store exports active children even when a parent is trashed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const parent = store.addTask({ title: 'temporary parent', area: 'work' });
  store.addTask({ title: 'active child', area: 'work', parentId: parent.id });
  store.moveToTrash(parent.id);

  const text = store.exportOrgText();
  assert.doesNotMatch(text, /Temporary Parent/);
  assert.match(text, /\* Work[\s\S]*\*\* TODO Active Child :work:/);
  store.close();
});

test('SQLite store re-imports exported Org task metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const created = store.addTask({ title: 'round trip task', area: 'work' });
  store.updateTask(created.id, {
    title: 'round trip task',
    todo: 'NEXT',
    list: 'scheduled',
    focus: true,
    area: 'work',
    effort: '0:45',
    energy: 'high',
    dueAt: '2026-06-11',
    scheduledAt: '2026-06-10',
    project: 'GTD web',
    tags: ['work', 'roundtrip'],
    notes: 'Line one\nLine two',
    repeat: 'weekly',
  });
  const exported = store.exportOrgText();
  store.close();

  const importedDir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-import-'));
  const importedCurrentFile = path.join(importedDir, 'current.org');
  const importedArchiveFile = path.join(importedDir, 'archive.org');
  const importedDbFile = path.join(importedDir, 'gtd.sqlite');
  await writeFile(importedCurrentFile, exported, 'utf8');
  await writeFile(importedArchiveFile, '', 'utf8');

  const importedStore = await createGtdStore({
    currentFile: importedCurrentFile,
    archiveFile: importedArchiveFile,
    dbFile: importedDbFile,
  });
  const state = importedStore.readState();
  const imported = state.groups.all.find((entry) => entry.title === 'Round Trip Task');
  assert.equal(imported.todo, 'NEXT');
  assert.equal(imported.list, 'scheduled');
  assert.equal(imported.focus, true);
  assert.equal(imported.area, 'work');
  assert.equal(imported.effort, '0:45');
  assert.equal(imported.energy, 'high');
  assert.equal(imported.project, 'GTD web');
  assert.equal(imported.due, '2026-06-11');
  assert.equal(imported.scheduled, '2026-06-10');
  assert.equal(imported.notes, 'Line one\nLine two');
  assert.equal(imported.repeat, 'weekly');
  assert.deepEqual(imported.tags, ['work', 'roundtrip']);
  importedStore.close();
});

test('SQLite store round-trips note bodies that look like Org headings or drawers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const trickyNotes = ['groceries', '* milk', '* eggs', ':PROPERTIES:', 'SCHEDULED: today'].join('\n');
  store.addTask({ title: 'shopping list', area: 'work', notes: trickyNotes });
  store.addTask({ title: 'innocent sibling', area: 'work' });
  const exported = store.exportOrgText();
  store.close();

  const importedDir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-import-'));
  const importedCurrentFile = path.join(importedDir, 'current.org');
  const importedArchiveFile = path.join(importedDir, 'archive.org');
  const importedDbFile = path.join(importedDir, 'gtd.sqlite');
  await writeFile(importedCurrentFile, exported, 'utf8');
  await writeFile(importedArchiveFile, '', 'utf8');

  const importedStore = await createGtdStore({
    currentFile: importedCurrentFile,
    archiveFile: importedArchiveFile,
    dbFile: importedDbFile,
  });
  const state = importedStore.readState();
  const importedGrocery = state.groups.all.find((entry) => entry.title === 'Shopping List');
  assert.equal(importedGrocery.notes, trickyNotes);
  const sibling = state.groups.all.find((entry) => entry.title === 'Innocent Sibling');
  assert.notEqual(sibling, undefined);
  assert.equal(sibling.section, 'Work');

  // The sibling must survive a second export -> cold re-import too.
  const exported2 = importedStore.exportOrgText();
  importedStore.close();
  assert.match(exported2, /Innocent Sibling/);
  assert.match(exported2, /Shopping List/);
});

test('SQLite store anchors "today" on the local calendar date during the 00:00-08:00 window', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  // ~02:00 local on 2026-06-10 — the window where a positive UTC offset rolls
  // the UTC calendar date back to 2026-06-09.
  const now = new Date(2026, 5, 10, 2, 0, 0);
  const localDate = '2026-06-10';
  const localTomorrow = '2026-06-11';
  // Guard: this assertion only stresses the bug when the host offset actually
  // puts the UTC date a day behind the local date.
  const utcDateBehindLocal = now.toISOString().slice(0, 10) !== localDate;

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now });
  const today = store.addTask({ title: 'local today', area: 'work', list: 'scheduled', scheduledAt: localDate });
  let state = store.readState();
  assert.equal(state.groups.next.some((entry) => entry.id === today.id), true);
  assert.equal(state.groups.actions.some((entry) => entry.id === today.id), true);

  // A scheduled task with no explicit date defaults to local tomorrow.
  const noDate = store.addTask({ title: 'auto schedule', area: 'work', list: 'scheduled' });
  state = store.readState();
  const scheduled = state.groups.scheduled.find((entry) => entry.id === noDate.id);
  assert.equal(scheduled.scheduled, localTomorrow);

  if (utcDateBehindLocal) {
    assert.equal(now.toISOString().slice(0, 10), '2026-06-09');
  }
  store.close();
});

test('SQLite store treats a UTC date-only scheduled task as due today in UTC+8', async () => {
  const oldTz = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
    const currentFile = path.join(dir, 'current.org');
    const archiveFile = path.join(dir, 'archive.org');
    const dbFile = path.join(dir, 'gtd.sqlite');
    await writeFile(currentFile, '* Work\n', 'utf8');
    await writeFile(archiveFile, '', 'utf8');

    const store = await createGtdStore({
      currentFile,
      archiveFile,
      dbFile,
      now: new Date('2026-06-09T09:00:00+08:00'),
    });
    const task = store.addTask({
      title: 'today scheduled',
      area: 'work',
      list: 'scheduled',
      scheduledAt: '2026-06-09',
    });
    const state = store.readState();
    assert.equal(state.groups.next.some((entry) => entry.id === task.id), true);
    store.close();
  } finally {
    if (oldTz === undefined) delete process.env.TZ;
    else process.env.TZ = oldTz;
  }
});

test('SQLite store supports UI edit, trash, restore, and delete', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const created = store.addTask({ title: 'rough task', area: 'other' });
  store.updateTask(created.id, {
    title: 'polished task',
    todo: 'NEXT',
    area: 'work',
    effort: '0:45',
    energy: 'high',
    dueAt: '2026-06-09',
    scheduledAt: '2026-06-08',
    project: 'GTD web',
    tags: ['work', 'ui'],
    notes: 'edited from UI',
  });
  store.setTaskFocus(created.id, true);
  let state = store.readState();
  const edited = state.groups.next.find((entry) => entry.id === created.id);
  assert.equal(edited.title, 'Polished Task');
  assert.equal(edited.area, 'work');
  assert.equal(edited.scheduled, '2026-06-08');
  assert.equal(edited.due, '2026-06-09');
  assert.equal(edited.energy, 'high');
  assert.equal(edited.project, 'GTD web');
  assert.deepEqual(edited.tags, ['work', 'ui']);
  assert.equal(edited.focus, true);
  assert.equal(edited.notes, 'edited from UI');

  const copied = store.copyTask(created.id);
  state = store.readState();
  assert.equal(state.groups.next.some((entry) => entry.id === copied.id && entry.title === 'Polished Task Copy'), true);

  store.convertToProject(created.id);
  state = store.readState();
  const project = state.groups.next.find((entry) => entry.id === created.id);
  assert.equal(project.todo, 'PROJ');
  assert.equal(project.project, 'GTD web');

  store.moveToLogbook(copied.id);
  state = store.readState();
  assert.equal(state.groups.completed.some((entry) => entry.id === copied.id), true);

  store.moveToTrash(created.id);
  state = store.readState();
  assert.equal(state.groups.trash.some((entry) => entry.id === created.id), true);
  store.restoreTask(created.id);
  state = store.readState();
  assert.equal(state.groups.trash.some((entry) => entry.id === created.id), false);
  store.deleteTask(created.id);
  state = store.readState();
  assert.equal(state.groups.actions.some((entry) => entry.id === created.id), false);
  store.close();
});

test('SQLite store persists manual row ordering', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile });
  const first = store.addTask({ title: 'first drag task', area: 'work', list: 'next' });
  const second = store.addTask({ title: 'second drag task', area: 'work', list: 'next' });
  let state = store.readState();
  const initial = state.groups.next.filter((entry) => [first.id, second.id].includes(entry.id));
  assert.deepEqual(initial.map((entry) => entry.id), [first.id, second.id]);

  store.reorderTasks([second.id, first.id]);
  state = store.readState();
  const reordered = state.groups.next.filter((entry) => [first.id, second.id].includes(entry.id));
  assert.deepEqual(reordered.map((entry) => entry.id), [second.id, first.id]);
  store.close();
});

test('SQLite store rolls recurring tasks forward when completed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date(2026, 5, 7) });
  const created = store.addTask({
    title: 'weekly planning',
    area: 'work',
    list: 'scheduled',
    scheduledAt: '2026-06-08',
    repeat: 'weekly',
  });
  const result = store.updateTaskState(created.id, 'DONE');
  assert.equal(result.nextRepeat.scheduledAt, '2026-06-15');

  const state = store.readState();
  assert.equal(state.groups.completed.some((entry) => entry.id === created.id), true);
  const next = state.groups.scheduled.find((entry) => entry.title === 'Weekly Planning' && entry.id !== created.id);
  assert.equal(next.scheduled, '2026-06-15');
  assert.equal(next.repeat, 'weekly');
  assert.match(store.exportOrgText(), /:Repeat: weekly/);
  store.close();
});

test('SQLite store rolls an overdue repeat forward to a single future occurrence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date('2026-06-10T00:00:00Z') });
  const overdue = store.addTask({ title: 'water plants', area: 'work', list: 'scheduled', scheduledAt: '2026-06-01', repeat: 'daily' });
  const result = store.updateTaskState(overdue.id, 'DONE');
  // 9 days overdue: successor lands tomorrow, not back at 2026-06-02.
  assert.equal(result.nextRepeat.scheduledAt, '2026-06-11');

  const state = store.readState();
  const successors = state.groups.scheduled.filter((entry) => entry.title === 'Water Plants' && entry.id !== overdue.id);
  assert.equal(successors.length, 1);
  assert.equal(successors[0].scheduled, '2026-06-11');

  // A task completed on time still advances exactly one period.
  const onTime = store.addTask({ title: 'standup', area: 'work', list: 'scheduled', scheduledAt: '2026-06-10', repeat: 'daily' });
  const onTimeResult = store.updateTaskState(onTime.id, 'DONE');
  assert.equal(onTimeResult.nextRepeat.scheduledAt, '2026-06-11');
  store.close();
});

test('SQLite store clamps monthly repeats to the month end', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date('2026-01-31T00:00:00Z') });
  const jan = store.addTask({ title: 'pay rent', area: 'work', list: 'scheduled', scheduledAt: '2026-01-31', repeat: 'monthly' });
  const janResult = store.updateTaskState(jan.id, 'DONE');
  // Feb 2026 has 28 days (not a leap year): clamp 31 -> 28.
  assert.equal(janResult.nextRepeat.scheduledAt, '2026-02-28');

  const mar = store.addTask({ title: 'review budget', area: 'work', list: 'scheduled', scheduledAt: '2026-03-31', repeat: 'monthly' });
  const marResult = store.updateTaskState(mar.id, 'DONE');
  // April has 30 days: clamp 31 -> 30.
  assert.equal(marResult.nextRepeat.scheduledAt, '2026-04-30');

  // Mid-month monthly repeats are unaffected.
  const mid = store.addTask({ title: 'mid month', area: 'work', list: 'scheduled', scheduledAt: '2026-01-15', repeat: 'monthly' });
  const midResult = store.updateTaskState(mid.id, 'DONE');
  assert.equal(midResult.nextRepeat.scheduledAt, '2026-02-15');
  store.close();
});

test('SQLite store spawns a repeat successor only on an open->done transition', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtd-db-'));
  const currentFile = path.join(dir, 'current.org');
  const archiveFile = path.join(dir, 'archive.org');
  const dbFile = path.join(dir, 'gtd.sqlite');
  await writeFile(currentFile, '* Work\n', 'utf8');
  await writeFile(archiveFile, '', 'utf8');

  const store = await createGtdStore({ currentFile, archiveFile, dbFile, now: new Date(2026, 5, 7) });
  const successors = (title, taskId) => {
    const state = store.readState();
    return state.groups.scheduled.filter((entry) => entry.title === title && entry.id !== taskId).length;
  };

  // Double-DONE => exactly one successor.
  const doubled = store.addTask({ title: 'double done', area: 'work', list: 'scheduled', scheduledAt: '2026-06-08', repeat: 'weekly' });
  store.updateTaskState(doubled.id, 'DONE');
  store.updateTaskState(doubled.id, 'DONE');
  assert.equal(successors('Double Done', doubled.id), 1);

  // DONE -> TODO -> DONE => exactly one total.
  const undone = store.addTask({ title: 'reopened task', area: 'work', list: 'scheduled', scheduledAt: '2026-06-08', repeat: 'weekly' });
  store.updateTaskState(undone.id, 'DONE');
  store.updateTaskState(undone.id, 'TODO');
  store.updateTaskState(undone.id, 'DONE');
  assert.equal(successors('Reopened Task', undone.id), 1);

  // CANCELLED => no successor.
  const cancelled = store.addTask({ title: 'cancel me', area: 'work', list: 'scheduled', scheduledAt: '2026-06-08', repeat: 'weekly' });
  store.updateTaskState(cancelled.id, 'CANCELLED');
  assert.equal(successors('Cancel Me', cancelled.id), 0);

  // moveToLogbook on an already-DONE task => no extra successor.
  const logbook = store.addTask({ title: 'logbook task', area: 'work', list: 'scheduled', scheduledAt: '2026-06-08', repeat: 'weekly' });
  store.updateTaskState(logbook.id, 'DONE');
  store.moveToLogbook(logbook.id);
  assert.equal(successors('Logbook Task', logbook.id), 1);

  // Normal open->DONE via moveToLogbook still spawns exactly one.
  const fresh = store.addTask({ title: 'fresh logbook', area: 'work', list: 'scheduled', scheduledAt: '2026-06-08', repeat: 'weekly' });
  store.moveToLogbook(fresh.id);
  assert.equal(successors('Fresh Logbook', fresh.id), 1);
  store.close();
});
