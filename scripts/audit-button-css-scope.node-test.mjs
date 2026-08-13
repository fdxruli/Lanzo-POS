import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectCss } from './audit-button-css-scope.mjs';

test('allows reserved button selectors only in the canonical authority', () => {
  const result = inspectCss(`
    .btn, .btn-secondary:hover:not(:disabled), button:active { color: white; }
  `, 'src/styles/buttons.css');

  assert.equal(result.definitions.length, 3);
  assert.deepEqual(result.violations, []);
});

test('rejects an unscoped reserved selector in component CSS', () => {
  const result = inspectCss(`
    .component { display: grid; }
    .btn-secondary { background: white; }
  `, 'src/components/Example.css');

  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].selector, '.btn-secondary');
});

test('rejects an unsafe branch inside a grouped selector', () => {
  const result = inspectCss(`
    .component__action,
    .btn-link:focus-visible { outline: none; }
  `, 'src/components/Example.css');

  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].selector, '.btn-link:focus-visible');
});

test('allows component-scoped layout adjustments to shared roles', () => {
  const result = inspectCss(`
    .component .btn-secondary { width: 100%; }
    #dialog .btn-cancel:hover { margin-inline: auto; }
  `, 'src/components/Example.css');

  assert.deepEqual(result.violations, []);
});

test('ignores CSS Modules because their classes are locally scoped', () => {
  const result = inspectCss('.button, .primary { color: red; }', 'src/components/Example.module.css');
  assert.deepEqual(result.definitions, []);
  assert.deepEqual(result.violations, []);
});
