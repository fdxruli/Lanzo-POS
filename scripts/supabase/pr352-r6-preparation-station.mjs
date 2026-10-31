import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const LICENSE_A = '00000000-0000-0000-0000-000000000001';
const LICENSE_B = '00000000-0000-0000-0000-000000000002';
const DEVICE_A = '00000000-0000-0000-0000-00000000000a';
const DEVICE_B = '00000000-0000-0000-0000-00000000000b';
const STAFF_A = '00000000-0000-0000-0000-0000000000ab';
const BARRIER_KEY_A = 824452;
const BARRIER_KEY_B = 352;
const WORKER_NAMES = ['pr352-r6-station-worker-a', 'pr352-r6-station-worker-b'];
const CONTROLLER_NAME = 'pr352-r6-station-barrier-controller';

function quote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function startPsqlSession(name, psqlBin, baseEnv) {
  const child = spawn(psqlBin, [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1',
    '-p', baseEnv.PGPORT || '5432',
    '-U', baseEnv.PGUSER || 'postgres',
    '-d', 'pr352_bridge_isolated',
  ], {
    env: {
      ...baseEnv,
      PGHOST: '127.0.0.1',
      PGDATABASE: 'pr352_bridge_isolated',
      PGAPPNAME: name,
      PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=15000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let closed = false;
  let inputEnded = false;
  let processError = null;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.on('error', (error) => { processError ||= error; });
  child.stdin.on('error', (error) => { processError ||= error; });
  child.on('close', () => { closed = true; });

  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, processError }));
    child.once('error', (error) => resolve({ code: null, signal: null, processError: error }));
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
      if (processError) throw new Error(`psql ${name} failed before SQL submission: ${processError.message}`);
      if (closed || child.stdin.destroyed || !child.stdin.writable) {
        throw new Error(`psql ${name} is not writable`);
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
      if (!closed) throw new Error(`could not terminate psql session ${name}`);
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
    throw new Error(`bounded psql completion timeout: ${session.name}; stderr=${session.stderr}`);
  }
  if (result.processError) {
    throw new Error(`psql process error in ${session.name}: ${result.processError.message}; stderr=${session.stderr}`);
  }
  return { ...result, stdout: session.stdout, stderr: session.stderr };
}

async function waitForObserved(description, query, predicate, timeoutMs = 10000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await query();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`bounded PostgreSQL observation timed out for ${description}; latest=${JSON.stringify(latest)}`);
}

function stationStateSql(licenseId) {
  return `select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'licenseId',license_id,'code',code,'name',name,'nameKey',name_key,
    'sortOrder',sort_order,'isDefault',is_default,'isActive',is_active,
    'createdAt',created_at,'updatedAt',updated_at,'deletedAt',deleted_at,'lastIdempotencyKey',last_idempotency_key,
    'serverVersion',server_version,'createdByDeviceId',created_by_device_id,
    'updatedByDeviceId',updated_by_device_id,'createdByStaffUserId',created_by_staff_user_id,
    'updatedByStaffUserId',updated_by_staff_user_id,'metadata',metadata
  ) order by id),'[]'::jsonb)::text
  from public.pos_preparation_stations where license_id=${quote(licenseId)}::uuid and deleted_at is null`;
}

