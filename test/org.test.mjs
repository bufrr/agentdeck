import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org.js';

const sample = `#+TITLE: Current Work

* Inbox
** TODO Raw captured thing
   :PROPERTIES:
   :Created: [2026-05-01 Fri 09:00]
   :END:

* Tasks
** TODO Call bank :shallow:
   :PROPERTIES:
   :Effort: 0:30
   :Created: [2026-05-01 Fri 09:00]
   :END:

* Work
** NEXT Ship API :work:
   :PROPERTIES:
   :List: scheduled
   :Focus: true
   :Effort: 1:00
   :Energy: high
   :Project: AgentDeck
   :Repeat: weekly
   :Created: [2026-05-01 Fri 09:00]
   :END:
   SCHEDULED: [2026-06-09 Tue 09:00]
   DEADLINE: [2026-06-10 Wed 17:00]

Ship note line one.
Ship note line two.
*** TODO Write tests
*** DONE Draft patch
   CLOSED: [2026-06-06 Sat 10:00]

* Part-Time
** TODO Design part time flow :parttime:

* Learning
** TODO Study Solana :learning:

* Ideas
** Learn the shortcuts
`;

test('parseOrg extracts headings, areas, and subtask progress', () => {
  const entries = parseOrg(sample, '/tmp/current.org');
  const ship = entries.find((entry) => entry.title === 'Ship API');
  assert.equal(ship.todo, 'NEXT');
  assert.equal(ship.area, 'work');
  assert.equal(ship.list, 'scheduled');
  assert.equal(ship.focus, true);
  assert.equal(ship.effort, '1:00');
  assert.equal(ship.energy, 'high');
  assert.equal(ship.project, 'AgentDeck');
  assert.equal(ship.repeat, 'weekly');
  assert.equal(ship.notes, 'Ship note line one.\nShip note line two.');
  assert.match(ship.scheduled, /2026-06-09/);
  assert.match(ship.due, /2026-06-10/);
  assert.equal(ship.subtasks.total, 2);
  assert.equal(ship.subtasks.done, 1);
  assert.equal(ship.subtasks.percent, 50);
  assert.equal(entries.find((entry) => entry.title === 'Learn the shortcuts').section, 'Ideas');
});
