import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DONE_STATES = new Set(['DONE', 'CANCELLED']);
const OPEN_STATES = new Set(['TODO', 'NEXT', 'PROJ', 'WAIT']);

export function expandHome(file) {
  if (!file) return file;
  if (file === '~') return os.homedir();
  if (file.startsWith('~/')) return path.join(os.homedir(), file.slice(2));
  return file;
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
  const [, y, m, d, hh, mm] = match;
  const time = hh === undefined
    ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  return Number.isNaN(time.getTime()) ? null : time;
}

const REPEAT_UNITS = { d: 'daily', w: 'weekly', m: 'monthly', y: 'yearly' };

function repeaterCookie(value) {
  const match = String(value || '').match(/[.+]{0,2}\+\d+([dwmy])/);
  return match ? REPEAT_UNITS[match[1]] : '';
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

const NOTE_AMBIGUOUS = /^(?:\*+\s|\s*:[A-Za-z]|(?:SCHEDULED|DEADLINE|CLOSED):)/;

function unescapeNoteLine(line) {
  return line.startsWith(',') && NOTE_AMBIGUOUS.test(line.slice(1)) ? line.slice(1) : line;
}

function notesBody(lines, start, nextStart) {
  const noteLines = [];
  let inProperties = false;
  for (let i = start + 1; i < nextStart; i += 1) {
    const line = lines[i];
    if (/^\s*:PROPERTIES:\s*$/i.test(line)) {
      inProperties = true;
      continue;
    }
    if (inProperties) {
      if (/^\s*:END:\s*$/i.test(line)) inProperties = false;
      continue;
    }
    if (/^\s*(SCHEDULED|DEADLINE|CLOSED):\s*/i.test(line)) continue;
    noteLines.push(unescapeNoteLine(line));
  }
  while (noteLines.length && !noteLines[0].trim()) noteLines.shift();
  while (noteLines.length && !noteLines[noteLines.length - 1].trim()) noteLines.pop();
  const notes = noteLines.join('\n');
  return notes.trim() ? notes : '';
}

function encodeId(file, line, title) {
  return Buffer.from(JSON.stringify({ file, line, title }), 'utf8').toString('base64url');
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
    entry.due = lineTimestamp(lines, start, nextStart, 'DEADLINE') || propertyValue(lines, start, nextStart, 'DEADLINE');
    entry.list = propertyValue(lines, start, nextStart, 'List') || '';
    entry.focus = /^(true|yes|1)$/i.test(propertyValue(lines, start, nextStart, 'Focus') || '');
    entry.energy = propertyValue(lines, start, nextStart, 'Energy') || '';
    entry.project = propertyValue(lines, start, nextStart, 'Project') || '';
    entry.repeat = propertyValue(lines, start, nextStart, 'Repeat')
      || propertyValue(lines, start, nextStart, 'REPEAT')
      || repeaterCookie(entry.scheduled)
      || repeaterCookie(entry.due)
      || '';
    entry.notes = notesBody(lines, start, nextStart);
    entry.createdTime = parseTimestamp(entry.created);
    entry.closedTime = parseTimestamp(entry.closed);
    entry.scheduledTime = parseTimestamp(entry.scheduled);
    entry.dueTime = parseTimestamp(entry.due);
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
