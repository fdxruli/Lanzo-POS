import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

function redact(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:token|secret|api[_-]?key|authorization)(\s*[:=]\s*)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/\b\d{10,15}\b/g, '[REDACTED_NUMBER]');
}

function serializeError(error, depth = 0) {
  if (error == null || depth > 2) return error == null ? null : '[CAUSE_DEPTH_LIMIT]';
  const name = error.name || error.constructor?.name || 'Error';
  const result = {
    class: redact(error.constructor?.name || name),
    name: redact(name),
    message: redact(error.message ?? error),
    stack: redact(error.stack ?? ''),
  };
  if (error.code != null) result.code = redact(error.code);
  if (error.type != null) result.type = redact(error.type);
  if (error.cause != null) result.cause = serializeError(error.cause, depth + 1);
  return result;
}

function resourceSnapshot(eventLoopStart) {
  let activeResources = null;
  let usage = null;
  try {
    activeResources = typeof process.getActiveResourcesInfo === 'function'
      ? process.getActiveResourcesInfo().reduce((counts, type) => {
          counts[type] = (counts[type] || 0) + 1;
          return counts;
        }, {})
      : null;
  } catch {}
  try { usage = process.resourceUsage(); } catch {}
  return {
    memory: process.memoryUsage(),
    resourceUsage: usage,
    hostLoadAverage: os.loadavg(),
    activeResources,
    eventLoopUtilization: eventLoopStart
      ? performance.eventLoopUtilization(eventLoopStart)
      : performance.eventLoopUtilization(),
  };
}

export function createCheckpointRecorder(testName) {
  const enabled = process.env.PR378_DIAG_ENABLED === '1';
  const outputPath = process.env.PR378_DIAGNOSTIC_EVENTS_PATH;
  if (!enabled || !outputPath) return null;

  mkdirSync(dirname(outputPath), { recursive: true });
  let fd = openSync(outputPath, 'a');
  let closed = false;
  const start = process.hrtime.bigint();
  const eventLoopStart = performance.eventLoopUtilization();
  const pending = new Map();
  let sequence = 0;
  let lastStarted = null;
  let lastCompleted = null;

  function write(event, extra = {}) {
    if (closed) return;
    const now = process.hrtime.bigint();
    const payload = {
      source: 'test-worker',
      testName,
      sequence: ++sequence,
      wallTimeUtc: new Date().toISOString(),
      elapsedMs: Number(now - start) / 1e6,
      event,
      lastOperationStarted: lastStarted,
      lastOperationCompleted: lastCompleted,
      pendingOperations: Array.from(pending.values()),
      ...extra,
    };
    try { writeSync(fd, JSON.stringify(payload) + '\n'); } catch {}
  }

  return {
    begin(operation) {
      const id = ++sequence;
      const now = process.hrtime.bigint();
      const pendingEntry = {
        id,
        operation,
        startedAtUtc: new Date().toISOString(),
        elapsedAtStartMs: Number(now - start) / 1e6,
      };
      pending.set(id, pendingEntry);
      lastStarted = operation;
      write('checkpoint-start', { operation, operationId: id });
      return id;
    },
    complete(id, state = 'completed') {
      const current = pending.get(id);
      if (!current) return;
      const now = process.hrtime.bigint();
      const elapsedMs = Number(now - start) / 1e6 - current.elapsedAtStartMs;
      pending.delete(id);
      if (state === 'completed') lastCompleted = current.operation;
      write('checkpoint-end', {
        operation: current.operation,
        operationId: id,
        operationState: state,
        operationDurationMs: elapsedMs,
      });
    },
    event(name, extra = {}) {
      write(name, extra);
    },
    failure(context) {
      write('onTestFailed', {
        testState: context.signalAborted ? 'aborted' : 'failed',
        errors: (context.errors || []).map(error => serializeError(error)),
        timers: {
          fakeTimersActive: Boolean(context.fakeTimersActive),
          fakeTimerCount: context.fakeTimerCount ?? null,
        },
        resources: resourceSnapshot(eventLoopStart),
      });
    },
    finish(context = {}) {
      write('test-finished', {
        testState: context.testState ?? 'finished',
        timers: {
          fakeTimersActive: Boolean(context.fakeTimersActive),
          fakeTimerCount: context.fakeTimerCount ?? null,
        },
        resources: resourceSnapshot(eventLoopStart),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      try { closeSync(fd); } catch {}
      fd = null;
    },
  };
}

export { serializeError, resourceSnapshot };

