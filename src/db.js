import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { expandHome, readEntries, slugTitle } from './org.js';

const DONE_STATES = new Set(['DONE', 'CANCELLED']);
const OPEN_STATES = new Set(['TODO', 'NEXT', 'PROJ', 'WAIT']);
const TODO_STATES = new Set(['TODO', 'NEXT', 'PROJ', 'WAIT', 'DONE', 'CANCELLED']);
const LISTS = new Set(['inbox', 'next', 'later', 'scheduled', 'someday', 'waiting']);
const REPEATS = new Set(['', 'daily', 'weekly', 'monthly']);
const SOURCE_TYPES = new Set(['twitter', 'article', 'youtube', 'pdf', 'github', 'doc', 'other']);
const SOURCE_STATUSES = new Set(['unread', 'reading', 'processed', 'archived']);
const AREA_SECTIONS = new Map([
  ['work', 'Work'],
  ['parttime', 'Part-Time'],
  ['learn', 'Learning'],
  ['other', 'Tasks'],
]);

function nowIso() {
  return new Date().toISOString();
}

function stableOrgId(entry) {
  const raw = `${entry.file}\0${entry.line}\0${entry.rawTitle || entry.title}`;
  return `org_${createHash('sha1').update(raw).digest('hex').slice(0, 24)}`;
}

function pathKey(entry) {
  return `${entry.file}\0${entry.outlinePath.join('\0')}`;
}

function parentPathKey(entry) {
  return `${entry.file}\0${entry.parentPath.join('\0')}`;
}

function toJson(value) {
  return JSON.stringify(value || []);
}

function fromJson(value, fallback = []) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isoFromDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoFromDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return isoFromDate(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).toISOString();
  }
  return isoFromDate(value);
}

function cleanRepeat(value) {
  const repeat = String(value || '').trim().toLowerCase();
  return REPEATS.has(repeat) ? repeat : '';
}

