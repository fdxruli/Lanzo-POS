import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const LICENSE = 'lab-license-a';
const LICENSE_ID = '00000000-0000-0000-0000-000000000001';
const DEVICE = 'lab-device-a';
const TOKEN = 'lab-device-token-a';
const ADMIN_SESSION = 'lab-admin-session';

function quote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

export function statusUpdateSql(orderId, status, idempotencyKey) {
  return 'do $r6_status$ declare receipt jsonb; begin '
    + 'receipt:=public.pos_update_restaurant_order_status_unlimited('
    + [LICENSE, DEVICE, TOKEN, ADMIN_SESSION, orderId, status, idempotencyKey].map(quote).join(',')
    + '); '
    + "if coalesce((receipt->>'success')::boolean,false) is not true "
    + "or receipt->'order'->>'id' is distinct from " + quote(orderId)
    + " then raise exception 'R6_STATUS_UPDATE_FAILED: %',receipt; end if; "
    + "raise notice 'R6_STATUS_UPDATE_ACCEPTED:%',receipt; end; $r6_status$;";
}

function startPsqlSession(name, psqlBin, env) {
  const child = spawn(psqlBin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
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
    "select coalesce(json_agg(json_build_object('pid',l.pid,'granted',l.granted,'mode',l.mode,'locktype',l.locktype,'classId',l.classid,'objectId',l.objid,'objectSubId',l.objsubid,",
    "'state',a.state,'waitEventType',a.wait_event_type,'waitEvent',a.wait_event) order by l.granted,l.pid),'[]'::json)::text",
    'from pg_locks l join pg_stat_activity a on a.pid=l.pid',
    'where a.application_name=' + quote(name) + " and l.locktype='advisory' and l.objsubid=1",
    "and l.classid::bigint=((pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0) >> 32) & 4294967295::bigint)",
    "and l.objid::bigint=(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0) & 4294967295::bigint)",
  ].join(' ');
  return JSON.parse(await query(sql, 4000));
}

async function observeRestaurantIdempotencyLock(query, name, idempotencyKey) {
  const lockKey = 'restaurant_order_upsert_idempotency_v1:' + LICENSE_ID + ':' + idempotencyKey;
  const sql = [
    "select coalesce(json_agg(json_build_object('pid',l.pid,'granted',l.granted,'mode',l.mode,'locktype',l.locktype,",
    "'state',a.state,'waitEventType',a.wait_event_type,'waitEvent',a.wait_event,'blockedBy',pg_catalog.pg_blocking_pids(l.pid)) order by l.granted,l.pid),'[]'::json)::text",
    'from pg_locks l join pg_stat_activity a on a.pid=l.pid',
    'where a.application_name=' + quote(name) + " and l.locktype='advisory' and l.objsubid=1",
    'and l.classid::bigint=((pg_catalog.hashtextextended(' + quote(lockKey) + ',0) >> 32) & 4294967295::bigint)',
    'and l.objid::bigint=(pg_catalog.hashtextextended(' + quote(lockKey) + ',0) & 4294967295::bigint)',
  ].join(' ');
  return JSON.parse(await query(sql, 4000));
}

