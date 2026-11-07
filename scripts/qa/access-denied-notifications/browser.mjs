// Run after LANZO_ACCESS_VISUAL_DIR=/tmp/lanzo-access-visual npx vitest run
// src/components/notifications/__tests__/accessVisual.fixture.test.jsx.
// Uses preinstalled tooling; no application dependencies or live business data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const fixtures = process.env.LANZO_ACCESS_VISUAL_DIR || '/tmp/lanzo-access-visual';
const out = process.argv[2] || '/tmp/lanzo-access-visual/evidence';
await mkdir(out, { recursive: true });
const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(modules ? pathToFileURL(join(modules, 'playwright/index.mjs')).href : 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.ACTOR_QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  for (const [width, height] of [[320, 568], [360, 640], [393, 851], [1280, 800]]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
      for (const scenario of ['denied', 'denied-pos', 'restricted', 'connection', 'loading', 'empty']) {
        await page.setContent(await readFile(join(fixtures, `${scenario}.html`), 'utf8'));
        await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
        await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished)));
        const metrics = await page.evaluate(() => {
          const state = document.querySelector('.notification-list-state');
          const action = document.querySelector('.permission-blocker__action') || state?.querySelector('button');
          const rect = action?.getBoundingClientRect();
          const card = document.querySelector('.permission-blocker__card');
          return {
            viewportOverflow: document.documentElement.scrollWidth > innerWidth,
            actionHeight: rect?.height ?? null,
            stateHeight: state?.getBoundingClientRect().height ?? null,
            cardBottom: card?.getBoundingClientRect().bottom ?? null,
            hiddenNavDisplay: document.querySelector('[hidden]') ? getComputedStyle(document.querySelector('[hidden]')).display : null,
            bodyScrollHeight: document.body.scrollHeight,
            drawerScroll: (() => { const drawer = document.querySelector('.notification-center-drawer'); return drawer ? drawer.scrollHeight > drawer.clientHeight : null; })()
          };
        });
        assert.equal(metrics.viewportOverflow, false, `${scenario} ${width} ${theme}: horizontal overflow`);
        if (metrics.actionHeight !== null) assert.ok(metrics.actionHeight >= 44 && metrics.actionHeight < 90, `${scenario}: touch target ${metrics.actionHeight}`);
        if (metrics.stateHeight !== null) assert.ok(metrics.stateHeight < 300, `${scenario}: stretched state`);
        if (metrics.hiddenNavDisplay !== null) assert.equal(metrics.hiddenNavDisplay, 'none');
        if (metrics.drawerScroll !== null) assert.equal(metrics.drawerScroll, false);
        if (scenario.startsWith('denied')) assert.ok(metrics.cardBottom <= height - (width < 1024 ? 72 : 0), `${scenario} ${width}: card overlaps navigation (${metrics.cardBottom})`);
        if ((width === 393 || width === 1280) && ['denied', 'restricted', 'connection'].includes(scenario)) {
          await page.screenshot({ path: join(out, `${scenario}-${width}-${theme}.png`), fullPage: true });
        }
        results.push({ scenario, width, height, theme, status: 'PASS', ...metrics });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(out, 'results.json'), JSON.stringify({ scope: 'Controlled real component DOM and CSS in Chromium; not Android device or El Balón end-to-end QA', results }, null, 2));
}
console.log(`${results.length} visual checks passed`);
