import { configure } from '@testing-library/dom';
import { expect } from 'vitest';
import '@testing-library/jest-dom/vitest';

// A small number of legacy suites still import '@testing-library/jest-dom'
// directly. Expose Vitest's expect in the test environment so those imports
// extend the same assertion instance without requiring Jest globals in runtime
// code. New tests should continue using the /vitest entry point.
globalThis.expect = expect;

configure({
  asyncUtilTimeout: 15_000,
});
