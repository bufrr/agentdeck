# Design — Replace Area with Project

**Date:** 2026-06-11
**Branch:** `feat/replace-area-with-project` (from `main` @ `9ee773a`)
**Status:** Approved design, pending spec review.

## Goal

Remove the **Area** dimension (`Work / Part-Time / Learning / Other`) entirely and make
**Project** the sole grouping dimension. Make it possible to set a task's project at
creation time, including from the Rapid Entry box.

## Approved decisions

1. **Scope:** Replace Area entirely (not coexist).
2. **Migration:** Clean slate — no backfill. Existing tasks keep any `project` they already
   have; everything else is Standalone. Old `area` values are discarded.
3. **Navigation:** Remove the four Area sidebar views; keep the single **Projects overview**
   page + `#project/<slug>` drill-in.
4. **DB column:** Drop the `area` column and `idx_tasks_area` index (idempotent migration).
   A manual backup is taken before redeploy.
5. **Create flow:** Project picker (existing projects + "+ New project…") in Rapid Entry and
   the new-item form; it **defaults to the current project** when creating inside a project view.
6. **Keyboard shortcuts:** Retire `6/7/8` (were work/parttime/learn). `1–5`, `9`, `0` stay.

## Why this is low-risk on the org layer

`area` is already decoupled from the Org export. `exportTree`/`exportOrgText` group by
`section`, never `area`; `area` only feeds `section` at write-time via `sectionForArea`, and
project already round-trips as the `:Project:` property. Dropping Area therefore does **not**
touch the recently-fixed Org round-trip (H-2/M-5/M-6). We remove the area→section derivation
and let `section` default to `Tasks`; existing stored sections (e.g. `Work`) still export.

## Data model

- **Remove** `area` column + `idx_tasks_area` via an idempotent migration
  (`DROP INDEX IF EXISTS idx_tasks_area; ALTER TABLE tasks DROP COLUMN area;`), guarded by a
  PRAGMA `table_info` check so it runs at most once and is a no-op on an already-migrated DB.
  (Node 22's bundled SQLite supports `ALTER TABLE … DROP COLUMN`; the index is dropped first
  because a column referenced by an index cannot be dropped.)
- **Critical ordering:** also remove the `['area', …]` entry from the additive `ensureColumn`
  migration list and the `CREATE INDEX IF NOT EXISTS idx_tasks_area` from schema creation —
  otherwise the additive migration would re-add the column and the index right after the drop.
  Run the drop-migration after `ensureColumn` so a freshly-created DB is also normalised.
- Keep `section` (default `Tasks`). Keep `project TEXT` (the grouping label) and `parent_id`
  (hierarchy) unchanged.
- `project` semantics unchanged: a task belongs to a project when `project` is set, or it is a
  `PROJ`-status task (its title is the project name), or it descends from one.

## Backend (`src/db.js`, `src/org.js`)

Remove: `AREA_SECTIONS`, `sectionForArea`, `tagsForArea`, `effortForArea`, `areaForEntry`,
the `groups.areas` block + its per-area fill loop, area counts, and `area` from `rowsToEntries`
and all `logEvent` payloads.

Change:
- `addTask`: stop computing/storing `area`; `section` defaults to `Tasks`; tags come only from
  `input.tags` (no auto `work`/`learning` tags); effort defaults to none (no `effortForArea`).
- `updateTask`: drop `area`/area→section handling; keep explicit `section` if provided.
- `createTaskFromSource`: drop the `area: 'learn'` default; keep `project`.
- `copyTask` and `convertToProject`: drop `area`/`sectionForArea` references.
- `importOrgIfEmpty`: stop setting `area`/deriving section from area; keep `:Project:` import.
- `insertTask` prepared statement + all `.run(...)` call sites: remove the `area` column.

## Frontend (`public/app.js`, `public/index.html`, `public/styles.css`)

Remove:
- `VIEWS.work/parttime/learn/other`; the four entries in `VIEW_ORDER`; their sidebar rail links
  in `index.html`.
- `AREA_LABELS`, `els.areaSelect`, the frontend `sectionForArea`, the area branch in
  `localTaskPatchFromBody`, the `taskView.area` view filter, `areaFilter`, area counts, the
  area chip on rows (replaced by the project name), the `SET_AREA` context-menu item + handler,
  drag-to-area (`data-dropArea`) handler, and the `6/7/8` keyboard shortcuts.
- The area `<select>` in the editor side fields and the area value from `taskBodyFromFormData`.

Add / change:
- **Project picker** component used by both Rapid Entry and the new-item form: a `<select>`
  populated from `state.groups.projects` (names) with a trailing `+ New project…` option that
  reveals a text input; submitting maps to the existing `project` body field. No new server field.
- Default the picker to `currentProject` when the active view is a project (`#project/<slug>`).
- `projectRows()` sort: order by title (was `area` then title).
- Quick-add submit: send `project` (from the picker) instead of `area`.
- Rows render the project name in place of the former area chip.

## Org compatibility

- `:Project:` property export/import is unchanged.
- Remove `areaForEntry` derivation on import; imported tasks simply have no area.
- `section` grouping in the export is unchanged (M-5 fix preserved). New tasks export under
  `* Tasks`; previously-imported `Work`/etc. sections still export.

## Tests

Update all area-referencing tests in `test/db.test.mjs` and `test/org.test.mjs`. Add:
- `addTask` with `project` stores it; without one it is Standalone; `section` defaults `Tasks`.
- The drop-`area` migration is idempotent (run store init twice; `area` absent from `table_info`).
- Org `:Project:` round-trip still holds (export → cold re-import preserves project).
- A server/HTTP test: create a task with a project via `POST /api/tasks` returns it grouped
  under that project.
- Frontend coverage via the existing e2e + the headless click-through (no area views remain;
  project picker creates into the chosen project; Rapid Entry sets project).

## Acceptance criteria

- No `area` anywhere in the API response, UI, or new DB rows; `idx_tasks_area` and the column
  are gone; `npm test` green.
- Creating a task (Rapid Entry **and** new-item form) lets you pick an existing project or make
  a new one; inside a project view it defaults to that project.
- Sidebar has no Work/Part-Time/Learning/Other; Projects overview + drill-in work.
- Org export/import round-trip (incl. `:Project:`) still passes its tests.
- e2e + headless click-through clean; production redeployed and healthy.

## Delivery

1. Implement per the plan (TDD; commit per coherent unit).
2. Full gate: `npm test`, `npm run test:e2e`, headless click-every-button on an isolated instance.
3. **Backup the live DB** (`npm run backup`) before deploying the schema migration.
4. Merge to `main`, **push to `origin`**, restart `agentdeck.service`, health-check.

## Out of scope

Drag-to-project, project archiving/colours, pinned projects in the sidebar, and all prior
review Low/Info items. Not touched.
