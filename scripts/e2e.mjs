import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { slugTitle } from '../src/org.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEADFUL = process.env.PLAYWRIGHT_HEADFUL === '1';

const explicitChromePath = process.env.PLAYWRIGHT_CHROME || process.env.CHROME_PATH;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, server) {
  const deadline = Date.now() + 12_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before readiness with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/state`, { cache: 'no-store' });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw new Error(`Server did not become ready: ${lastError?.message || 'timeout'}`);
}

function launchOptions() {
  const options = {
    headless: !HEADFUL,
    timeout: 15_000,
    args: ['--disable-dev-shm-usage'],
  };
  if (explicitChromePath) {
    if (!existsSync(explicitChromePath)) {
      throw new Error(`Chrome executable does not exist: ${explicitChromePath}`);
    }
    options.executablePath = explicitChromePath;
  }
  return options;
}

function attr(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localDateOffset(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function menuPath(action, value) {
  if (action === 'SET_TIME') return ['Time'];
  if (action === 'SET_ENERGY') return ['Energy'];
  if (action === 'SET_REPEAT') return ['Repeat'];
  if (action === 'SET_DUE') return ['Due'];
  if (action === 'SET_SCHEDULE') return ['Schedule'];
  if (['ADD_TAG', 'CLEAR_TAGS'].includes(action)) return ['Contexts'];
  if (action === 'CONVERT_PROJECT') return ['Convert'];
  if (action === 'SET_PROJECT') return ['Move', 'Projects'];
  if (['TRASH', 'LOGBOOK'].includes(action)) return ['Move'];
  if (action === 'SET_LIST') {
    return ['State'];
  }
  return [];
}

async function visibleTaskTitles(page) {
  return page.$$eval('.task[data-task-title]', (rows) =>
    rows
      .filter((row) => row.offsetWidth || row.offsetHeight || row.getClientRects().length)
      .map((row) => row.dataset.taskTitle)
  );
}

async function visibleLoadingCards(page) {
  return page.$$eval('.empty-card h2', (nodes) =>
    nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return node.textContent.trim() === 'Loading'
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && box.width > 0
        && box.height > 0;
    }).length
  );
}

async function assertNoVisibleLoading(page) {
  assert.equal(await visibleLoadingCards(page), 0, 'Expected no visible Loading card during UI mutation');
}

async function holdRoute(page, pattern) {
  let markSeen;
  const seenPromise = new Promise((resolve) => {
    markSeen = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const handler = async (route) => {
    markSeen();
    await gate;
    await route.continue();
  };
  await page.route(pattern, handler);
  return {
    seen: seenPromise,
    release,
    cleanup: async () => {
      release();
      await page.unroute(pattern, handler);
    },
  };
}

async function waitForTask(page, title) {
  await page.waitForFunction((expected) => {
    return [...document.querySelectorAll('.task[data-task-title]')]
      .some((row) => row.dataset.taskTitle === expected && (row.offsetWidth || row.offsetHeight || row.getClientRects().length));
  }, title, { timeout: 5_000 });
  const row = page.locator(`.task[data-task-title="${attr(title)}"]`);
  await row.waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await row.count(), 1, `Expected one visible task titled ${title}`);
  return row;
}

async function waitForProjectTask(page, title) {
  await page.waitForFunction((expected) => {
    return [...document.querySelectorAll('.task[data-task-title]')]
      .some((row) => row.dataset.taskTitle === expected && row.querySelector('.state-proj'));
  }, title, { timeout: 5_000 });
  return waitForTask(page, title);
}

async function waitForNoTask(page, title) {
  await page.waitForFunction((expected) => {
    return ![...document.querySelectorAll('.task[data-task-title]')]
      .some((row) => row.dataset.taskTitle === expected && (row.offsetWidth || row.offsetHeight || row.getClientRects().length));
  }, title, { timeout: 5_000 });
}

async function clickNav(page, view) {
  const nav = page.locator(`.rail-link[data-view-link="${view}"], .footer-link[data-view-link="${view}"]`);
  assert.equal(await nav.count(), 1, `Expected one nav link for ${view}`);
  await nav.click();
  await page.waitForFunction((expected) => location.hash === `#${expected}`, view);
}

async function assertAppIdentity(page) {
  assert.equal(await page.title(), 'GTD');
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/assets/gtd-icon.svg');
  assert.equal(await page.locator('.brand').getAttribute('aria-label'), 'GTD Home');
  assert.equal((await page.locator('.brand-text').textContent()).trim(), 'GTD');
  assert.equal(await page.locator('svg[viewBox="0 0 115 9.8"]').count(), 0, 'Old Nirvana wordmark should not be rendered');
  assert.equal(await page.getByText('Nirvana GTD').count(), 0, 'Old Nirvana title should not be rendered');
  const brandBox = await page.locator('.brand-mark').boundingBox();
  assert.ok(brandBox && brandBox.width >= 20 && brandBox.height >= 20, 'Expected visible GTD brand mark');
  const faviconStatus = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="icon"]')?.href;
    if (!href) return 0;
    const response = await fetch(href, { cache: 'no-store' });
    return response.status;
  });
  assert.equal(faviconStatus, 200, 'Expected favicon to load');
}

