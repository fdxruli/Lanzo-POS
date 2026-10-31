import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { serializeError } from './checkpoint-recorder.mjs';

const TARGET = 'closes editing and recoverable checkout states without clearing the cart';

function isTarget(entity) {
  return Boolean(entity?.fullName?.includes(TARGET) || entity?.name?.includes(TARGET));
}

function getFile(entity) {
  return entity?.module?.moduleId || entity?.module?.filepath || entity?.module?.filename || null;
}

export default class Pr378TimeoutReporter {
  constructor() {
    this.path = process.env.PR378_DIAGNOSTIC_REPORT_PATH;
    this.caseStart = new Map();
    this.hookStart = new Map();
    if (this.path) mkdirSync(dirname(this.path), { recursive: true });
  }

  emit(event, extra = {}) {
    if (!this.path) return;
    const payload = {
      source: 'vitest-reporter',
      wallTimeUtc: new Date().toISOString(),
      monotonicMs: Number(process.hrtime.bigint()) / 1e6,
      event,
      ...extra,
    };
    appendFileSync(this.path, JSON.stringify(payload) + '\n', { encoding: 'utf8' });
  }

  onInit(vitest) {
    this.config = vitest.config;
    let vitestVersion = null;
    try {
      vitestVersion = JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules/vitest/package.json'), 'utf8')).version;
    } catch {}
    this.emit('runtime', {
      node: process.version,
      npmUserAgent: process.env.npm_config_user_agent || null,
      vitest: vitestVersion,
      runnerOs: process.env.GITHUB_RUNNER_OS || os.platform(),
      runnerArch: process.env.GITHUB_RUNNER_ARCH || os.arch(),
      osRelease: os.release(),
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg(),
      memory: process.memoryUsage(),
      config: {
        maxWorkers: vitest.config.maxWorkers ?? null,
        fileParallelism: vitest.config.fileParallelism ?? null,
        pool: vitest.config.pool ?? null,
        testTimeoutMs: vitest.config.testTimeout ?? null,
        hookTimeoutMs: vitest.config.hookTimeout ?? null,
        sequence: vitest.config.sequence ?? null,
      },
    });
  }

  onTestCaseReady(testCase) {
    if (!isTarget(testCase)) return;
    this.caseStart.set(testCase.id, process.hrtime.bigint());
    this.emit('test-case-ready-before-hooks', {
      testName: testCase.fullName,
      file: getFile(testCase),
      timeoutMs: testCase.options?.timeout ?? this.config?.testTimeout ?? null,
    });
  }

  onHookStart(hook) {
    if (!isTarget(hook.entity)) return;
    const key = String(hook.entity.id) + ':' + hook.name;
    this.hookStart.set(key, process.hrtime.bigint());
    this.emit('hook-start', {
      testName: hook.entity.fullName,
      file: getFile(hook.entity),
      hook: hook.name,
    });
  }

  onHookEnd(hook) {
    if (!isTarget(hook.entity)) return;
    const key = String(hook.entity.id) + ':' + hook.name;
    const started = this.hookStart.get(key);
    this.hookStart.delete(key);
    this.emit('hook-end', {
      testName: hook.entity.fullName,
      file: getFile(hook.entity),
      hook: hook.name,
      durationMs: started ? Number(process.hrtime.bigint() - started) / 1e6 : null,
    });
  }

  onTestCaseResult(testCase) {
    if (!isTarget(testCase)) return;
    const result = testCase.result();
    const started = this.caseStart.get(testCase.id);
    this.emit('test-case-result', {
      testName: testCase.fullName,
      file: getFile(testCase),
      state: result.state,
      timeoutMs: testCase.options?.timeout ?? this.config?.testTimeout ?? null,
      elapsedFromReadyMs: started ? Number(process.hrtime.bigint() - started) / 1e6 : null,
      errors: (result.errors || []).map(error => serializeError(error)),
      unresolvedHooks: Array.from(this.hookStart.keys()),
      memory: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
      hostLoadAverage: os.loadavg(),
    });
    this.caseStart.delete(testCase.id);
  }

  onTestRunEnd(_modules, unhandledErrors, reason) {
    this.emit('test-run-end', {
      reason,
      unhandledErrors: (unhandledErrors || []).map(error => serializeError(error)),
    });
  }
}
