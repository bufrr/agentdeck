# AgentDeck Review Fixes — Verification Report

**Branch:** `fix/review-2026-06-11`
**Base:** `2b18922` (`main`, "Add backup workflow")
**Verified:** 2026-06-11

## Final test results

- `npm test` — **35 tests, 35 pass, 0 fail** (baseline at branch point was 23/23; the implementation commits added 12 unit/HTTP regression tests).
- `npm run test:e2e` — **passed** (all 19 browser scenarios green; chromium spawned its own temp server on an ephemeral port, the production `:8787` instance was untouched).

Both suites are green. No fix-forward and no revert were required.

## Findings status (H-1..H-3, M-1..M-14 — 17 in scope)

| ID | Status | Commit | Subject | Regression test added |
|---|---|---|---|---|
| H-1 | fixed | `edaed78` | fix(db): H-1 spawn repeat successor only on open->done transition | db: "spawns a repeat successor only on an open->done transition" |
| H-2 | fixed | `7571020` | fix(org): H-2 escape note lines so a leading-asterisk note can't be reparsed as a heading | db: "round-trips note bodies that look like Org headings or drawers" |
| H-3 | fixed | `99e81d5` | fix(frontend): H-3 preserve PROJ/DONE status on edit-form save | none (frontend-only; covered by e2e suite + agent Chromium probe) |
| M-1 | fixed | `95d1571` | fix(server): M-1 guard against malformed Host header pre-auth crash | server: "survives a malformed Host header (no pre-auth crash)" |
| M-2 | fixed | `119f457` | fix(db): M-2 anchor day boundaries on the local calendar date | db: "anchors today on the local calendar date during the 00:00-08:00 window" |
| M-3 | fixed | `a840272` | fix(db): M-3 clamp monthly repeats to the month end | db: "clamps monthly repeats to the month end" |
| M-4 | fixed | `81cfd9f` | fix(db): M-4 roll overdue repeats forward to one future occurrence | db: "rolls an overdue repeat forward to a single future occurrence" |
| M-5 | fixed | `20ce92b` | fix(db): M-5 export tasks under non-default sections instead of dropping them | db: "exports tasks whose section is not a hardcoded default" |
| M-6 | fixed | `801cdcf` | fix(org): M-6 parse date-only stamps as UTC midnight and map repeater cookies | db: "imports a date-only repeating Org timestamp with the right UTC date"; org: "reads date-only stamps as UTC midnight and maps repeater cookies" |
| M-7 | fixed | `ff36f5b` | fix(db): M-7 sanitize tags on export so spaces/colons survive the round-trip | db: "sanitizes tags with spaces or colons on export" |
| M-8 | skipped | — | — | none — `scripts/backup.mjs` was not assigned to any implementation agent and is untouched on the branch |
| M-9 | fixed | `4cfdb5d` | fix(frontend): M-9 keep inline editor open and show error on failed PATCH | none (frontend-only; covered by e2e suite + agent Chromium probe) |
| M-10 | fixed | `864a78e` | fix(frontend): M-10 guard quick-add and new-task forms against double submit | none (frontend-only; covered by e2e suite + agent Chromium probe) |
| M-11 | fixed | `8215f73` | fix(frontend): M-11 preserve in-progress drafts across optimistic and sync renders | none (frontend-only; covered by e2e suite + agent Chromium probe) |
| M-12 | fixed | `160ef95` | test(server): M-12 M-13 cover mutation routes and auto-export wiring | server: "mutation routes return their documented status codes" |
| M-13 | fixed | `160ef95` | test(server): M-12 M-13 cover mutation routes and auto-export wiring | server: "auto-export path writes the org file and reports success on mutation" |
| M-14 | fixed | `39db6f2` | fix(frontend): M-14 let Ctrl/Cmd/Alt key combos pass through to the browser | none (frontend-only; covered by e2e suite + agent Chromium probe) |

**16 fixed, 1 skipped (M-8), 0 reverted.**

## Follow-ups / not in scope

- **M-8** (backup partial-dir eviction): the only in-scope finding left unaddressed. No implementation agent owned `scripts/backup.mjs`; the fix (atomic temp-dir + rename on success, and a manifest-gated prune) is a self-contained change that should be done in its own TDD commit. Tracked for the next pass.
- **M-15** (backup never scheduled), **L-10** (DNS-rebinding TOCTOU), **L-16** (no CSP), **L-24** (systemd unit hardening), **L-27** (fonts/icons hot-loaded from a competitor CDN), and **all other Low / Info findings (L-1..L-30, I-1..I-9)** were deliberately out of scope for this pass and were not touched.