async function quickAdd(page, title) {
  await page.locator('#quick-add input[name="title"]').click();
  await page.locator('#quick-add input[name="title"]').fill(title);
  await page.keyboard.press('Enter');
  await waitForTask(page, title);
}

async function openMenu(page, title) {
  const row = await waitForTask(page, title);
  await row.hover();
  await row.locator('[data-action="MENU"]').click();
  await page.locator('.task-menu').waitFor({ state: 'visible', timeout: 5_000 });
}

async function clickMenuParent(page, label) {
  const parents = page.locator('.task-menu .menu-parent').filter({ hasText: new RegExp(`^${escapeRegex(label)}$`) });
  const count = await parents.count();
  assert.ok(count >= 1, `Expected submenu parent ${label}`);
  for (let index = 0; index < count; index += 1) {
    const parent = parents.nth(index);
    if (await parent.isVisible()) {
      await parent.click();
      return;
    }
  }
  throw new Error(`Submenu parent is not visible: ${label}`);
}

async function clickMenu(page, title, action, value) {
  await openMenu(page, title);
  for (const label of menuPath(action, value)) {
    await clickMenuParent(page, label);
  }
  const valueSelector = value === undefined ? '' : `[data-value="${attr(value)}"]`;
  const buttons = page.locator(`.task-menu [data-action="${action}"]${valueSelector}`);
  const count = await buttons.count();
  assert.ok(count >= 1, `Expected menu action ${action} ${value ?? ''}`.trim());
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      await page.locator('.task-menu').waitFor({ state: 'hidden', timeout: 5_000 });
      return;
    }
  }
  throw new Error(`Menu action is not visible: ${action} ${value ?? ''}`.trim());
}

async function dragTaskToTask(page, draggedTitle, targetTitle, position = 'before') {
  const dragged = await waitForTask(page, draggedTitle);
  const target = await waitForTask(page, targetTitle);
  const grip = await dragged.locator('.grip').boundingBox();
  const targetBox = await target.boundingBox();
  assert.ok(grip, `Missing drag grip for ${draggedTitle}`);
  assert.ok(targetBox, `Missing target box for ${targetTitle}`);
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const endY = position === 'after' ? targetBox.y + targetBox.height - 3 : targetBox.y + 3;
  const end = { x: targetBox.x + 20, y: endY };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ draggedTitle: dragged, targetTitle: target, position: pos }) => {
    const titles = [...document.querySelectorAll('.task[data-task-title]')].map((row) => row.dataset.taskTitle);
    const draggedIndex = titles.indexOf(dragged);
    const targetIndex = titles.indexOf(target);
    if (draggedIndex < 0 || targetIndex < 0) return false;
    return pos === 'after' ? draggedIndex === targetIndex + 1 : draggedIndex === targetIndex - 1;
  }, { draggedTitle, targetTitle, position }, { timeout: 5_000 });
}

