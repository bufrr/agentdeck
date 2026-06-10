const VIEWS = {
  inbox: { title: 'Inbox', subtitle: "New / unprocessed to-do's", group: 'inbox', empty: 'Your Inbox is empty' },
  focus: { title: 'Focus', subtitle: 'Today', group: 'focus', empty: 'Focus list is empty' },
  today: { title: 'Today', subtitle: 'Due, scheduled, and focused', group: 'all', empty: 'Nothing planned for today', chips: true },
  forecast: { title: 'Forecast', subtitle: 'Next 14 days', group: 'all', empty: 'No upcoming dated tasks', chips: true },
  next: { title: 'Next', subtitle: "To-do's for anytime", group: 'actions', section: 'Actions', empty: 'Next list is empty', chips: true },
  projects: { title: 'Projects', subtitle: 'Open loops with visible next actions', group: 'projects', empty: 'No active projects' },
  review: { title: 'Review', subtitle: 'Weekly clarity check', group: 'all', empty: 'Nothing to review' },
  later: { title: 'Later', subtitle: "To-do's for later", group: 'later', empty: 'Later list is empty' },
  scheduled: { title: 'Scheduled', subtitle: '... for a future date', group: 'scheduled', empty: 'You have nothing Scheduled' },
  someday: { title: 'Someday', subtitle: 'Maybe', group: 'someday', empty: 'Someday list is empty' },
  waiting: { title: 'Waiting', subtitle: '... for someone / on hold', group: 'waiting', empty: 'You are not currently Waiting on anyone' },
  work: { title: 'Work', subtitle: 'Project actions', area: 'work', empty: 'Work list is empty' },
  parttime: { title: 'Part-Time', subtitle: 'Project actions', area: 'parttime', empty: 'Part-Time list is empty' },
  learn: { title: 'Learning', subtitle: 'Project actions', area: 'learn', empty: 'Learning list is empty' },
  other: { title: 'Other', subtitle: 'Project actions', area: 'other', empty: 'Other list is empty' },
  sourceInbox: { title: 'Source Inbox', subtitle: 'Captured links to process', sourceGroup: 'inbox', empty: 'Source inbox is empty' },
  sourceReading: { title: 'Reading', subtitle: 'Sources currently being read', sourceGroup: 'reading', empty: 'Reading list is empty' },
  sourceTwitter: { title: 'Twitter Sources', subtitle: 'Threads and posts', sourceGroup: 'twitter', empty: 'No Twitter sources' },
  sourceArticles: { title: 'Articles', subtitle: 'Articles, docs, and web pages', sourceGroup: 'articles', empty: 'No article sources' },
  sourceVideos: { title: 'Videos', subtitle: 'YouTube and video links', sourceGroup: 'videos', empty: 'No video sources' },
  sourcePdfs: { title: 'PDFs', subtitle: 'PDF reading queue', sourceGroup: 'pdfs', empty: 'No PDF sources' },
  sourceProcessed: { title: 'Processed Sources', subtitle: 'Sources already reviewed', sourceGroup: 'processed', empty: 'No processed sources' },
  logbook: { title: 'Logbook', subtitle: 'Recently completed', group: 'completed', section: 'Done', empty: 'No completed tasks found', showClosed: true },
  trash: { title: 'Trash', subtitle: '... to be deleted', group: 'trash', empty: 'Trash is empty.' },
};

const VIEW_ORDER = ['inbox', 'focus', 'today', 'forecast', 'next', 'later', 'scheduled', 'someday', 'waiting', 'projects', 'review', 'work', 'parttime', 'learn', 'other', 'sourceInbox', 'sourceReading', 'sourceTwitter', 'sourceArticles', 'sourceVideos', 'sourcePdfs', 'sourceProcessed', 'logbook', 'trash'];

const LIST_LABELS = {
  inbox: 'Inbox',
  next: 'Next',
  later: 'Later',
  scheduled: 'Scheduled',
  someday: 'Someday',
  waiting: 'Waiting',
};

const AREA_LABELS = {
  work: 'Work',
  parttime: 'Part-Time',
  learn: 'Learning',
  other: 'Other',
};

const TIME_OPTIONS = ['', '5m', '10m', '15m', '30m', '45m', '1h', '2h', '3h', '4h', '6h', '8h', 'whoa nelly!'];
const ENERGY_OPTIONS = ['', 'low', 'medium', 'high'];
const TIME_LABELS = {
  '5m': '5 minutes',
  '10m': '10 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '45m': '45 minutes',
  '1h': '1 hour',
  '2h': '2 hours',
  '3h': '3 hours',
  '4h': '4 hours',
  '6h': '6 hours',
  '8h': '8 hours',
};
const ENERGY_LABELS = {
  low: '• low',
  medium: '•• med',
  high: '••• high',
};
const REPEAT_LABELS = {
  '': 'none',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
};
const SOURCE_TYPE_LABELS = {
  twitter: 'Twitter',
  article: 'Article',
  youtube: 'Video',
  pdf: 'PDF',
  github: 'GitHub',
  doc: 'Doc',
  other: 'Source',
};
const SOURCE_STATUS_LABELS = {
  unread: 'Unread',
  reading: 'Reading',
  processed: 'Processed',
  archived: 'Archived',
};
const DEFAULT_CONTEXT_TAGS = ['AI', 'blockchain', 'Errand', 'gateway', 'Home', 'Important', 'Pending', 'work', 'Work'];
const DONE_TODOS = new Set(['DONE', 'CANCELLED']);
const ACTIVE_STALE_DAYS = 14;
const DEFERRED_REVIEW_DAYS = 30;
const FORECAST_DAYS = 14;

let state = null;
let currentView = 'next';
let currentProject = '';
let currentContext = 'all';
let currentSourceId = '';
let areaFilter = 'all';
let tagFilter = 'all';
let timeFilter = 'all';
let energyFilter = 'all';
let editingId = null;
let editDraft = null;
let editError = '';
let creatingTask = false;
let menuId = null;
let todayPlannerMode = false;
let noteMode = localStorage.getItem('gtd-note-mode') || 'preview';
let draggingId = null;
let dragOverId = null;
let dragPosition = null;
let pointerDrag = null;
let highlightedTaskId = '';
let highlightedTaskTimer = 0;
let pendingMutations = 0;
let mutationVersion = 0;
let stateSyncTimer = 0;

const DRAG_START_DISTANCE = 8;

const els = {
  title: document.querySelector('#view-title'),
  subtitle: document.querySelector('#view-subtitle'),
  chips: document.querySelector('#chips'),
  content: document.querySelector('#content'),
  search: document.querySelector('#search'),
  form: document.querySelector('#quick-add'),
  addStatus: document.querySelector('#add-status'),
  updated: document.querySelector('#updated'),
  rail: document.querySelector('.rail'),
  projectList: document.querySelector('#project-list'),
  projectSummary: document.querySelector('#project-summary'),
  tagList: document.querySelector('#tag-list'),
  settings: document.querySelector('#settings'),
  settingsPanel: document.querySelector('#settings-panel'),
  settingsClose: document.querySelector('#settings-close'),
  exportOrg: document.querySelector('#export-org'),
  exportStatus: document.querySelector('#export-status'),
  storagePrimary: document.querySelector('#storage-primary'),
  storageExport: document.querySelector('#storage-export'),
  storageDb: document.querySelector('#storage-db'),
};
els.titleInput = els.form.elements.title;
els.areaSelect = els.form.elements.area;

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlLines(value = '') {
  return esc(value).replaceAll('\n', '<br>');
}

function dateOnly(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function todayStart() {
  return startOfDay();
}

function relativeDate(days) {
  const date = todayStart();
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

function nextWeekDate() {
  return relativeDate(7);
}

function minutesForEffort(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text === 'whoa nelly!') return Number.MAX_SAFE_INTEGER;
  const minuteMatch = text.match(/^(\d+)m$/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = text.match(/^(\d+)h$/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  const clockMatch = text.match(/^(\d+):(\d{2})$/);
  if (clockMatch) return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);
  return null;
}

function isDoneEntry(entry) {
  return DONE_TODOS.has(entry?.todo);
}

function uniqueEntries(entries) {
  return [...new Map(entries.filter(Boolean).map((entry) => [entry.id, entry])).values()];
}

function cloneState() {
  return state ? JSON.parse(JSON.stringify(state)) : null;
}

function renderLocalState() {
  if (!state) return;
  setCounts();
  renderStorage();
  render();
}

function restoreLocalState(snapshot) {
  if (!snapshot) return;
  state = snapshot;
  renderLocalState();
}

function updateLocalTask(id, updater) {
  if (!state?.groups) return;
  for (const value of Object.values(state.groups)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry === 'object' && entry.id === id) updater(entry);
    }
  }
}

