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
