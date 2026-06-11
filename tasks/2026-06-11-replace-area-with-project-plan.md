# Replace Area with Project — Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Steps use `- [ ]`. After each task: run the listed command, confirm expected output, commit. Backend tasks must leave `npm test` green; frontend tasks are verified with headless Chromium probes (no unit harness for the SPA) and the full e2e at the end.

**Goal:** Remove the Area dimension entirely and make Project the sole grouping dimension, settable at creation time (incl. Rapid Entry).

**Architecture:** Backend first (strip `area` usage while keeping the column, then drop the column+index via an idempotent migration), then frontend (strip area UI, then add a project picker to the create flows). `project` is an existing first-class field; `:Project:` already round-trips through Org. Spec: `tasks/2026-06-11-replace-area-with-project-design.md`.

**Tech Stack:** Node 22 ESM, `node:sqlite` (`DatabaseSync`), `node:test`, raw `node:http`, vanilla-JS SPA, `playwright-core` for browser probes.

---

### Task 1: Strip `area` from backend logic (keep the column physically)

Remove all *use* of `area` from `src/db.js` and `src/org.js`. The `area` column stays in the table for now (it just keeps its `DEFAULT 'other'`); `INSERT`/`UPDATE` simply stop naming it. This keeps `npm test` green and is a no-schema-change commit.

**Files:**
- Modify: `src/db.js` — remove `AREA_SECTIONS` (≈l.15), `sectionForArea` (≈l.95), `tagsForArea` (≈l.99), `effortForArea` (≈l.106); remove `area: row.area` from `rowsToEntries` (≈l.396); remove the `groups.areas` object (≈l.589) and its fill loop (≈l.605); remove `area`/`section` derivation from `addTask` (≈l.813), `updateTask` (≈l.1023), `createTaskFromSource` (`area:'learn'` ≈l.949), `copyTask` (≈l.980), `convertToProject` (≈l.1129); drop `area` from the `insertTask` column list + every `.run(...)` (≈l.677, l.752, l.832) and from `task_created`/`task_updated` `logEvent` payloads. `section` now defaults to `'Tasks'` (`input.section || 'Tasks'`); tags come only from `input.tags` (no `tagsForArea` fallback); effort from `input.effort` only.
- Modify: `src/org.js` — remove `areaForEntry` (≈l.30) and `entry.area = areaForEntry(entry)` (≈l.231).
- Test: `test/db.test.mjs`, `test/org.test.mjs` — update assertions that reference `area`/`groups.areas`/`tagsForArea`.

- [ ] **Step 1: Update tests to the new contract first (they should fail).** In `test/db.test.mjs`, change any assertion on `entry.area`, `state.groups.areas`, or auto-derived `work`/`learning` tags. Add:

```js
test('addTask stores an explicit project and leaves area out of the entry', () => {
  const { store } = freshStore();               // use the file's existing harness helper
  const { id } = store.addTask({ title: 'Ship it', project: 'Website redesign' });
  const entry = store.getState().entries.find((e) => e.id === id);
  assert.equal(entry.project, 'Website redesign');
  assert.equal('area' in entry, false);
  assert.equal(entry.section, 'Tasks');
});
```

In `test/org.test.mjs`, remove assertions that expect `entry.area` from `areaForEntry`.

- [ ] **Step 2: Run to confirm failure.** Run: `node --disable-warning=ExperimentalWarning --test test/db.test.mjs test/org.test.mjs`. Expected: FAIL (`area` still present / helper still referenced).

- [ ] **Step 3: Remove the area logic** across `src/db.js` and `src/org.js` per the Files list. Leave the `area` column in the `CREATE TABLE`, the `ensureColumn` list, and the `CREATE INDEX` untouched in THIS task (Task 2 handles the schema).

- [ ] **Step 4: Run the full suite.** Run: `npm test`. Expected: PASS (all tests, including the new ones).

- [ ] **Step 5: Commit.**

```bash
git add src/db.js src/org.js test/db.test.mjs test/org.test.mjs
git commit -m "refactor(db): stop using area; project is the grouping dimension"
```

---

### Task 2: Drop the `area` column and its index (idempotent migration)

**Files:**
- Modify: `src/db.js` — remove `['area', "area TEXT NOT NULL DEFAULT 'other'"]` from the `ensureColumn` migration list (≈l.182); remove `area TEXT NOT NULL DEFAULT 'other',` from `CREATE TABLE tasks` (≈l.294); remove `CREATE INDEX IF NOT EXISTS idx_tasks_area ON tasks(area);` (≈l.353); add a drop-migration that runs after `ensureColumn`.
- Test: `test/db.test.mjs`.

- [ ] **Step 1: Write the failing migration test.**

