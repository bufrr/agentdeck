import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TODO_STATES = new Set(['TODO', 'NEXT', 'PROJ', 'WAIT', 'DONE', 'CANCELLED']);
const DONE_STATES = new Set(['DONE', 'CANCELLED']);
const OPEN_STATES = new Set(['TODO', 'NEXT', 'PROJ', 'WAIT']);
const AREA_SECTIONS = new Map([
  ['work', 'Work'],
  ['parttime', 'Part-Time'],
  ['learn', 'Learning'],
  ['other', 'Tasks'],
]);

export function expandHome(file) {
  if (!file) return file;
  if (file === '~') return os.homedir();
  if (file.startsWith('~/')) return path.join(os.homedir(), file.slice(2));
  return file;
}

export function htmlEscape(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugTitle(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (/^(AI|API|BTC|CLI|EVM|ETH|GTD|HTTP|JS|MEV|PR|RPC|SOL|TODO|UI|URL)$/.test(upper)) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function areaForEntry(entry) {
  const tags = entry.tags || [];
  if (entry.section === 'Work' || tags.includes('work')) return 'work';
  if (entry.section === 'Part-Time' || tags.includes('parttime') || tags.includes('part-time')) return 'parttime';
  if (entry.section === 'Learning' || tags.includes('learning')) return 'learn';
  return 'other';
}

function cleanTitle(title = '') {
  return title
    .replace(/^\s*(TODO|NEXT|PROJ|WAIT|DONE|CANCELLED)\s+/, '')
    .replace(/^\s*\[#.\]\s*/, '')
    .replace(/\[[0-9]+%]|\[[0-9]+\/[0-9]+]/g, '')
    .replace(/\s+:[\w@#%_:-]+:\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseHeading(line) {
  const match = line.match(/^(\*+)\s+(?:(TODO|NEXT|PROJ|WAIT|DONE|CANCELLED)\s+)?(?:\[#([A-Z])]\s+)?(.+?)\s*$/);
  if (!match) return null;
  let title = match[4].trim();
  let tags = [];
  const tagMatch = title.match(/\s+(:[\w@#%_:-]+:)\s*$/);
  if (tagMatch) {
    tags = tagMatch[1].split(':').filter(Boolean);
    title = title.slice(0, tagMatch.index).trim();
  }
  return {
    level: match[1].length,
    todo: match[2] || null,
    priority: match[3] || null,
    title: cleanTitle(title),
    rawTitle: title,
    tags,
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, hh = '00', mm = '00'] = match;
  const time = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  return Number.isNaN(time.getTime()) ? null : time;
}

function timestampText(date = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${days[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}]`;
}

function lineTimestamp(lines, start, nextStart, label) {
  const re = new RegExp(`^\\s*${label}:\\s*(.+)$`);
  for (let i = start + 1; i < nextStart; i += 1) {
    const match = lines[i].match(re);
    if (match) return match[1].trim();
  }
  return null;
}

function propertyValue(lines, start, nextStart, key) {
  const re = new RegExp(`^\\s*:${key}:\\s*(.+)\\s*$`, 'i');
  for (let i = start + 1; i < nextStart; i += 1) {
    const match = lines[i].match(re);
    if (match) return match[1].trim();
  }
  return null;
}

function priorityRank(entry) {
  if (entry.priority === 'A') return 0;
  if (entry.priority === 'B') return 1;
  if (entry.priority === 'C') return 2;
  return 3;
}

function effortMinutes(entry) {
  const match = String(entry.effort || '').match(/^(\d+):(\d{2})$/);
  if (!match) return 9999;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function sortActions(entries) {
  return [...entries].sort((a, b) => {
    const pa = priorityRank(a);
    const pb = priorityRank(b);
    if (pa !== pb) return pa - pb;
    const ea = effortMinutes(a);
    const eb = effortMinutes(b);
    if (ea !== eb) return ea - eb;
    return a.title.localeCompare(b.title);
  });
}

export function sortClosed(entries) {
  return [...entries].sort((a, b) => (b.closedTime?.getTime() || 0) - (a.closedTime?.getTime() || 0));
}

function encodeId(file, line, title) {
  return Buffer.from(JSON.stringify({ file, line, title }), 'utf8').toString('base64url');
}

export function decodeId(id) {
  return JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
}

function attachStats(entries) {
  const byIndex = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) {
    const children = entries.filter((candidate) => candidate.parent === entry);
    entry.children = children;
    entry.childPreview = children
      .filter((child) => child.todo)
      .slice(0, 5)
      .map((child) => ({
        depth: Math.max(1, child.level - entry.level),
        todo: child.todo,
        title: child.title,
      }));
  }

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const descendants = [];
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[j].level <= entry.level) break;
      if (entries[j].todo) descendants.push(entries[j]);
    }
    const total = descendants.length;
    const done = descendants.filter((item) => DONE_STATES.has(item.todo)).length;
    const open = descendants.filter((item) => OPEN_STATES.has(item.todo)).length;
    const next = descendants.filter((item) => item.todo === 'NEXT').length;
    const wait = descendants.filter((item) => item.todo === 'WAIT').length;
    const projects = descendants.filter((item) => item.todo === 'PROJ').length;
    entry.hasOpenDescendant = descendants.some((item) => OPEN_STATES.has(item.todo));
    entry.hasNextDescendant = descendants.some((item) => item.todo === 'NEXT');
    entry.subtasks = {
      total,
      done,
      open,
      next,
      wait,
      projects,
      percent: total ? Math.round((done / total) * 100) : 0,
    };
    const parent = entry.parent;
    if (parent && byIndex.has(parent)) {
      entry.parentStats = parent.subtasks;
    }
  }
  return entries;
}

export function parseOrg(text, file) {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const entries = [];
  const stack = [];

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseHeading(lines[i]);
    if (!parsed) continue;
    while (stack.length && stack[stack.length - 1].level >= parsed.level) stack.pop();
    const outlinePath = [...stack.map((item) => item.title), parsed.title];
    const entry = {
      ...parsed,
      id: encodeId(file, i + 1, parsed.title),
      file,
      line: i + 1,
      section: stack[0]?.title || parsed.title,
      parent: stack[stack.length - 1] || null,
      parentPath: stack.map((item) => item.title),
      outlinePath,
    };
    stack.push(entry);
    entries.push(entry);
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const nextStart = i + 1 < entries.length ? entries[i + 1].line - 1 : lines.length;
    const start = entry.line - 1;
    entry.effort = propertyValue(lines, start, nextStart, 'Effort');
    entry.created = propertyValue(lines, start, nextStart, 'Created') || propertyValue(lines, start, nextStart, 'CREATED');
    entry.closed = lineTimestamp(lines, start, nextStart, 'CLOSED') || propertyValue(lines, start, nextStart, 'CLOSED');
    entry.scheduled = lineTimestamp(lines, start, nextStart, 'SCHEDULED') || propertyValue(lines, start, nextStart, 'SCHEDULED');
    entry.repeat = propertyValue(lines, start, nextStart, 'Repeat') || propertyValue(lines, start, nextStart, 'REPEAT') || '';
    entry.createdTime = parseTimestamp(entry.created);
    entry.closedTime = parseTimestamp(entry.closed);
    entry.scheduledTime = parseTimestamp(entry.scheduled);
    entry.area = areaForEntry(entry);
  }

  return attachStats(entries).map((entry) => {
    const { parent, children, ...serializable } = entry;
    return {
      ...serializable,
      hasOpenChild: entry.hasOpenDescendant,
      hasNextChild: entry.hasNextDescendant,
      childrenCount: children.length,
    };
  });
}

export async function readEntries(files) {
  const entries = [];
  for (const file of files.filter(Boolean)) {
    const expanded = expandHome(file);
    try {
      const text = await readFile(expanded, 'utf8');
      entries.push(...parseOrg(text, expanded));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return entries;
}

export function groupEntries(entries, options = {}) {
  const days = options.days || 7;
  const staleDays = options.staleDays || 14;
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const staleCutoff = new Date(now.getTime() - staleDays * 86400000);
  const open = entries.filter((entry) => entry.todo && !DONE_STATES.has(entry.todo));
  const current = entries.filter((entry) => entry.isCurrent !== false);
  const currentOpen = current.filter((entry) => entry.todo && !DONE_STATES.has(entry.todo));
  const explicitNext = currentOpen.filter((entry) => entry.todo === 'NEXT');
  const candidateNext = currentOpen.filter((entry) => entry.todo === 'TODO' && !entry.hasOpenChild);
  const actions = sortActions([...explicitNext, ...candidateNext]);

  return {
    next: sortActions(explicitNext),
    candidates: sortActions(candidateNext),
    actions,
    inbox: current.filter((entry) => entry.level > 1 && entry.section === 'Inbox'),
    waiting: sortActions(currentOpen.filter((entry) => entry.todo === 'WAIT')),
    scheduled: sortActions(currentOpen.filter((entry) => entry.scheduled)),
    someday: current.filter((entry) => entry.level > 1 && entry.section === 'Ideas'),
    stale: sortActions(currentOpen.filter((entry) => ['TODO', 'NEXT'].includes(entry.todo) && entry.createdTime && entry.createdTime < staleCutoff)),
    completed: sortClosed(entries.filter((entry) => DONE_STATES.has(entry.todo) && entry.closedTime && entry.closedTime >= cutoff)),
    projectsMissingNext: sortActions(currentOpen.filter((entry) => entry.todo === 'PROJ' && !entry.hasNextChild)),
    areas: {
      work: actions.filter((entry) => entry.area === 'work'),
      parttime: actions.filter((entry) => entry.area === 'parttime'),
      learn: actions.filter((entry) => entry.area === 'learn'),
      other: actions.filter((entry) => entry.area === 'other'),
    },
    counts: {
      open: open.length,
      actions: actions.length,
      inbox: current.filter((entry) => entry.level > 1 && entry.section === 'Inbox').length,
      waiting: currentOpen.filter((entry) => entry.todo === 'WAIT').length,
      scheduled: currentOpen.filter((entry) => entry.scheduled).length,
      someday: current.filter((entry) => entry.level > 1 && entry.section === 'Ideas').length,
      stale: currentOpen.filter((entry) => ['TODO', 'NEXT'].includes(entry.todo) && entry.createdTime && entry.createdTime < staleCutoff).length,
    },
  };
}

export async function readGtdState(config) {
  const currentFile = expandHome(config.currentFile);
  const archiveFile = expandHome(config.archiveFile);
  const current = (await readEntries([currentFile])).map((entry) => ({ ...entry, isCurrent: true }));
  const archived = (await readEntries([archiveFile])).map((entry) => ({ ...entry, isCurrent: false }));
  const entries = [...current, ...archived];
  return {
    files: { current: currentFile, archive: archiveFile },
    generatedAt: new Date().toISOString(),
    groups: groupEntries(entries, config),
  };
}

function tagsForArea(area) {
  if (area === 'work') return ['work'];
  if (area === 'parttime') return ['parttime'];
  if (area === 'learn') return ['deep', 'learning'];
  return [];
}

function effortForArea(area) {
  if (area === 'learn') return '1:00';
  if (area === 'work') return '1:00';
  return '0:30';
}

function sectionForArea(area) {
  return AREA_SECTIONS.get(area) || 'Tasks';
}

function headingLine(todo, title, tags = []) {
  const tagText = tags.length ? ` :${tags.join(':')}:` : '';
  return `** ${todo ? `${todo} ` : ''}${title}${tagText}`;
}

async function backupFile(file) {
  const backupDir = path.join(path.dirname(file), 'backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
  const backup = path.join(backupDir, `${path.basename(file, '.org')}-${stamp}.org`);
  await copyFile(file, backup);
  return backup;
}

export async function addTask(config, input) {
  const currentFile = expandHome(config.currentFile);
  const area = input.area || 'other';
  const title = slugTitle(input.title);
  if (!title) throw new Error('Task title is required');
  const text = await readFile(currentFile, 'utf8');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const section = sectionForArea(area);
  const sectionIndex = lines.findIndex((line) => line.trim() === `* ${section}`);
  if (sectionIndex === -1) throw new Error(`Missing GTD section: ${section}`);

  let insertAt = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    if (/^\* [^*]/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }

  const tags = tagsForArea(area);
  const block = [
    headingLine(input.todo || 'TODO', title, tags),
    '   :PROPERTIES:',
    `   :Effort: ${effortForArea(area)}`,
    `   :Created: ${timestampText()}`,
    '   :Source: agentdeck',
    '   :END:',
    '',
  ];

  await backupFile(currentFile);
  lines.splice(insertAt, 0, ...block);
  await writeFile(currentFile, lines.join('\n'), 'utf8');
  return { ok: true, title };
}

export async function updateTaskState(config, id, todo) {
  if (!TODO_STATES.has(todo)) throw new Error(`Unsupported TODO state: ${todo}`);
  const currentFile = expandHome(config.currentFile);
  const target = decodeId(id);
  if (path.resolve(target.file) !== path.resolve(currentFile)) {
    throw new Error('Refusing to mutate non-current org file');
  }
  const text = await readFile(currentFile, 'utf8');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = Number(target.line) - 1;
  if (!lines[index] || !lines[index].includes(target.title)) {
    index = lines.findIndex((line) => line.startsWith('*') && line.includes(target.title));
  }
  if (index < 0) throw new Error(`Cannot find task: ${target.title}`);
  const parsed = parseHeading(lines[index]);
  if (!parsed || !parsed.todo) throw new Error(`Target is not a TODO item: ${target.title}`);
  const stars = '*'.repeat(parsed.level);
  const priority = parsed.priority ? `[#${parsed.priority}] ` : '';
  const tags = parsed.tags.length ? ` :${parsed.tags.join(':')}:` : '';
  lines[index] = `${stars} ${todo} ${priority}${parsed.title}${tags}`;
  if (DONE_STATES.has(todo)) {
    const nextHeading = lines.findIndex((line, i) => i > index && /^\*+\s+/.test(line));
    const end = nextHeading === -1 ? lines.length : nextHeading;
    const hasClosed = lines.slice(index + 1, end).some((line) => /^\s*CLOSED:/.test(line));
    if (!hasClosed) lines.splice(index + 1, 0, `   CLOSED: ${timestampText()}`);
  }
  await backupFile(currentFile);
  await writeFile(currentFile, lines.join('\n'), 'utf8');
  return { ok: true, title: parsed.title, todo };
}
