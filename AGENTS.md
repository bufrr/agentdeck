# AGENTS.md

Guidance for coding agents working in AgentDeck.

## Overview

AgentDeck is a standalone Node/SQLite GTD and research workflow app. It manages tasks, projects, source links, fetched article/Twitter content, Today/Forecast planning, and source-to-GTD task conversion.

Important paths:

- `server.mjs`: HTTP server and API routes.
- `src/db.js`: SQLite store, migrations, task/source operations, Org export.
- `src/source-fetch.js`: URL/Twitter/article metadata and content capture.
- `src/org.js`: Org import/export compatibility helpers.
- `public/`: Browser app, styles, and assets.
- `scripts/e2e.mjs`: Playwright end-to-end suite.
- `test/`: Node test suite.

## Rules

- Preserve user data. Never delete or reset `data/*.sqlite*` files unless explicitly asked.
- SQLite is primary storage. Org is import/export compatibility only.
- Keep app code independent from the old Doom Emacs config repo.
- Use `rg`/`rg --files` for search.
- Use `apply_patch` for manual edits.
- Do not commit `node_modules/` or `data/*.sqlite*`.
- For UI/status/data changes, add or update tests and rerun both `npm test` and `npm run test:e2e`.
- For deployed UI changes, bump asset query versions in `public/index.html` so browsers do not keep stale JavaScript/CSS.

## Commands

```sh
npm ci
npm test
npm run test:e2e:install
npm run test:e2e
npm start
```

Production smoke checks:

```sh
systemctl status agentdeck.service --no-pager
curl -fsS -u "bytenoob:$(cat /home/bytenoob/agentdeck/data/basic-password)" http://127.0.0.1:8787/api/state
```

## Deployment Notes

Production runs from `/home/bytenoob/agentdeck` behind nginx. The public URL is:

```text
https://gtd.bytenoob.io
```

The service should bind to `127.0.0.1`; nginx handles external HTTPS.