function nextRepeatDate(repeat, anchor = new Date()) {
  const date = new Date(anchor);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  if (repeat === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  else if (repeat === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (repeat === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else return null;
  return date.toISOString();
}

function dateText(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function sectionForArea(area) {
  return AREA_SECTIONS.get(area) || 'Tasks';
}

function tagsForArea(area) {
  if (area === 'work') return ['work'];
  if (area === 'parttime') return ['parttime'];
  if (area === 'learn') return ['deep', 'learning'];
  return [];
}

function effortForArea(area) {
  if (area === 'learn' || area === 'work') return '1:00';
  return '0:30';
}

function cleanList(value, fallback = 'next') {
  return LISTS.has(value) ? value : fallback;
}

function cleanSourceType(value, fallback = 'other') {
  const type = String(value || '').trim().toLowerCase();
  return SOURCE_TYPES.has(type) ? type : fallback;
}

function cleanSourceStatus(value, fallback = 'unread') {
  const status = String(value || '').trim().toLowerCase();
  return SOURCE_STATUSES.has(status) ? status : fallback;
}

function firstUrl(value = '') {
  return String(value).match(/https?:\/\/[^\s)]+/)?.[0] || '';
}

function titleFromTwitterTask(task) {
  const article = String(task.notes || '').match(/^Article:\s*(.+)$/m)?.[1]?.trim();
  return article || task.title;
}

function listForImportedEntry(entry) {
  if (entry.section === 'Inbox') return 'inbox';
  if (entry.section === 'Ideas') return 'someday';
  if (entry.todo === 'WAIT') return 'waiting';
  if (entry.scheduledTime) return 'scheduled';
  return 'next';
}

function tomorrowIso() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function headingTags(tags) {
  return tags?.length ? ` :${tags.join(':')}:` : '';
}

function orgTimestamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${days[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}]`;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((info) => info.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensureTaskColumns(db) {
  [
    ['parent_id', 'parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL'],
    ['list', "list TEXT NOT NULL DEFAULT 'next'"],
    ['focus', 'focus INTEGER NOT NULL DEFAULT 0'],
    ['area', "area TEXT NOT NULL DEFAULT 'other'"],
    ['section', "section TEXT NOT NULL DEFAULT 'Tasks'"],
    ['priority', 'priority TEXT'],
    ['effort', 'effort TEXT'],
    ['notes', 'notes TEXT'],
    ['tags_json', "tags_json TEXT NOT NULL DEFAULT '[]'"],
    ['due_at', 'due_at TEXT'],
    ['energy', 'energy TEXT'],
    ['project', 'project TEXT'],
    ['repeat', 'repeat TEXT'],
    ['sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0'],
    ['scheduled_at', 'scheduled_at TEXT'],
    ['closed_at', 'closed_at TEXT'],
    ['archived', 'archived INTEGER NOT NULL DEFAULT 0'],
    ['trashed_at', 'trashed_at TEXT'],
    ['source_file', 'source_file TEXT'],
    ['source_line', 'source_line INTEGER'],
  ].forEach(([column, definition]) => ensureColumn(db, 'tasks', column, definition));
}

function ensureSourceColumns(db) {
  [
    ['type', "type TEXT NOT NULL DEFAULT 'other'"],
    ['author', 'author TEXT'],
    ['status', "status TEXT NOT NULL DEFAULT 'unread'"],
    ['summary', 'summary TEXT'],
    ['raw_text', 'raw_text TEXT'],
    ['topics_json', "topics_json TEXT NOT NULL DEFAULT '[]'"],
    ['published_at', 'published_at TEXT'],
    ['fetched_at', 'fetched_at TEXT'],
    ['archived_at', 'archived_at TEXT'],
  ].forEach(([column, definition]) => ensureColumn(db, 'sources', column, definition));
}

function migrateTwitterListToSources(db) {
  const migrated = db.prepare('SELECT value FROM meta WHERE key = ?').get('twitter_list_migrated_to_sources');
  if (migrated) return;
  const tasks = db.prepare("SELECT * FROM tasks WHERE list = 'twitter'").all();
  if (!tasks.length) {
    db.prepare('INSERT INTO meta(key, value) VALUES(?, ?)').run('twitter_list_migrated_to_sources', nowIso());
    return;
  }
  const insertSource = db.prepare(`
    INSERT INTO sources (
      id, type, url, title, author, status, summary, raw_text, topics_json,
      published_at, fetched_at, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findSource = db.prepare('SELECT id FROM sources WHERE url = ?');
  const linkSourceTask = db.prepare('INSERT OR IGNORE INTO source_tasks(source_id, task_id, relation, created_at) VALUES(?, ?, ?, ?)');
  const moveTask = db.prepare("UPDATE tasks SET list = 'next', updated_at = ? WHERE id = ?");
  const insertMeta = db.prepare('INSERT INTO meta(key, value) VALUES(?, ?)');
  const created = nowIso();
  db.exec('BEGIN');
  try {
    for (const task of tasks) {
      const url = firstUrl(task.notes || '');
      if (url) {
        let sourceId = findSource.get(url)?.id;
        if (!sourceId) {
          sourceId = randomUUID();
          const tags = fromJson(task.tags_json).filter((tag) => !['twitter', 'reading'].includes(String(tag).toLowerCase()));
          const author = String(task.notes || '').match(/^Tweet author:\s*(.+)$/m)?.[1]?.trim() || null;
          const published = String(task.notes || '').match(/^Tweet created:\s*(.+)$/m)?.[1]?.trim();
          insertSource.run(
            sourceId,
            'twitter',
            url,
            titleFromTwitterTask(task),
            author,
            'reading',
            task.notes ? task.notes.slice(0, 700) : null,
            task.notes || null,
            toJson(tags),
            published ? isoFromDate(published) : null,
            created,
            task.created_at || created,
            created,
            null,
          );
        }
        linkSourceTask.run(sourceId, task.id, 'read', created);
      }
      moveTask.run(created, task.id);
    }
    insertMeta.run('twitter_list_migrated_to_sources', created);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function prepareDb(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'TODO',
      list TEXT NOT NULL DEFAULT 'next',
      focus INTEGER NOT NULL DEFAULT 0,
      area TEXT NOT NULL DEFAULT 'other',
      section TEXT NOT NULL DEFAULT 'Tasks',
      priority TEXT,
      effort TEXT,
      notes TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      due_at TEXT,
      energy TEXT,
      project TEXT,
      repeat TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      scheduled_at TEXT,
      closed_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      trashed_at TEXT,
      source_file TEXT,
      source_line INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'other',
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      status TEXT NOT NULL DEFAULT 'unread',
      summary TEXT,
      raw_text TEXT,
      topics_json TEXT NOT NULL DEFAULT '[]',
      published_at TEXT,
      fetched_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS source_tasks (
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      relation TEXT NOT NULL DEFAULT 'read',
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, task_id, relation)
    );
  `);
  ensureTaskColumns(db);
  ensureSourceColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_area ON tasks(area);
    CREATE INDEX IF NOT EXISTS idx_tasks_closed ON tasks(closed_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_trash ON tasks(trashed_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list);
    CREATE INDEX IF NOT EXISTS idx_tasks_focus ON tasks(focus);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
    CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
    CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
  `);
  db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)').run('schema_version', '1');
  const migrated = db.prepare('SELECT value FROM meta WHERE key = ?').get('nirvana_fields_seeded');
  if (!migrated) {
    db.exec(`
      UPDATE tasks
      SET list = CASE
        WHEN scheduled_at IS NOT NULL THEN 'scheduled'
        WHEN status = 'WAIT' THEN 'waiting'
        WHEN section = 'Inbox' THEN 'inbox'
        WHEN section = 'Ideas' THEN 'someday'
        ELSE COALESCE(NULLIF(list, ''), 'next')
      END
      WHERE list IS NULL OR list = 'next' OR list = '';

      UPDATE tasks
      SET focus = 1
      WHERE status = 'NEXT' AND trashed_at IS NULL AND archived = 0;
    `);
    db.prepare('INSERT INTO meta(key, value) VALUES(?, ?)').run('nirvana_fields_seeded', nowIso());
  }
  migrateTwitterListToSources(db);
  return db;
}

function rowsToEntries(rows) {
  const entries = rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    todo: row.status,
    title: row.title,
    rawTitle: row.title,
    list: row.list || 'next',
    focus: Boolean(row.focus),
    section: row.section,
    area: row.area,
    priority: row.priority,
    effort: row.effort,
    time: row.effort,
    energy: row.energy || '',
    project: row.project || '',
    repeat: row.repeat || '',
    sortOrder: row.sort_order,
    due: dateText(row.due_at),
    notes: row.notes || '',
    tags: fromJson(row.tags_json),
    created: dateText(row.created_at),
    closed: dateText(row.closed_at),
    scheduled: dateText(row.scheduled_at),
    createdTime: row.created_at ? new Date(row.created_at) : null,
    closedTime: row.closed_at ? new Date(row.closed_at) : null,
    scheduledTime: row.scheduled_at ? new Date(row.scheduled_at) : null,
    dueTime: row.due_at ? new Date(row.due_at) : null,
    isCurrent: !row.archived && !row.trashed_at,
    archived: Boolean(row.archived),
    trashed: Boolean(row.trashed_at),
    trashedAt: row.trashed_at,
    file: row.source_file,
    line: row.source_line,
    level: 2,
    parentPath: [row.section],
    outlinePath: [row.section, row.title],
    children: [],
  }));

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (!entry.parentId || !byId.has(entry.parentId)) continue;
    const parent = byId.get(entry.parentId);
    entry.parent = parent;
    entry.level = parent.level + 1;
    entry.parentPath = [...parent.outlinePath];
    entry.outlinePath = [...entry.parentPath, entry.title];
    parent.children.push(entry);
  }

  const descendantsOf = (entry) => {
    const direct = entry.children || [];
    return direct.flatMap((child) => [child, ...descendantsOf(child)]);
  };

  for (const entry of entries) {
    const descendants = descendantsOf(entry);
    const done = descendants.filter((item) => DONE_STATES.has(item.todo)).length;
    const open = descendants.filter((item) => OPEN_STATES.has(item.todo)).length;
    const next = descendants.filter((item) => item.todo === 'NEXT').length;
    const wait = descendants.filter((item) => item.todo === 'WAIT').length;
    const projects = descendants.filter((item) => item.todo === 'PROJ').length;
    entry.hasOpenChild = descendants.some((item) => OPEN_STATES.has(item.todo));
    entry.hasNextChild = descendants.some((item) => item.todo === 'NEXT');
    entry.childrenCount = entry.children.length;
    entry.childPreview = entry.children.slice(0, 5).map((child) => ({
      depth: Math.max(1, child.level - entry.level),
      todo: child.todo,
      title: child.title,
    }));
    entry.subtasks = {
      total: descendants.length,
      done,
      open,
      next,
      wait,
      projects,
      percent: descendants.length ? Math.round((done / descendants.length) * 100) : 0,
    };
  }

  return entries.map(({ parent, children, ...entry }) => entry);
}

