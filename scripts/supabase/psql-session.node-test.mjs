import assert from 'node:assert/strict';
import test from 'node:test';
import { openPsqlSession, closePsqlSession } from './psql-session.mjs';

const node = process.execPath;
const session = (name, script, timeoutMs = 2_000) => openPsqlSession({
  command: node,
  args: ['-e', script],
  applicationName: name,
  timeoutMs
});

test('session waits for stdin finish and captures output and exit code', async () => {
  const child = session('psql-session-node-pass',
    "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write('received:' + input));");
  await child.end('select 1;\n');
  const result = await child.done;
  assert.equal(result.code, 0, result.output);
  assert.equal(result.stdinEnded, true);
  assert.equal(result.spawnError, null);
  assert.equal(result.inputError, null);
  assert.match(result.output, /received:select 1;/);
});

test('spawn failures and unexpected process exits are returned as diagnostics', async () => {
  const missing = openPsqlSession({
    command: 'pr352-definitely-missing-psql-executable',
    args: [],
    applicationName: 'psql-session-node-spawn-error',
    timeoutMs: 2_000
  });
  const missingResult = await missing.done;
  assert.match(missingResult.spawnError, /ENOENT/i);

  const early = session('psql-session-node-unexpected-exit', "process.exit(7)");
  const earlyResult = await early.done;
  assert.equal(earlyResult.code, 7);
});

test('session timeout terminates a stuck child and marks the result', async () => {
  const stuck = session('psql-session-node-timeout', 'setInterval(() => {}, 1000)', 500);
  const result = await stuck.done;
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /exceeded 500ms; terminating/);
});

test('transaction cleanup submits rollback and waits for the process to close', async () => {
  const interactive = session('psql-session-node-cleanup',
    "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write(input));");
  await interactive.write('BEGIN;\n');
  const result = await closePsqlSession(interactive, { input: 'ROLLBACK;\n' });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /ROLLBACK/);
  assert.equal(interactive.closed, true);
});