export async function runPreparationStationBehavior({ query, runSql, psqlBin, env }) {
  const results = [];
  const createdRows = JSON.parse(await query(stationStateSql(LICENSE_A)));
  assert.equal(createdRows.length, 1, 'The authentic Staff writer must create one Kitchen station');
  const created = createdRows[0];
  assert.match(created.id, /^station_kitchen_[0-9a-f]{32}$/);
  assert.equal(created.code, 'kitchen');
  assert.equal(created.name, 'Cocina');
  assert.equal(created.nameKey, 'cocina');
  assert.equal(created.sortOrder, 0);
  assert.equal(created.isDefault, true);
  assert.equal(created.isActive, true);
  assert.equal(created.serverVersion, 1);
  assert.equal(created.createdByDeviceId, DEVICE_B);
  assert.equal(created.updatedByDeviceId, DEVICE_B);
  assert.equal(created.createdByStaffUserId, STAFF_A);
  assert.equal(created.updatedByStaffUserId, STAFF_A);
  assert.deepEqual(created.metadata, { phase: 'REST.1', bootstrap: true });
  const itemResolution = JSON.parse(await query(`select jsonb_build_object(
    'stationCode',station_code,'stationName',station_name
  )::text from public.pos_restaurant_order_items where restaurant_order_id='bridge-staff-owned-parent'`));
  assert.deepEqual(itemResolution, { stationCode: 'kitchen', stationName: 'Cocina' });
  results.push({
    name: 'A/G: first authenticated Staff write creates and attributes Kitchen',
    status: 'PASS',
    stationId: created.id,
    count: createdRows.length,
    actor: { deviceId: created.createdByDeviceId, staffUserId: created.createdByStaffUserId },
    persistedOrderItemStation: itemResolution,
  });

  const beforeReuse = JSON.parse(JSON.stringify(created));
  const ensureSql = `select (private.ensure_default_preparation_station(${quote(LICENSE_A)}::uuid,${quote(DEVICE_B)}::uuid,${quote(STAFF_A)}::uuid)).id`;
  assert.equal(await query(ensureSql), created.id, 'Active station reuse must return the same row');
  const afterReuse = JSON.parse(await query(stationStateSql(LICENSE_A)));
  assert.equal(afterReuse.length, 1, 'Active station reuse must not insert a duplicate');
  assert.deepEqual(afterReuse[0], beforeReuse, 'An already valid active station must not be rewritten');
  const resolvedFallback = JSON.parse(await query(`select private.resolve_restaurant_order_station(
    ${quote(LICENSE_A)}::uuid,'unknown-station','Salón alterno',${quote(DEVICE_B)}::uuid,${quote(STAFF_A)}::uuid)::text`));
  assert.deepEqual(resolvedFallback, { code: 'kitchen', name: 'Salón alterno' },
    'Unknown station codes must use the authentic Kitchen fallback while retaining the requested label');
  results.push({
    name: 'B: active station reuse and authentic resolver fallback',
    status: 'PASS',
    stationId: afterReuse[0].id,
    duplicateCount: afterReuse.length,
    resolver: resolvedFallback,
  });

  const previousVersion = afterReuse[0].serverVersion;
  await runSql(`update public.pos_preparation_stations
    set is_active=false, sort_order=9
    where license_id=${quote(LICENSE_A)}::uuid and code='kitchen' and deleted_at is null;`, 'station-reactivation-seed');
  await query(`select (private.ensure_default_preparation_station(${quote(LICENSE_A)}::uuid,${quote(DEVICE_A)}::uuid,NULL::uuid)).id`);
  const reactivated = JSON.parse(await query(stationStateSql(LICENSE_A)));
  assert.equal(reactivated.length, 1);
  assert.equal(reactivated[0].id, created.id);
  assert.equal(reactivated[0].isActive, true);
  assert.equal(reactivated[0].isDefault, true);
  assert.equal(reactivated[0].sortOrder, 0);
  assert.equal(reactivated[0].serverVersion, previousVersion + 1);
  assert.equal(reactivated[0].updatedByDeviceId, DEVICE_A);
  assert.equal(reactivated[0].updatedByStaffUserId, null);
  results.push({
    name: 'C: inactive station reactivation',
    status: 'PASS',
    stationId: reactivated[0].id,
    serverVersion: reactivated[0].serverVersion,
    updatedByDeviceId: reactivated[0].updatedByDeviceId,
    updatedByStaffUserId: reactivated[0].updatedByStaffUserId,
  });

  await runSql(`update public.pos_preparation_stations
    set name=' Cocina ', name_key='custom-key', sort_order=7, is_default=false,
        metadata='{"custom":"preserve","phase":"legacy"}'::jsonb
    where license_id=${quote(LICENSE_A)}::uuid and code='kitchen' and deleted_at is null;`, 'station-incomplete-metadata-seed');
  await query(ensureSql);
  const repaired = JSON.parse(await query(stationStateSql(LICENSE_A)));
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, created.id);
  assert.equal(repaired[0].name, 'Cocina');
  assert.equal(repaired[0].nameKey, 'cocina');
  assert.equal(repaired[0].sortOrder, 0);
  assert.equal(repaired[0].isDefault, true);
  assert.equal(repaired[0].isActive, true);
  assert.equal(repaired[0].serverVersion, previousVersion + 2);
  assert.deepEqual(repaired[0].metadata, { custom: 'preserve', phase: 'legacy' },
    'The Production function does not synthesize bootstrap metadata; caller metadata must remain intact');
  assert.equal(repaired[0].updatedByDeviceId, DEVICE_B);
  assert.equal(repaired[0].updatedByStaffUserId, STAFF_A);
  results.push({
    name: 'D: incomplete station fields repaired without rewriting metadata',
    status: 'PASS',
    stationId: repaired[0].id,
    metadata: repaired[0].metadata,
    updatedBy: { deviceId: repaired[0].updatedByDeviceId, staffUserId: repaired[0].updatedByStaffUserId },
  });
  const licenseAStateBeforeOtherLicense = JSON.parse(JSON.stringify(repaired[0]));

  const workerSessions = [];
  let controller = null;
  let lockObservation = null;
  let released = false;
  try {
    await runSql(`create or replace function private.pr352_r6_station_insert_barrier_v1()
      returns trigger language plpgsql set search_path to '' as $barrier$
      begin perform pg_advisory_xact_lock(${BARRIER_KEY_A},${BARRIER_KEY_B}); return new; end;
      $barrier$;
      create trigger pr352_r6_station_insert_barrier_v1
        before insert on public.pos_preparation_stations
        for each row execute function private.pr352_r6_station_insert_barrier_v1();`, 'station-concurrency-barrier-setup');

    controller = startPsqlSession(CONTROLLER_NAME, psqlBin, env);
    controller.send('BEGIN;');
    controller.send(`SELECT pg_advisory_xact_lock(${BARRIER_KEY_A},${BARRIER_KEY_B});`);
    const controllerLock = await waitForObserved('granted station barrier lock',
      async () => JSON.parse(await query(`select coalesce(json_agg(json_build_object(
        'granted',l.granted,'mode',l.mode,'locktype',l.locktype,'pid',l.pid
      ) order by l.pid),'[]'::json)::text
      from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where a.application_name=${quote(CONTROLLER_NAME)} and l.locktype='advisory'`)),
      (rows) => rows.some((row) => row.granted === true && row.mode === 'ExclusiveLock'));
    assert.ok(controllerLock.some((row) => row.granted === true));

    const concurrentSql = `select (private.ensure_default_preparation_station(${quote(LICENSE_B)}::uuid,NULL::uuid,NULL::uuid)).id;`;
    for (const name of WORKER_NAMES) {
      const worker = startPsqlSession(name, psqlBin, env);
      workerSessions.push(worker);
      worker.send(concurrentSql);
      worker.finish();
    }
    lockObservation = await waitForObserved('both independent station writers waiting at PostgreSQL advisory barrier',
      async () => JSON.parse(await query(`select coalesce(json_agg(json_build_object(
        'applicationName',a.application_name,'state',a.state,'waitEventType',a.wait_event_type,
        'waitEvent',a.wait_event,'queryText',left(a.query,220),'lockGranted',l.granted,'lockMode',l.mode
      ) order by a.application_name),'[]'::json)::text
      from pg_stat_activity a join pg_locks l on l.pid=a.pid
      where a.application_name in (${WORKER_NAMES.map(quote).join(',')})
        and l.locktype='advisory' and not l.granted`)),
      (rows) => rows.length === 2
        && rows.every((row) => row.state === 'active'
          && row.waitEventType === 'Lock'
          && row.waitEvent === 'advisory'
          && row.queryText.includes('ensure_default_preparation_station')));
    assert.equal(lockObservation.length, 2, 'Both independent PostgreSQL sessions must be observed blocked after SQL submission');

    controller.finish('COMMIT;');
    released = true;
    const exits = await Promise.all(workerSessions.map((worker) => waitForSessionExit(worker, 15000)));
    const controllerExit = await waitForSessionExit(controller, 5000);
    assert.equal(controllerExit.code, 0, `Barrier controller must commit and exit cleanly: ${controllerExit.stderr}`);
    assert.equal(controllerExit.signal, null, 'Barrier controller must not be signal-terminated');
    for (const [index, exit] of exits.entries()) {
      assert.equal(exit.code, 0, `${WORKER_NAMES[index]} must complete successfully: ${exit.stderr}`);
      assert.equal(exit.signal, null, `${WORKER_NAMES[index]} must not be signal-terminated`);
      assert.equal(exit.stderr.trim(), '', `${WORKER_NAMES[index]} must not hide PostgreSQL errors`);
    }
    const stationIds = exits.map((exit) => exit.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.ok(stationIds[0], 'The first session must return its inserted station id');
    assert.deepEqual(stationIds, [stationIds[0], stationIds[0]], 'Concurrent callers must return the same winning station');
    const concurrentRows = JSON.parse(await query(stationStateSql(LICENSE_B)));
    assert.equal(concurrentRows.length, 1, 'Concurrent inserts must leave exactly one Kitchen station for license B');
    assert.equal(concurrentRows[0].id, stationIds[0]);
    results.push({
      name: 'E: concurrent creation, independent psql sessions',
      status: 'PASS',
      sql: concurrentSql,
      sessions: WORKER_NAMES,
      sqlSubmittedAndObserved: true,
      observation: lockObservation,
      controllerLock: controllerLock[0],
      release: 'controller COMMIT; transaction-scoped advisory barrier released only after both writers were observed waiting',
      controllerExit: { code: controllerExit.code, signal: controllerExit.signal, stderr: controllerExit.stderr },
      exits: exits.map(({ code, signal, stderr }) => ({ code, signal, stderr })),
      returnedStationIds: stationIds,
      finalStationCount: concurrentRows.length,
      sqlstate: null,
      pendingSessionCount: Number(await query(`select count(*) from pg_stat_activity
        where application_name in (${[...WORKER_NAMES, CONTROLLER_NAME].map(quote).join(',')})`)),
    });
  } finally {
    if (controller && !controller.closed && !controller.inputEnded) {
      try { controller.finish('ROLLBACK;'); } catch { await controller.kill(); }
    }
    await Promise.all(workerSessions.filter((session) => !session.closed).map(async (session) => {
      try { await waitForSessionExit(session, 3000); } catch { await session.kill(); }
    }));
    if (controller && !controller.closed) {
      try { await waitForSessionExit(controller, 3000); } catch { await controller.kill(); }
    }
    if (!released && controller && !controller.closed) await controller.kill();
    await runSql(`drop trigger if exists pr352_r6_station_insert_barrier_v1 on public.pos_preparation_stations;
      drop function if exists private.pr352_r6_station_insert_barrier_v1();`, 'station-concurrency-barrier-cleanup');
  }
  const pendingConcurrencySessions = Number(await query(`select count(*) from pg_stat_activity
    where application_name in (${[...WORKER_NAMES, CONTROLLER_NAME].map(quote).join(',')})`));
  assert.equal(pendingConcurrencySessions, 0, 'No concurrency helper sessions may survive the station test');
  assert.equal(await query(`select count(*) from pg_trigger where tgname='pr352_r6_station_insert_barrier_v1' and not tgisinternal`), '0',
    'The temporary concurrency barrier must be removed from the disposable schema');
  assert.equal(await query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='pr352_r6_station_insert_barrier_v1'`), '0',
    'The temporary trigger helper must be removed from the disposable schema');

  const crossLicenseBefore = JSON.parse(await query(stationStateSql(LICENSE_A)));
  const otherLicenseRows = JSON.parse(await query(stationStateSql(LICENSE_B)));
  assert.equal(crossLicenseBefore.length, 1);
  assert.equal(otherLicenseRows.length, 1);
  assert.equal(crossLicenseBefore[0].id, created.id);
  assert.equal(crossLicenseBefore[0].licenseId, LICENSE_A);
  assert.deepEqual(crossLicenseBefore[0], licenseAStateBeforeOtherLicense,
    'Creating the other license station must leave every field of license A unchanged');
  assert.equal(otherLicenseRows[0].licenseId, LICENSE_B);
  results.push({
    name: 'F: different licenses keep distinct default stations',
    status: 'PASS',
    licenseAStationId: crossLicenseBefore[0].id,
    licenseBStationId: otherLicenseRows[0].id,
    counts: { licenseA: crossLicenseBefore.length, licenseB: otherLicenseRows.length },
  });

  await runSql(`delete from public.pos_preparation_stations where license_id=${quote(LICENSE_B)}::uuid;
    do $rollback$
    declare v_state text; v_message text;
    begin
      begin
        perform private.ensure_default_preparation_station(${quote(LICENSE_B)}::uuid,NULL::uuid,NULL::uuid);
        raise exception 'R6_STATION_ROLLBACK_PROBE' using errcode='P0001';
      exception when others then
        get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
        if v_state<>'P0001' or v_message<>'R6_STATION_ROLLBACK_PROBE' then raise; end if;
      end;
      if exists(select 1 from public.pos_preparation_stations where license_id=${quote(LICENSE_B)}::uuid) then
        raise exception 'R6_STATION_ROLLBACK_LEFT_PERSISTENT_ROW';
      end if;
    end $rollback$;`, 'station-operation-rollback');
  assert.equal(await query(`select count(*) from public.pos_preparation_stations where license_id=${quote(LICENSE_B)}::uuid`), '0');
  assert.deepEqual(JSON.parse(await query(stationStateSql(LICENSE_A)))[0], licenseAStateBeforeOtherLicense,
    'The rollback scenario for license B must not alter the station belonging to license A');
  results.push({
    name: 'H: failed transaction rolls back station initialization',
    status: 'PASS',
    deliberateSqlstate: 'P0001',
    finalStationCount: 0,
  });

  return results;
}