async function observeActivity(query, name) {
  const sql = [
    "select coalesce(json_agg(json_build_object('pid',pid,'state',state,'waitEventType',wait_event_type,'waitEvent',wait_event,'queryText',left(query,300),'blockedBy',pg_catalog.pg_blocking_pids(pid))",
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
  assert.equal(result.spawnError, null, name + ' must not have a process or stdin error');
}

export function countOpenSessions(sessions) {
  return [...sessions].filter((session) => !session.closed).length;
}

function stateQuery(localOrderId, expectedPausedWriteId = null) {
  const extra = expectedPausedWriteId
    ? ",'pausedWriteParentCount',(select count(*) from public.pos_restaurant_orders where local_order_id="
      + quote(expectedPausedWriteId) + ')'
    : '';
  return "select json_build_object('paused',(select writes_paused from private.restaurant_cloud_contract_state where singleton),"
    + "'parentStatus',(select status from public.pos_restaurant_orders where license_id=" + quote(LICENSE_ID)
    + "::uuid and deleted_at is null and local_order_id="
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
    const commitOrderId = await createLegacyOrder(commitOrder, 'r6-concurrency-commit-seed');
    const writeApp = 'pr352-r6-inflight-commit';
    const pauseApp = 'pr352-r6-pause-after-commit';
    const newWriteApp = 'pr352-r6-write-during-pause';
    const holder = start(writeApp);
    holder.send('begin;');
    holder.send(statusUpdateSql(commitOrderId, 'preparing', 'r6-inflight-commit'));
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
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(holderLocks.find((lock) => lock.granted && lock.mode === 'ShareLock').pid)));
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
      "        'status','pending','fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),",
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
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(pauseLocks.find((lock) => !lock.granted && lock.mode === 'ExclusiveLock').pid)));
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
    assert.match(holderExit.stderr, /R6_STATUS_UPDATE_ACCEPTED:/, 'The in-flight writer must report a successful RPC receipt');
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
      category: 'CUTOVER_COMMIT_RACE',
      name: 'in-flight real writer commits, pause waits exclusively, new writer rejects',
      status: 'PASS',
      sql: {
        inFlight: statusUpdateSql(commitOrderId, 'preparing', 'r6-inflight-commit'),
        pause: 'select private.set_restaurant_transition_policy_v1(true,null,null)',
        newWrite: newWriteSql,
      },
      submitted: { inFlight: true, pause: true, newWrite: true },
      lockObservations: {
        holderGranted: holderLocks,
        holderActivity,
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
      pendingProcesses: countOpenSessions(sessions),
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
      category: 'UNRELATED_RUBRIC_CONTINUITY',
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
    const rollbackOrderId = await createLegacyOrder(rollbackOrder, 'r6-concurrency-rollback-seed');
    const rollbackApp = 'pr352-r6-inflight-rollback';
    const rollbackPauseApp = 'pr352-r6-pause-after-rollback';
    const rollbackHolder = start(rollbackApp);
    rollbackHolder.send('begin;');
    rollbackHolder.send(statusUpdateSql(rollbackOrderId, 'preparing', 'r6-inflight-rollback'));
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
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(rollbackHolderLocks.find((lock) => lock.granted && lock.mode === 'ShareLock').pid)));
    assert.ok(rollbackPauseActivity.some((row) => row.queryText.includes('set_restaurant_transition_policy_v1')),
      'The rollback scenario pause session must have issued the policy transition');

    rollbackPause.finish('commit;');
    rollbackHolder.finish('rollback;');
    const rollbackHolderExit = await waitForSessionExit(rollbackHolder);
    const rollbackPauseExit = await waitForSessionExit(rollbackPause);
    assertSessionSuccess(rollbackApp, rollbackHolderExit);
    assert.match(rollbackHolderExit.stderr, /R6_STATUS_UPDATE_ACCEPTED:/, 'The rolled-back writer must report a successful RPC receipt');
    assertSessionSuccess(rollbackPauseApp, rollbackPauseExit);
    const rollbackScenarioPending = await countPendingSessions(query, [rollbackApp, rollbackPauseApp]);
    assert.equal(rollbackScenarioPending, 0, 'No PostgreSQL backend may remain after the rollback scenario');
    const rolledBackState = JSON.parse(await query(stateQuery(rollbackOrder)));
    assert.equal(rolledBackState.paused, true);
    assert.equal(rolledBackState.parentStatus, 'pending');
    assert.equal(rolledBackState.saleCount, 0);
    results.push({
      category: 'CUTOVER_ROLLBACK_RACE',
      name: 'in-flight real writer rolls back and releases shared lock for pause',
      status: 'PASS',
      sql: {
        inFlight: statusUpdateSql(rollbackOrderId, 'preparing', 'r6-inflight-rollback'),
        pause: 'select private.set_restaurant_transition_policy_v1(true,null,null)',
      },
      submitted: { inFlight: true, pause: true },
      lockObservations: { holderGranted: rollbackHolderLocks, holderActivity: rollbackHolderActivity, pauseWaiting: rollbackPauseLocks, pauseActivity: rollbackPauseActivity },
      releaseOrder: ['holder ROLLBACK', 'exclusive pause COMMIT'],
      exitCodes: { holder: rollbackHolderExit.code, pause: rollbackPauseExit.code },
      sqlstate: { holder: '00000', pause: '00000' },
      finalState: rolledBackState,
      pendingProcesses: countOpenSessions(sessions),
      pendingDatabaseSessions: rollbackScenarioPending,
    });

    await query('select private.set_restaurant_transition_policy_v1(false,null,null)');
    const replaySql = [
      'do $r6$',
      'declare first_receipt jsonb; replay_receipt jsonb;',
      'begin',
      '  first_receipt:=public.pos_update_restaurant_order_status_unlimited(',
      "    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',",
      '    ' + quote(rollbackOrderId) + ",'preparing','r6-inflight-rollback-replay');",
      '  replay_receipt:=public.pos_update_restaurant_order_status_unlimited(',
      "    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',",
      '    ' + quote(rollbackOrderId) + ",'preparing','r6-inflight-rollback-replay');",
      "  if coalesce((first_receipt->>'success')::boolean,false) is not true or first_receipt->'order'->>'id' is distinct from " + quote(rollbackOrderId) + " then raise exception 'R6_POST_RESUME_FIRST_FAILED: %',first_receipt; end if;",
      "  if coalesce((replay_receipt->>'success')::boolean,false) is not true then raise exception 'R6_POST_RESUME_REPLAY_FAILED: %',replay_receipt; end if;",
      "  if first_receipt is distinct from replay_receipt then raise exception 'R6_POST_RESUME_REPLAY_MISMATCH'; end if;",
      "  if (select count(*) from public.pos_restaurant_orders where license_id=" + quote(LICENSE_ID) + "::uuid and deleted_at is null and local_order_id=" + quote(rollbackOrder) + " and status='preparing')<>1",
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
      + "'parentStatus',(select status from public.pos_restaurant_orders where license_id=" + quote(LICENSE_ID) + "::uuid and deleted_at is null and local_order_id=" + quote(rollbackOrder) + "),"
      + "'operationRows',(select count(*) from public.pos_idempotency_keys where license_id='00000000-0000-0000-0000-000000000001'"
      + " and idempotency_key='r6-inflight-rollback-replay'))::text"));
    assert.equal(replayState.paused, false);
    assert.equal(replayState.parentStatus, 'preparing');
    assert.equal(replayState.operationRows, 1);
    results.push({
      category: 'POST_RESUME_REPLAY',
      name: 'replay after resume commits exactly once after concurrent rollback',
      status: 'PASS',
      sql: statusUpdateSql(rollbackOrderId, 'preparing', 'r6-inflight-rollback-replay') + ' repeated with the same key',
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

function versionedUpsertSql(localOrderId, idempotencyKey, lineId, itemName = 'Bridge synthetic product',
  expectedParentVersion = null, staffSession = 'lab-admin-session') {
  const expectedPair = expectedParentVersion === null
    ? ''
    : `,'expectedParentVersion',${quote(expectedParentVersion)}`;
  return `set role anon; select public.pos_upsert_restaurant_order_versioned_v1(
    'lab-license-a','lab-device-a','lab-device-token-a',${quote(staffSession)},
    jsonb_build_object('localOrderId',${quote(localOrderId)},'clientContractVersion',2,
      'tableLabel','Concurrent versioned request','status','pending','fulfillmentStatus','pending',
      'source','tables','subtotal',10,'total',10${expectedPair}),
    jsonb_build_array(jsonb_build_object('localLineId',${quote(lineId)},'productId','bridge-restaurant-product',
      'productName',${quote(itemName)},'quantity',1,'unitPrice',10,'lineTotal',10)),
    ${quote(idempotencyKey)})::text; reset role;`;
}

function sessionJson(session, description) {
  const jsonLines = session.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{'));
  assert.ok(jsonLines.length > 0, description + ' must emit the PostgreSQL JSON receipt');
  return JSON.parse(jsonLines.at(-1));
}

export async function runVersionedUpsertIdempotencyRaces({ query, psqlBin, env }) {
  const scenarios = [];
  const sessions = new Set();
  const contenderSession = 'lab-admin-session-r20-distinct';
  const contenderSessionId = '00000000-0000-0000-0000-0000000000f1';
  const start = (name) => {
    const session = startPsqlSession(name, psqlBin, env);
    sessions.add(session);
    return session;
  };

  const runRace = async ({ name, localOrderId, idempotencyKey, conflict }) => {
    const holderName = `pr352-r6-${name}-holder`;
    const contenderName = `pr352-r6-${name}-contender`;
    const holder = start(holderName);
    const contender = start(contenderName);
    holder.send('begin;');
    holder.send(versionedUpsertSql(localOrderId, idempotencyKey, localOrderId + '-line'));
    const holderReady = await waitForObserved(holderName + ' first versioned request remains uncommitted',
      () => observeActivity(query, holderName),
      (rows) => rows.some((row) => row.state === 'idle in transaction'));
    const holderResponse = sessionJson(holder, holderName);
    assert.equal(holderResponse.success, true, holderName + ' must complete the authentic upsert before commit');
    assert.ok(holderResponse.order?.id, holderName + ' must return its persisted parent identity');

    contender.send('begin;');
    contender.send(versionedUpsertSql(localOrderId, idempotencyKey, localOrderId + '-line',
      conflict ? 'Different synthetic product name' : 'Bridge synthetic product',null,contenderSession));
    const contenderBlocked = await waitForObserved(contenderName + ' waits for first transaction',
      () => observeActivity(query, contenderName),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(holderReady.find((row) => row.state === 'idle in transaction').pid)));
    const contenderActivity = contenderBlocked.find((row) => row.state === 'active' && row.waitEventType === 'Lock');
    assert.ok(contenderActivity.queryText.includes('pos_upsert_restaurant_order_versioned_v1'),
      contenderName + ' must have submitted the complete versioned SQL call to PostgreSQL');

    holder.finish('commit;');
    contender.finish('commit;');
    const holderExit = await waitForSessionExit(holder);
    const contenderExit = await waitForSessionExit(contender);
    assertSessionSuccess(holderName, holderExit);
    assertSessionSuccess(contenderName, contenderExit);
    const contenderResponse = sessionJson(contender, contenderName);
    if (conflict) {
      assert.equal(contenderResponse.success, false);
      assert.equal(contenderResponse.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal('order' in contenderResponse, false, 'A conflicting request must never receive the stored receipt');
    } else {
      assert.deepEqual(contenderResponse, holderResponse,
        'A concurrent exact retry must recover the one committed receipt');
    }
    const finalState = JSON.parse(await query(`select json_build_object(
      'parents',(select count(*) from public.pos_restaurant_orders where license_id='00000000-0000-0000-0000-000000000001'::uuid and local_order_id=${quote(localOrderId)}),
      'items',(select count(*) from public.pos_restaurant_order_items where license_id='00000000-0000-0000-0000-000000000001'::uuid and restaurant_order_id=${quote(holderResponse.order.id)}),
      'events',(select count(*) from public.pos_sync_events where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key=${quote(idempotencyKey)}),
      'ledger',(select count(*) from public.pos_idempotency_keys where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key=${quote(idempotencyKey)}),
      'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key=${quote(idempotencyKey)})
    )::text`));
    assert.deepEqual(finalState, { parents: 1, items: 1, events: 2, ledger: 1, proofs: 1 },
      name + ' must leave exactly one parent, item, idempotency row, and strong proof');
    assert.equal(holderExit.signal, null);
    assert.equal(contenderExit.signal, null);
    scenarios.push({
      name,
      contenderQuerySubmitted: true,
      waitEventType: contenderActivity.waitEventType,
      waitEvent: contenderActivity.waitEvent,
      blockedBy: contenderActivity.blockedBy,
      releaseOrder: 'holder COMMIT, then contender COMMIT',
      holderExitCode: holderExit.code,
      contenderExitCode: contenderExit.code,
      holderResponse: conflict ? 'successful first write' : 'receipt preserved',
      contenderResponse: conflict ? 'IDEMPOTENCY_CONFLICT without receipt' : 'same committed receipt',
      finalState,
      status: 'PASS',
    });
  };

  try {
    await query(`insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
      values (${quote(contenderSessionId)}::uuid,'${LICENSE_ID}'::uuid,
        '00000000-0000-0000-0000-0000000000aa'::uuid,'00000000-0000-0000-0000-00000000000a'::uuid,
        extensions.crypt(${quote(contenderSession)},extensions.gen_salt('bf')),now()+interval '1 day')`);
    await runRace({ name: 'versioned-idempotency-identical', localOrderId: 'bridge-r20-concurrent-identical',
      idempotencyKey: 'bridge-r20-concurrent-identical-key', conflict: false });
    await runRace({ name: 'versioned-idempotency-conflict', localOrderId: 'bridge-r20-concurrent-conflict',
      idempotencyKey: 'bridge-r20-concurrent-conflict-key', conflict: true });

    const keyHolderLocalId = 'bridge-r20-same-key-parent-holder';
    const keyContenderLocalId = 'bridge-r20-same-key-parent-contender';
    const sharedKey = 'bridge-r20-cross-parent-same-key';
    const keyHolderName = 'pr352-r6-cross-parent-same-key-holder';
    const keyContenderName = 'pr352-r6-cross-parent-same-key-contender';
    const keyHolder = start(keyHolderName);
    const keyContender = start(keyContenderName);
    keyHolder.send('begin;');
    keyHolder.send(versionedUpsertSql(keyHolderLocalId,sharedKey,keyHolderLocalId+'-line'));
    const keyHolderRows = await waitForObserved(keyHolderName + ' holds parent A and idempotency key lock',
      () => observeActivity(query,keyHolderName),
      (rows) => rows.some((row) => row.state === 'idle in transaction'));
    const keyHolderReceipt = sessionJson(keyHolder,keyHolderName);
    assert.equal(keyHolderReceipt.success,true,'The cross-parent key holder must perform the authentic first write');
    const keyHolderPid = keyHolderRows.find((row) => row.state === 'idle in transaction').pid;
    const heldKeyLock = await observeRestaurantIdempotencyLock(query,keyHolderName,sharedKey);
    assert.ok(heldKeyLock.some((row) => row.granted && row.mode === 'ExclusiveLock'),
      'The first request must own the exact per-license idempotency advisory lock');

    keyContender.send('begin;');
    keyContender.send(versionedUpsertSql(keyContenderLocalId,sharedKey,keyContenderLocalId+'-line',
      'Different parent, same key',null,contenderSession));
    const keyWaitRows = await waitForObserved(keyContenderName + ' waits for the same idempotency key across distinct parents',
      () => observeActivity(query,keyContenderName),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(keyHolderPid)));
    const keyWait = keyWaitRows.find((row) => row.state === 'active' && row.waitEventType === 'Lock');
    assert.ok(keyWait.queryText.includes('pos_upsert_restaurant_order_versioned_v1'),
      'The second distinct-parent call must submit the complete writer SQL');
    const waitingKeyLock = await observeRestaurantIdempotencyLock(query,keyContenderName,sharedKey);
    assert.ok(waitingKeyLock.some((row) => !row.granted && row.mode === 'ExclusiveLock' && row.blockedBy.includes(keyHolderPid)),
      'The observed conflict must be waiting on the exact matching idempotency advisory lock, after taking a distinct parent lock');

    keyHolder.finish('commit;');
    keyContender.finish('commit;');
    const keyHolderExit = await waitForSessionExit(keyHolder);
    const keyContenderExit = await waitForSessionExit(keyContender);
    assertSessionSuccess(keyHolderName,keyHolderExit);
    assertSessionSuccess(keyContenderName,keyContenderExit);
    const keyContenderResponse = sessionJson(keyContender,keyContenderName);
    assert.equal(keyContenderResponse.success,false);
    assert.equal(keyContenderResponse.code,'IDEMPOTENCY_CONFLICT');
    assert.equal('order' in keyContenderResponse,false,'A different parent must not receive the holder receipt');
    const crossParentFinal = JSON.parse(await query(`select json_build_object(
      'holderParents',(select count(*) from public.pos_restaurant_orders where license_id='${LICENSE_ID}'::uuid and local_order_id=${quote(keyHolderLocalId)}),
      'contenderParents',(select count(*) from public.pos_restaurant_orders where license_id='${LICENSE_ID}'::uuid and local_order_id=${quote(keyContenderLocalId)}),
      'holderItems',(select count(*) from public.pos_restaurant_order_items where license_id='${LICENSE_ID}'::uuid and local_line_id=${quote(keyHolderLocalId+'-line')} and deleted_at is null),
      'contenderItems',(select count(*) from public.pos_restaurant_order_items where license_id='${LICENSE_ID}'::uuid and local_line_id=${quote(keyContenderLocalId+'-line')} and deleted_at is null),
      'ledger',(select count(*) from public.pos_idempotency_keys where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(sharedKey)}),
      'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(sharedKey)}),
      'events',(select count(*) from public.pos_sync_events where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(sharedKey)}))::text`));
    assert.deepEqual(crossParentFinal,{holderParents:1,contenderParents:0,holderItems:1,contenderItems:0,ledger:1,proofs:1,events:2},
      'A same-key request for a different parent must leave only the original parent, receipt, proof and writer events');
    const crossParentPending = await countPendingSessions(query,[keyHolderName,keyContenderName]);
    assert.equal(crossParentPending,0,'The cross-parent advisory-key race must leave no PostgreSQL sessions');
    scenarios.push({
      name:'versioned-same-key-distinct-parents',
      holderQuerySubmitted:true,
      contenderQuerySubmitted:true,
      holderLock:heldKeyLock.find((row)=>row.granted),
      contenderLockWait:waitingKeyLock.find((row)=>!row.granted),
      waitEventType:keyWait.waitEventType,
      waitEvent:keyWait.waitEvent,
      blockedBy:keyWait.blockedBy,
      releaseOrder:'same-key holder COMMIT, then contender resumes and returns IDEMPOTENCY_CONFLICT',
      holderExitCode:keyHolderExit.code,
      contenderExitCode:keyContenderExit.code,
      contenderResponse:'IDEMPOTENCY_CONFLICT without receipt',
      finalState:crossParentFinal,
      pendingDatabaseSessions:crossParentPending,
      status:'PASS',
    });

    // A fresh authorization session for the same actor/device isolates the
    // parent's advisory lock from the shared rate-limit row in this race.
    const parentLocalId = 'bridge-r20-same-parent-distinct-keys';
    const seedKey = parentLocalId + '-seed-key';
    const seedReceipt = JSON.parse(await query(versionedUpsertSql(parentLocalId, seedKey,
      parentLocalId + '-line')));
    assert.equal(seedReceipt.success, true, 'RC-05 parent seed must be a real versioned write');
    const initialParentVersion = await query(`select updated_at::text from public.pos_restaurant_orders
      where license_id=${quote(LICENSE_ID)}::uuid and local_order_id=${quote(parentLocalId)}`);
    const holderName = 'pr352-r6-same-parent-distinct-keys-holder';
    const contenderName = 'pr352-r6-same-parent-distinct-keys-contender';
    const holder = start(holderName);
    const contender = start(contenderName);
    holder.send('begin;');
    holder.send(versionedUpsertSql(parentLocalId, parentLocalId + '-key-a', parentLocalId + '-line',
      'Bridge holder update', initialParentVersion));
    const holderActivityRows = await waitForObserved(holderName + ' holds canonical parent lock',
      () => observeActivity(query, holderName),
      (rows) => rows.some((row) => row.state === 'idle in transaction'));
    const holderResponse = sessionJson(holder, holderName);
    assert.equal(holderResponse.success, true, 'RC-05 first key must perform its real parent update');
    const holderPid = holderActivityRows.find((row) => row.state === 'idle in transaction').pid;

    contender.send('begin;');
    contender.send(versionedUpsertSql(parentLocalId, parentLocalId + '-key-b', parentLocalId + '-line',
      'Bridge contender update', initialParentVersion, contenderSession));
    const contenderActivityRows = await waitForObserved(contenderName + ' waits on canonical parent serialization',
      () => observeActivity(query, contenderName),
      (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
        && row.blockedBy.includes(holderPid)));
    const blockedActivity = contenderActivityRows.find((row) => row.state === 'active' && row.waitEventType === 'Lock');
    assert.ok(blockedActivity.queryText.includes('pos_upsert_restaurant_order_versioned_v1'),
      'RC-05 contender must submit its complete distinct-key writer request');

    holder.finish('commit;');
    const holderExit = await waitForSessionExit(holder);
    const contenderExit = await waitForSessionExit(contender);
    assertSessionSuccess(holderName, holderExit);
    assert.equal(contenderExit.code, 1, 'The stale distinct-key contender must fail its SQL statement');
    assert.equal(contenderExit.signal, null, 'The contender must exit from PostgreSQL rejection, not a process signal');
    assert.equal(contenderExit.spawnError, null, 'The contender must not fail to start or write SQL');
    assert.match(contenderExit.stderr, /RESTAURANT_ORDER_VERSION_CONFLICT/,
      'The second distinct key must observe the committed parent version and be rejected as stale');
    assert.match(contenderExit.stderr, /P0001/,
      'RC-05 must retain the specific PostgreSQL SQLSTATE for version conflict');
    const finalState = JSON.parse(await query(`select json_build_object(
      'parents',(select count(*) from public.pos_restaurant_orders where license_id='${LICENSE_ID}'::uuid and local_order_id=${quote(parentLocalId)}),
      'items',(select count(*) from public.pos_restaurant_order_items where license_id='${LICENSE_ID}'::uuid and local_line_id=${quote(parentLocalId + '-line')} and deleted_at is null),
      'holderLedger',(select count(*) from public.pos_idempotency_keys where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-a')}),
      'contenderLedger',(select count(*) from public.pos_idempotency_keys where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-b')}),
      'holderProof',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-a')}),
      'contenderProof',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-b')}),
      'holderEvents',(select count(*) from public.pos_sync_events where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-a')}),
      'contenderEvents',(select count(*) from public.pos_sync_events where license_id='${LICENSE_ID}'::uuid and idempotency_key=${quote(parentLocalId + '-key-b')}),
      'serverVersion',(select server_version from public.pos_restaurant_orders where license_id='${LICENSE_ID}'::uuid and local_order_id=${quote(parentLocalId)})
    )::text`));
    assert.deepEqual(finalState, {
      parents: 1, items: 1, holderLedger: 1, contenderLedger: 0,
      holderProof: 1, contenderProof: 0, holderEvents: 2, contenderEvents: 0,
      serverVersion: seedReceipt.order.serverVersion + 1,
    }, 'RC-05 must commit one parent version and no second ledger, proof, event or duplicate item');
    const databaseSessions = await countPendingSessions(query, [holderName, contenderName]);
    assert.equal(databaseSessions, 0, 'RC-05 must leave no PostgreSQL test sessions');
    assert.equal(holderExit.signal, null);
    assert.equal(contenderExit.signal, null);
    scenarios.push({
      name: 'versioned-same-parent-distinct-keys',
      holderQuerySubmitted: true,
      contenderQuerySubmitted: true,
      waitEventType: blockedActivity.waitEventType,
      waitEvent: blockedActivity.waitEvent,
      blockedBy: blockedActivity.blockedBy,
      releaseOrder: 'holder COMMIT, then contender resumes under a distinct session rate-limit key',
      holderExitCode: holderExit.code,
      contenderExitCode: contenderExit.code,
      holderResponse: 'versioned parent update committed',
      contenderSqlstate: 'P0001',
      contenderResponse: 'RESTAURANT_ORDER_VERSION_CONFLICT',
      finalState,
      pendingDatabaseSessions: databaseSessions,
      status: 'PASS',
    });

    // Match the authentic public wrapper's rate-row -> transition-lock order.
    // The exclusive pause is queued while a second request owns the same
    // limiter row; the contender must wait on the rate row first, then on the
    // pause lock, and fail closed after the pause commits without a lock cycle.
    const orderingToken = 'lab-admin-session-r20-cutover-order';
    const orderingSessionId = '00000000-0000-0000-0000-0000000000f2';
    const orderingHash = await query(`select encode(extensions.digest(${quote(orderingToken)},'sha256'),'hex')`);
    const rateHolderName = 'pr352-r6-cutover-rate-row-holder';
    const pauseName = 'pr352-r6-cutover-exclusive-pause';
    const pausedWriterName = 'pr352-r6-cutover-versioned-writer';
    const rateHolder = start(rateHolderName);
    const pauseSession = start(pauseName);
    const pausedWriter = start(pausedWriterName);
    try {
      await query(`insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
        values (${quote(orderingSessionId)}::uuid,'${LICENSE_ID}'::uuid,
          '00000000-0000-0000-0000-0000000000aa'::uuid,'00000000-0000-0000-0000-00000000000a'::uuid,
          extensions.crypt(${quote(orderingToken)},extensions.gen_salt('bf')),now()+interval '1 day')`);

      rateHolder.send('begin;');
      rateHolder.send(`select public.enforce_pos_rpc_rate_limit_v2(
        p_license_key:='lab-license-a',p_device_fingerprint:='lab-device-a',p_staff_session_token:=${quote(orderingToken)},
        p_rpc_name:='pos_upsert_restaurant_order',p_scope:='POS_WRITE',p_max_attempts:=120,
        p_window_seconds:=600,p_block_seconds:=300,p_code:='RPC_RATE_LIMITED',p_metadata:='{}'::jsonb)::text;`);
      const rateHolderRows = await waitForObserved(rateHolderName + ' retains the authentic limiter row lock',
        () => observeActivity(query, rateHolderName),
        (rows) => rows.some((row) => row.state === 'idle in transaction'));
      const rateHolderResponse = sessionJson(rateHolder, rateHolderName);
      assert.equal(rateHolderResponse.allowed, true, 'The held rate-limit attempt must remain below the threshold');
      const rateHolderPid = rateHolderRows.find((row) => row.state === 'idle in transaction').pid;

      pauseSession.send('begin;');
      pauseSession.send('select private.set_restaurant_transition_policy_v1(true,null,null);');
      const pauseActivityRows = await waitForObserved(pauseName + ' owns the exclusive transition lock',
        () => observeActivity(query, pauseName),
        (rows) => rows.some((row) => row.state === 'idle in transaction'));
      const pausePid = pauseActivityRows.find((row) => row.state === 'idle in transaction').pid;
      const pauseLocks = await observeLocks(query, pauseName);
      assert.ok(pauseLocks.some((lock) => lock.granted && lock.mode === 'ExclusiveLock'),
        'The cutover setter must hold the real exclusive advisory lock before the competing writer starts');

      pausedWriter.send('begin;');
      pausedWriter.send(versionedUpsertSql('bridge-r20-cutover-rate-order',
        'bridge-r20-cutover-rate-order-key','bridge-r20-cutover-rate-order-line',
        'Cutover lock-order request',null,orderingToken));
      const rateWaitRows = await waitForObserved(pausedWriterName + ' waits on the holder rate-limit row first',
        () => observeActivity(query, pausedWriterName),
        (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
          && row.blockedBy.includes(rateHolderPid)));
      const rateWait = rateWaitRows.find((row) => row.state === 'active' && row.waitEventType === 'Lock');
      assert.ok(rateWait.queryText.includes('pos_upsert_restaurant_order_versioned_v1'),
        'The blocked contender must have submitted the complete versioned RPC');
      assert.ok(!(await observeLocks(query, pausedWriterName)).some((lock) => lock.granted),
        'The contender must not acquire the transition shared lock while blocked on the earlier limiter row');

      rateHolder.finish('commit;');
      const rateHolderExit = await waitForSessionExit(rateHolder);
      assertSessionSuccess(rateHolderName, rateHolderExit);
      const transitionWaitRows = await waitForObserved(pausedWriterName + ' then waits on exclusive cutover pause',
        () => observeActivity(query, pausedWriterName),
        (rows) => rows.some((row) => row.state === 'active' && row.waitEventType === 'Lock'
          && row.blockedBy.includes(pausePid)));
      const transitionWait = transitionWaitRows.find((row) => row.state === 'active' && row.waitEventType === 'Lock');
      const transitionWaitLocks = await observeLocks(query, pausedWriterName);
      assert.ok(transitionWaitLocks.some((lock) => !lock.granted && lock.mode === 'ShareLock'),
        'After the rate row is released, the contender must wait for shared admission behind the exclusive pause');

      pauseSession.finish('commit;');
      const pauseExit = await waitForSessionExit(pauseSession);
      assertSessionSuccess(pauseName, pauseExit);
      const pausedWriterExit = await waitForSessionExit(pausedWriter);
      assert.equal(pausedWriterExit.code, 1, 'A writer released after committed pause must fail in PostgreSQL');
      assert.equal(pausedWriterExit.signal, null);
      assert.equal(pausedWriterExit.spawnError, null);
      assert.match(pausedWriterExit.stderr, /RESTAURANT_CONTRACT_MAINTENANCE/);
      assert.match(pausedWriterExit.stderr, /P0001/);
      const pausedFinalState = JSON.parse(await query(`select json_build_object(
        'parents',(select count(*) from public.pos_restaurant_orders where license_id='${LICENSE_ID}'::uuid and local_order_id='bridge-r20-cutover-rate-order'),
        'items',(select count(*) from public.pos_restaurant_order_items where license_id='${LICENSE_ID}'::uuid and local_line_id='bridge-r20-cutover-rate-order-line'),
        'ledger',(select count(*) from public.pos_idempotency_keys where license_id='${LICENSE_ID}'::uuid and idempotency_key='bridge-r20-cutover-rate-order-key'),
        'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='${LICENSE_ID}'::uuid and idempotency_key='bridge-r20-cutover-rate-order-key'),
        'events',(select count(*) from public.pos_sync_events where license_id='${LICENSE_ID}'::uuid and idempotency_key='bridge-r20-cutover-rate-order-key'))::text`));
      assert.deepEqual(pausedFinalState,{parents:0,items:0,ledger:0,proofs:0,events:0},
        'A paused versioned write must not leave business, ledger, proof or sync effects');
      const rateCountAfterPausedError = await query(`select request_count::text from public.pos_rpc_rate_limits
        where license_key='lab-license-a' and device_fingerprint='lab-device-a'
          and rpc_name='pos_upsert_restaurant_order' and scope='POS_WRITE'
          and staff_session_hash=${quote(orderingHash)}`);
      assert.equal(rateCountAfterPausedError,'1',
        'The denied writer transaction must roll back its rate-row increment after transition admission fails');
      const pending = await countPendingSessions(query,[rateHolderName,pauseName,pausedWriterName]);
      assert.equal(pending,0,'The cutover/rate-order scenario must leave no PostgreSQL sessions');
      scenarios.push({
        name:'versioned-cutover-rate-limit-order',
        rateHolderQuerySubmitted:true,
        pauseSetterQuerySubmitted:true,
        contenderQuerySubmitted:true,
        rateWait:{waitEventType:rateWait.waitEventType,waitEvent:rateWait.waitEvent,blockedBy:rateWait.blockedBy},
        transitionWait:{waitEventType:transitionWait.waitEventType,waitEvent:transitionWait.waitEvent,blockedBy:transitionWait.blockedBy},
        releaseOrder:'rate-row holder COMMIT, then exclusive pause COMMIT',
        rateHolderExitCode:rateHolderExit.code,
        pauseExitCode:pauseExit.code,
        contenderExitCode:pausedWriterExit.code,
        contenderSqlstate:'P0001',
        contenderResponse:'RESTAURANT_CONTRACT_MAINTENANCE',
        pausedFinalState,
        rateCountAfterPausedError,
        pendingDatabaseSessions:pending,
        status:'PASS',
      });
    } finally {
      for (const session of [rateHolder,pauseSession,pausedWriter]) {
        if (!session.closed) await session.kill();
      }
      await query(`select private.set_restaurant_transition_policy_v1(false,null,null)`);
      await query(`delete from public.pos_rpc_rate_limits where license_key='lab-license-a'
        and device_fingerprint='lab-device-a' and rpc_name='pos_upsert_restaurant_order'
        and scope='POS_WRITE' and staff_session_hash=${quote(orderingHash)}`);
      await query(`delete from public.license_admin_sessions where id=${quote(orderingSessionId)}::uuid`);
    }
    return scenarios;
  } finally {
    for (const session of sessions) {
      if (!session.closed) await session.kill();
    }
    await query(`delete from public.license_admin_sessions where id='00000000-0000-0000-0000-0000000000f1'::uuid`);
  }
}
