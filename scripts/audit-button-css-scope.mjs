import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESERVED_CLASSES = [
  'action-button',
  'button',
  'cancel',
  'delete',
  'primary',
  'save',
  'secondary',
  'btn',
  'btn-block',
  'btn-cancel',
  'btn-confirm',
  'btn-danger',
  'btn-delete',
  'btn-help',
  'btn-icon',
  'btn-icon-small',
  'btn-lg',
  'btn-link',
  'btn-neutral',
  'btn-primary',
  'btn-save',
  'btn-secondary',
  'btn-sm',
  'ui-button',
  'ui-icon-button',
];

const AUTHORITY_FILES = new Set([
  'src/styles/buttons.css',
  'src/styles/reset.css',
]);

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function splitSelectorList(prelude) {
  const selectors = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];
    if (character === '(') roundDepth += 1;
    if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
    if (character === '[') squareDepth += 1;
    if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
    if (character === ',' && roundDepth === 0 && squareDepth === 0) {
      selectors.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(prelude.slice(start).trim());
  return selectors.filter(Boolean);
}

function getRulePreludes(source) {
  const cleanSource = stripComments(source);
  const rules = [];
  let boundary = 0;

  for (let index = 0; index < cleanSource.length; index += 1) {
    const character = cleanSource[index];
    if (character === '{') {
      const prelude = cleanSource.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith('@')) rules.push({ prelude, index });
      boundary = index + 1;
    } else if (character === '}' || character === ';') {
      boundary = index + 1;
    }
  }

  return rules;
}

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function isReservedGlobalSelector(selector) {
  if (/^button(?:$|[\s.:#\[>+~])/.test(selector)) return true;
  if (/^a\.btn(?:$|[\s.:#\[>+~])/.test(selector)) return true;

  return RESERVED_CLASSES.some((className) => {
    const prefix = `.${className}`;
    if (!selector.startsWith(prefix)) return false;
    const nextCharacter = selector[prefix.length];
    return !nextCharacter || !/[A-Za-z0-9_-]/.test(nextCharacter);
  });
}

export function inspectCss(source, relativePath) {
  if (relativePath.endsWith('.module.css')) return { definitions: [], violations: [] };

  const definitions = [];
  for (const rule of getRulePreludes(source)) {
    for (const selector of splitSelectorList(rule.prelude)) {
      if (!isReservedGlobalSelector(selector)) continue;
      definitions.push({
        file: relativePath,
        line: getLineNumber(source, rule.index),
        selector,
      });
    }
  }

  return {
    definitions,
    violations: AUTHORITY_FILES.has(relativePath) ? [] : definitions,
  };
}

async function findCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findCssFiles(absolutePath));
    if (entry.isFile() && entry.name.endsWith('.css')) files.push(absolutePath);
  }
  return files;
}

export async function auditButtonCssScope(rootDirectory) {
  const srcDirectory = path.join(rootDirectory, 'src');
  const cssFiles = await findCssFiles(srcDirectory);
  const definitions = [];
  const violations = [];

  for (const absolutePath of cssFiles) {
    const relativePath = path.relative(rootDirectory, absolutePath).replaceAll(path.sep, '/');
    const source = await readFile(absolutePath, 'utf8');
    const result = inspectCss(source, relativePath);
    definitions.push(...result.definitions);
    violations.push(...result.violations);
  }

  return { cssFileCount: cssFiles.length, definitions, violations };
}

async function main() {
  const result = await auditButtonCssScope(process.cwd());
  console.log(`CSS files audited: ${result.cssFileCount}`);
  console.log(`Reserved global button definitions: ${result.definitions.length}`);
  console.log(`Unauthorized definitions: ${result.violations.length}`);

  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(`${violation.file}:${violation.line} ${violation.selector}`);
    }
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) await main();