async function assertDragPreviewFollowsMouse(page, title) {
  const row = await waitForTask(page, title);
  const grip = await row.locator('.grip').boundingBox();
  assert.ok(grip, `Missing drag grip for ${title}`);
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const first = { x: start.x + 90, y: start.y + 24 };
  const second = { x: first.x + 140, y: first.y + 54 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(first.x, first.y, { steps: 4 });
  const preview = page.locator('.task-drag-preview');
  await preview.waitFor({ state: 'visible', timeout: 5_000 });
  assert.match(await preview.innerText(), new RegExp(escapeRegex(title)));
  const firstBox = await preview.boundingBox();
  assert.ok(firstBox, 'Expected visible drag preview bounds');
  await page.mouse.move(second.x, second.y, { steps: 5 });
  await page.waitForFunction(({ left, top }) => {
    const rect = document.querySelector('.task-drag-preview')?.getBoundingClientRect();
    return rect && Math.abs(rect.left - left) > 24 && Math.abs(rect.top - top) > 12;
  }, { left: firstBox.x, top: firstBox.y }, { timeout: 5_000 });
  await page.mouse.up();
  await preview.waitFor({ state: 'detached', timeout: 5_000 });
  await waitForTask(page, title);
}

async function dragTaskToNav(page, title, view) {
  const row = await waitForTask(page, title);
  const nav = page.locator(`.rail-link[data-view-link="${view}"], .footer-link[data-view-link="${view}"]`);
  assert.equal(await nav.count(), 1, `Expected one nav target for ${view}`);
  const grip = await row.locator('.grip').boundingBox();
  const navBox = await nav.boundingBox();
  assert.ok(grip, `Missing drag grip for ${title}`);
  assert.ok(navBox, `Missing nav box for ${view}`);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await waitForNoTask(page, title);
}

async function clickPlannerAction(page, title, plan) {
  const row = await waitForTask(page, title);
  await row.hover();
  const button = row.locator(`[data-action="PLAN"][data-plan="${attr(plan)}"]`);
  await button.waitFor({ state: 'visible', timeout: 5_000 });
  await button.click();
}

async function assertFocusStar(page, title, active) {
  const row = await waitForTask(page, title);
  const selector = active
    ? '[data-action="FOCUS"].active'
    : '[data-action="FOCUS"]:not(.active)';
  await row.locator(selector).waitFor({ state: 'attached', timeout: 5_000 });
}

async function dragTaskToForecastSection(page, title, label) {
  const row = await waitForTask(page, title);
  const target = page.locator(`.section-title[data-drop-plan-label="${attr(label)}"]`);
  await target.waitFor({ state: 'visible', timeout: 5_000 });
  const grip = await row.locator('.grip').boundingBox();
  const targetBox = await target.boundingBox();
  assert.ok(grip, `Missing drag grip for ${title}`);
  assert.ok(targetBox, `Missing forecast section target ${label}`);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(({ expectedTitle, expectedLabel }) => {
    let currentSection = '';
    for (const node of document.querySelectorAll('.section-title, .task[data-task-title]')) {
      if (node.classList.contains('section-title')) currentSection = node.querySelector('h2')?.textContent.trim() || '';
      if (node.dataset?.taskTitle === expectedTitle) return currentSection === expectedLabel;
    }
    return false;
  }, { expectedTitle: title, expectedLabel: label }, { timeout: 5_000 });
}

async function clickProject(page, title) {
  const nav = page.locator(`[data-project-link="${attr(title)}"]`);
  assert.equal(await nav.count(), 1, `Expected one project link for ${title}`);
  await nav.click();
  await page.waitForFunction((expected) => decodeURIComponent(location.hash).endsWith(`/project/${expected}`) || decodeURIComponent(location.hash).endsWith(`#project/${expected}`), title);
}

async function chooseNewTaskMenuValue(form, field, value) {
  const fieldName = field === 'dueAt' ? 'dueAt' : field;
  await form.locator(`[data-new-menu="${field}"]`).click();
  await form.locator(`.new-task-menu [data-new-menu-value="${attr(value)}"]`).click();
  assert.equal(await form.locator(`[name="${fieldName}"]`).inputValue(), value);
}

async function assertContextPanel(page, tagName) {
  const panel = page.locator('.context-panel');
  await panel.waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await panel.evaluate((node) => node.open), true, 'Contexts should start expanded');

  const firstRowButtonCount = await page.$$eval('#tag-list .tag-button', (buttons) => {
    if (!buttons.length) return 0;
    const firstTop = buttons[0].getBoundingClientRect().top;
    return buttons.filter((button) => Math.abs(button.getBoundingClientRect().top - firstTop) < 4).length;
  });
  assert.ok(firstRowButtonCount >= 2, 'Expected multiple context buttons on the first row');

  const tagOrder = await page.$$eval('#tag-list .tag-button', (buttons) =>
    buttons.map((button) => ({
      name: button.dataset.tagFilter,
      count: button.querySelector('strong')?.textContent.trim() || '',
    }))
  );
  assert.equal(tagOrder[0]?.name, 'all', 'All should stay first in contexts');
  const contextCounts = tagOrder.slice(1).map((tag) => Number(tag.count || 0));
  for (let index = 1; index < contextCounts.length; index += 1) {
    assert.ok(
      contextCounts[index - 1] >= contextCounts[index],
      `Expected contexts to be sorted by count: ${JSON.stringify(tagOrder)}`
    );
  }
  const targetTag = tagOrder.find((tag) => tag.name === tagName);
  assert.equal(targetTag?.count, '2', `Expected ${tagName} context count to be 2`);

  await page.locator('.context-summary').click();
  assert.equal(await panel.evaluate((node) => node.open), false, 'Contexts should collapse');
  await page.locator('.context-summary').click();
  assert.equal(await panel.evaluate((node) => node.open), true, 'Contexts should expand again');

  await page.locator(`#tag-list [data-tag-filter="${attr(tagName)}"]`).click();
  await page.waitForFunction((expected) => decodeURIComponent(location.hash) === `#context/${expected}`, tagName);
  assert.equal(await page.locator('#view-title').innerText(), tagName === '-' ? 'No Tags' : tagName);
  assert.equal(await page.locator('#view-subtitle').innerText(), 'Context');
}

async function assertSourceCard(page, title) {
  const card = page.locator(`.source-card[data-source-title="${attr(title)}"]`);
  await card.waitFor({ state: 'visible', timeout: 5_000 });
  return card;
}

async function assertSourceStatus(scope, status) {
  const activeButton = scope.locator(`[data-source-status="${attr(status)}"][aria-pressed="true"]`).first();
  await activeButton.waitFor({ state: 'visible', timeout: 5_000 });
  assert.match(await activeButton.getAttribute('class') || '', /\bactive\b/);
  assert.match(await scope.locator('.source-status').first().innerText(), new RegExp(status, 'i'));
}

async function assertSourceBadge(scope, status) {
  await scope.locator('.source-status').first().waitFor({ state: 'visible', timeout: 5_000 });
  assert.match(await scope.locator('.source-status').first().innerText(), new RegExp(status, 'i'));
}