```js
test('tasks table has no area column and migration is idempotent', () => {
  const { store, dbPath } = freshStore();        // freshStore must expose the sqlite file path
  const db = new DatabaseSync(dbPath);
  const cols = db.prepare("PRAGMA table_info('tasks')").all().map((c) => c.name);
  db.close();
  assert.equal(cols.includes('area'), false);
  // Re-opening the store again must not throw (idempotent).
  assert.doesNotThrow(() => createGtdStore({ ...storeOptionsFor(dbPath) }).close());
});
```

(If `freshStore` does not already expose the db path / options, extend the helper minimally to do so.)

- [ ] **Step 2: Run to confirm failure.** Run: `node --disable-warning=ExperimentalWarning --test test/db.test.mjs`. Expected: FAIL (`area` column still present).

- [ ] **Step 3: Implement the drop migration.** After the `ensureColumn` loop in `createGtdStore`, add:

```js
// One-time removal of the legacy `area` dimension (replaced by `project`).
const hasArea = db.prepare("PRAGMA table_info('tasks')").all().some((c) => c.name === 'area');
if (hasArea) {
  db.exec('DROP INDEX IF EXISTS idx_tasks_area;');
  db.exec('ALTER TABLE tasks DROP COLUMN area;');
}
```

Also delete the three schema references listed in Files (CREATE TABLE column, ensureColumn entry, CREATE INDEX).

- [ ] **Step 4: Run the full suite.** Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/db.js test/db.test.mjs
git commit -m "feat(db): drop legacy area column and index"
```

---

### Task 3: Strip `area` from the frontend

**Files:**
- Modify: `public/app.js` — remove `VIEWS.work/parttime/learn/other` (≈l.13-16) and their entries in `VIEW_ORDER` (≈l.28); remove `AREA_LABELS` (≈l.39), `els.areaSelect` (≈l.145), frontend `sectionForArea` (≈l.305), the `patch.area/section` branch in `localTaskPatchFromBody` (≈l.327), the `taskView.area` filter (≈l.522), `areaFilter` (≈l.768, l.2351), area counts (≈l.879-882), the area chip in the row renderer (≈l.1750 — render `entry.project` instead), the `SET_AREA` context-menu item (≈l.1467) + its handler (≈l.2851), the drag-to-area handler (`dataset.dropArea` ≈l.2197), the `6/7/8` shortcut entries (≈l.2529-2531) and their mention in the help string (≈l.2298); change `projectRows()` sort (≈l.677) to `a.title.localeCompare(b.title)`; remove the `area` `<select>` from `editorSideFields` (≈l.1266) and the `area` key from `taskBodyFromFormData` (≈l.1281); make the quick-add submit (≈l.2614) send `project` (added in Task 4) instead of `area`.
- Modify: `public/index.html` — remove the Work/Part-Time/Learning/Other rail links; remove the hidden/visible `area` field from the `#quick-add` form.
- Modify: `public/styles.css` — remove now-dead area-chip / area-link rules (only those clearly area-specific).

- [ ] **Step 1: Remove the area UI** per the Files list. Where the row renderer showed the area chip, render the project name (`entry.project` or the resolved `projectNameForEntry(entry)`), reusing the existing chip markup/escaping.

- [ ] **Step 2: Headless smoke probe.** Write a throwaway probe (pattern from `scripts/e2e.mjs`) that boots an isolated server (temp dir, ephemeral port, `GTD_REQUIRE_AUTH=0`), loads the SPA headless, and asserts: no console errors / no pageerror on load; navigating to `#work`/`#learn` does NOT render an area view (falls back to a default/empty); a task row shows its project name; no element with `name="area"` exists. Run: `node /tmp/probe-area-gone.mjs`. Expected: prints `CLEAN`.

- [ ] **Step 3: Commit.**

```bash
git add public/app.js public/index.html public/styles.css
git commit -m "refactor(ui): remove Area views, selector, chips, and shortcuts"
```

---

### Task 4: Project picker in the create flows

Add a reusable picker: a `<select name="project">` whose options are the existing project names from `state.groups.projects`, plus a final `+ New project…` option (`value="__new__"`) that reveals a `<input name="newProject">`. On submit, `taskBodyFromFormData` resolves `project = projectSelect === '__new__' ? newProject.trim() : projectSelect`. Default the select to the current project when the active view is a project.

**Files:**
- Modify: `public/app.js` — add `projectPickerField(selected)` helper; use it in `editorSideFields` (replacing the bare project `<input>`) and wire `taskBodyFromFormData` to resolve `__new__`+`newProject`; default `selected` to `currentProject` when `currentView === 'project'`; add a delegated `change` handler that toggles the `newProject` input's visibility when `__new__` is chosen; add the same picker to the Rapid Entry form and include `project` in its submit body.
- Modify: `public/index.html` — add the picker container to the `#quick-add` form.

- [ ] **Step 1: Add `projectPickerField` and wire submit.**

