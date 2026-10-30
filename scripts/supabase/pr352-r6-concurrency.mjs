import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const LICENSE = 'lab-license-a';
const DEVICE = 'lab-device-a';
const TOKEN = 'lab-device-token-a';
const ADMIN_SESSION = 'lab-admin-session';

function quote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function statusUpdateSql(localOrderId, status, idempotencyKey) {
  return "select public.pos_update_restaurant_order_status_unlimited("
    + [LICENSE, DEVICE, TOKEN, ADMIN_SESSION, localOrderId, status, idempotencyKey].map(quote).join(',')
    + ');';
}

function startPsqlSession(name, psqlBin, env) {
  const child = spawn(psqlBin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    env: {
      ...env,
      PGHOST: '127.0.0.1',
      PGDATABASE: 'pr352_bridge_isolated',
      PGAPPNAME: name,
      PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=12000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let closed = false;
  let inputEnded = false;
  let spawnError = null;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.on('error', (error) => { spawnError = error; });
  child.stdin.on('error', (error) => { spawnError ||= error; });
  child.on('close', () => { closed = true; });

  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, spawnError }));
    child.once('error', (error) => resolve({ code: null, signal: null, spawnError: error }));
  });

  return {
    name,
    child,
    exited,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get closed() { return closed; },
    get inputEnded() { return inputEnded; },
    send(sql) {
      if (spawnError) throw new Error('psql session failed before SQL submission: ' + name + ': ' + spawnError.message);
      if (closed || child.stdin.destroyed || !child.stdin.writable) {
        throw new Error('psql session is not writable: ' + name);
      }
      child.stdin.write(sql + '\n');
    },
    finish(sql) {
      if (closed || inputEnded) return;
      if (sql) child.stdin.write(sql + '\n');
      child.stdin.write('\\q\n');
      child.stdin.end();
      inputEnded = true;
    },
    async kill() {
      if (closed) return;
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (!closed) {
        child.kill('SIGKILL');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      }
      if (!closed) throw new Error('failed to terminate psql session after SIGTERM/SIGKILL: ' + name);
    },
  };
}

async function waitForSessionExit(session, timeoutMs = 15000) {
  let timeout;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });
  const result = await Promise.race([session.exited, timeoutPromise]);
  clearTimeout(timeout);
  if (result === null) {
    await session.kill();
    throw new Error('psql session exceeded bounded completion timeout: ' + session.name
      + ' stderr=' + session.stderr);
  }
  return { ...result, stdout: session.stdout, stderr: session.stderr };
}

async function waitForObserved(description, observe, predicate, timeoutMs = 9000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await observe();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('bounded lock observation timed out for ' + description + '; latest=' + JSON.stringify(latest));
}

async function observeLocks(query, name) {
  const sql = [
    "select coalesce(json_agg(json_build_object('pid',l.pid,'granted',l.granted,'mode',l.mode,'locktype',l.locktype,",
    "'state',a.state,'waitEventType',a.wait_event_type,'waitEvent',a.wait_event) order by l.granted,l.pid),'[]'::json)::text",
    'from pg_locks l join pg_stat_activity a on a.pid=l.pid',
    'where a.application_name=' + quote(name) + " and l.locktype='advisory'",
  ].join(' ');
  return JSON.parse(await query(sql, 4000));
}

async function observeActivity(query, name) {
  const sql = [
    "select coalesce(json_agg(json_build_object('pid',pid,'state',state,'waitEventType',wait_event_type,'waitEvent',wait_event,'queryText',left(query,300))",
    "order by pid),'[]'::json)::text",
    'from pg_stat_activity where application_name=' + quote(name),
  ].join(' ');
  return JSON.parse(await query(sql, 4000));
}

async function countPendingSessions(query, names) {
  const list = names.map(quote).join(',');
  return Number(await query("select count(*) from pg_stat_activity where application_name in (" + list + ")", 4000));
}

function appHasLock(rows, granted, mode) {
  return rows.some((row) => row.granted === granted && row.mode === mode);
}