async function runBrowserSuite(baseUrl) {
  let browser;
  try {
    log('E2E: launch browser');
    browser = await chromium.launch(launchOptions());
  } catch (error) {
    if (/Executable doesn't exist/i.test(error.message)) {
      throw new Error(`Could not launch Playwright Chromium. Run "npm run test:e2e:install" once, then retry.\n${error.message}`);
    }
    throw new Error(`Could not launch Playwright Chromium. This machine may block standalone browser automation; retry in the in-app Browser sidebar or on a less restricted machine.\n${error.message}`);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const suffix = Date.now().toString(36);
  const alpha = slugTitle(`E2E ${suffix} alpha`);
  const alphaEdited = slugTitle(`E2E ${suffix} alpha edited`);
  const beta = slugTitle(`E2E ${suffix} beta`);
  const gamma = slugTitle(`E2E ${suffix} gamma`);
  const doneUndo = slugTitle(`E2E ${suffix} done undo`);
  const routine = slugTitle(`E2E ${suffix} routine`);
  const planner = slugTitle(`E2E ${suffix} planner`);
  const project = slugTitle(`E2E ${suffix} project`);
  const projectCopy = `${project} Copy`;

  try {
    log('E2E: load app shell');
    await page.goto(`${baseUrl}/#next`, { waitUntil: 'domcontentloaded' });
    await page.locator('#view-title').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator('#view-title').innerText(), 'Next');
    await assertAppIdentity(page);
    assert.equal(await page.locator('[data-view-link="twitter"]').count(), 0, 'Old GTD Twitter list should not be present');
    assert.equal(await page.locator('[data-view-link="sourceTwitter"]').count(), 1, 'Knowledge Twitter view should be present');
    assert.equal(await page.locator('[data-view-link="work"], [data-view-link="parttime"], [data-view-link="learn"], [data-view-link="other"]').count(), 0, 'Area links should not be sidebar navigation');
    const railText = await page.locator('.rail-nav').innerText();
    assert.doesNotMatch(railText, /\bLists\b/);
    assert.doesNotMatch(railText, /\bAreas\b/);
    assert.match(railText, /\bProjects\b/);
    assert.match(railText, /\bTags\b/);
    const topbar = await page.locator('.topbar').innerText();
    assert.match(topbar, /New Item/);
    assert.match(topbar, /Search/);
    assert.match(topbar, /Settings/);
    assert.doesNotMatch(topbar, /Refresh|Upgrade/);

    log('E2E: keyboard new item editor controls and escape');
    await page.keyboard.press('n');
    const newForm = page.locator('[data-new-form]');
    await newForm.waitFor({ state: 'visible', timeout: 5_000 });
    await newForm.locator('[data-action="NEW_FOCUS"]').click();
    assert.equal(await newForm.locator('[data-action="NEW_FOCUS"]').getAttribute('data-focus'), '1');
    await chooseNewTaskMenuValue(newForm, 'effort', '30m');
    await chooseNewTaskMenuValue(newForm, 'energy', 'high');
    await chooseNewTaskMenuValue(newForm, 'repeat', 'weekly');
    const browserToday = await page.evaluate(() => {
      const date = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    });
    await chooseNewTaskMenuValue(newForm, 'dueAt', browserToday);
    await chooseNewTaskMenuValue(newForm, 'list', 'later');
    await newForm.locator('input[name="title"]').fill(`draft ${suffix}`);
    await page.keyboard.press('Escape');
    await page.locator('[data-new-form]').waitFor({ state: 'hidden', timeout: 5_000 });
    assert.equal(await page.locator('#quick-add input[name="title"]').inputValue(), '');

    log('E2E: rapid create tasks');
    await quickAdd(page, alpha);
    await quickAdd(page, beta);
    await quickAdd(page, gamma);
    await quickAdd(page, doneUndo);
    await quickAdd(page, routine);
    await quickAdd(page, planner);
    await quickAdd(page, project);

    log('E2E: search and clear');
    await page.locator('#search').fill(beta);
    await waitForTask(page, beta);
    await waitForNoTask(page, alpha);
    await page.locator('#search').fill(`no result ${suffix}`);
    await page.locator('[data-clear-search]').click();
    await waitForTask(page, alpha);

    log('E2E: edit task fields');
    const alphaRow = await waitForTask(page, alpha);
    await alphaRow.dblclick();
    const editForm = page.locator(`form.task[data-task-title="${attr(alpha)}"]`);
    await editForm.waitFor({ state: 'visible', timeout: 5_000 });
    await editForm.locator('input[name="title"]').fill(alphaEdited);
    await editForm.locator('input[name="tags"]').fill(`e2e, ${suffix}`);
    await editForm.locator('textarea[name="notes"]').fill('Edited from browser automation.');
    await editForm.locator('select[name="effort"]').selectOption('15m');
    await editForm.locator('select[name="energy"]').selectOption('medium');
    await editForm.locator('button[type="submit"]').click();
    await waitForTask(page, alphaEdited);
    await waitForNoTask(page, alpha);

    log('E2E: context menu, sorting, wrapping and collapse');
    await clickMenu(page, beta, 'ADD_TAG', 'AI');
    await clickMenu(page, gamma, 'ADD_TAG', 'AI');
    await page.waitForFunction(() => {
      const button = document.querySelector('#tag-list [data-tag-filter="AI"]');
      return button?.querySelector('strong')?.textContent.trim() === '2';
    }, null, { timeout: 5_000 });
    await clickNav(page, 'later');
    await assertContextPanel(page, 'AI');
    await waitForTask(page, beta);
    await waitForTask(page, gamma);
    await waitForNoTask(page, alphaEdited);
    await page.locator('#tag-list [data-tag-filter="all"]').click();
    await page.waitForFunction(() => location.hash === '#next');
    await waitForTask(page, alphaEdited);

    log('E2E: optimistic focus star and focus view');
    const editedRow = await waitForTask(page, alphaEdited);
    const focusHold = await holdRoute(page, '**/api/tasks/*/focus');
    try {
      await editedRow.locator('[data-action="FOCUS"]').click();
      await focusHold.seen;
      await page.waitForFunction((title) => {
        const row = [...document.querySelectorAll('.task[data-task-title]')]
          .find((node) => node.dataset.taskTitle === title);
        return row?.querySelector('[data-action="FOCUS"]')?.classList.contains('active');
      }, alphaEdited, { timeout: 5_000 });
      await page.waitForTimeout(250);
      await assertNoVisibleLoading(page);
      const focusResponse = page.waitForResponse((response) =>
        response.url().includes('/api/tasks/') && response.url().endsWith('/focus') && response.status() === 200
      );
      focusHold.release();
      await focusResponse;
    } finally {
      await focusHold.cleanup();
    }
    await clickNav(page, 'focus');
    await waitForTask(page, alphaEdited);
    await clickNav(page, 'next');

    log('E2E: menu field changes');
    await clickMenu(page, alphaEdited, 'SET_TIME', '10m');
    await waitForTask(page, alphaEdited);
    assert.match(await (await waitForTask(page, alphaEdited)).innerText(), /10m/);
    await clickMenu(page, alphaEdited, 'SET_ENERGY', 'high');
    assert.match(await (await waitForTask(page, alphaEdited)).innerText(), /high/);
    await clickMenu(page, alphaEdited, 'SET_REPEAT', 'weekly');
    assert.match(await (await waitForTask(page, alphaEdited)).innerText(), /weekly/);
    const today = await page.evaluate(() => {
      const date = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    });
    await clickMenu(page, alphaEdited, 'SET_DUE', today);
    assert.match(await (await waitForTask(page, alphaEdited)).innerText(), /Due/);
    await clickNav(page, 'today');
    assert.equal(await page.locator('#view-title').innerText(), 'Today');
    await waitForTask(page, alphaEdited);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Due Today'));
    await page.keyboard.press('u');
    await page.waitForFunction(() => location.hash === '#forecast');
    assert.equal(await page.locator('#view-title').innerText(), 'Forecast');
    await waitForTask(page, alphaEdited);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Today'));
    await clickNav(page, 'next');

    log('E2E: today planner controls and forecast date drag');
    await clickPlannerAction(page, planner, 'today');
    await clickNav(page, 'today');
    await waitForTask(page, planner);
    await page.locator('[data-planner-mode="today"]').click();
    await waitForTask(page, gamma);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Available Next Actions'));
    await clickPlannerAction(page, planner, 'tomorrow');
    await waitForNoTask(page, planner);
    await clickNav(page, 'forecast');
    await waitForTask(page, planner);
    await assertFocusStar(page, planner, true);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Tomorrow'));
    await clickPlannerAction(page, planner, 'not-today');
    await waitForTask(page, planner);
    await assertFocusStar(page, planner, false);
    await clickPlannerAction(page, planner, 'no-date');
    await waitForNoTask(page, planner);
    await clickNav(page, 'next');
    await waitForTask(page, planner);
    await clickPlannerAction(page, planner, 'next-week');
    await waitForNoTask(page, planner);
    await clickNav(page, 'forecast');
    await waitForTask(page, planner);
    await dragTaskToForecastSection(page, planner, 'Today');
    await clickNav(page, 'today');
    await waitForTask(page, planner);
    await clickPlannerAction(page, planner, 'no-date');
    await clickNav(page, 'focus');
    await waitForTask(page, planner);
    await assertFocusStar(page, planner, true);
    await clickNav(page, 'next');
    await waitForTask(page, planner);
    await clickPlannerAction(page, planner, 'tomorrow');
    await waitForNoTask(page, planner);
    await clickNav(page, 'forecast');
    await waitForTask(page, planner);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Tomorrow'));
    await clickNav(page, 'next');

    log('E2E: Knowledge Twitter source view');
    await clickNav(page, 'sourceTwitter');
    assert.equal(await page.locator('#view-title').innerText(), 'Twitter Sources');
    await page.locator('[data-source-import] input[name="url"]').fill(`${baseUrl}/styles.css?twitter=${suffix}`);
    await page.locator('[data-source-import] select[name="type"]').selectOption('twitter');
    const twitterImportResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/sources') && response.request().method() === 'POST' && response.status() === 201
    );
    await page.locator('[data-source-import] button[type="submit"]').click();
    const twitterSource = await (await twitterImportResponse).json();
    await page.waitForFunction((sourceId) => location.hash === `#source/${sourceId}`, twitterSource.id);
    assert.match(await page.locator('#view-subtitle').innerText(), /Twitter .* Unread/);
    const sourceDetail = page.locator('.source-detail');
    await assertSourceStatus(sourceDetail, 'unread');
    await page.locator('[data-source-status="processed"]').click();
    await assertSourceStatus(sourceDetail, 'processed');
    assert.match(await page.locator('#view-subtitle').innerText(), /Processed/);
    await page.locator('[data-source-status="reading"]').click();
    await assertSourceStatus(sourceDetail, 'reading');
    assert.match(await page.locator('#view-subtitle').innerText(), /Reading/);
    await page.locator('[data-source-status="reading"]').click();
    await assertSourceStatus(sourceDetail, 'unread');
    assert.match(await page.locator('#view-subtitle').innerText(), /Unread/);
    await page.locator('[data-source-status="reading"]').click();
    await assertSourceStatus(sourceDetail, 'reading');
    await clickNav(page, 'sourceTwitter');
    let twitterCard = await assertSourceCard(page, 'styles.css');
    await assertSourceStatus(twitterCard, 'reading');
    await twitterCard.locator('[data-source-status="reading"]').click();
    twitterCard = await assertSourceCard(page, 'styles.css');
    await assertSourceBadge(twitterCard, 'unread');
    assert.equal(await twitterCard.locator('[data-source-status="reading"]').getAttribute('aria-pressed'), 'false');
    await twitterCard.locator('[data-source-status="reading"]').click();
    twitterCard = await assertSourceCard(page, 'styles.css');
    await assertSourceStatus(twitterCard, 'reading');
    await twitterCard.locator('[data-source-status="processed"]').click();
    twitterCard = await assertSourceCard(page, 'styles.css');
    await assertSourceStatus(twitterCard, 'processed');
    await clickNav(page, 'sourceProcessed');
    await assertSourceCard(page, 'styles.css');
    await clickNav(page, 'sourceTwitter');
    await assertSourceStatus(await assertSourceCard(page, 'styles.css'), 'processed');
    await clickNav(page, 'next');

    log('E2E: source library import, status, detail and linked GTD task');
    await clickNav(page, 'sourceInbox');
    assert.equal(await page.locator('#view-title').innerText(), 'Source Inbox');
    await page.locator('[data-source-import] input[name="url"]').fill(`${baseUrl}/`);
    await page.locator('[data-source-import] select[name="type"]').selectOption('article');
    const importResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/sources') && response.request().method() === 'POST' && response.status() === 201
    );
    await page.locator('[data-source-import] button[type="submit"]').click();
    const importedSource = await (await importResponse).json();
    await page.waitForFunction((sourceId) => location.hash === `#source/${sourceId}`, importedSource.id);
    assert.equal(await page.locator('#view-title').innerText(), 'GTD');
    assert.match(await page.locator('#view-subtitle').innerText(), /Article .* Unread/);
    await page.locator('[data-source-status="reading"]').click();
    await page.waitForFunction(() => /Reading/.test(document.querySelector('#view-subtitle')?.textContent || ''));
    await assertSourceStatus(page.locator('.source-detail'), 'reading');
    await clickNav(page, 'sourceReading');
    const gtdSourceCard = await assertSourceCard(page, 'GTD');
    await gtdSourceCard.locator('[data-source-open]').click();
    await page.waitForFunction(() => location.hash.startsWith('#source/'));
    await page.locator('[data-source-task]').click();
    await page.waitForFunction(() => location.hash === '#next');
    let gtdTask = await waitForTask(page, 'Read: GTD');
    assert.match(await gtdTask.getAttribute('class') || '', /\bsource-created\b/);
    await clickNav(page, 'sourceReading');
    await (await assertSourceCard(page, 'GTD')).locator('[data-source-task-open]').click();
    await page.waitForFunction(() => location.hash === '#next');
    gtdTask = await waitForTask(page, 'Read: GTD');
    assert.match(await gtdTask.getAttribute('class') || '', /\bsource-created\b/);
    await clickNav(page, 'sourceReading');
    const processedResponse = page.waitForResponse((response) =>
      response.url().includes('/api/sources/') && response.request().method() === 'PATCH' && response.status() === 200
    );
    await (await assertSourceCard(page, 'GTD')).locator('[data-source-status="processed"]').click();
    await processedResponse;
    await page.waitForFunction(() => !document.querySelector('.source-card[data-source-title="GTD"]'));
    await clickNav(page, 'sourceProcessed');
    await assertSourceCard(page, 'GTD');
    await clickNav(page, 'next');

    log('E2E: scheduled move and unschedule');
    const tomorrow = localDateOffset(1);
    await clickMenu(page, alphaEdited, 'SET_SCHEDULE', tomorrow);
    await waitForNoTask(page, alphaEdited);
    await clickNav(page, 'scheduled');
    await waitForTask(page, alphaEdited);
    await clickMenu(page, alphaEdited, 'SET_SCHEDULE', '');
    await waitForNoTask(page, alphaEdited);
    await clickNav(page, 'next');
    await waitForTask(page, alphaEdited);

    log('E2E: recurring routine rolls forward when completed');
    await clickMenu(page, routine, 'SET_REPEAT', 'daily');
    assert.match(await (await waitForTask(page, routine)).innerText(), /daily/);
    const routineRow = await waitForTask(page, routine);
    await routineRow.locator('[data-action="DONE"]').click();
    await page.waitForFunction((title) => {
      const row = [...document.querySelectorAll('.task[data-task-title]')]
        .find((node) => node.dataset.taskTitle === title);
      return row?.classList.contains('done-state');
    }, routine, { timeout: 5_000 });
    await clickNav(page, 'scheduled');
    await waitForTask(page, routine);
    assert.match(await (await waitForTask(page, routine)).innerText(), /daily/);
    await clickNav(page, 'forecast');
    await waitForTask(page, routine);
    assert.ok((await page.$$eval('.section-title h2', (nodes) => nodes.map((node) => node.textContent.trim()))).includes('Tomorrow'));
    await clickNav(page, 'next');

    log('E2E: drag reorder');
    await assertDragPreviewFollowsMouse(page, gamma);
    await dragTaskToTask(page, gamma, beta, 'before');
    const titlesAfterDrag = await visibleTaskTitles(page);
    assert.ok(titlesAfterDrag.indexOf(gamma) < titlesAfterDrag.indexOf(beta), 'Expected dragged task before target task');

    log('E2E: copy and convert project');
    await clickMenu(page, project, 'COPY');
    await waitForTask(page, projectCopy);
    await clickMenu(page, project, 'CONVERT_PROJECT');
    await waitForProjectTask(page, project);
    await clickMenu(page, gamma, 'SET_PROJECT', project);
    await clickMenu(page, beta, 'SET_PROJECT', project);
    await clickMenu(page, beta, 'SET_DUE', today);
    await page.waitForFunction((title) => {
      const row = [...document.querySelectorAll('.task[data-task-title]')]
        .find((node) => node.dataset.taskTitle === title);
      return /Due/.test(row?.innerText || '');
    }, beta, { timeout: 5_000 });
    await clickNav(page, 'next');
    const nextProjectOrder = await visibleTaskTitles(page);
    assert.ok(
      nextProjectOrder.indexOf(beta) < nextProjectOrder.indexOf(alphaEdited),
      `Expected project action before standalone action in Next: ${nextProjectOrder.join(' > ')}`,
    );
    assert.ok(
      nextProjectOrder.indexOf(gamma) < nextProjectOrder.indexOf(alphaEdited),
      `Expected project action before standalone action in Next: ${nextProjectOrder.join(' > ')}`,
    );
    await clickNav(page, 'today');
    await waitForTask(page, beta);
    await waitForTask(page, alphaEdited);
    const todayProjectOrder = await visibleTaskTitles(page);
    assert.ok(
      todayProjectOrder.indexOf(beta) < todayProjectOrder.indexOf(alphaEdited),
      `Expected project action before standalone action in Today: ${todayProjectOrder.join(' > ')}`,
    );
    await clickNav(page, 'forecast');
    await waitForTask(page, beta);
    await waitForTask(page, alphaEdited);
    const forecastProjectOrder = await visibleTaskTitles(page);
    assert.ok(
      forecastProjectOrder.indexOf(beta) < forecastProjectOrder.indexOf(alphaEdited),
      `Expected project action before standalone action in Forecast: ${forecastProjectOrder.join(' > ')}`,
    );
    await clickNav(page, 'next');
    await clickNav(page, 'projects');
    await page.locator('.project-card').filter({ hasText: project }).waitFor({ state: 'visible', timeout: 5_000 });
    await clickProject(page, project);
    assert.match(await page.locator('.project-summary-card').innerText(), new RegExp(escapeRegex(project)));
    await waitForTask(page, gamma);
    await clickNav(page, 'next');

    log('E2E: optimistic done and undo without loading flash');
    const doneHold = await holdRoute(page, '**/api/tasks/*/state');
    try {
      const doneRow = await waitForTask(page, doneUndo);
      await doneRow.locator('[data-action="DONE"]').click();
      await doneHold.seen;
      await page.waitForFunction((title) => {
        const row = [...document.querySelectorAll('.task[data-task-title]')]
          .find((node) => node.dataset.taskTitle === title);
        return row?.classList.contains('done-state')
          && row.querySelector('.check.checked[data-action="TODO"]');
      }, doneUndo, { timeout: 5_000 });
      await page.waitForTimeout(250);
      await assertNoVisibleLoading(page);
      const doneResponse = page.waitForResponse((response) =>
        response.url().includes('/api/tasks/') && response.url().endsWith('/state') && response.status() === 200
      );
      doneHold.release();
      await doneResponse;
    } finally {
      await doneHold.cleanup();
    }

    const undoHold = await holdRoute(page, '**/api/tasks/*/state');
    try {
      const undoRow = await waitForTask(page, doneUndo);
      await undoRow.locator('[data-action="TODO"]').click();
      await undoHold.seen;
      await page.waitForFunction((title) => {
        const row = [...document.querySelectorAll('.task[data-task-title]')]
          .find((node) => node.dataset.taskTitle === title);
        return row && !row.classList.contains('done-state')
          && row.querySelector('.check[data-action="DONE"]:not(.checked)');
      }, doneUndo, { timeout: 5_000 });
      await page.waitForTimeout(250);
      await assertNoVisibleLoading(page);
      const undoResponse = page.waitForResponse((response) =>
        response.url().includes('/api/tasks/') && response.url().endsWith('/state') && response.status() === 200
      );
      undoHold.release();
      await undoResponse;
    } finally {
      await undoHold.cleanup();
    }

    log('E2E: done and logbook');
    const betaRow = await waitForTask(page, beta);
    await betaRow.locator('[data-action="DONE"]').click();
    await page.waitForFunction((title) => {
      const row = [...document.querySelectorAll('.task[data-task-title]')]
        .find((node) => node.dataset.taskTitle === title);
      return row?.classList.contains('done-state')
        && row.querySelector('.check.checked[data-action="TODO"]');
    }, beta, { timeout: 5_000 });
    await clickNav(page, 'logbook');
    await waitForTask(page, beta);

    log('E2E: trash restore delete');
    await clickNav(page, 'next');
    await clickMenu(page, alphaEdited, 'TRASH');
    await waitForNoTask(page, alphaEdited);
    await clickNav(page, 'trash');
    await waitForTask(page, alphaEdited);
    const trashRow = await waitForTask(page, alphaEdited);
    await trashRow.hover();
    await trashRow.locator('[data-action="RESTORE"]').click();
    await waitForNoTask(page, alphaEdited);
    await clickNav(page, 'next');
    await waitForTask(page, alphaEdited);
    await clickMenu(page, alphaEdited, 'TRASH');
    await clickNav(page, 'trash');
    const deleteRow = await waitForTask(page, alphaEdited);
    await deleteRow.hover();
    await deleteRow.locator('[data-action="DELETE"]').click();
    await waitForNoTask(page, alphaEdited);

    log('E2E: settings export');
    await page.locator('#settings').click();
    await page.locator('#settings-panel').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#export-org').click();
    await page.waitForFunction(() => /Exported /.test(document.querySelector('#export-status')?.textContent || ''), null, { timeout: 5_000 });

    log('E2E: keyboard nav and shortcuts');
    await page.mouse.click(500, 82);
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
    await page.locator('#search').fill('');
    await page.mouse.click(500, 82);
    let shortcutText = '';
    page.once('dialog', async (dialog) => {
      shortcutText = dialog.message();
      await dialog.dismiss();
    });
    await page.keyboard.press('k');
    await page.waitForTimeout(100);
    assert.match(shortcutText, /Create: n/);
    assert.match(shortcutText, /t today, u forecast/);
    assert.doesNotMatch(shortcutText, /Refresh/);
    await page.keyboard.press('5');
    await page.waitForFunction(() => location.hash === '#review');
    assert.equal(await page.locator('#view-title').innerText(), 'Review');
    await page.keyboard.press('3');
    await page.waitForFunction(() => location.hash === '#next');

    assert.deepEqual(browserErrors, [], `Browser console/page errors:\n${browserErrors.join('\n')}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'agentdeck-e2e-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const currentFile = path.join(tmp, 'current.org');
  const archiveFile = path.join(tmp, 'archive.org');
  const dbFile = path.join(tmp, 'gtd.sqlite');
  const exportFile = path.join(tmp, 'export.org');

  await writeFile(currentFile, '* Inbox\n', 'utf8');
  await writeFile(archiveFile, '* Archive\n', 'utf8');

  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GTD_PORT: String(port),
      GTD_HOST: '127.0.0.1',
      GTD_CURRENT_FILE: currentFile,
      GTD_ARCHIVE_FILE: archiveFile,
      GTD_DB_FILE: dbFile,
      GTD_EXPORT_FILE: exportFile,
      GTD_AUTO_EXPORT: '0',
      GTD_REQUIRE_AUTH: '0',
      GTD_ALLOW_PRIVATE_FETCH: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.on('data', (chunk) => { serverOutput += chunk; });

  try {
    await waitForServer(baseUrl, server);
    await runBrowserSuite(baseUrl);
    log('E2E: passed');
  } catch (error) {
    if (serverOutput) {
      process.stderr.write('\n--- server output ---\n');
      process.stderr.write(serverOutput);
      process.stderr.write('--- end server output ---\n');
    }
    throw error;
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
      setTimeout(resolve, 1_000);
    });
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