```js
function projectPickerField(selected = '') {
  const names = (state?.groups?.projects || []).map((p) => p.name);
  const known = names.includes(selected);
  const opts = names.map((n) => option(n, n, selected)).join('');
  return `
    <label class="side-field side-project"><span>project</span>
      <select name="project" data-project-select>
        ${option('', 'Standalone', known ? '' : selected || '')}
        ${opts}
        ${option('__new__', '+ New project…', '')}
      </select>
    </label>
    <label class="side-field side-newproject" data-newproject hidden><span>new</span>
      <input name="newProject" value="" placeholder="New project name"></label>`;
}
```

In `taskBodyFromFormData`, replace the `project` line with:

```js
const projectSel = String(data.get('project') || '');
const project = projectSel === '__new__' ? String(data.get('newProject') || '').trim() : projectSel;
```

and set `project` in the body object from that.

- [ ] **Step 2: Default from current view + reveal-on-new.** Where `newTaskForm()` builds its side fields, pass `projectPickerField(currentView === 'project' ? effectiveProjectName(currentProject) : '')`. Add a delegated listener: when a `[data-project-select]` changes to `__new__`, unhide its sibling `[data-newproject]` and focus the input; otherwise hide it.

- [ ] **Step 3: Rapid Entry.** In `index.html` add the picker container to `#quick-add`; in the quick-add submit handler build `project` the same way and include it in the POST body (it replaces the removed `area`).

- [ ] **Step 4: Headless probe.** Probe (isolated server) that: seeds two projects via API; loads the SPA; opens the new-item form and asserts the project `<select>` lists both seeded projects + Standalone + "+ New project…"; selects an existing project, submits a new task, asserts it’s created under that project; chooses "+ New project…", types a name, submits, asserts the new task carries that project; uses Rapid Entry to create a task with a chosen project. Run: `node /tmp/probe-project-picker.mjs`. Expected: prints `CLEAN` with all assertions passing.

- [ ] **Step 5: Commit.**

```bash
git add public/app.js public/index.html
git commit -m "feat(ui): set project when creating tasks (picker + Rapid Entry)"
```

---

### Task 5: Org round-trip regression + server create-with-project test

**Files:**
- Test: `test/db.test.mjs` (org round-trip), `test/server.test.mjs` (HTTP create).

- [ ] **Step 1: Org `:Project:` round-trip test.**

```js
test('project survives export -> cold re-import', () => {
  const { store } = freshStore();
  store.addTask({ title: 'Draft post', project: 'Blog' });
  const org = store.exportOrgText();
  assert.match(org, /:Project: Blog/);
  const cold = importIntoColdStore(org);          // use the file's existing cold-import helper/pattern
  const entry = cold.getState().entries.find((e) => e.title === 'Draft post');
  assert.equal(entry.project, 'Blog');
});
```

- [ ] **Step 2: HTTP create-with-project test** in `test/server.test.mjs` (reuse the file's `startServer()` helper): `POST /api/tasks {title, project:'Ops'}` → 201; then `GET /api/state` shows the task with `project === 'Ops'` and it appears in `groups.projects`.

- [ ] **Step 3: Run.** Run: `npm test`. Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add test/db.test.mjs test/server.test.mjs
git commit -m "test: cover project round-trip and HTTP create-with-project"
```

---

### Task 6: Verification & delivery

- [ ] **Step 1: Full unit suite.** Run: `npm test`. Expected: all pass, 0 fail.
- [ ] **Step 2: Browser e2e.** Run: `npm run test:e2e`. Expected: passed. (Fix-forward any scenario that referenced area views.)
- [ ] **Step 3: Headless click-every-button** on an isolated instance (same exhaustive explorer used previously): 0 JS/console/5xx errors; confirm no area views, project picker works, Rapid Entry sets project.
- [ ] **Step 4: Backup live DB** before the schema migration ships. Run: `npm run backup`. Confirm a new backup dir with a `manifest.json`.
- [ ] **Step 5: Merge + push + redeploy.**

```bash
git checkout main && git merge --ff-only feat/replace-area-with-project
git push origin main
sudo systemctl restart agentdeck
```

- [ ] **Step 6: Health check.** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/state` → `401`; `systemctl show agentdeck -p ActiveState,SubState,MainPID,ExecMainStatus`; `journalctl -u agentdeck --since '1 min ago'` shows a clean start; the migration ran once (no `area` in the live DB) and existing tasks still load.

---

## Self-review notes

- **Spec coverage:** data-model drop (T1/T2), backend cleanup (T1), frontend strip + shortcuts + chips (T3), create-flow picker + default-from-view + Rapid Entry (T4), org compatibility (T1 removal + T5 round-trip), tests (T1/T2/T5 + probes), delivery incl. backup + push + redeploy (T6). All spec sections map to a task.
- **Migration ordering** (drop runs after `ensureColumn`, and the `ensureColumn` entry + `CREATE INDEX` are removed) is handled in T2 — prevents the column being re-added.
- **No placeholders:** new code (migration, picker) shown in full; removals specified by exact symbol + line anchor; test code and commands concrete.
- **Naming consistency:** `projectPickerField`, `newProject`, `__new__`, `data-project-select`, `data-newproject` used consistently across T3/T4.