function assertSessionSuccess(name, result) {
  assert.equal(result.code, 0, name + ' must exit 0; stderr=' + result.stderr);
  assert.equal(result.signal, null, name + ' must not be signal-terminated');
}

function stateQuery(localOrderId, expectedPausedWriteId = null) {
  const extra = expectedPausedWriteId
    ? ",'pausedWriteParentCount',(select count(*) from public.pos_restaurant_orders where local_order_id="
      + quote(expectedPausedWriteId) + ')'
    : '';
  return "select json_build_object('paused',(select writes_paused from private.restaurant_cloud_contract_state where singleton),"
    + "'parentStatus',(select status from public.pos_restaurant_orders where local_order_id="
    + quote(localOrderId) + "),"
    + "'saleCount',(select count(*) from public.pos_sales where id=" + quote(localOrderId) + ')'
    + extra + ')::text';
}

export async function runRestaurantCutoverConcurrency({ query, psqlBin, env, createLegacyOrder, runOtherRubricOperation }) {
  const results = [];
  const sessions = new Set();
  const start = (name) => {
    const session = startPsqlSession(name, psqlBin, env);
    sessions.add(session);
    return session;
  };

  try {
    const commitOrder = 'bridge-r6-concurrency-commit';
    await createLegacyOrder(commitOrder, 'r6-concurrency-commit-seed');
    const writeApp = 'pr352-r6-inflight-commit';
    const pauseApp = 'pr352-r6-pause-after-commit';
    const newWriteApp = 'pr352-r6-write-during-pause';
    const holder = start(writeApp);
    holder.send('begin;');
    holder.send(statusUpdateSql(commitOrder, 'preparing', 'r6-inflight-commit'));
    const holderLocks = await waitForObserved(writeApp + ' shared transaction lock',
      () => observeLocks(query, writeApp), (rows) => appHasLock(rows, true, 'ShareLock'));
    const holderActivity = await waitForObserved(writeApp + ' open transaction',
      () => observeActivity(query, writeApp), (rows) => rows.some((row) => row.state === 'idle in transaction'));
    assert.ok(holderActivity.some((row) => row.queryText.includes('pos_update_restaurant_order_status_unlimited')),
      'The blocking session must have completed the real Restaurant status update');

    const pause = start(pauseApp);
    pause.send('begin;');
    pause.send('select private.set_restaurant_transition_policy_v1(true,null,null);');
    const pauseLocks = await waitForObserved(pauseApp + ' queued exclusive transition lock',
      () => observeLocks(query, pauseApp), (rows) => appHasLock(rows, false, 'ExclusiveLock'));
    const pauseActivity = await waitForObserved(pauseApp + ' waiting on the transition lock',
      () => observeActivity(query, pauseApp),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'));
    assert.ok(pauseActivity.some((row) => row.queryText.includes('set_restaurant_transition_policy_v1')),
      'The pause session must be executing its policy transition while waiting');

    const newWrite = start(newWriteApp);
    const newWriteSql = [
      'begin;',
      'do $r6$',
      'declare message text; state text;',
      'begin',
      '  begin',
      '    perform public.pos_upsert_restaurant_order_unlimited(',
      "      'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',",
      "      jsonb_build_object('localOrderId','bridge-r6-paused-write','tableLabel','Synthetic paused write',",
      "        'status','pending','fulfillmentStatus','pending','subtotal',10,'total',10),",
      "      jsonb_build_array(jsonb_build_object('localLineId','bridge-r6-paused-line',",
      "        'productId','bridge-restaurant-product','productName','Bridge synthetic product',",
      "        'quantity',1,'unitPrice',10,'lineTotal',10)),",
      "      'r6-paused-write');",
      "    raise exception 'R6_WRITE_UNEXPECTEDLY_ADMITTED';",
      '  exception when others then',
      '    get stacked diagnostics message=message_text, state=returned_sqlstate;',
      "    if state<>'P0001' or message<>'RESTAURANT_CONTRACT_MAINTENANCE' then raise; end if;",
      "    raise notice 'R6_NEW_WRITE_REJECTED:%:%',state,message;",
      '  end;',
      'end',
      '$r6$;',
    ].join('\n');
    newWrite.send(newWriteSql);
    const newWriteLocks = await waitForObserved(newWriteApp + ' queued shared transition lock',
      () => observeLocks(query, newWriteApp), (rows) => appHasLock(rows, false, 'ShareLock'));
    const newWriteActivity = await waitForObserved(newWriteApp + ' waiting behind pause request',
      () => observeActivity(query, newWriteApp),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'));
    assert.ok(newWriteActivity.some((row) => row.queryText.includes('pos_upsert_restaurant_order_unlimited')),
      'The contender must have sent its complete legacy write call to PostgreSQL');

    // Queue transaction completion behind the blocked calls and close stdin before
    // releasing the holder. This proves both commands were submitted to psql.
    pause.finish('commit;');
    newWrite.finish('commit;');
    holder.finish('commit;');
    const holderExit = await waitForSessionExit(holder);
    const pauseExit = await waitForSessionExit(pause);
    const newWriteExit = await waitForSessionExit(newWrite);
    assertSessionSuccess(writeApp, holderExit);
    assertSessionSuccess(pauseApp, pauseExit);
    assertSessionSuccess(newWriteApp, newWriteExit);
    const rejected = newWriteExit.stderr.match(/R6_NEW_WRITE_REJECTED:([0-9A-Z]{5}):([^\r\n]+)/);
    assert.ok(rejected, 'Expected the real SQLSTATE and message notice from the caught PostgreSQL exception');
    assert.equal(rejected[1], 'P0001');
    assert.equal(rejected[2], 'RESTAURANT_CONTRACT_MAINTENANCE');
    const firstScenarioPending = await countPendingSessions(query, [writeApp, pauseApp, newWriteApp]);
    assert.equal(firstScenarioPending, 0, 'No PostgreSQL backend may remain after the first concurrency scenario');
    const commitState = JSON.parse(await query(stateQuery(commitOrder, 'bridge-r6-paused-write')));
    assert.equal(commitState.paused, true);
    assert.equal(commitState.parentStatus, 'preparing');
    assert.equal(commitState.saleCount, 0);
    assert.equal(commitState.pausedWriteParentCount, 0);
    results.push({
      name: 'in-flight real writer commits, pause waits exclusively, new writer rejects',
      status: 'PASS',
      sql: {
        inFlight: statusUpdateSql(commitOrder, 'preparing', 'r6-inflight-commit'),
        pause: 'select private.set_restaurant_transition_policy_v1(true,null,null)',
        newWrite: newWriteSql,
      },
      submitted: { inFlight: true, pause: true, newWrite: true },
      lockObservations: {
        holderGranted: holderLocks,
        pauseWaiting: pauseLocks,
        pauseActivity,
        newWriteWaiting: newWriteLocks,
        newWriteActivity,
      },
      releaseOrder: ['holder COMMIT', 'exclusive pause COMMIT', 'new writer receives P0001 maintenance'],
      exitCodes: { holder: holderExit.code, pause: pauseExit.code, newWrite: newWriteExit.code },
      sqlstate: { newWrite: rejected[1], message: rejected[2] },
      stderrMarkers: newWriteExit.stderr,
      finalState: commitState,
      pendingProcesses: sessions.filter((session) => !session.closed).length,
      pendingDatabaseSessions: firstScenarioPending,
    });

    await runOtherRubricOperation();
    const otherSql = "select json_build_object('paused',(select writes_paused from private.restaurant_cloud_contract_state where singleton),"
      + "'saleCount',(select count(*) from public.pos_sales where id='lab-ordinary-during-pause'),"
      + "'paymentCount',(select count(*) from public.pos_sale_payments where sale_id='lab-ordinary-during-pause'),"
      + "'inventoryCount',(select count(*) from public.pos_inventory_movements where sale_id='lab-ordinary-during-pause'))::text";
    const pausedOther = JSON.parse(await query(otherSql));
    assert.equal(pausedOther.paused, true);
    assert.equal(pausedOther.saleCount, 1);
    assert.equal(pausedOther.paymentCount, 1);
    assert.equal(pausedOther.inventoryCount, 1);
    results.push({
      name: 'unrelated cashier financial operation completes while Restaurant transition is paused',
      status: 'PASS',
      sql: 'public.pos_execute_financial_operation_v1(... operation=sale.cashier_inventory, no Restaurant parent or settlement)',
      submitted: true,
      lockObservations: 'real sale/payment/inventory rows confirmed while writes_paused=true',
      releaseOrder: ['pause COMMIT persisted writes_paused=true', 'other-rubric financial transaction COMMIT'],
      exitCodes: { operation: 0 },
      sqlstate: { operation: '00000' },
      finalState: pausedOther,
      pendingProcesses: 0,
    });

    await query('select private.set_restaurant_transition_policy_v1(false,null,null)');

    const rollbackOrder = 'bridge-r6-concurrency-rollback';
    await createLegacyOrder(rollbackOrder, 'r6-concurrency-rollback-seed');
    const rollbackApp = 'pr352-r6-inflight-rollback';
    const rollbackPauseApp = 'pr352-r6-pause-after-rollback';
    const rollbackHolder = start(rollbackApp);
    rollbackHolder.send('begin;');
    rollbackHolder.send(statusUpdateSql(rollbackOrder, 'preparing', 'r6-inflight-rollback'));
    const rollbackHolderLocks = await waitForObserved(rollbackApp + ' shared transaction lock',
      () => observeLocks(query, rollbackApp), (rows) => appHasLock(rows, true, 'ShareLock'));
    const rollbackHolderActivity = await waitForObserved(rollbackApp + ' open transaction',
      () => observeActivity(query, rollbackApp), (rows) => rows.some((row) => row.state === 'idle in transaction'));
    assert.ok(rollbackHolderActivity.some((row) => row.queryText.includes('pos_update_restaurant_order_status_unlimited')),
      'The rollback holder must have completed the real Restaurant status update');

    const rollbackPause = start(rollbackPauseApp);
    rollbackPause.send('begin;');
    rollbackPause.send('select private.set_restaurant_transition_policy_v1(true,null,null);');
    const rollbackPauseLocks = await waitForObserved(rollbackPauseApp + ' queued exclusive lock',
      () => observeLocks(query, rollbackPauseApp), (rows) => appHasLock(rows, false, 'ExclusiveLock'));
    const rollbackPauseActivity = await waitForObserved(rollbackPauseApp + ' waiting for rollback holder',
      () => observeActivity(query, rollbackPauseApp),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'));
    assert.ok(rollbackPauseActivity.some((row) => row.queryText.includes('set_restaurant_transition_policy_v1')),
      'The rollback scenario pause session must have issued the policy transition');

    rollbackPause.finish('commit;');
    rollbackHolder.finish('rollback;');
    const rollbackHolderExit = await waitForSessionExit(rollbackHolder);
    const rollbackPauseExit = await waitForSessionExit(rollbackPause);
    assertSessionSuccess(rollbackApp, rollbackHolderExit);
    assertSessionSuccess(rollbackPauseApp, rollbackPauseExit);
    const rollbackScenarioPending = await countPendingSessions(query, [rollbackApp, rollbackPauseApp]);
    assert.equal(rollbackScenarioPending, 0, 'No PostgreSQL backend may remain after the rollback scenario');
    const rolledBackState = JSON.parse(await query(stateQuery(rollbackOrder)));
    assert.equal(rolledBackState.paused, true);
    assert.equal(rolledBackState.parentStatus, 'pending');
    assert.equal(rolledBackState.saleCount, 0);
    results.push({
      name: 'in-flight real writer rolls back and releases shared lock for pause',
      status: 'PASS',
      sql: {
        inFlight: statusUpdateSql(rollbackOrder, 'preparing', 'r6-inflight-rollback'),
        pause: 'select private.set_restaurant_transition_policy_v1(true,null,null)',
      },
      submitted: { inFlight: true, pause: true },
      lockObservations: { holderGranted: rollbackHolderLocks, pauseWaiting: rollbackPauseLocks, pauseActivity: rollbackPauseActivity },
      releaseOrder: ['holder ROLLBACK', 'exclusive pause COMMIT'],
      exitCodes: { holder: rollbackHolderExit.code, pause: rollbackPauseExit.code },
      sqlstate: { holder: '00000', pause: '00000' },
      finalState: rolledBackState,
      pendingProcesses: sessions.filter((session) => !session.closed).length,
      pendingDatabaseSessions: rollbackScenarioPending,
    });

    await query('select private.set_restaurant_transition_policy_v1(false,null,null)');
    const replaySql = [
      'do $r6$',
      'declare first_receipt jsonb; replay_receipt jsonb;',
      'begin',
      '  first_receipt:=public.pos_update_restaurant_order_status_unlimited(',
      "    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',",
      '    ' + quote(rollbackOrder) + ",'preparing','r6-inflight-rollback-replay');",
      '  replay_receipt:=public.pos_update_restaurant_order_status_unlimited(',
      "    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',",
      '    ' + quote(rollbackOrder) + ",'preparing','r6-inflight-rollback-replay');",
      "  if first_receipt is distinct from replay_receipt then raise exception 'R6_POST_RESUME_REPLAY_MISMATCH'; end if;",
      "  if (select count(*) from public.pos_restaurant_orders where local_order_id=" + quote(rollbackOrder) + " and status='preparing')<>1",
      "    or (select count(*) from public.pos_idempotency_keys where license_id='00000000-0000-0000-0000-000000000001'",
      "      and idempotency_key='r6-inflight-rollback-replay')<>1 then",
      "    raise exception 'R6_POST_RESUME_REPLAY_EFFECT_MISMATCH';",
      '  end if;',
      'end',
      '$r6$;',
      "select 'PASS'",
    ].join('\n');
    const replay = await query(replaySql);
    assert.equal(replay, 'PASS');
    const replayState = JSON.parse(await query("select json_build_object("
      + "'paused',(select writes_paused from private.restaurant_cloud_contract_state where singleton),"
      + "'parentStatus',(select status from public.pos_restaurant_orders where local_order_id=" + quote(rollbackOrder) + "),"
      + "'operationRows',(select count(*) from public.pos_idempotency_keys where license_id='00000000-0000-0000-0000-000000000001'"
      + " and idempotency_key='r6-inflight-rollback-replay'))::text"));
    assert.equal(replayState.paused, false);
    assert.equal(replayState.parentStatus, 'preparing');
    assert.equal(replayState.operationRows, 1);
    results.push({
      name: 'replay after resume commits exactly once after concurrent rollback',
      status: 'PASS',
      sql: statusUpdateSql(rollbackOrder, 'preparing', 'r6-inflight-rollback-replay') + ' repeated with the same key',
      submitted: true,
      lockObservations: 'shared lock was observed before pause; no session remains after replay',
      releaseOrder: ['pause disabled', 'same operation committed', 'same key replayed'],
      exitCodes: { first: 0, replay: 0 },
      sqlstate: { first: '00000', replay: '00000' },
      finalState: replayState,
      pendingProcesses: 0,
    });

    const remaining = await query("select count(*) from pg_stat_activity where datname='pr352_bridge_isolated' and application_name like 'pr352-r6-%' and pid<>pg_backend_pid()");
    assert.equal(remaining, '0');
    return results;
  } finally {
    const cleanup = await Promise.allSettled([...sessions].map((session) => session.kill()));
    const cleanupFailures = cleanup.filter((item) => item.status === 'rejected').map((item) => item.reason);
    try {
      const isPaused = await query('select writes_paused from private.restaurant_cloud_contract_state where singleton', 4000);
      if (isPaused === 't' || isPaused === 'true') {
        await query('select private.set_restaurant_transition_policy_v1(false,null,null)', 4000);
      }
    } catch {
      // If the runner failed before a usable bridge exists, the disposable database is discarded.
    }
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'one or more psql sessions failed cleanup');
  }
}