function rowsToSources(rows) {
  return rows.map((row) => ({
    id: row.id,
    type: cleanSourceType(row.type),
    url: row.url,
    title: row.title,
    author: row.author || '',
    status: cleanSourceStatus(row.status),
    summary: row.summary || '',
    rawText: row.raw_text || '',
    topics: fromJson(row.topics_json),
    published: dateText(row.published_at),
    fetched: dateText(row.fetched_at),
    created: dateText(row.created_at),
    updated: dateText(row.updated_at),
    archived: Boolean(row.archived_at || row.status === 'archived'),
    archivedAt: row.archived_at,
    taskIds: fromJson(row.task_ids_json),
  }));
}

function startOfToday(now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function isOpenEntry(entry) {
  return entry.isCurrent && !DONE_STATES.has(entry.todo);
}

function isDueForNext(entry, now = new Date()) {
  if (!entry.scheduledTime) return true;
  return entry.scheduledTime <= startOfToday(now);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const scheduleA = a.scheduledTime?.getTime() || Number.MAX_SAFE_INTEGER;
    const scheduleB = b.scheduledTime?.getTime() || Number.MAX_SAFE_INTEGER;
    if (scheduleA !== scheduleB) return scheduleA - scheduleB;
    const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });
}

function sortSources(sources) {
  return [...sources].sort((a, b) => {
    const statusA = a.status === 'unread' ? 0 : a.status === 'reading' ? 1 : a.status === 'processed' ? 2 : 3;
    const statusB = b.status === 'unread' ? 0 : b.status === 'reading' ? 1 : b.status === 'processed' ? 2 : 3;
    if (statusA !== statusB) return statusA - statusB;
    return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || ''))
      || String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function buildSourceGroups(sources) {
  const active = sources.filter((source) => source.status !== 'archived' && !source.archived);
  const groups = {
    all: sortSources(active),
    inbox: sortSources(active.filter((source) => source.status === 'unread')),
    reading: sortSources(active.filter((source) => source.status === 'reading')),
    twitter: sortSources(active.filter((source) => source.type === 'twitter')),
    articles: sortSources(active.filter((source) => ['article', 'github', 'doc', 'other'].includes(source.type))),
    videos: sortSources(active.filter((source) => source.type === 'youtube')),
    pdfs: sortSources(active.filter((source) => source.type === 'pdf')),
    processed: sortSources(active.filter((source) => source.status === 'processed')),
    archived: sortSources(sources.filter((source) => source.status === 'archived' || source.archived)),
    counts: {},
  };
  groups.counts = {
    sourceInbox: groups.inbox.length,
    sourceReading: groups.reading.length,
    sourceTwitter: groups.twitter.length,
    sourceArticles: groups.articles.length,
    sourceVideos: groups.videos.length,
    sourcePdfs: groups.pdfs.length,
    sourceProcessed: groups.processed.length,
  };
  return groups;
}

function buildGroups(entries, config) {
  const now = config.now || new Date();
  const staleCutoff = startOfToday(now);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - Number(config.staleDays || 14));
  const open = entries.filter(isOpenEntry);
  const notTrashed = entries.filter((entry) => !entry.trashed);
  const completedCutoff = new Date();
  completedCutoff.setDate(completedCutoff.getDate() - Number(config.days || 7));
  const tagCounts = new Map();
  const projectCounts = new Map();
  for (const entry of open) {
    const tags = entry.tags?.length ? entry.tags : ['-'];
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const project = entry.project || (entry.todo === 'PROJ' ? entry.title : '');
    if (project) projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
  }

  const groups = {
    all: sortEntries(open),
    inbox: sortEntries(open.filter((entry) => entry.list === 'inbox')),
    focus: sortEntries(open.filter((entry) => entry.focus)),
    next: sortEntries(open.filter((entry) => entry.list === 'next' || (entry.list === 'scheduled' && isDueForNext(entry, now)))),
    actions: [],
    later: sortEntries(open.filter((entry) => entry.list === 'later')),
    stale: sortEntries(open.filter((entry) =>
      ['inbox', 'next'].includes(entry.list)
        && entry.createdTime
        && entry.createdTime < staleCutoff
        && !entry.scheduledTime
    )),
    scheduled: sortEntries(open.filter((entry) => entry.list === 'scheduled' || entry.scheduledTime)),
    someday: sortEntries(open.filter((entry) => entry.list === 'someday')),
    waiting: sortEntries(open.filter((entry) => entry.list === 'waiting' || entry.todo === 'WAIT')),
    completed: sortEntries(notTrashed.filter((entry) => DONE_STATES.has(entry.todo) && (!entry.closedTime || entry.closedTime >= completedCutoff))).reverse(),
    trash: sortEntries(entries.filter((entry) => entry.trashed)),
    areas: {
      work: [],
      parttime: [],
      learn: [],
      other: [],
    },
    tags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects: [...projectCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    counts: {},
  };
  groups.actions = groups.next;

  for (const area of Object.keys(groups.areas)) {
    groups.areas[area] = sortEntries(open.filter((entry) => entry.area === area));
  }

  groups.counts = {
    inbox: groups.inbox.length,
    focus: groups.focus.length,
    next: groups.next.length,
    actions: groups.actions.length,
    later: groups.later.length,
    stale: groups.stale.length,
    scheduled: groups.scheduled.length,
    someday: groups.someday.length,
    waiting: groups.waiting.length,
    completed: groups.completed.length,
    trash: groups.trash.length,
  };
  return groups;
}

function rowsForExport(rows) {
  const active = rows.filter((row) => !row.archived && !row.trashed_at);
  const activeIds = new Set(active.map((row) => row.id));
  const byParent = new Map();
  for (const row of active) {
    const key = row.parent_id && activeIds.has(row.parent_id) ? row.parent_id : '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }
  for (const children of byParent.values()) {
    children.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  }
  return byParent;
}

function exportTree(byParent, parentId, level) {
  const rows = byParent.get(parentId || '') || [];
  const lines = [];
  for (const row of rows) {
    const stars = '*'.repeat(level);
    const tags = headingTags(fromJson(row.tags_json));
    const priority = row.priority ? `[#${row.priority}] ` : '';
    lines.push(`${stars} ${row.status} ${priority}${row.title}${tags}`);
    const properties = [
      row.list ? `   :List: ${row.list}` : '',
      row.focus ? '   :Focus: true' : '',
      row.effort ? `   :Effort: ${row.effort}` : '',
      row.energy ? `   :Energy: ${row.energy}` : '',
      row.project ? `   :Project: ${row.project}` : '',
      row.repeat ? `   :Repeat: ${row.repeat}` : '',
      row.created_at ? `   :Created: ${orgTimestamp(row.created_at)}` : '',
      row.source_file ? '   :Source: agentdeck-import' : '   :Source: agentdeck',
    ].filter(Boolean);
    if (properties.length) {
      lines.push('   :PROPERTIES:', ...properties, '   :END:');
    }
    if (row.scheduled_at) lines.push(`   SCHEDULED: ${orgTimestamp(row.scheduled_at)}`);
    if (row.due_at) lines.push(`   DEADLINE: ${orgTimestamp(row.due_at)}`);
    if (row.closed_at) lines.push(`   CLOSED: ${orgTimestamp(row.closed_at)}`);
    if (row.notes) lines.push('', ...row.notes.split('\n'));
    lines.push(...exportTree(byParent, row.id, level + 1));
    lines.push('');
  }
  return lines;
}

export async function createGtdStore(config) {
  const dbFile = expandHome(config.dbFile || '~/org/gtd/gtd.sqlite');
  const db = prepareDb(dbFile);

  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      id, parent_id, title, status, list, focus, area, section, priority, effort,
      notes, tags_json, due_at, energy, project, repeat, sort_order, created_at, updated_at,
      scheduled_at, closed_at, archived, trashed_at, source_file, source_line
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = db.prepare(`
    INSERT INTO sources (
      id, type, url, title, author, status, summary, raw_text, topics_json,
      published_at, fetched_at, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare('INSERT INTO events(id, task_id, type, payload_json, created_at) VALUES(?, ?, ?, ?, ?)');

  function logEvent(taskId, type, payload) {
    insertEvent.run(randomUUID(), taskId || null, type, JSON.stringify(payload || {}), nowIso());
  }

  function allRows() {
    return db.prepare('SELECT * FROM tasks ORDER BY sort_order, created_at, title').all();
  }

  function allSourceRows() {
    const rows = db.prepare('SELECT * FROM sources ORDER BY updated_at DESC, created_at DESC, title').all();
    const taskIdsBySource = new Map();
    for (const link of db.prepare('SELECT source_id, task_id FROM source_tasks ORDER BY created_at').all()) {
      if (!taskIdsBySource.has(link.source_id)) taskIdsBySource.set(link.source_id, []);
      taskIdsBySource.get(link.source_id).push(link.task_id);
    }
    return rows.map((row) => ({
      ...row,
      task_ids_json: toJson(taskIdsBySource.get(row.id) || []),
    }));
  }

  function getTask(id) {
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  function getSource(id) {
    return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  }

  function getSourceByUrl(url) {
    return db.prepare('SELECT * FROM sources WHERE url = ?').get(url);
  }

  async function importOrgIfEmpty() {
    const existing = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
    if (existing > 0) return { imported: 0, skipped: true };

    const currentFile = expandHome(config.currentFile);
    const archiveFile = expandHome(config.archiveFile);
    const current = (await readEntries([currentFile])).map((entry) => ({ ...entry, archived: 0 }));
    const archived = (await readEntries([archiveFile])).map((entry) => ({ ...entry, archived: 1 }));
    const sourceEntries = [...current, ...archived]
      .filter((entry) => entry.level > 1)
      .filter((entry) => entry.todo || ['Inbox', 'Ideas'].includes(entry.section));

    const idByPath = new Map();
    const importedAt = nowIso();
    db.exec('BEGIN');
    try {
      sourceEntries.forEach((entry, index) => {
        const id = stableOrgId(entry);
        const parentId = idByPath.get(parentPathKey(entry)) || null;
        idByPath.set(pathKey(entry), id);
        const status = entry.todo || 'TODO';
        const list = cleanList(entry.list, listForImportedEntry(entry));
        insertTask.run(
          id,
          parentId,
          entry.title,
          status,
          list,
          entry.focus ? 1 : (status === 'NEXT' ? 1 : 0),
          entry.area || 'other',
          entry.section || sectionForArea(entry.area),
          entry.priority || null,
          entry.effort || null,
          entry.notes || null,
          toJson(entry.tags),
          isoFromDate(entry.dueTime),
          entry.energy || null,
          entry.project || null,
          cleanRepeat(entry.repeat),
          index * 1024,
          isoFromDate(entry.createdTime) || importedAt,
          importedAt,
          isoFromDate(entry.scheduledTime),
          isoFromDate(entry.closedTime),
          entry.archived,
          null,
          entry.file || null,
          entry.line || null,
        );
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    logEvent(null, 'org_import', { imported: sourceEntries.length, currentFile, archiveFile });
    return { imported: sourceEntries.length, skipped: false };
  }

  await importOrgIfEmpty();

  return {
    dbFile,
    exportFile: expandHome(config.exportFile || '~/org/gtd/agentdeck-export.org'),

    readState() {
      const entries = rowsToEntries(allRows());
      const groups = buildGroups(entries, config);
      const sources = buildSourceGroups(rowsToSources(allSourceRows()));
      return {
        files: {
          db: dbFile,
          current: expandHome(config.currentFile),
          archive: expandHome(config.archiveFile),
          export: expandHome(config.exportFile || '~/org/gtd/agentdeck-export.org'),
        },
        storage: {
          primary: 'sqlite',
          org: 'import-export',
          autoExport: config.autoExport !== false,
        },
        generatedAt: new Date().toISOString(),
        groups,
        sources,
      };
    },

    addTask(input) {
      const title = slugTitle(input.title);
      if (!title) throw new Error('Task title is required');
      const area = input.area || 'other';
      const section = input.section || sectionForArea(area);
      const list = cleanList(input.list, input.scheduledAt ? 'scheduled' : 'next');
      const status = input.todo || (list === 'waiting' ? 'WAIT' : 'TODO');
      if (!TODO_STATES.has(status)) throw new Error(`Unsupported TODO state: ${status}`);
      const scheduledAt = Object.hasOwn(input, 'scheduledAt')
        ? (input.scheduledAt ? isoFromDateOnly(input.scheduledAt) : null)
        : (list === 'scheduled' ? tomorrowIso() : null);
      const repeat = cleanRepeat(input.repeat);
      const created = nowIso();
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM tasks WHERE archived = 0 AND trashed_at IS NULL').get().value;
      const id = randomUUID();
      insertTask.run(
        id,
        input.parentId || null,
        title,
        status,
        list,
        input.focus ? 1 : 0,
        area,
        section,
        input.priority || null,
        input.effort || effortForArea(area),
        input.notes || null,
        toJson(input.tags || tagsForArea(area)),
        input.dueAt ? isoFromDateOnly(input.dueAt) : null,
        input.energy || null,
        input.project || null,
        repeat,
        maxOrder + 1024,
        created,
        created,
        scheduledAt,
        null,
        0,
        null,
        null,
        null,
      );
      logEvent(id, 'task_created', { title, area, section, list, repeat });
      return { ok: true, id, title };
    },

    addSource(input) {
      const url = String(input.url || '').trim();
      if (!url) throw new Error('Source URL is required');
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error('Source URL is invalid');
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Source URL must be http or https');
      const existing = getSourceByUrl(parsedUrl.href);
      if (existing) {
        const updated = this.updateSource(existing.id, input);
        return { ...updated, existing: true };
      }
      const title = String(input.title || parsedUrl.href).trim();
      if (!title) throw new Error('Source title is required');
      const created = nowIso();
      const id = randomUUID();
      const status = cleanSourceStatus(input.status);
      insertSource.run(
        id,
        cleanSourceType(input.type),
        parsedUrl.href,
        title,
        input.author || null,
        status,
        input.summary || null,
        input.rawText || null,
        toJson(input.topics || []),
        input.publishedAt ? isoFromDate(input.publishedAt) : null,
        input.fetchedAt ? isoFromDate(input.fetchedAt) : null,
        created,
        created,
        status === 'archived' ? created : null,
      );
      logEvent(null, 'source_created', { id, title, url: parsedUrl.href, type: cleanSourceType(input.type), status });
      return { ok: true, id, title };
    },

    updateSource(id, input) {
      const source = getSource(id);
      if (!source) throw new Error('Source not found');
      const status = Object.hasOwn(input, 'status')
        ? cleanSourceStatus(input.status, source.status)
        : cleanSourceStatus(source.status);
      const archivedAt = status === 'archived'
        ? (source.archived_at || nowIso())
        : null;
      db.prepare(`
        UPDATE sources
        SET type = ?, title = ?, author = ?, status = ?, summary = ?, raw_text = ?,
            topics_json = ?, published_at = ?, fetched_at = ?, updated_at = ?, archived_at = ?
        WHERE id = ?
      `).run(
        Object.hasOwn(input, 'type') ? cleanSourceType(input.type, source.type) : source.type,
        Object.hasOwn(input, 'title') ? String(input.title || '').trim() || source.title : source.title,
        Object.hasOwn(input, 'author') ? input.author || null : source.author,
        status,
        Object.hasOwn(input, 'summary') ? input.summary || null : source.summary,
        Object.hasOwn(input, 'rawText') ? input.rawText || null : source.raw_text,
        Object.hasOwn(input, 'topics') ? toJson(input.topics || []) : source.topics_json,
        Object.hasOwn(input, 'publishedAt') ? (input.publishedAt ? isoFromDate(input.publishedAt) : null) : source.published_at,
        Object.hasOwn(input, 'fetchedAt') ? (input.fetchedAt ? isoFromDate(input.fetchedAt) : null) : source.fetched_at,
        nowIso(),
        archivedAt,
        id,
      );
      logEvent(null, 'source_updated', { id, title: source.title, status });
      return { ok: true, id, title: Object.hasOwn(input, 'title') ? input.title || source.title : source.title, status };
    },

    deleteSource(id) {
      const source = getSource(id);
      if (!source) throw new Error('Source not found');
      db.prepare('DELETE FROM sources WHERE id = ?').run(id);
      logEvent(null, 'source_deleted', { id, title: source.title });
      return { ok: true, id, title: source.title };
    },

    createTaskFromSource(sourceId, input = {}) {
      const source = getSource(sourceId);
      if (!source) throw new Error('Source not found');
      const type = cleanSourceType(source.type);
      const topics = fromJson(source.topics_json);
      const tags = [...new Set([type, 'reading', ...topics].filter(Boolean))];
      const notes = [
        source.url,
        source.summary,
        source.raw_text ? source.raw_text.slice(0, 4000) : '',
      ].filter(Boolean).join('\n\n');
      const task = this.addTask({
        title: input.title || `Read: ${source.title}`,
        area: input.area || 'learn',
        list: input.list || 'next',
        tags: input.tags || tags,
        notes: input.notes || notes,
        project: input.project || '',
      });
      db.prepare('INSERT OR IGNORE INTO source_tasks(source_id, task_id, relation, created_at) VALUES(?, ?, ?, ?)')
        .run(sourceId, task.id, input.relation || 'read', nowIso());
      if (source.status === 'unread') this.updateSource(sourceId, { status: 'reading' });
      logEvent(task.id, 'task_created_from_source', { sourceId, sourceTitle: source.title });
      return { ok: true, id: task.id, title: task.title, sourceId };
    },

    createNextRepeatTask(task, closedAt = nowIso()) {
      const repeat = cleanRepeat(task.repeat);
      const nextAt = nextRepeatDate(repeat, task.scheduled_at || task.due_at || closedAt);
      if (!repeat || !nextAt) return null;
      const created = nowIso();
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM tasks WHERE archived = 0 AND trashed_at IS NULL').get().value;
      const nextId = randomUUID();
      insertTask.run(
        nextId,
        task.parent_id || null,
        task.title,
        'TODO',
        'scheduled',
        0,
        task.area || 'other',
        task.section || sectionForArea(task.area),
        task.priority || null,
        task.effort || null,
        task.notes || null,
        task.tags_json || '[]',
        task.due_at ? nextAt : null,
        task.energy || null,
        task.project || null,
        repeat,
        maxOrder + 1024,
        created,
        created,
        nextAt,
        null,
        0,
        null,
        null,
        null,
      );
      logEvent(nextId, 'task_repeated', { from: task.id, title: task.title, repeat, scheduledAt: nextAt });
      return { id: nextId, title: task.title, scheduledAt: dateText(nextAt), repeat };
    },

    updateTaskState(id, todo) {
      if (!TODO_STATES.has(todo)) throw new Error(`Unsupported TODO state: ${todo}`);
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      const closedAt = DONE_STATES.has(todo) ? nowIso() : null;
      const list = todo === 'WAIT' ? 'waiting' : (todo === 'NEXT' ? 'next' : task.list);
      db.prepare('UPDATE tasks SET status = ?, list = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(todo, list, closedAt, nowIso(), id);
      const nextRepeat = DONE_STATES.has(todo) ? this.createNextRepeatTask(task, closedAt) : null;
      logEvent(id, 'task_status_changed', { from: task.status, to: todo });
      return { ok: true, id, title: task.title, todo, nextRepeat };
    },

    updateTask(id, input) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      const title = input.title === undefined ? task.title : slugTitle(input.title);
      if (!title) throw new Error('Task title is required');
      const status = input.todo || task.status;
      if (!TODO_STATES.has(status)) throw new Error(`Unsupported TODO state: ${status}`);
      const area = input.area || task.area;
      const section = input.section || sectionForArea(area);
      const list = cleanList(input.list, task.list || 'next');
      const focus = Object.hasOwn(input, 'focus') ? (input.focus ? 1 : 0) : task.focus;
      const scheduledAt = Object.hasOwn(input, 'scheduledAt')
        ? (input.scheduledAt ? isoFromDateOnly(input.scheduledAt) : null)
        : task.scheduled_at;
      const dueAt = Object.hasOwn(input, 'dueAt')
        ? (input.dueAt ? isoFromDateOnly(input.dueAt) : null)
        : task.due_at;
      const tags = Object.hasOwn(input, 'tags') ? toJson(input.tags || []) : task.tags_json;
      const repeat = Object.hasOwn(input, 'repeat') ? cleanRepeat(input.repeat) : cleanRepeat(task.repeat);
      const closedAt = DONE_STATES.has(status)
        ? (task.closed_at || nowIso())
        : null;
      db.prepare(`
        UPDATE tasks
        SET title = ?, status = ?, list = ?, focus = ?, area = ?, section = ?,
            effort = ?, notes = ?, tags_json = ?, scheduled_at = ?, due_at = ?,
            energy = ?, project = ?, repeat = ?, closed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        title,
        status,
        list,
        focus,
        area,
        section,
        input.effort === undefined ? task.effort : input.effort || null,
        input.notes === undefined ? task.notes : input.notes || null,
        tags,
        scheduledAt,
        dueAt,
        input.energy === undefined ? task.energy : input.energy || null,
        input.project === undefined ? task.project : input.project || null,
        repeat,
        closedAt,
        nowIso(),
        id,
      );
      logEvent(id, 'task_updated', { title, status, list, focus: Boolean(focus), area, section, repeat });
      return { ok: true, id, title, todo: status };
    },

    reorderTasks(ids) {
      if (!Array.isArray(ids) || ids.length < 2) return { ok: true, ids: Array.isArray(ids) ? ids : [] };
      const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
      if (uniqueIds.length < 2) return { ok: true, ids: uniqueIds };
      for (const id of uniqueIds) {
        if (!getTask(id)) throw new Error(`Task not found: ${id}`);
      }
      const updateOrder = db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND archived = 0 AND trashed_at IS NULL');
      const updatedAt = nowIso();
      db.exec('BEGIN');
      try {
        uniqueIds.forEach((id, index) => {
          updateOrder.run((index + 1) * 1024, updatedAt, id);
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      logEvent(null, 'tasks_reordered', { ids: uniqueIds });
      return { ok: true, ids: uniqueIds };
    },

    setTaskFocus(id, focus) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      db.prepare('UPDATE tasks SET focus = ?, updated_at = ? WHERE id = ?').run(focus ? 1 : 0, nowIso(), id);
      logEvent(id, 'task_focus_changed', { title: task.title, focus: Boolean(focus) });
      return { ok: true, id, title: task.title, focus: Boolean(focus) };
    },

    moveToLogbook(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      const closedAt = nowIso();
      db.prepare('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run('DONE', closedAt, closedAt, id);
      const nextRepeat = this.createNextRepeatTask(task, closedAt);
      logEvent(id, 'task_moved_to_logbook', { title: task.title });
      return { ok: true, id, title: task.title, nextRepeat };
    },

    convertToProject(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      db.prepare('UPDATE tasks SET status = ?, project = ?, updated_at = ? WHERE id = ?').run('PROJ', task.project || task.title, nowIso(), id);
      logEvent(id, 'task_converted_to_project', { title: task.title });
      return { ok: true, id, title: task.title };
    },

    copyTask(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      const created = nowIso();
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM tasks WHERE archived = 0 AND trashed_at IS NULL').get().value;
      const copyId = randomUUID();
      insertTask.run(
        copyId,
        task.parent_id || null,
        `${task.title} Copy`,
        DONE_STATES.has(task.status) ? 'TODO' : task.status,
        task.list || 'next',
        task.focus || 0,
        task.area || 'other',
        task.section || sectionForArea(task.area),
        task.priority || null,
        task.effort || null,
        task.notes || null,
        task.tags_json || '[]',
        task.due_at || null,
        task.energy || null,
        task.project || null,
        task.repeat || '',
        maxOrder + 1024,
        created,
        created,
        task.scheduled_at || null,
        null,
        0,
        null,
        null,
        null,
      );
      logEvent(copyId, 'task_copied', { from: id, title: task.title });
      return { ok: true, id: copyId, title: `${task.title} Copy` };
    },

    moveToTrash(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      db.prepare('UPDATE tasks SET trashed_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
      logEvent(id, 'task_trashed', { title: task.title });
      return { ok: true, id, title: task.title };
    },

    restoreTask(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      db.prepare('UPDATE tasks SET trashed_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
      logEvent(id, 'task_restored', { title: task.title });
      return { ok: true, id, title: task.title };
    },

    deleteTask(id) {
      const task = getTask(id);
      if (!task) throw new Error('Task not found');
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      logEvent(id, 'task_deleted', { title: task.title });
      return { ok: true, id, title: task.title };
    },

    emptyTrash() {
      const trashed = db.prepare('SELECT id, title FROM tasks WHERE trashed_at IS NOT NULL').all();
      db.prepare('DELETE FROM tasks WHERE trashed_at IS NOT NULL').run();
      logEvent(null, 'trash_emptied', { count: trashed.length, ids: trashed.map((task) => task.id) });
      return { ok: true, count: trashed.length };
    },

    getTask,
    getSource,

    exportOrgText() {
      const rows = allRows();
      const byParent = rowsForExport(rows);
      const sections = ['Inbox', 'Tasks', 'Work', 'Part-Time', 'Learning', 'Ideas'];
      const lines = ['#+TITLE: GTD Export', `#+DATE: ${orgTimestamp(nowIso())}`, ''];
      for (const section of sections) {
        lines.push(`* ${section}`);
        const sectionRows = (byParent.get('') || []).filter((row) => row.section === section);
        const sectionMap = new Map(byParent);
        sectionMap.set('', sectionRows);
        lines.push(...exportTree(sectionMap, '', 2));
      }
      return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
    },

    async writeOrgExport(file = config.exportFile || '~/org/gtd/agentdeck-export.org') {
      const target = expandHome(file);
      mkdirSync(path.dirname(target), { recursive: true });
      await writeFile(target, this.exportOrgText(), 'utf8');
      logEvent(null, 'org_export', { file: target });
      return { ok: true, file: target };
    },

    close() {
      db.close();
    },
  };
}