function sortLocalSources(sources) {
  return [...sources].sort((a, b) => {
    const rank = (source) => source.status === 'unread' ? 0 : source.status === 'reading' ? 1 : source.status === 'processed' ? 2 : 3;
    const statusOrder = rank(a) - rank(b);
    if (statusOrder) return statusOrder;
    return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || ''))
      || String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function sourceRowsForLocalState() {
  if (!state?.sources) return [];
  const rows = new Map();
  for (const value of Object.values(state.sources)) {
    if (!Array.isArray(value)) continue;
    for (const source of value) {
      if (source?.id) rows.set(source.id, source);
    }
  }
  return [...rows.values()];
}

function rebuildLocalSourceGroups() {
  if (!state?.sources) return;
  const rows = sourceRowsForLocalState();
  const active = rows.filter((source) => source.status !== 'archived' && !source.archived);
  const archived = rows.filter((source) => source.status === 'archived' || source.archived);
  state.sources = {
    all: sortLocalSources(active),
    inbox: sortLocalSources(active.filter((source) => source.status === 'unread')),
    reading: sortLocalSources(active.filter((source) => source.status === 'reading')),
    twitter: sortLocalSources(active.filter((source) => source.type === 'twitter')),
    articles: sortLocalSources(active.filter((source) => ['article', 'github', 'doc', 'other'].includes(source.type))),
    videos: sortLocalSources(active.filter((source) => source.type === 'youtube')),
    pdfs: sortLocalSources(active.filter((source) => source.type === 'pdf')),
    processed: sortLocalSources(active.filter((source) => source.status === 'processed')),
    archived: sortLocalSources(archived),
    counts: {},
  };
  state.sources.counts = {
    sourceInbox: state.sources.inbox.length,
    sourceReading: state.sources.reading.length,
    sourceTwitter: state.sources.twitter.length,
    sourceArticles: state.sources.articles.length,
    sourceVideos: state.sources.videos.length,
    sourcePdfs: state.sources.pdfs.length,
    sourceProcessed: state.sources.processed.length,
  };
}

function optimisticPatchSource(id, body) {
  for (const source of sourceRowsForLocalState()) {
    if (source.id !== id) continue;
    if (Object.hasOwn(body, 'status')) {
      source.status = body.status;
      source.archived = body.status === 'archived';
    }
    if (Object.hasOwn(body, 'title')) source.title = body.title || source.title;
    if (Object.hasOwn(body, 'type')) source.type = body.type || source.type;
    if (Object.hasOwn(body, 'summary')) source.summary = body.summary || '';
    source.updated = dateOnly(new Date());
  }
  rebuildLocalSourceGroups();
  renderLocalState();
}

function sectionForArea(area) {
  return AREA_LABELS[area] || 'Other';
}

function localDateOrNull(value) {
  return value ? String(value).slice(0, 10) : null;
}

function localTaskPatchFromBody(body, entry = {}) {
  const patch = {};
  if (Object.hasOwn(body, 'title')) {
    patch.title = body.title;
    patch.rawTitle = body.title;
  }
  if (Object.hasOwn(body, 'todo')) {
    patch.todo = body.todo;
    if (isDoneEntry(patch)) patch.closed = dateOnly(new Date());
    else patch.closed = null;
  }
  if (Object.hasOwn(body, 'list')) patch.list = body.list;
  if (Object.hasOwn(body, 'focus')) patch.focus = Boolean(body.focus);
  if (Object.hasOwn(body, 'area')) {
    patch.area = body.area || entry.area || 'other';
    patch.section = sectionForArea(patch.area);
  }
  if (Object.hasOwn(body, 'effort')) {
    patch.effort = body.effort || '';
    patch.time = patch.effort;
  }
  if (Object.hasOwn(body, 'energy')) patch.energy = body.energy || '';
  if (Object.hasOwn(body, 'project')) patch.project = body.project || '';
  if (Object.hasOwn(body, 'repeat')) patch.repeat = body.repeat || '';
  if (Object.hasOwn(body, 'notes')) patch.notes = body.notes || '';
  if (Object.hasOwn(body, 'tags')) patch.tags = Array.isArray(body.tags) ? body.tags : [];
  if (Object.hasOwn(body, 'scheduledAt') && body.scheduledAt !== undefined) patch.scheduled = localDateOrNull(body.scheduledAt);
  if (Object.hasOwn(body, 'dueAt') && body.dueAt !== undefined) patch.due = localDateOrNull(body.dueAt);
  return patch;
}

function optimisticPatchTask(id, body) {
  const entry = entryById(id);
  const patch = localTaskPatchFromBody(body, entry);
  updateLocalTask(id, (task) => Object.assign(task, patch));
  editingId = null;
  creatingTask = false;
  menuId = null;
  renderLocalState();
}

function optimisticTrashTask(id, trashed) {
  updateLocalTask(id, (task) => {
    task.trashed = Boolean(trashed);
    task.trashedAt = trashed ? new Date().toISOString() : null;
  });
  editingId = null;
  creatingTask = false;
  menuId = null;
  renderLocalState();
}

function scheduledIsDueForNext(entry) {
  const scheduled = dateValue(entry.scheduled);
  if (!scheduled) return true;
  return scheduled <= todayStart();
}

function minDate(...dates) {
  return dates.filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

function forecastDate(entry) {
  return minDate(dateValue(entry.scheduled), dateValue(entry.due));
}

function isTodayAction(entry) {
  if (!entry.isCurrent || entry.trashed || isDoneEntry(entry)) return false;
  const today = todayStart();
  const scheduled = dateValue(entry.scheduled);
  const due = dateValue(entry.due);
  const hasFutureDate = (scheduled && scheduled > today) || (due && due > today);
  return (scheduled && scheduled <= today) || (due && due <= today) || (entry.focus && !hasFutureDate);
}

function isForecastAction(entry) {
  if (!entry.isCurrent || entry.trashed || isDoneEntry(entry)) return false;
  const date = forecastDate(entry);
  if (!date) return false;
  const today = todayStart();
  return date < today || date <= addDays(today, FORECAST_DAYS);
}

function compareTaskTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function compareTaskPosition(a, b) {
  const aOrder = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder || compareTaskTitle(a, b);
}

function compareForecastDate(a, b) {
  const aDate = forecastDate(a)?.getTime() || Number.MAX_SAFE_INTEGER;
  const bDate = forecastDate(b)?.getTime() || Number.MAX_SAFE_INTEGER;
  return aDate - bDate;
}

function sortByForecastDate(entries) {
  return [...entries].sort((a, b) => compareForecastDate(a, b) || compareTaskPosition(a, b));
}

function sortByProject(entries, fallbackCompare = compareTaskPosition) {
  return [...entries].sort((a, b) => compareProjectBelonging(a, b) || fallbackCompare(a, b) || compareTaskPosition(a, b));
}

function todoForPlannedEntry(entry) {
  return entry?.list === 'waiting' || entry?.todo === 'WAIT' ? 'WAIT' : 'TODO';
}

function isTodayOrPast(value) {
  const date = dateValue(value);
  return Boolean(date && date <= todayStart());
}

function plannedDatePatch(entry, value) {
  const date = value || '';
  const patch = {
    todo: todoForPlannedEntry(entry),
  };
  if (isTodayOrPast(date)) patch.focus = true;
  if (entry?.due && !entry?.scheduled) {
    patch.dueAt = date;
  } else {
    patch.scheduledAt = date;
    patch.list = isTodayOrPast(date) ? 'next' : 'scheduled';
  }
  return patch;
}

function plannerPatch(entry, plan) {
  if (plan === 'today') return plannedDatePatch(entry, relativeDate(0));
  if (plan === 'tomorrow') return plannedDatePatch(entry, relativeDate(1));
  if (plan === 'next-week') return plannedDatePatch(entry, nextWeekDate());
  if (plan === 'no-date') {
    return {
      scheduledAt: '',
      dueAt: '',
      list: entry?.list === 'scheduled' ? 'next' : entry?.list || 'next',
      todo: todoForPlannedEntry(entry),
    };
  }
  if (plan === 'not-today') {
    const tomorrow = relativeDate(1);
    const due = dateValue(entry?.due);
    return {
      scheduledAt: tomorrow,
      dueAt: due && due <= todayStart() ? tomorrow : undefined,
      list: 'scheduled',
      focus: false,
      todo: todoForPlannedEntry(entry),
    };
  }
  return {};
}

function entryBelongsToListView(entry, viewId) {
  if (viewId === 'next') return entry.list === 'next' || (entry.list === 'scheduled' && scheduledIsDueForNext(entry));
  if (viewId === 'scheduled') return entry.list === 'scheduled' || Boolean(entry.scheduled);
  if (viewId === 'waiting') return entry.list === 'waiting' || entry.todo === 'WAIT';
  return entry.list === viewId;
}

function isTodayPlannerCandidate(entry) {
  return entry.isCurrent
    && !entry.trashed
    && !isDoneEntry(entry)
    && entryBelongsToListView(entry, 'next')
    && !isTodayAction(entry);
}

function entriesForView(viewId) {
  const view = VIEWS[viewId];
  if (viewId === 'source') {
    const source = sourceById(currentSourceId);
    return source ? [source] : [];
  }
  if (view?.sourceGroup) {
    return sourcesForGroup(view.sourceGroup);
  }
  const entries = entriesForSearch();
  if (viewId === 'context') {
    const tagged = entries.filter((entry) => {
      if (!entry.isCurrent || entry.trashed || isDoneEntry(entry)) return false;
      if (currentContext === 'all') return true;
      const tags = entry.tags || [];
      return currentContext === '-' ? tags.length === 0 : tags.includes(currentContext);
    });
    return filterEntries(sortByProject(tagged), viewId);
  }
  if (viewId === 'project') return filterEntries(entriesForProject(currentProject), viewId);
  if (viewId === 'projects') return filterEntries(projectRows(), viewId);
  if (viewId === 'review') return filterEntries(entriesForReview(), viewId);
  if (viewId === 'today') {
    const selected = todayPlannerMode
      ? entries.filter((entry) => isTodayAction(entry) || isTodayPlannerCandidate(entry))
      : entries.filter(isTodayAction);
    return filterEntries(sortByProject(selected, (a, b) => compareForecastDate(a, b) || compareTaskPosition(a, b)), viewId);
  }
  if (viewId === 'forecast') return filterEntries(sortByProject(entries.filter(isForecastAction), (a, b) => compareForecastDate(a, b) || compareTaskPosition(a, b)), viewId);
  if (viewId === 'logbook') return filterEntries(entries.filter((entry) => !entry.trashed && isDoneEntry(entry)), viewId);
  if (viewId === 'trash') return filterEntries(entries.filter((entry) => entry.trashed), viewId);
  const taskView = view || VIEWS.next;
  if (taskView.area) {
    return filterEntries(entries.filter((entry) => entry.isCurrent && !entry.trashed && entry.area === taskView.area), viewId);
  }
  if (viewId === 'focus') {
    return filterEntries(entries.filter((entry) => entry.isCurrent && !entry.trashed && !isDoneEntry(entry) && entry.focus), viewId);
  }
  if (viewId === 'next') {
    return filterEntries(sortByProject(entries.filter((entry) => entry.isCurrent && !entry.trashed && entryBelongsToListView(entry, viewId))), viewId);
  }
  if (['inbox', 'later', 'scheduled', 'someday', 'waiting'].includes(viewId)) {
    return filterEntries(entries.filter((entry) => entry.isCurrent && !entry.trashed && entryBelongsToListView(entry, viewId)), viewId);
  }
  const list = state.groups[taskView.group] || [];
  return filterEntries(list, viewId);
}

function projectSlug(name) {
  return encodeURIComponent(name);
}

function projectNameFromSlug(slug) {
  try {
    return decodeURIComponent(slug || '');
  } catch {
    return slug || '';
  }
}

function projectFromHash(hashValue) {
  const hash = String(hashValue || '').replace(/^#/, '');
  if (!hash.startsWith('project/')) return null;
  return projectNameFromSlug(hash.slice('project/'.length));
}

function contextSlug(name) {
  return encodeURIComponent(name);
}

function contextNameFromSlug(slug) {
  try {
    return decodeURIComponent(slug || '');
  } catch {
    return slug || '';
  }
}

function contextFromHash(hashValue) {
  const hash = String(hashValue || '').replace(/^#/, '');
  if (!hash.startsWith('context/')) return null;
  return contextNameFromSlug(hash.slice('context/'.length)) || 'all';
}

function contextLabel(name) {
  if (name === 'all') return 'All Contexts';
  if (name === '-') return 'No Tags';
  return name || 'Context';
}

function sourceSlug(id) {
  return encodeURIComponent(id);
}

function sourceIdFromSlug(slug) {
  try {
    return decodeURIComponent(slug || '');
  } catch {
    return slug || '';
  }
}

function sourceFromHash(hashValue) {
  const hash = String(hashValue || '').replace(/^#/, '');
  if (!hash.startsWith('source/')) return null;
  return sourceIdFromSlug(hash.slice('source/'.length));
}

function projectByName(name) {
  const projects = state?.groups?.projects || [];
  return projects.find((project) => project.name === name) || null;
}

function firstProjectName() {
  return state?.groups?.projects?.[0]?.name || '';
}

function effectiveProjectName(name = currentProject) {
  return projectByName(name)?.name || firstProjectName();
}

function isProjectEntry(entry, projectName) {
  return Boolean(projectName) && (
    entry.project === projectName ||
    (entry.todo === 'PROJ' && entry.title === projectName) ||
    (entry.parentPath || []).includes(projectName) ||
    ((entry.outlinePath || []).includes(projectName) && entry.title !== projectName)
  );
}

function projectNameForEntry(entry) {
  if (!entry) return '';
  if (entry.project) return entry.project;
  if (entry.todo === 'PROJ') return entry.title;
  const path = [...(entry.parentPath || []), ...(entry.outlinePath || [])];
  return (state?.groups?.projects || [])
    .map((project) => project.name)
    .find((name) => name && entry.title !== name && path.includes(name)) || '';
}

function projectSortRank(projectName) {
  if (!projectName) return Number.MAX_SAFE_INTEGER;
  const index = (state?.groups?.projects || []).findIndex((project) => project.name === projectName);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER - 1;
}

function compareProjectBelonging(a, b) {
  const aProject = projectNameForEntry(a);
  const bProject = projectNameForEntry(b);
  if (aProject === bProject) return 0;
  const aRank = projectSortRank(aProject);
  const bRank = projectSortRank(bProject);
  return aRank - bRank || aProject.localeCompare(bProject);
}

function entriesForProject(projectName) {
  const project = effectiveProjectName(projectName);
  if (!project) return [];
  return entriesForSearch().filter((entry) => !entry.trashed && isProjectEntry(entry, project));
}

function projectActionEntries(projectName, entries = entriesForProject(projectName)) {
  return entries.filter((entry) => !(entry.todo === 'PROJ' && entry.title === projectName));
}

function projectProgressStats(projectName, entries = entriesForProject(projectName)) {
  const actions = projectActionEntries(projectName, entries);
  const done = actions.filter(isDoneEntry).length;
  const open = actions.filter((entry) => entry.isCurrent && !isDoneEntry(entry)).length;
  const next = actions.filter((entry) => entry.isCurrent && entry.list === 'next').length;
  const wait = actions.filter((entry) => entry.isCurrent && (entry.list === 'waiting' || entry.todo === 'WAIT')).length;
  const projects = actions.filter((entry) => entry.todo === 'PROJ').length;
  const total = actions.length;
  return {
    total,
    done,
    open,
    next,
    wait,
    projects,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

function projectRows() {
  return entriesForSearch()
    .filter((entry) => entry.todo === 'PROJ' && entry.isCurrent && !entry.trashed)
    .sort((a, b) => (a.area || '').localeCompare(b.area || '') || a.title.localeCompare(b.title));
}

function allCurrentEntries() {
  return entriesForSearch().filter((entry) => entry.isCurrent && !entry.trashed);
}

function daysAgo(days) {
  return addDays(todayStart(), -days);
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDoneRecently(entry, days = 7) {
  const closed = dateValue(entry.closed);
  return Boolean(closed && closed >= daysAgo(days));
}

function isStaleOpen(entry, days = ACTIVE_STALE_DAYS) {
  if (!entry.isCurrent || entry.trashed || isDoneEntry(entry)) return false;
  if (!['inbox', 'next'].includes(entry.list)) return false;
  const created = dateValue(entry.created);
  return Boolean(created && created < daysAgo(days) && !entry.scheduled);
}

function isDueOrOverdue(entry) {
  const due = dateValue(entry.due);
  return Boolean(due && due <= todayStart());
}

function isDeferredReviewDue(entry, days = DEFERRED_REVIEW_DAYS) {
  if (!entry.isCurrent || entry.trashed || isDoneEntry(entry)) return false;
  if (!['later', 'someday'].includes(entry.list)) return false;
  if (entry.scheduled) return false;
  const created = dateValue(entry.created);
  return isDueOrOverdue(entry) || Boolean(created && created < daysAgo(days));
}

function projectHasNextAction(projectName) {
  return projectActionEntries(projectName)
    .some((entry) => entry.isCurrent && !entry.trashed && !isDoneEntry(entry) && entry.list === 'next');
}

function entriesForReview() {
  const current = allCurrentEntries();
  const completed = state.groups.completed || [];
  const review = [
    ...current.filter((entry) => entry.list === 'inbox'),
    ...current.filter((entry) => entry.list === 'waiting' || entry.todo === 'WAIT'),
    ...current.filter((entry) => entry.list === 'scheduled'),
    ...current.filter(isStaleOpen),
    ...current.filter(isDeferredReviewDue),
    ...projectRows(),
    ...completed.filter((entry) => isDoneRecently(entry, 7)),
  ];
  return [...new Map(review.map((entry) => [entry.id, entry])).values()];
}

function entriesForSearch() {
  const seen = new Map();
  for (const entry of [
    ...(state.groups.all || []),
    ...(state.groups.completed || []),
    ...(state.groups.trash || []),
  ]) {
    seen.set(entry.id, entry);
  }
  return [...seen.values()];
}

function allSources() {
  return state?.sources?.all || [];
}

function sourceById(id) {
  return allSources()
    .concat(state?.sources?.archived || [])
    .find((source) => source.id === id) || null;
}

function sourcesForGroup(group) {
  return [...(state?.sources?.[group] || [])];
}

function filterEntries(entries, viewId = currentView) {
  let filtered = entries;
  if (['next', 'review'].includes(viewId) && areaFilter !== 'all') {
    filtered = filtered.filter((entry) => entry.area === areaFilter);
  }
  if (timeFilter !== 'all') {
    const limit = minutesForEffort(timeFilter);
    filtered = filtered.filter((entry) => {
      const minutes = minutesForEffort(entry.effort);
      return minutes !== null && minutes <= limit;
    });
  }
  if (energyFilter !== 'all') {
    filtered = filtered.filter((entry) => entry.energy === energyFilter);
  }
  if (tagFilter !== 'all') {
    filtered = filtered.filter((entry) => {
      const tags = entry.tags || [];
      return tagFilter === '-' ? tags.length === 0 : tags.includes(tagFilter);
    });
  }
  return filtered;
}

function resetViewState() {
  areaFilter = 'all';
  tagFilter = 'all';
  timeFilter = 'all';
  energyFilter = 'all';
  todayPlannerMode = false;
  creatingTask = false;
  editingId = null;
  menuId = null;
}

function listForCurrentView() {
  if (['inbox', 'next', 'later', 'scheduled', 'someday', 'waiting'].includes(currentView)) return currentView;
  if (currentView === 'project') return 'next';
  if (currentView === 'focus') return 'next';
  return 'next';
}

function viewForTask(entry) {
  if (!entry) return 'next';
  if (entry.trashed) return 'trash';
  if (isDoneEntry(entry)) return 'logbook';
  if (entry.list === 'inbox') return 'inbox';
  if (entry.list === 'later') return 'later';
  if (entry.list === 'scheduled') return 'scheduled';
  if (entry.list === 'someday') return 'someday';
  if (entry.list === 'waiting' || entry.todo === 'WAIT') return 'waiting';
  return 'next';
}

function todoForList(list) {
  return list === 'waiting' ? 'WAIT' : 'TODO';
}

function entryById(id) {
  return entriesForSearch().find((entry) => entry.id === id) || null;
}

function matchesSearch(entry) {
  const query = els.search.value.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    entry.todo,
    entry.title,
    entry.url,
    entry.author,
    entry.status,
    entry.type,
    entry.summary,
    entry.rawText,
    entry.section,
    entry.area,
    entry.effort,
    entry.energy,
    entry.project,
    entry.due,
    entry.list,
    entry.scheduled,
    entry.closed,
    ...(entry.tags || []),
    ...(entry.topics || []),
    ...(entry.outlinePath || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function entriesForRender(query) {
  const entries = entriesForView(currentView);
  return query ? entries.filter(matchesSearch) : entries;
}

function setCounts() {
  const entries = entriesForSearch();
  const active = entries.filter((entry) => entry.isCurrent && !entry.trashed && !isDoneEntry(entry));
  const counts = {
    inbox: active.filter((entry) => entry.list === 'inbox').length,
    focus: active.filter((entry) => entry.focus).length,
    today: entries.filter(isTodayAction).length,
    forecast: entries.filter(isForecastAction).length,
    actions: active.filter((entry) => entryBelongsToListView(entry, 'next')).length,
    projects: projectRows().length,
    review: entriesForReview().length,
    later: active.filter((entry) => entry.list === 'later').length,
    stale: active.filter(isStaleOpen).length,
    scheduled: active.filter((entry) => entryBelongsToListView(entry, 'scheduled')).length,
    someday: active.filter((entry) => entry.list === 'someday').length,
    waiting: active.filter((entry) => entryBelongsToListView(entry, 'waiting')).length,
    work: active.filter((entry) => entry.area === 'work').length,
    parttime: active.filter((entry) => entry.area === 'parttime').length,
    learn: active.filter((entry) => entry.area === 'learn').length,
    other: active.filter((entry) => entry.area === 'other').length,
    ...(state.sources?.counts || {}),
  };
  for (const [name, value] of Object.entries(counts)) {
    const node = document.querySelector(`[data-count="${name}"]`);
    if (node) node.textContent = value > 0 ? value : '';
  }
  els.updated.textContent = new Date(state.generatedAt).toLocaleString();
}

function renderProjects() {
  if (!els.projectList) return;
  const projects = state.groups.projects || [];
  if (!projects.length) {
    els.projectList.innerHTML = '';
    return;
  }
  els.projectList.innerHTML = projects.map((project) => `
    <a class="rail-link project ${currentView === 'project' && effectiveProjectName() === project.name ? 'active' : ''}"
      href="#project/${projectSlug(project.name)}"
      data-project-link="${esc(project.name)}"
      data-drop-project="${esc(project.name)}">
      <span class="dot"></span><span>${esc(project.name)}</span><strong>${entriesForProject(project.name).filter((entry) => !(entry.todo === 'PROJ' && entry.title === project.name)).length || ''}</strong>
    </a>
  `).join('');
}

function renderStorage() {
  if (!state || !els.storagePrimary) return;
  const storage = state.storage || {};
  const files = state.files || {};
  els.storagePrimary.textContent = storage.primary === 'sqlite' ? 'SQLite' : (storage.primary || 'SQLite');
  els.storageExport.textContent = files.export || 'Org export';
  els.storageDb.textContent = files.db || '';
}

function setSettingsOpen(open) {
  if (!els.settingsPanel) return;
  els.settingsPanel.hidden = !open;
  els.settings?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function settingsStatus(message, kind = '') {
  if (!els.exportStatus) return;
  els.exportStatus.hidden = false;
  els.exportStatus.textContent = message;
  els.exportStatus.className = `settings-status ${kind}`.trim();
}

function renderTags() {
  const tags = state.groups.tags || [];
  if (!els.tagList) return;
  const total = tags.reduce((sum, tag) => sum + tag.count, 0);
  const sortedTags = [...tags].sort((a, b) =>
    (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name)
  );
  const buttons = [
    { name: 'all', label: 'All', count: total },
    ...sortedTags.map((tag) => ({ name: tag.name, label: tag.name === '-' ? 'No Tags' : tag.name, count: tag.count })),
  ];
  els.tagList.innerHTML = buttons.map((tag) => `
    <button class="tag-button ${tagFilter === tag.name ? 'active' : ''}" type="button" data-tag-filter="${esc(tag.name)}">
      <span>${esc(tag.label)}</span><strong>${tag.count || ''}</strong>
    </button>
  `).join('');
}

function optionsHtml(options, selected, labelFor = (value) => value) {
  return options.map((value) =>
    `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(labelFor(value))}</option>`
  ).join('');
}

function metadataFiltersHtml() {
  if (!['next', 'focus', 'project', 'review'].includes(currentView)) return '';
  return `
    <select class="meta-filter" data-meta-filter="time" aria-label="Filter by available time">
      <option value="all" ${timeFilter === 'all' ? 'selected' : ''}>Any time</option>
      ${optionsHtml(TIME_OPTIONS.filter(Boolean), timeFilter, (value) => `≤ ${TIME_LABELS[value] || value}`)}
    </select>
    <select class="meta-filter" data-meta-filter="energy" aria-label="Filter by available energy">
      <option value="all" ${energyFilter === 'all' ? 'selected' : ''}>Any energy</option>
      ${optionsHtml(ENERGY_OPTIONS.filter(Boolean), energyFilter, (value) => ENERGY_LABELS[value] || value)}
    </select>
  `;
}

function areaChipsHtml() {
  if (!['next', 'review'].includes(currentView)) return '';
  return [
    ['all', 'All'],
    ['work', 'Work'],
    ['parttime', 'Part-Time'],
    ['learn', 'Learn'],
    ['other', 'Other'],
  ].map(([value, label]) =>
    `<button class="chip ${areaFilter === value ? 'active' : ''}" type="button" data-area="${value}">${esc(label)}</button>`
  ).join('');
}

function renderChips() {
  if (currentView === 'source' || VIEWS[currentView]?.sourceGroup) {
    els.chips.hidden = true;
    els.chips.innerHTML = '';
    return;
  }
  const plannerToggle = currentView === 'today'
    ? `<button class="chip ${todayPlannerMode ? 'active' : ''}" type="button" data-planner-mode="today">Plan Today</button>`
    : '';
  const tools = `
    <div class="view-tools" role="group" aria-label="View options">
      <button class="note-toggle ${noteMode === 'hide' ? 'active' : ''}" type="button" data-note-mode="hide" title="Hide notes">-</button>
      <button class="note-toggle ${noteMode === 'preview' ? 'active' : ''}" type="button" data-note-mode="preview" title="Preview notes">=</button>
      <button class="note-toggle ${noteMode === 'full' ? 'active' : ''}" type="button" data-note-mode="full" title="Show full notes">list</button>
    </div>
  `;
  const metadataFilters = metadataFiltersHtml();
  const areaChips = areaChipsHtml();
  if (!areaChips && !metadataFilters && ['inbox', 'trash'].includes(currentView)) {
    els.chips.hidden = true;
    els.chips.innerHTML = '';
    return;
  }
  els.chips.hidden = false;
  els.chips.innerHTML = `${plannerToggle}${areaChips}${metadataFilters}${tools}`;
}

function progress(entry, statsOverride = null) {
  const stats = statsOverride || (entry.todo === 'PROJ' ? projectProgressStats(entry.title) : entry.subtasks);
  if (!stats || !stats.total) return '';
  const badges = [
    `<span>${stats.open} open</span>`,
    stats.projects ? `<span>${stats.projects} project${stats.projects === 1 ? '' : 's'}</span>` : '',
  ].join('');
  return `
    <div class="progress">
      <div class="progress-head"><span>Process</span><strong>${stats.done}/${stats.total} done</strong></div>
      <div class="track"><span style="width:${stats.percent}%"></span></div>
      <div class="badges">${badges}</div>
    </div>
  `;
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateBucket(entry) {
  const date = dateValue(entry.scheduled);
  if (!date) return 'No Date';
  const today = todayStart();
  const day = today.getDay() || 7;
  const thisWeek = addDays(today, -day + 1);
  const nextWeek = addDays(thisWeek, 7);
  const twoWeeks = addDays(nextWeek, 7);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date >= today && date < nextWeek) return 'This Week';
  if (date >= nextWeek && date < twoWeeks) return 'Next Week';
  return 'Future Dates';
}

function todayBucket(entry) {
  if (todayPlannerMode && isTodayPlannerCandidate(entry)) return 'Available Next Actions';
  const today = todayStart();
  const scheduled = dateValue(entry.scheduled);
  const due = dateValue(entry.due);
  if ((due && due < today) || (scheduled && scheduled < today)) return 'Overdue';
  if (scheduled && scheduled.getTime() === today.getTime()) return 'Scheduled Today';
  if (due && due.getTime() === today.getTime()) return 'Due Today';
  if (entry.focus) return 'Focus';
  return 'Today';
}

function forecastLabel(date) {
  if (!date) return 'No Date';
  const today = todayStart();
  const tomorrow = addDays(today, 1);
  if (date < today) return 'Overdue';
  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function forecastBucket(entry) {
  return forecastLabel(forecastDate(entry));
}

function forecastOrder(entries) {
  const labels = [];
  const seen = new Set();
  for (const entry of sortByForecastDate(entries)) {
    const label = forecastBucket(entry);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function forecastSectionAttrs(label, entries) {
  const firstDate = forecastDate(entries?.[0]);
  const date = label === 'Today'
    ? todayStart()
    : (label === 'Tomorrow' ? addDays(todayStart(), 1) : firstDate);
  if (!date || date < todayStart()) return '';
  return `data-drop-plan-date="${dateOnly(date)}" data-drop-plan-label="${esc(label)}"`;
}

function closedBucket(entry) {
  const date = dateValue(entry.closed);
  if (!date) return 'Older';
  const today = todayStart();
  const weekStart = addDays(today, -((today.getDay() || 7) - 1));
  const lastWeekStart = addDays(weekStart, -7);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date >= weekStart) return 'This Week';
  if (date >= lastWeekStart) return 'Last Week';
  return 'Older';
}

function areaBucket(entry) {
  if (isDoneEntry(entry)) return 'Done';
  if (entry.list === 'scheduled') return 'Scheduled';
  if (entry.list === 'waiting' || entry.todo === 'WAIT') return 'Waiting';
  if (entry.list === 'someday') return 'Someday';
  if (entry.list === 'later') return 'Later';
  if (entry.list === 'inbox') return 'Inbox';
  return 'Next Up';
}

function meta(entry) {
  const displayProject = entry.project || (currentView === 'project' && entry.todo !== 'PROJ' ? effectiveProjectName() : '');
  const values = [
    entry.scheduled ? `<span><i class="metaicon scheduled"></i>Scheduled ${shortDate(entry.scheduled)}</span>` : '',
    entry.due ? `<span><i class="metaicon due"></i>Due ${shortDate(entry.due)}</span>` : '',
    entry.effort ? `<span><i class="metaicon etime"></i>${esc(entry.effort)}</span>` : '',
    entry.energy ? `<span><i class="metaicon energy"></i>${esc(ENERGY_LABELS[entry.energy] || entry.energy)}</span>` : '',
    entry.repeat ? `<span><i class="metaicon repeat"></i>${esc(repeatLabel(entry.repeat))}</span>` : '',
    displayProject ? `<span><i class="metaicon belongsto"></i>${esc(displayProject)}</span>` : '',
    entry.closed ? `<span>Closed ${esc(entry.closed)}</span>` : '',
  ].filter(Boolean);
  return values.length ? `<div class="meta">${values.join('')}</div>` : '';
}

function taskTags(entry) {
  const tags = entry.tags || [];
  if (!tags.length) return '';
  return tags.map((tag) => `<span class="task-tag">${esc(tag)}</span>`).join('');
}

function noteHtml(entry) {
  if (!entry.notes || noteMode === 'hide') return '';
  const text = noteMode === 'preview'
    ? entry.notes.split('\n').find((line) => line.trim()) || ''
    : entry.notes;
  const value = noteMode === 'preview' && text.length > 180 ? `${text.slice(0, 180)}...` : text;
  return `<div class="task-note">${htmlLines(value)}</div>`;
}

function actionButtons(entry) {
  if (entry.trashed) {
    return `
      <div class="actions trash-actions">
        <button type="button" data-action="RESTORE" data-id="${entry.id}">Restore</button>
        <button class="danger" type="button" data-action="DELETE" data-id="${entry.id}">Delete</button>
      </div>
    `;
  }
  if (!entry.isCurrent) return '';
  return `
    <div class="actions">
      <button class="row-menu-button" type="button" data-action="MENU" data-id="${entry.id}" aria-label="Task menu"></button>
    </div>
  `;
}

function noteMark(entry) {
  const hasMarker = Boolean(entry.notes || entry.subtasks?.total);
  if (!hasMarker) return '';
  if (entry.todo === 'PROJ' && entry.isCurrent) {
    return `<button class="note-mark" type="button" data-project-open="${esc(entry.title)}" aria-label="Open project actions" title="Open project actions"></button>`;
  }
  if (entry.isCurrent) {
    return `<button class="note-mark" type="button" data-action="EDIT" data-id="${entry.id}" aria-label="Edit notes" title="Edit notes"></button>`;
  }
  return `<button class="note-mark" type="button" data-action="INFO" data-id="${entry.id}" aria-label="Show task info" title="Show task info"></button>`;
}

function checkbox(entry) {
  if (!entry.isCurrent) {
    return '<span class="check"></span>';
  }
  if (isDoneEntry(entry)) {
    const nextTodo = entry.list === 'waiting' ? 'WAIT' : 'TODO';
    return `<button class="check checked" type="button" data-action="${nextTodo}" data-id="${entry.id}" aria-label="Mark not done" title="Mark not done"></button>`;
  }
  return `<button class="check" type="button" data-action="DONE" data-id="${entry.id}" aria-label="Mark done"></button>`;
}

function focusStar(entry) {
  if (!entry.isCurrent || entry.trashed) return '<span class="star"></span>';
  const label = entry.focus ? 'Remove from focus' : 'Add to focus';
  return `<button class="star ${entry.focus ? 'active' : ''}" type="button" data-action="FOCUS" data-focus="${entry.focus ? '0' : '1'}" data-id="${entry.id}" aria-label="${label}"></button>`;
}

function repeatLabel(value, fallback = 'repeat') {
  if (!value) return fallback;
  return REPEAT_LABELS[value] || value;
}

function option(value, label, selected) {
  return `<option value="${value}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`;
}

function tagsText(entry) {
  return (entry.tags || []).join(', ');
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function editorTagPlaceholder(value) {
  if (window.matchMedia?.('(max-width: 640px)').matches) return 'Tags';
  return value;
}

function editorMainFields({ title = '', tags = '', notes = '', cancelAction, cancelId = '', tagPlaceholder, error = '' }) {
  const cancelIdAttr = cancelId ? ` data-id="${esc(cancelId)}"` : '';
  const errorHtml = error ? `<p class="edit-error" role="alert">${esc(error)}</p>` : '';
  return `
    <div class="task-main edit-main">
      <input class="title-input" name="title" value="${esc(title)}" autocomplete="off" placeholder="To Do">
      <input name="tags" value="${esc(tags)}" autocomplete="off" placeholder="${esc(editorTagPlaceholder(tagPlaceholder))}">
      <textarea name="notes" rows="8" placeholder="Notes">${esc(notes)}</textarea>
      ${errorHtml}
      <div class="edit-actions">
        <button type="submit">Save Changes</button>
        <button type="button" data-action="${cancelAction}"${cancelIdAttr}>Cancel</button>
      </div>
    </div>
  `;
}

function editorSideFields({
  effort = '',
  energy = '',
  due = '',
  dueType = 'date',
  scheduled = '',
  list = 'next',
  area = 'other',
  project = '',
  repeat = '',
  includeArea = true,
  includeScheduled = false,
  customMenus = false,
}) {
  const newMenuControl = (field, label) => customMenus
    ? `<button class="side-control" type="button" data-new-menu="${field}" aria-haspopup="menu" aria-expanded="false"><span class="side-control-text">${esc(label)}</span></button>`
    : '';
  const nativeClass = customMenus ? ' class="native-field"' : '';
  return `
    <div class="edit-side">
      <label class="side-field side-time"><span>time</span><select${nativeClass} name="effort">
        ${TIME_OPTIONS.map((value) => option(value, value || 'time', effort)).join('')}
      </select>${newMenuControl('effort', effort ? (TIME_LABELS[effort] || effort) : 'time')}</label>
      <label class="side-field side-energy"><span>energy</span><select${nativeClass} name="energy">
        ${ENERGY_OPTIONS.map((value) => option(value, value ? (ENERGY_LABELS[value] || value) : 'energy', energy)).join('')}
      </select>${newMenuControl('energy', energy ? (ENERGY_LABELS[energy] || energy) : 'energy')}</label>
      <label class="side-field side-due"><span>due</span><input${nativeClass} name="dueAt" type="${dueType}" value="${esc(due)}" placeholder="due">${newMenuControl('dueAt', due || 'due')}</label>
      <label class="side-field side-list"><span>list</span><select${nativeClass} name="list">
        ${Object.entries(LIST_LABELS).map(([value, label]) => option(value, label, list)).join('')}
      </select>${newMenuControl('list', LIST_LABELS[list] || list)}</label>
      <label class="side-field side-repeat"><span>repeat</span><select${nativeClass} name="repeat">
        ${Object.entries(REPEAT_LABELS).map(([value, label]) => option(value, label, repeat)).join('')}
      </select>${newMenuControl('repeat', repeatLabel(repeat))}</label>
      ${includeScheduled ? `<label><span>scheduled</span><input name="scheduledAt" type="date" value="${esc(scheduled)}"></label>` : ''}
      ${includeArea ? `<label class="side-field side-area"><span>area</span><select name="area">
        ${Object.entries(AREA_LABELS).map(([value, label]) => option(value, label, area)).join('')}
      </select></label>` : `<input type="hidden" name="area" value="${esc(area)}">`}
      <label class="side-field side-project"><span>project</span><input${nativeClass} name="project" value="${esc(project)}" placeholder="Standalone">${newMenuControl('project', project || 'Standalone')}</label>
    </div>
  `;
}

const OPEN_LIST_TODOS = new Set(['TODO', 'WAIT', 'NEXT']);

function taskBodyFromFormData(data, { includeScheduled = false, entry = null } = {}) {
  const list = String(data.get('list') || 'next');
  const body = {
    title: data.get('title'),
    list,
    area: data.get('area'),
    effort: data.get('effort'),
    dueAt: data.get('dueAt'),
    energy: data.get('energy'),
    project: data.get('project'),
    repeat: data.get('repeat'),
    tags: parseTags(data.get('tags')),
    notes: data.get('notes'),
  };
  if (!entry || OPEN_LIST_TODOS.has(entry.todo)) body.todo = todoForList(list);
  if (includeScheduled) body.scheduledAt = data.get('scheduledAt');
  return body;
}

function newTaskMenuChoices(field) {
  if (field === 'effort') {
    return [
      ...TIME_OPTIONS.filter(Boolean).map((value) => ({ value, label: TIME_LABELS[value] || value })),
      { value: '', label: 'none', emptyLabel: 'time' },
    ];
  }
  if (field === 'energy') {
    return [
      ...ENERGY_OPTIONS.filter(Boolean).map((value) => ({ value, label: ENERGY_LABELS[value] || value })),
      { value: '', label: 'none', emptyLabel: 'energy' },
    ];
  }
  if (field === 'dueAt') {
    return [
      { value: relativeDate(0), label: 'Today' },
      { value: relativeDate(1), label: 'Tomorrow' },
      { value: nextWeekDate(), label: 'Next Week' },
      { value: '', label: 'none', emptyLabel: 'due' },
    ];
  }
  if (field === 'list') {
    return Object.entries(LIST_LABELS).map(([value, label]) => ({ value, label }));
  }
  if (field === 'repeat') {
    return Object.entries(REPEAT_LABELS).map(([value, label]) => ({ value, label, emptyLabel: 'repeat' }));
  }
  if (field === 'project') {
    const projects = (state?.groups?.projects || []).map((project) => project.name).filter(Boolean);
    return [
      { value: '', label: 'Standalone', emptyLabel: 'Standalone' },
      ...projects.map((name) => ({ value: name, label: name })),
    ];
  }
  return [];
}

function newTaskMenuField(form, field) {
  const name = field === 'dueAt' ? 'dueAt' : field;
  return form.querySelector(`[name="${name}"]`);
}

function closeNewTaskMenu() {
  document.querySelectorAll('.new-task-menu').forEach((node) => node.remove());
  document.querySelectorAll('[data-new-menu][aria-expanded="true"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function openNewTaskMenu(button) {
  const label = button.closest('label');
  const field = button.dataset.newMenu;
  if (!label || !field) return;
  const wasOpen = button.getAttribute('aria-expanded') === 'true';
  closeNewTaskMenu();
  if (wasOpen) return;
  const form = button.closest('[data-new-form]');
  const native = form ? newTaskMenuField(form, field) : null;
  const currentValue = native?.value || '';
  const choices = newTaskMenuChoices(field);
  const menu = document.createElement('div');
  menu.className = 'new-task-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = choices.map((choice) => `
    <button type="button" role="menuitem" data-new-menu-value="${esc(choice.value)}" data-empty-label="${esc(choice.emptyLabel || '')}" class="${choice.value === currentValue ? 'active' : ''}">
      ${esc(choice.label)}
    </button>
  `).join('');
  label.append(menu);
  button.setAttribute('aria-expanded', 'true');
}

function setNewTaskMenuValue(choiceButton) {
  const menu = choiceButton.closest('.new-task-menu');
  const label = menu?.closest('label');
  const control = label?.querySelector('[data-new-menu]');
  const form = label?.closest('[data-new-form]');
  if (!menu || !control || !form) return;
  const native = newTaskMenuField(form, control.dataset.newMenu);
  if (!native) return;
  native.value = choiceButton.dataset.newMenuValue || '';
  native.dispatchEvent(new Event('change', { bubbles: true }));
  const text = control.querySelector('.side-control-text');
  if (text) {
    text.textContent = native.value
      ? choiceButton.textContent.trim()
      : (choiceButton.dataset.emptyLabel || choiceButton.textContent.trim());
  }
  closeNewTaskMenu();
}

function newTaskForm() {
  const list = listForCurrentView();
  const area = VIEWS[currentView]?.area || els.areaSelect.value || 'other';
  const project = currentView === 'project' ? effectiveProjectName() : '';
  return `
    <form class="task edit-task new-task" data-new-form>
      <div class="task-controls edit-controls">
        <span class="grip" aria-hidden="true"></span>
        <span class="check"></span>
        <button class="star" type="button" data-action="NEW_FOCUS" data-focus="0" aria-label="Add to focus"></button>
      </div>
      ${editorMainFields({
        cancelAction: 'CANCEL_NEW',
        tagPlaceholder: 'Tags (areas, contacts, contexts) comma separated',
      })}
      ${editorSideFields({ list, area, project, dueType: 'text', includeArea: false, customMenus: true })}
    </form>
  `;
}

function editTask(entry) {
  const draft = editDraft && editDraft.id === entry.id ? editDraft : null;
  return `
    <form class="task edit-task" data-edit-form data-id="${entry.id}" data-task-title="${esc(entry.title)}">
      <div class="task-controls edit-controls">
        <span class="grip" aria-hidden="true"></span>
        <span class="check"></span>
        ${focusStar(entry)}
      </div>
      ${editorMainFields({
        title: draft ? draft.title : entry.title,
        tags: draft ? draft.tags : tagsText(entry),
        notes: draft ? draft.notes : (entry.notes || ''),
        cancelAction: 'CANCEL_EDIT',
        cancelId: entry.id,
        tagPlaceholder: 'Tags (contexts) comma separated',
        error: editError && editingId === entry.id ? editError : '',
      })}
      ${editorSideFields({
        effort: entry.effort || '',
        energy: entry.energy || '',
        due: entry.due || '',
        scheduled: entry.scheduled || '',
        list: entry.list || 'next',
        area: entry.area || 'other',
        project: entry.project || '',
        repeat: entry.repeat || '',
        includeScheduled: true,
      })}
    </form>
  `;
}

function taskMenu(entry) {
  if (menuId !== entry.id || entry.trashed || !entry.isCurrent) return '';
  const menuItem = (action, label, value = '') =>
    `<button type="button" data-action="${action}" data-id="${entry.id}" data-value="${esc(value)}">${label}</button>`;
  const textItem = (action, label, value = '') => menuItem(action, esc(label), value);
  const submenu = (label, items) => `
    <div class="menu-row has-submenu">
      <button class="menu-parent" type="button">${esc(label)}</button>
      <div class="menu-flyout">${items}</div>
    </div>
  `;
  const currentTags = entry.tags || [];
  const contextTags = [
    ...new Set([
      ...currentTags,
      ...(state.groups.tags || []).map((tag) => tag.name).filter((tag) => tag && tag !== '-'),
      ...DEFAULT_CONTEXT_TAGS,
    ]),
  ].slice(0, 16);
  const areaItems = [
    '<span class="menu-label">Area</span>',
    ...Object.entries(AREA_LABELS)
      .map(([value, label]) => textItem('SET_AREA', `${entry.area === value ? '• ' : ''}${label}`, value)),
  ].join('');
  const contextItems = [
    '<span class="menu-label">Contexts</span>',
    ...contextTags.map((tag) => textItem('ADD_TAG', currentTags.includes(tag) ? `✓ ${tag}` : tag, tag)),
    textItem('CLEAR_TAGS', 'No Context / Clear', ''),
  ].join('');
  const listItems = [
    '<span class="menu-label">State</span>',
    ...Object.entries(LIST_LABELS).map(([value, label]) => textItem('SET_LIST', entry.list === value ? `• ${label}` : label, value)),
  ].join('');
  const projectItems = (state.groups.projects || [])
    .map((project) => textItem('SET_PROJECT', entry.project === project.name ? `• ${project.name}` : project.name, project.name))
    .join('');
  const moveItems = [
    projectItems ? submenu('Projects', projectItems) : '',
    textItem('LOGBOOK', 'Logbook'),
    textItem('TRASH', 'Trash'),
  ].join('');
  const timeItems = [
    '<span class="menu-label">Time</span>',
    ...TIME_OPTIONS.filter(Boolean).map((value) => textItem('SET_TIME', TIME_LABELS[value] || value, value)),
    textItem('SET_TIME', 'None', ''),
  ].join('');
  const energyItems = [
    '<span class="menu-label">Energy</span>',
    ...ENERGY_OPTIONS.filter(Boolean).map((value) => textItem('SET_ENERGY', ENERGY_LABELS[value] || value, value)),
    textItem('SET_ENERGY', 'None', ''),
  ].join('');
  const repeatItems = [
    '<span class="menu-label">Repeat</span>',
    textItem('SET_REPEAT', entry.repeat === 'daily' ? '• Daily' : 'Daily', 'daily'),
    textItem('SET_REPEAT', entry.repeat === 'weekly' ? '• Weekly' : 'Weekly', 'weekly'),
    textItem('SET_REPEAT', entry.repeat === 'monthly' ? '• Monthly' : 'Monthly', 'monthly'),
    textItem('SET_REPEAT', entry.repeat ? 'None' : '• None', ''),
  ].join('');
  return `
    <div class="task-menu" role="menu">
      <span class="menu-title">${esc(entry.title)}</span>
      ${submenu('State', listItems)}
      ${submenu('Areas', areaItems)}
      ${submenu('Contexts', contextItems)}
      ${submenu('Time', timeItems)}
      ${submenu('Energy', energyItems)}
      ${submenu('Repeat', repeatItems)}
      ${submenu('Due', `${textItem('SET_DUE', 'Today', relativeDate(0))}${textItem('SET_DUE', 'Tomorrow', relativeDate(1))}${textItem('SET_DUE', 'Next Week', nextWeekDate())}${textItem('SET_DUE', 'Remove Date', '')}`)}
      ${submenu('Schedule', `${textItem('SET_SCHEDULE', 'Tomorrow', relativeDate(1))}${textItem('SET_SCHEDULE', 'Next Week', nextWeekDate())}${entry.scheduled ? textItem('SET_SCHEDULE', 'Remove Start Date', '') : ''}`)}
      ${submenu('Move', moveItems)}
      ${submenu('Convert', `${textItem('CONVERT_PROJECT', 'Action into a → Project')}`)}
      <button class="menu-row" type="button" data-action="COPY" data-id="${entry.id}">Make a copy...</button>
      <button class="menu-row menu-info" type="button" data-action="INFO" data-id="${entry.id}">get_info</button>
    </div>
  `;
}

function plannerActions(entry) {
  if (!['today', 'next', 'forecast'].includes(currentView)) return '';
  if (!entry.isCurrent || entry.trashed || isDoneEntry(entry) || entry.todo === 'PROJ') return '';
  const plans = [
    ['today', 'Today'],
    ['tomorrow', 'Tomorrow'],
    ['next-week', 'Next Week'],
    ['no-date', 'No Date'],
    ['not-today', 'Not Today'],
  ];
  return `
    <div class="planner-actions" aria-label="Plan task">
      ${plans.map(([value, label]) => `<button type="button" data-action="PLAN" data-plan="${value}" data-id="${entry.id}">${label}</button>`).join('')}
    </div>
  `;
}

function task(entry) {
  if (editingId === entry.id) return editTask(entry);
  const isProject = entry.todo === 'PROJ';
  const visibleState = entry.todo && entry.todo !== 'TODO'
    ? `<span class="state state-${entry.todo.toLowerCase()}">${esc(entry.todo)}</span>`
    : '';
  const note = noteMark(entry);
  const date = entry.scheduled ? `<span class="date-chip">${esc(shortDate(entry.scheduled))}</span>` : '';
  const canDrag = entry.isCurrent && !entry.trashed;
  const title = isProject && entry.isCurrent
    ? `<a class="project-title-link" href="#project/${projectSlug(entry.title)}" data-project-open="${esc(entry.title)}">${esc(entry.title)}</a>`
    : `<h3 class="task-title">${esc(entry.title)}</h3>`;
  return `
    <article class="task ${isProject ? 'project-task' : ''} ${isDoneEntry(entry) ? 'done-state' : ''} ${entry.focus ? 'focus-state' : ''} ${highlightedTaskId === entry.id ? 'source-created' : ''} ${menuId === entry.id ? 'menu-open' : ''} ${draggingId === entry.id ? 'dragging' : ''} ${dragOverId === entry.id && dragPosition ? `drop-${dragPosition}` : ''}" data-task-id="${entry.id}" data-task-title="${esc(entry.title)}" data-draggable="${canDrag ? 'true' : 'false'}">
      <div class="task-controls">
        <span class="grip" role="button" aria-label="Drag task" title="Drag task"></span>
        ${checkbox(entry)}
        ${focusStar(entry)}
      </div>
      <div class="task-main">
        <div class="title-row">${visibleState}${date}${title}${note}</div>
        ${meta(entry)}
        ${plannerActions(entry)}
        ${noteHtml(entry)}
        ${progress(entry)}
      </div>
      <div class="task-tags">${taskTags(entry)}</div>
      <div class="task-menu-cell">${actionButtons(entry)}</div>
      ${taskMenu(entry)}
    </article>
  `;
}

function emptyCard(title) {
  return `
    <div class="empty-card">
      <h2>${esc(title)}</h2>
      <p>Press <kbd>n</kbd> to create a new action.</p>
    </div>
  `;
}

function renderGrouped(entries, bucketFn, order, options = {}) {
  const buckets = new Map();
  for (const entry of entries) {
    const label = bucketFn(entry);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(entry);
  }
  const labels = [
    ...order.filter((label) => buckets.has(label)),
    ...[...buckets.keys()].filter((label) => !order.includes(label)).sort(),
  ];
  return labels.map((label) => {
    const bucketEntries = buckets.get(label);
    const attrs = options.sectionAttrs ? options.sectionAttrs(label, bucketEntries) : '';
    return `
    <div class="section-title"${attrs ? ` ${attrs}` : ''}><h2>${esc(label)}</h2><span>${bucketEntries.length}</span></div>
    <div class="items">${bucketEntries.map(task).join('')}</div>
  `;
  }).join('');
}

function projectBucket(entry) {
  if (entry.todo === 'PROJ') return 'Project';
  if (isDoneEntry(entry)) return 'Done';
  if (entry.list === 'someday') return 'Someday';
  if (entry.list === 'later') return 'Later';
  if (entry.list === 'scheduled') return 'Scheduled';
  if (entry.list === 'waiting' || entry.todo === 'WAIT') return 'Waiting';
  if (entry.list === 'inbox') return 'Inbox';
  return 'Next Up';
}

function projectSummaryCard(projectName, entries) {
  const projectEntry = entries.find((entry) => entry.todo === 'PROJ' && entry.title === projectName);
  const actions = projectActionEntries(projectName, entries);
  const stats = projectProgressStats(projectName, entries);
  const summary = projectEntry || {
    title: projectName,
    notes: '',
    subtasks: stats,
  };
  const count = actions.length;
  return `
    <article class="project-summary-card" data-project-summary="${esc(projectName)}">
      <div class="project-summary-count">
        <strong>${count}</strong>
        <span>${count === 1 ? 'Action' : 'Actions'}</span>
      </div>
      <div class="project-summary-main">
        <div class="project-summary-title">
          <span class="state state-proj">PROJ</span>
          <h2>${esc(projectName)}</h2>
          ${summary.notes || stats.total ? `<button class="note-mark" type="button" data-project-open="${esc(projectName)}" aria-label="Open project actions" title="Open project actions"></button>` : ''}
        </div>
        ${summary.notes ? `<div class="task-note">${htmlLines(summary.notes)}</div>` : ''}
        ${progress(summary, stats)}
      </div>
      <a class="project-jump" href="#next" data-view-link="next" aria-label="Back to Next"></a>
    </article>
  `;
}

function renderProjectSummary(projectName, entries) {
  if (!els.projectSummary) return;
  if (currentView !== 'project' || !projectName) {
    els.projectSummary.hidden = true;
    els.projectSummary.innerHTML = '';
    return;
  }
  els.projectSummary.hidden = false;
  els.projectSummary.innerHTML = projectSummaryCard(projectName, entries);
}

function renderProjectItems(entries, projectName) {
  const taskEntries = entries.filter((entry) => !(entry.todo === 'PROJ' && entry.title === projectName));
  if (!taskEntries.length) return emptyCard('Project has no actions');
  const buckets = new Map();
  for (const entry of taskEntries) {
    const label = projectBucket(entry);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(entry);
  }
  const order = ['Next Up', 'Waiting', 'Scheduled', 'Later', 'Someday', 'Inbox', 'Done'];
  const labels = [
    ...order.filter((label) => buckets.has(label)),
    ...[...buckets.keys()].filter((label) => !order.includes(label)).sort(),
  ];
  return labels.map((label) => `
    <div class="section-title project-section"><h2>${esc(label)}</h2><strong>${buckets.get(label).length}</strong></div>
    <div class="items">${buckets.get(label).map(task).join('')}</div>
  `).join('');
}

function statusSummary(label, value) {
  return `<div class="status-card"><strong>${value}</strong><span>${esc(label)}</span></div>`;
}

function reviewBucket(entry) {
  if (isDoneRecently(entry, 7)) return 'Done Last 7 Days';
  if (entry.list === 'inbox') return 'Inbox To Clarify';
  if (entry.todo === 'PROJ' && !projectHasNextAction(entry.title)) return 'Projects Needing Next Action';
  if (entry.todo === 'PROJ') return 'Project Health';
  if (entry.list === 'waiting' || entry.todo === 'WAIT') return 'Waiting';
  if (entry.list === 'scheduled') return 'Scheduled';
  if (isStaleOpen(entry)) return 'Stale Open Loops';
  if (isDeferredReviewDue(entry)) return 'Later / Someday Review';
  return 'Other';
}

function listBucket(entry, label) {
  return isDoneEntry(entry) ? 'Done' : label;
}

function renderReview(entries) {
  const current = allCurrentEntries();
  const completed = state.groups.completed || [];
  const projects = projectRows();
  const cards = [
    statusSummary('Next actions', (state.groups.actions || []).length),
    statusSummary('Open projects', projects.length),
    statusSummary('Done last 7 days', completed.filter((entry) => isDoneRecently(entry, 7)).length),
    statusSummary('Need review', entries.length),
  ].join('');
  const body = entries.length
    ? renderGrouped(entries, reviewBucket, [
      'Inbox To Clarify',
      'Projects Needing Next Action',
      'Project Health',
      'Stale Open Loops',
      'Waiting',
      'Scheduled',
      'Later / Someday Review',
      'Done Last 7 Days',
      'Other',
    ])
    : emptyCard('Nothing to review');
  return `
    <section class="status-grid">${cards}</section>
    ${body}
  `;
}

function projectCard(entry) {
  const stats = projectProgressStats(entry.title);
  const actions = projectActionEntries(entry.title);
  const nextActions = actions.filter((item) => item.isCurrent && item.list === 'next' && item.todo !== 'PROJ');
  const waiting = actions.filter((item) => item.isCurrent && (item.list === 'waiting' || item.todo === 'WAIT'));
  return `
    <article class="project-card" data-project-card="${esc(entry.title)}">
      <a class="project-card-title" href="#project/${projectSlug(entry.title)}" data-project-open="${esc(entry.title)}">
        <span class="state state-proj">PROJ</span>
        <strong>${esc(entry.title)}</strong>
      </a>
      ${meta(entry)}
      ${progress(entry, stats)}
      <div class="project-card-footer">
        <span>${nextActions.length} next</span>
        <span>${waiting.length} waiting</span>
        <span>${actions.length} total</span>
      </div>
    </article>
  `;
}

function renderProjectsView(entries) {
  if (!entries.length) return emptyCard('No active projects');
  const groups = new Map();
  for (const entry of entries) {
    const label = AREA_LABELS[entry.area] || 'Other';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  }
  return [...groups.entries()].map(([label, projects]) => `
    <div class="section-title"><h2>${esc(label)}</h2><span>${projects.length}</span></div>
    <div class="project-grid">${projects.map(projectCard).join('')}</div>
  `).join('');
}

function sourceImportForm() {
  return `
    <form class="source-import" data-source-import>
      <input name="url" type="url" autocomplete="off" placeholder="Paste article, Twitter, YouTube, PDF, GitHub, or doc URL">
      <select name="type" aria-label="Source type">
        <option value="">Auto</option>
        <option value="twitter">Twitter</option>
        <option value="article">Article</option>
        <option value="youtube">Video</option>
        <option value="pdf">PDF</option>
        <option value="github">GitHub</option>
        <option value="doc">Doc</option>
        <option value="other">Other</option>
      </select>
      <button type="submit">Import</button>
      <p data-source-import-status hidden></p>
    </form>
  `;
}

function sourceTopics(source) {
  const topics = source.topics || [];
  if (!topics.length) return '';
  return `<div class="source-topics">${topics.map((topic) => `<span>${esc(topic)}</span>`).join('')}</div>`;
}

function sourceStatusButton(source, status) {
  const active = source.status === status;
  const label = SOURCE_STATUS_LABELS[status] || status;
  return `
    <button class="source-status-action ${active ? 'active' : ''}" type="button" data-source-status="${esc(status)}" data-id="${esc(source.id)}" aria-pressed="${active ? 'true' : 'false'}">
      <span>${esc(label)}</span>
    </button>
  `;
}

function sourceStatusButtons(source, statuses) {
  return statuses.map((status) => sourceStatusButton(source, status)).join('');
}

function linkedSourceTaskId(source) {
  return Array.isArray(source.taskIds) && source.taskIds.length ? source.taskIds[0] : '';
}

function sourceTaskButton(source) {
  const taskId = linkedSourceTaskId(source);
  if (taskId) {
    return `<button type="button" data-source-task-open data-task-id="${esc(taskId)}">Open GTD Task</button>`;
  }
  return `<button type="button" data-source-task data-id="${esc(source.id)}">Create GTD Task</button>`;
}

function sourceCard(source) {
  const type = SOURCE_TYPE_LABELS[source.type] || 'Source';
  const status = SOURCE_STATUS_LABELS[source.status] || source.status;
  return `
    <article class="source-card" data-source-id="${esc(source.id)}" data-source-title="${esc(source.title)}">
      <div class="source-card-head">
        <a href="#source/${sourceSlug(source.id)}" data-source-open="${esc(source.id)}">
          <span class="source-type">${esc(type)}</span>
          <strong>${esc(source.title)}</strong>
        </a>
        <span class="source-status">${esc(status)}</span>
      </div>
      <a class="source-url" href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.url)}</a>
      ${source.summary ? `<p class="source-summary">${htmlLines(source.summary.slice(0, 420))}</p>` : ''}
      ${sourceTopics(source)}
      <div class="source-actions">
        ${sourceStatusButtons(source, ['reading', 'processed'])}
        ${sourceTaskButton(source)}
      </div>
    </article>
  `;
}

function renderSources(sources, view) {
  const body = sources.length
    ? `<div class="source-list">${sources.map(sourceCard).join('')}</div>`
    : emptyCard(view.empty);
  return `${sourceImportForm()}${body}`;
}

function renderSourceDetail(source) {
  if (!source) return emptyCard('Source not found');
  const type = SOURCE_TYPE_LABELS[source.type] || 'Source';
  const status = SOURCE_STATUS_LABELS[source.status] || source.status;
  const related = (source.taskIds || []).length
    ? `<p class="source-related">${source.taskIds.length} linked GTD task${source.taskIds.length === 1 ? '' : 's'}</p>`
    : '';
  return `
    <article class="source-detail" data-source-id="${esc(source.id)}">
      <div class="source-detail-bar">
        <span class="source-type">${esc(type)}</span>
        <span class="source-status">${esc(status)}</span>
        ${source.author ? `<span>${esc(source.author)}</span>` : ''}
        ${source.fetched ? `<span>Fetched ${esc(source.fetched)}</span>` : ''}
      </div>
      <a class="source-url" href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.url)}</a>
      ${source.summary ? `<section><h2>Summary</h2><p>${htmlLines(source.summary)}</p></section>` : ''}
      ${sourceTopics(source)}
      ${related}
      <div class="source-actions">
        ${sourceStatusButtons(source, ['unread', 'reading', 'processed'])}
        ${sourceTaskButton(source)}
        ${sourceStatusButton(source, 'archived')}
      </div>
      ${source.rawText ? `
        <details class="source-raw">
          <summary>Fetched Content</summary>
          <pre>${esc(source.rawText)}</pre>
        </details>
      ` : ''}
    </article>
  `;
}

function renderItems(entries, view) {
  if (currentView === 'source') {
    return renderSourceDetail(sourceById(currentSourceId));
  }
  if (view.sourceGroup) {
    return renderSources(entries, view);
  }
  if (currentView === 'context') {
    return renderGrouped(entries, (entry) => listBucket(entry, view.title), [view.title, 'Done']);
  }
  if (currentView === 'project') {
    return renderProjectItems(entries, effectiveProjectName());
  }
  if (currentView === 'projects') {
    return renderProjectsView(entries);
  }
  if (currentView === 'review') {
    return renderReview(entries);
  }
  if (currentView === 'today') {
    return renderGrouped(entries, todayBucket, ['Overdue', 'Scheduled Today', 'Due Today', 'Focus', 'Today', 'Available Next Actions']);
  }
  if (currentView === 'forecast') {
    return renderGrouped(entries, forecastBucket, forecastOrder(entries), { sectionAttrs: forecastSectionAttrs });
  }
  if (currentView === 'scheduled') {
    return renderGrouped(entries, dateBucket, ['Today', 'This Week', 'Next Week', 'Future Dates', 'No Date']);
  }
  if (currentView === 'logbook') {
    return renderGrouped(entries, closedBucket, ['Today', 'This Week', 'Last Week', 'Older']);
  }
  if (view.area) {
    return renderGrouped(entries, areaBucket, ['Next Up', 'Scheduled', 'Waiting', 'Later', 'Someday', 'Inbox', 'Done']);
  }
  const primaryLabel = view.section || view.title || 'Actions';
  return `
    ${renderGrouped(entries, (entry) => listBucket(entry, primaryLabel), [primaryLabel, 'Done'])}
  `;
}

function searchEmptyCard(query) {
  return `
    <div class="empty-card">
      <h2>No results for "${esc(query)}"</h2>
      <p>Clear search to see the current list.</p>
      <button class="clear-search" type="button" data-clear-search>Clear Search</button>
    </div>
  `;
}

function render() {
  if (!state) return;
  const projectName = currentView === 'project' ? effectiveProjectName() : '';
  if (currentView === 'project') currentProject = projectName;
  const activeSource = currentView === 'source' ? sourceById(currentSourceId) : null;
  const view = currentView === 'project'
    ? { title: projectName || 'Project', subtitle: 'Project', empty: 'Project has no actions' }
    : currentView === 'source'
      ? {
        title: activeSource?.title || 'Source',
        subtitle: activeSource ? `${SOURCE_TYPE_LABELS[activeSource.type] || 'Source'} · ${SOURCE_STATUS_LABELS[activeSource.status] || activeSource.status}` : 'Source',
        empty: 'Source not found',
      }
    : currentView === 'context'
      ? { title: contextLabel(currentContext), subtitle: 'Context', empty: 'No actions in this context' }
      : (VIEWS[currentView] || VIEWS.next);
  const query = els.search.value.trim();
  const entries = entriesForRender(query);
  els.title.textContent = view.title;
  els.subtitle.textContent = view.subtitle;
  els.areaSelect.value = view.area || 'other';
  document.body.classList.toggle('project-mode', currentView === 'project');
  document.body.classList.toggle('source-mode', currentView === 'source' || Boolean(view.sourceGroup));
  renderChips();
  renderProjectSummary(projectName, currentView === 'project' ? entriesForProject(projectName) : []);
  renderProjects();
  renderTags();
  document.querySelectorAll('[data-view-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.viewLink === currentView);
  });
  document.querySelectorAll('[data-project-link]').forEach((link) => {
    link.classList.toggle('active', currentView === 'project' && link.dataset.projectLink === projectName);
  });
  if (!entries.length && !['review', 'projects'].includes(currentView)) {
    if (view.sourceGroup) {
      els.content.innerHTML = `${sourceImportForm()}${query ? searchEmptyCard(query) : emptyCard(view.empty)}`;
      return;
    }
    if (creatingTask) {
      els.content.innerHTML = newTaskForm();
      return;
    }
    els.content.innerHTML = query ? searchEmptyCard(query) : emptyCard(view.empty);
    return;
  }
  els.content.innerHTML = `${creatingTask ? newTaskForm() : ''}${renderItems(entries, view)}`;
}

function setView(view, replace = false, options = {}) {
  const projectName = projectFromHash(view);
  const contextName = contextFromHash(view);
  const sourceId = sourceFromHash(view);
  currentContext = 'all';
  currentSourceId = '';
  if (projectName !== null) {
    currentView = 'project';
    currentProject = projectByName(projectName)?.name || firstProjectName() || projectName;
  } else if (contextName !== null) {
    currentView = 'context';
    currentContext = contextName;
    currentProject = '';
  } else if (sourceId !== null) {
    currentView = 'source';
    currentSourceId = sourceId;
    currentProject = '';
  } else {
    currentView = VIEWS[view] ? view : 'next';
    currentProject = '';
  }
  if (!options.preserveViewState) resetViewState();
  if (currentView === 'context') tagFilter = currentContext;
  const hash = currentView === 'project'
    ? `#project/${projectSlug(effectiveProjectName())}`
    : currentView === 'context'
      ? `#context/${contextSlug(currentContext)}`
      : currentView === 'source'
        ? `#source/${sourceSlug(currentSourceId)}`
        : `#${currentView}`;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  render();
}

function revealTask(taskId) {
  if (!taskId) return;
  const entry = entryById(taskId);
  highlightedTaskId = taskId;
  window.clearTimeout(highlightedTaskTimer);
  setView(viewForTask(entry));
  window.requestAnimationFrame(() => {
    document.querySelector(`.task[data-task-id="${taskId}"]`)?.scrollIntoView({ block: 'center' });
  });
  highlightedTaskTimer = window.setTimeout(() => {
    if (highlightedTaskId !== taskId) return;
    highlightedTaskId = '';
    render();
  }, 2400);
}

function scheduleStateSync(version = mutationVersion) {
  window.clearTimeout(stateSyncTimer);
  stateSyncTimer = window.setTimeout(() => {
    if (pendingMutations > 0 || version !== mutationVersion) return;
    load({ preserveViewState: true, silent: true, version }).catch((error) => {
      settingsStatus(`Sync failed: ${error.message}`, 'error');
    });
  }, 80);
}

async function load(options = {}) {
  if (!options.silent) {
    els.content.innerHTML = '<div class="empty-card"><h2>Loading</h2><p>Reading task database...</p></div>';
  }
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load GTD state');
  const freshState = await response.json();
  if (options.version !== undefined && options.version !== mutationVersion) return null;
  state = freshState;
  setCounts();
  renderStorage();
  setView((location.hash || '#next').slice(1), true, options);
  return state;
}

async function mutate(url, options, mutationOptions = {}) {
  const version = ++mutationVersion;
  const snapshot = mutationOptions.optimistic ? cloneState() : null;
  pendingMutations += 1;
  if (mutationOptions.optimistic) mutationOptions.optimistic();
  try {
    const response = await fetch(url, {
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || 'Action failed');
    }
    if (!mutationOptions.optimistic) {
      editingId = null;
      creatingTask = false;
      menuId = null;
    }
    if (body.export?.ok) settingsStatus(`Exported ${body.export.file}`, 'ok');
    if (body.export && body.export.ok === false) settingsStatus(`Export failed: ${body.export.error}`, 'error');
    return body;
  } catch (error) {
    if (version === mutationVersion) restoreLocalState(snapshot);
    throw error;
  } finally {
    pendingMutations = Math.max(0, pendingMutations - 1);
    scheduleStateSync(mutationVersion);
  }
}

function patchTask(id, body) {
  return mutate(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, {
    optimistic: () => optimisticPatchTask(id, body),
  });
}

function removeDragPreview(drag = pointerDrag) {
  drag?.preview?.remove();
  if (drag) drag.preview = null;
  document.querySelectorAll('.task-drag-preview').forEach((node) => node.remove());
}

function updateDragPreviewPosition(drag, clientX, clientY) {
  if (!drag?.preview) return;
  const x = Math.round(clientX - drag.previewOffsetX);
  const y = Math.round(clientY - drag.previewOffsetY);
  drag.preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function createDragPreview(drag, row, event) {
  if (!drag || !row) return;
  removeDragPreview(drag);
  const rect = row.getBoundingClientRect();
  const preview = row.cloneNode(true);
  preview.classList.remove('dragging', 'drop-before', 'drop-after', 'menu-open');
  preview.classList.add('task-drag-preview');
  preview.removeAttribute('data-task-id');
  preview.removeAttribute('data-task-title');
  preview.removeAttribute('data-draggable');
  preview.setAttribute('aria-hidden', 'true');
  preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  preview.querySelector('.task-menu')?.remove();
  preview.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`;
  preview.style.height = `${rect.height}px`;
  drag.preview = preview;
  drag.previewOffsetX = event.clientX - rect.left;
  drag.previewOffsetY = event.clientY - rect.top;
  updateDragPreviewPosition(drag, event.clientX, event.clientY);
  document.body.append(preview);
}

function clearDragMarkers() {
  dragOverId = null;
  dragPosition = null;
  document.querySelectorAll('.task.drop-before, .task.drop-after').forEach((node) => {
    node.classList.remove('drop-before', 'drop-after');
  });
  document.querySelectorAll('.drag-over-nav').forEach((node) => node.classList.remove('drag-over-nav'));
}

function orderedIdsForDrop(container, draggedId, targetId, position) {
  const ids = [...container.querySelectorAll('.task[data-task-id]')]
    .map((row) => row.dataset.taskId)
    .filter((id) => id && id !== draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex === -1) return null;
  ids.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return ids;
}

async function reorderDrop(container, draggedId, targetId, position) {
  const ids = orderedIdsForDrop(container, draggedId, targetId, position);
  if (!ids) return;
  await mutate('/api/tasks/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ ids }),
  });
}

function navDropTarget(target) {
  return target?.closest?.('[data-drop-plan-date], [data-drop-list], [data-drop-area], [data-drop-action], [data-drop-focus], [data-drop-project]') || null;
}

async function dropOnNavTarget(id, target) {
  const entry = entryById(id);
  if (!entry || !target) return;
  if (target.dataset.dropPlanDate) {
    await patchTask(id, plannedDatePatch(entry, target.dataset.dropPlanDate));
    return;
  }
  if (target.dataset.dropList) {
    const list = target.dataset.dropList;
    await patchTask(id, {
      list,
      todo: todoForList(list),
      scheduledAt: list === 'scheduled' && !entry.scheduled ? relativeDate(1) : undefined,
    });
    return;
  }
  if (target.dataset.dropArea) {
    await patchTask(id, { area: target.dataset.dropArea });
    return;
  }
  if (target.dataset.dropProject) {
    await patchTask(id, { project: target.dataset.dropProject });
    return;
  }
  if (target.dataset.dropFocus) {
    await mutate(`/api/tasks/${id}/focus`, {
      method: 'PATCH',
      body: JSON.stringify({ focus: true }),
    }, {
      optimistic: () => optimisticPatchTask(id, { focus: true }),
    });
    return;
  }
  if (target.dataset.dropAction === 'logbook') {
    await mutate(`/api/tasks/${id}/logbook`, { method: 'POST' }, {
      optimistic: () => optimisticPatchTask(id, { todo: 'DONE' }),
    });
    return;
  }
  if (target.dataset.dropAction === 'trash') {
    await mutate(`/api/tasks/${id}/trash`, { method: 'POST' }, {
      optimistic: () => optimisticTrashTask(id, true),
    });
  }
}

function pointerDropContext(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  const navTarget = navDropTarget(target);
  if (navTarget) return { type: 'nav', target: navTarget };
  const row = target?.closest?.('.task[data-task-id]');
  const container = row?.closest('.items');
  if (row && container && row.dataset.taskId !== draggingId) {
    const rect = row.getBoundingClientRect();
    return {
      type: 'row',
      row,
      container,
      targetId: row.dataset.taskId,
      position: clientY > rect.top + rect.height / 2 ? 'after' : 'before',
    };
  }
  return { type: 'none' };
}

function updatePointerDragMarkers(context) {
  clearDragMarkers();
  if (context.type === 'nav') {
    context.target.classList.add('drag-over-nav');
    return;
  }
  if (context.type === 'row') {
    dragOverId = context.targetId;
    dragPosition = context.position;
    context.row.classList.add(`drop-${context.position}`);
  }
}

function finishPointerDrag(event) {
  const drag = pointerDrag;
  if (!drag) return null;
  pointerDrag = null;
  drag.grip?.releasePointerCapture?.(event?.pointerId ?? drag.pointerId);
  removeDragPreview(drag);
  document.body.classList.remove('is-dragging-task');
  return drag;
}

function resetDraggingUi({ rerender = false } = {}) {
  draggingId = null;
  removeDragPreview();
  clearDragMarkers();
  document.querySelectorAll('.task.dragging').forEach((node) => node.classList.remove('dragging'));
  if (rerender) render();
}

function focusRapidEntry(view = currentView) {
  if (view !== currentView) setView(view);
  els.titleInput.focus();
}

function openNewTask(view = currentView) {
  if (view !== currentView) setView(view);
  creatingTask = true;
  editingId = null;
  menuId = null;
  render();
  requestAnimationFrame(() => {
    document.querySelector('[data-new-form] input[name="title"]')?.focus();
  });
}

function showShortcuts() {
  window.alert([
    'Create: n, Shift+n',
    'Create in list: i inbox, x next, f focus, p project area',
    'Navigate: t today, u forecast',
    'Navigate: 1 inbox, 2 focus, 3 next, 4 projects, 5 review, 6 work, 7 part-time, 8 learning, 9 logbook, 0 trash',
    'Search: /',
    'Shortcuts: k',
    'Close menu/edit: Esc',
  ].join('\n'));
}

document.querySelectorAll('[data-view-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setView(link.dataset.viewLink);
  });
});

document.addEventListener('click', (event) => {
  const projectLink = event.target.closest('[data-project-link]');
  if (projectLink) {
    event.preventDefault();
    setView(`project/${projectSlug(projectLink.dataset.projectLink)}`);
    return;
  }
  const projectOpen = event.target.closest('[data-project-open]');
  if (projectOpen) {
    event.preventDefault();
    setView(`project/${projectSlug(projectOpen.dataset.projectOpen)}`);
    return;
  }
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink && !viewLink.matches('.rail-link, .footer-link, .brand')) {
    event.preventDefault();
    setView(viewLink.dataset.viewLink);
  }
});

window.addEventListener('popstate', () => {
  setView((location.hash || '#next').slice(1), true);
});

window.addEventListener('hashchange', () => {
  setView((location.hash || '#next').slice(1), true);
});

els.search.addEventListener('input', render);

els.chips.addEventListener('click', (event) => {
  const planner = event.target.closest('[data-planner-mode]');
  if (planner) {
    todayPlannerMode = !todayPlannerMode;
    render();
    return;
  }
  const area = event.target.closest('[data-area]');
  if (area) {
    areaFilter = area.dataset.area;
    render();
    return;
  }
  const note = event.target.closest('[data-note-mode]');
  if (note) {
    noteMode = note.dataset.noteMode;
    localStorage.setItem('gtd-note-mode', noteMode);
    render();
  }
});

els.chips.addEventListener('change', (event) => {
  const filter = event.target.closest('[data-meta-filter]');
  if (!filter) return;
  if (filter.dataset.metaFilter === 'time') timeFilter = filter.value;
  if (filter.dataset.metaFilter === 'energy') energyFilter = filter.value;
  render();
});

els.tagList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag-filter]');
  if (!button) return;
  const tag = button.dataset.tagFilter;
  if (tag === 'all') {
    setView(currentView === 'context' ? 'next' : currentView);
    return;
  }
  setView(`context/${contextSlug(tag)}`);
});

document.querySelector('#new-item').addEventListener('click', () => {
  openNewTask();
});

els.settings?.addEventListener('click', (event) => {
  event.stopPropagation();
  renderStorage();
  setSettingsOpen(els.settingsPanel.hidden);
});

els.settingsClose?.addEventListener('click', () => {
  setSettingsOpen(false);
});

els.exportOrg?.addEventListener('click', async () => {
  els.exportOrg.disabled = true;
  settingsStatus('Exporting');
  try {
    const response = await fetch('/api/export/org', { method: 'POST' });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || 'Export failed');
    settingsStatus(`Exported ${body.file}`, 'ok');
    await load();
  } catch (error) {
    settingsStatus(error.message, 'error');
  } finally {
    els.exportOrg.disabled = false;
  }
});

els.content.addEventListener('pointerdown', (event) => {
  const grip = event.target.closest('.grip');
  const row = grip?.closest?.('.task[data-task-id]');
  if (!row || row.dataset.draggable !== 'true' || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  grip.setPointerCapture?.(event.pointerId);
  pointerDrag = {
    id: row.dataset.taskId,
    pointerId: event.pointerId,
    grip,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  document.body.classList.add('is-dragging-task');
});

document.addEventListener('pointermove', (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = Math.abs(event.clientX - pointerDrag.startX);
  const dy = Math.abs(event.clientY - pointerDrag.startY);
  if (!pointerDrag.active && dx + dy < DRAG_START_DISTANCE) return;
  draggingId = pointerDrag.id;
  const row = document.querySelector(`.task[data-task-id="${draggingId}"]`);
  if (!pointerDrag.active) {
    pointerDrag.active = true;
    menuId = null;
    editingId = null;
    createDragPreview(pointerDrag, row, event);
  }
  row?.classList.add('dragging');
  updateDragPreviewPosition(pointerDrag, event.clientX, event.clientY);
  updatePointerDragMarkers(pointerDropContext(event.clientX, event.clientY));
});

document.addEventListener('pointerup', async (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const drag = finishPointerDrag(event);
  event.preventDefault();
  if (!drag.active) {
    resetDraggingUi();
    return;
  }
  const context = pointerDropContext(event.clientX, event.clientY);
  resetDraggingUi();
  try {
    if (context.type === 'nav') {
      await dropOnNavTarget(drag.id, context.target);
    } else if (context.type === 'row') {
      await reorderDrop(context.container, drag.id, context.targetId, context.position);
    } else {
      render();
    }
  } catch (error) {
    els.content.innerHTML = `<div class="empty-card"><h2>Drag failed</h2><p>${esc(error.message)}</p></div>`;
  }
});

document.addEventListener('pointercancel', (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  finishPointerDrag(event);
  resetDraggingUi({ rerender: true });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-new-menu]') && !event.target.closest('.new-task-menu')) {
    closeNewTaskMenu();
  }
  if (!event.target.closest('.task-menu') && !event.target.closest('[data-action="MENU"]')) {
    if (menuId) {
      menuId = null;
      render();
    }
  }
  if (!event.target.closest('#settings-panel') && !event.target.closest('#settings')) {
    setSettingsOpen(false);
  }
});

document.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName?.toLowerCase();
  const inField = ['input', 'textarea', 'select'].includes(tag);
  if (event.key === 'Escape') {
    if (document.querySelector('.new-task-menu')) {
      event.preventDefault();
      closeNewTaskMenu();
      return;
    }
    if (editingId || menuId || creatingTask) {
      event.preventDefault();
      editingId = null;
      editDraft = null;
      editError = '';
      creatingTask = false;
      menuId = null;
      render();
      return;
    }
    if (event.target === els.titleInput) {
      els.titleInput.value = '';
      els.titleInput.blur();
      return;
    }
  }
  if (inField) return;

  const key = event.key.toLowerCase();
  const navByNumber = {
    1: 'inbox',
    2: 'focus',
    3: 'next',
    4: 'projects',
    5: 'review',
    6: 'work',
    7: 'parttime',
    8: 'learn',
    9: 'logbook',
    0: 'trash',
  };
  if (navByNumber[event.key]) {
    event.preventDefault();
    setView(navByNumber[event.key]);
    return;
  }
  if (event.key === '[' || event.key === ']') {
    event.preventDefault();
    const index = VIEW_ORDER.indexOf(currentView);
    const direction = event.key === ']' ? 1 : -1;
    const next = (index + direction + VIEW_ORDER.length) % VIEW_ORDER.length;
    setView(VIEW_ORDER[next]);
    return;
  }
  if (key === 't') {
    event.preventDefault();
    setView('today');
    return;
  }
  if (key === 'u') {
    event.preventDefault();
    setView('forecast');
    return;
  }
  if (key === '/') {
    event.preventDefault();
    els.search.focus();
    return;
  }
  if (key === 'k' || key === 'h') {
    event.preventDefault();
    showShortcuts();
    return;
  }
  if (key === 'n') {
    event.preventDefault();
    openNewTask();
    return;
  }
  const createTargets = {
    i: 'inbox',
    f: 'focus',
    x: 'next',
    p: 'work',
  };
  if (key === 'l' && event.shiftKey) createTargets.l = 'later';
  const targetView = createTargets[key];
  if (targetView) {
    event.preventDefault();
    openNewTask(targetView);
  }
});

els.titleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    els.form.requestSubmit();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    els.titleInput.value = '';
    els.titleInput.blur();
  }
});

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = els.titleInput.value.trim();
  if (!title) return;
  els.addStatus.hidden = false;
  els.addStatus.textContent = 'Saving';
  els.addStatus.className = '';
  try {
    const list = listForCurrentView();
    const tags = tagFilter && !['all', '-'].includes(tagFilter) ? [tagFilter] : undefined;
    const project = currentView === 'project' ? effectiveProjectName() : undefined;
    await mutate('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, area: els.areaSelect.value, list, focus: currentView === 'focus', tags, project }),
    });
    els.titleInput.value = '';
  } catch (error) {
    els.addStatus.textContent = error.message;
    els.addStatus.className = 'error';
  } finally {
    setTimeout(() => {
      els.addStatus.hidden = true;
    }, 1200);
  }
});

els.content.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-source-import]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const url = String(data.get('url') || '').trim();
  if (!url) return;
  const status = form.querySelector('[data-source-import-status]');
  if (status) {
    status.hidden = false;
    status.textContent = 'Importing';
    status.className = '';
  }
  try {
    const response = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        type: data.get('type') || undefined,
      }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || 'Import failed');
    form.reset();
    await load({ preserveViewState: true, silent: true });
    setView(`source/${sourceSlug(body.id)}`);
  } catch (error) {
    if (status) {
      status.textContent = error.message;
      status.className = 'error';
    }
  }
});

els.content.addEventListener('click', async (event) => {
  const newMenuChoice = event.target.closest('[data-new-menu-value]');
  if (newMenuChoice) {
    event.preventDefault();
    event.stopPropagation();
    setNewTaskMenuValue(newMenuChoice);
    return;
  }
  const newMenuButton = event.target.closest('[data-new-menu]');
  if (newMenuButton) {
    event.preventDefault();
    event.stopPropagation();
    openNewTaskMenu(newMenuButton);
    return;
  }
  if (event.target.closest('[data-clear-search]')) {
    els.search.value = '';
    render();
    els.search.focus();
    return;
  }
  const sourceOpen = event.target.closest('[data-source-open]');
  if (sourceOpen) {
    event.preventDefault();
    setView(`source/${sourceSlug(sourceOpen.dataset.sourceOpen)}`);
    return;
  }
  const sourceStatus = event.target.closest('[data-source-status]');
  if (sourceStatus) {
    event.preventDefault();
    event.stopPropagation();
    const status = sourceStatus.dataset.sourceStatus;
    const id = sourceStatus.dataset.id;
    const existing = sourceById(id);
    const nextStatus = existing?.status === 'reading' && status === 'reading' ? 'unread' : status;
    if (existing?.status === nextStatus) {
      render();
      return;
    }
    try {
      await mutate(`/api/sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      }, {
        optimistic: () => optimisticPatchSource(id, { status: nextStatus }),
      });
      await load({ preserveViewState: true, silent: true });
    } catch (error) {
      els.content.innerHTML = `<div class="empty-card"><h2>Source update failed</h2><p>${esc(error.message)}</p></div>`;
    }
    return;
  }
  const sourceTaskOpen = event.target.closest('[data-source-task-open]');
  if (sourceTaskOpen) {
    event.preventDefault();
    event.stopPropagation();
    revealTask(sourceTaskOpen.dataset.taskId);
    return;
  }
  const sourceTask = event.target.closest('[data-source-task]');
  if (sourceTask) {
    event.preventDefault();
    event.stopPropagation();
    sourceTask.disabled = true;
    sourceTask.textContent = 'Creating...';
    try {
      const result = await mutate(`/api/sources/${sourceTask.dataset.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await load({ preserveViewState: true, silent: true });
      revealTask(result.id);
    } catch (error) {
      els.content.innerHTML = `<div class="empty-card"><h2>Task creation failed</h2><p>${esc(error.message)}</p></div>`;
    }
    return;
  }
  const button = event.target.closest('[data-action]');
  const menuParent = event.target.closest('.menu-parent');
  if (!button && menuParent) {
    event.stopPropagation();
    const row = menuParent.closest('.has-submenu');
    row?.classList.toggle('submenu-open');
    return;
  }
  if (!button) return;
  event.stopPropagation();
  const { action, id } = button.dataset;
  if (action === 'CANCEL_NEW') {
    creatingTask = false;
    render();
    return;
  }
  if (action === 'NEW_FOCUS') {
    const active = button.dataset.focus !== '1';
    button.dataset.focus = active ? '1' : '0';
    button.classList.toggle('active', active);
    button.setAttribute('aria-label', active ? 'Remove from focus' : 'Add to focus');
    return;
  }
  const entry = entryById(id);
  if (action === 'MENU') {
    menuId = menuId === id ? null : id;
    editingId = null;
    creatingTask = false;
    render();
    return;
  }
  if (action === 'EDIT') {
    editingId = id;
    editDraft = null;
    editError = '';
    creatingTask = false;
    menuId = null;
    render();
    return;
  }
  if (action === 'CANCEL_EDIT') {
    editingId = null;
    editDraft = null;
    editError = '';
    render();
    return;
  }
  if (action === 'INFO') {
    window.alert([
      entry?.title || id,
      entry?.project ? `Project: ${entry.project}` : '',
      entry?.tags?.length ? `Tags: ${entry.tags.join(', ')}` : '',
      entry?.created ? `Created: ${entry.created}` : '',
      entry?.closed ? `Closed: ${entry.closed}` : '',
      entry?.file ? `Source: ${entry.file}:${entry.line || 1}` : 'Source: UI database',
    ].filter(Boolean).join('\n'));
    menuId = null;
    render();
    return;
  }
  if (action === 'EMAIL') {
    const subject = encodeURIComponent(entry?.title || 'GTD action');
    const body = encodeURIComponent([entry?.title || '', entry?.notes || ''].filter(Boolean).join('\n\n'));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    return;
  }
  if (action === 'MANAGE_AREAS' || action === 'MANAGE_CONTEXTS') {
    const messages = {
      MANAGE_AREAS: 'Areas are Work, Part-Time, Learning, and Other in this GTD setup.',
      MANAGE_CONTEXTS: 'Contexts are represented as tags for now.',
    };
    window.alert(messages[action]);
    menuId = null;
    render();
    return;
  }

  button.disabled = true;
  try {
    if (action === 'FOCUS') {
      const focus = button.dataset.focus === '1';
      await mutate(`/api/tasks/${id}/focus`, {
        method: 'PATCH',
        body: JSON.stringify({ focus }),
      }, {
        optimistic: () => optimisticPatchTask(id, { focus }),
      });
    } else if (action === 'SET_LIST') {
      const list = button.dataset.value;
      await patchTask(id, {
        list,
        todo: todoForList(list),
        scheduledAt: list === 'scheduled'
          ? (entry?.scheduled || relativeDate(1))
          : (entry?.scheduled && entry?.list === 'scheduled' ? '' : entry?.scheduled),
      });
    } else if (action === 'SET_TIME') {
      await patchTask(id, { effort: button.dataset.value });
    } else if (action === 'SET_ENERGY') {
      await patchTask(id, { energy: button.dataset.value });
    } else if (action === 'SET_REPEAT') {
      await patchTask(id, { repeat: button.dataset.value });
    } else if (action === 'PLAN') {
      await patchTask(id, plannerPatch(entry, button.dataset.plan));
    } else if (action === 'SET_DUE') {
      await patchTask(id, { dueAt: button.dataset.value });
    } else if (action === 'SET_AREA') {
      await patchTask(id, { area: button.dataset.value });
    } else if (action === 'SET_PROJECT') {
      await patchTask(id, { project: button.dataset.value });
    } else if (action === 'ADD_TAG') {
      const value = button.dataset.value;
      const tags = new Set(entry?.tags || []);
      if (tags.has(value)) tags.delete(value);
      else tags.add(value);
      await patchTask(id, { tags: [...tags] });
    } else if (action === 'CLEAR_TAGS') {
      await patchTask(id, { tags: [] });
    } else if (action === 'SET_SCHEDULE') {
      const value = button.dataset.value;
      await patchTask(id, {
        scheduledAt: value,
        list: value ? 'scheduled' : (entry?.list === 'scheduled' ? 'next' : entry?.list || 'next'),
        todo: entry?.list === 'waiting' ? 'WAIT' : 'TODO',
      });
    } else if (action === 'LOGBOOK') {
      await mutate(`/api/tasks/${id}/logbook`, { method: 'POST' }, {
        optimistic: () => optimisticPatchTask(id, { todo: 'DONE' }),
      });
    } else if (action === 'COPY') {
      await mutate(`/api/tasks/${id}/copy`, { method: 'POST' });
    } else if (action === 'CONVERT_PROJECT') {
      await mutate(`/api/tasks/${id}/convert/project`, { method: 'POST' });
    } else if (action === 'TRASH') {
      await mutate(`/api/tasks/${id}/trash`, { method: 'POST' }, {
        optimistic: () => optimisticTrashTask(id, true),
      });
    } else if (action === 'RESTORE') {
      await mutate(`/api/tasks/${id}/restore`, { method: 'POST' }, {
        optimistic: () => optimisticTrashTask(id, false),
      });
    } else if (action === 'DELETE') {
      await mutate(`/api/tasks/${id}`, { method: 'DELETE' });
    } else {
      await mutate(`/api/tasks/${id}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ todo: action }),
      }, {
        optimistic: () => optimisticPatchTask(id, { todo: action }),
      });
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Failed';
    button.title = error.message;
  }
});

els.content.addEventListener('dblclick', (event) => {
  const row = event.target.closest('[data-task-id]');
  if (!row) return;
  editingId = row.dataset.taskId;
  editDraft = null;
  editError = '';
  creatingTask = false;
  menuId = null;
  render();
});

els.content.addEventListener('submit', async (event) => {
  const newForm = event.target.closest('[data-new-form]');
  if (newForm) {
    event.preventDefault();
    const data = new FormData(newForm);
    const body = {
      ...taskBodyFromFormData(data),
      focus: newForm.querySelector('[data-action="NEW_FOCUS"]')?.dataset.focus === '1',
    };
    try {
      await mutate('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (error) {
      const button = newForm.querySelector('button[type="submit"]');
      button.textContent = 'Failed';
      button.title = error.message;
    }
    return;
  }
  const form = event.target.closest('[data-edit-form]');
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.id;
  const data = new FormData(form);
  const body = taskBodyFromFormData(data, { includeScheduled: true, entry: entryById(id) });
  editError = '';
  editDraft = null;
  try {
    await mutate(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    editingId = null;
    render();
  } catch (error) {
    editingId = id;
    editDraft = {
      id,
      title: String(data.get('title') || ''),
      notes: String(data.get('notes') || ''),
      tags: String(data.get('tags') || ''),
    };
    editError = error.message;
    render();
  }
});

load().catch((error) => {
  els.content.innerHTML = `<div class="empty-card"><h2>Cannot load GTD</h2><p>${esc(error.message)}</p></div>`;
});
