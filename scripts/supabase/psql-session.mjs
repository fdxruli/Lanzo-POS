import { spawn } from 'node:child_process';

const activeSessions = new Set();
let exitCleanupInstalled = false;

const appendError = (current, error) => current ?? error;

function installExitCleanup() {
  if (exitCleanupInstalled) return;
  exitCleanupInstalled = true;
  process.once('exit', () => {
    for (const child of activeSessions) {
      try { child.kill(); } catch { /* Process is already gone. */ }
    }
  });
}

function within(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve({ timedOut: false, value }); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Start one psql process with bounded lifetime and observable pipe completion. */
export function openPsqlSession({ command, args, env = process.env, applicationName, timeoutMs = 30_000 }) {
  if (!command) throw new TypeError('psql command is required');
  if (!Array.isArray(args)) throw new TypeError('psql args must be an array');
  if (!applicationName) throw new TypeError('PostgreSQL application_name is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('psql timeoutMs must be positive');

  installExitCleanup();
  let output = '';
  let spawnError = null;
  let inputError = null;
  let timedOut = false;
  let closed = false;
  let stdinEnded = false;
  let stdinFinished = false;
  let killTimer;
  let resolveDone;
  const child = spawn(command, args, {
    env: { ...env, PGAPPNAME: applicationName },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  activeSessions.add(child);

  const done = new Promise(resolve => { resolveDone = resolve; });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  child.stdin.on('error', error => { inputError = appendError(inputError, error); });
  child.stdin.on('finish', () => { stdinFinished = true; });
  child.on('error', error => {
    spawnError = appendError(spawnError, error);
    output += `\n[psql spawn error: ${error.message}]\n`;
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    output += `\n[psql session ${applicationName} exceeded ${timeoutMs}ms; terminating]\n`;
    try { child.kill(); } catch { /* The close event records the final state. */ }
    killTimer = setTimeout(() => {
      if (!closed) {
        try { child.kill('SIGKILL'); } catch { /* The close event records the final state. */ }
      }
    }, 1_000);
    killTimer.unref?.();
  }, timeoutMs);
  timeout.unref?.();

  child.on('close', (code, signal) => {
    closed = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    activeSessions.delete(child);
    resolveDone({
      code,
      signal,
      output,
      applicationName,
      spawnError: spawnError?.message ?? null,
      inputError: inputError?.message ?? null,
      timedOut,
      stdinEnded,
      stdinFinished
    });
  });

  const write = text => {
    if (closed) return Promise.reject(new Error(`psql session ${applicationName} already closed`));
    if (stdinEnded) return Promise.reject(new Error(`psql session ${applicationName} stdin already ended`));
    return new Promise((resolve, reject) => {
      child.stdin.write(text, error => error ? reject(error) : resolve());
    });
  };

  const end = text => {
    if (closed) return Promise.reject(new Error(`psql session ${applicationName} already closed`));
    if (stdinEnded) return Promise.reject(new Error(`psql session ${applicationName} stdin already ended`));
    stdinEnded = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        child.stdin.removeListener('finish', onFinish);
        child.stdin.removeListener('error', onError);
      };
      const onFinish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      child.stdin.once('finish', onFinish);
      child.stdin.once('error', onError);
      child.stdin.end(text);
      done.then(() => {
        if (!settled && !child.stdin.writableFinished) {
          onError(new Error(`psql session ${applicationName} closed before stdin finished`));
        }
      });
    });
  };

  const terminate = () => {
    if (closed) return;
    try { child.kill(); } catch { /* The close event records the final state. */ }
    clearTimeout(killTimer);
    killTimer = setTimeout(() => {
      if (!closed) {
        try { child.kill('SIGKILL'); } catch { /* The close event records the final state. */ }
      }
    }, 1_000);
    killTimer.unref?.();
  };

  return {
    child,
    done,
    write,
    end,
    terminate,
    get closed() { return closed; },
    get stdinEnded() { return stdinEnded; },
    get stdinFinished() { return stdinFinished; },
    get output() { return output; }
  };
}

/** Try a transactional close first; terminate if the session does not drain promptly. */
export async function closePsqlSession(session, { input = 'ROLLBACK;\n', graceMs = 2_000 } = {}) {
  if (!session || session.closed) return session ? session.done : null;
  if (!session.stdinEnded && input !== null) {
    try {
      const flushed = await within(session.end(input), graceMs);
      if (flushed.timedOut) session.terminate();
    } catch {
      session.terminate();
    }
  } else {
    session.terminate();
  }

  const completed = await within(session.done, graceMs);
  if (completed.timedOut) {
    session.terminate();
    return session.done;
  }
  return completed.value;
}
