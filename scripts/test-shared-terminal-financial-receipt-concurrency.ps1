param(
  [string]$DatabaseUrl = $env:LANZO_POS_TEST_DATABASE_URL,
  [string]$LicenseKey = $env:LANZO_POS_TEST_LICENSE_KEY,
  [string]$DeviceFingerprint = $env:LANZO_POS_TEST_DEVICE_FINGERPRINT,
  [string]$SecurityToken = $env:LANZO_POS_TEST_SECURITY_TOKEN,
  [string]$StaffSessionToken = $env:LANZO_POS_TEST_STAFF_SESSION_TOKEN,
  [string]$CashSessionId = $env:LANZO_POS_TEST_CASH_SESSION_ID,
  [string]$AllowFinancialMutation = $env:LANZO_POS_TEST_ALLOW_FINANCIAL_MUTATION,
  [string]$DisposableCashSession = $env:LANZO_POS_TEST_DISPOSABLE_CASH_SESSION
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DatabaseUrl) -or $DatabaseUrl -notmatch '(localhost|127\.0\.0\.1)') {
  throw 'LANZO_POS_TEST_DATABASE_URL must target an authorized local PostgreSQL test database (localhost or 127.0.0.1), never production.'
}
if ($AllowFinancialMutation -ne 'YES' -or $DisposableCashSession -ne 'YES') {
  throw 'Set LANZO_POS_TEST_ALLOW_FINANCIAL_MUTATION=YES and LANZO_POS_TEST_DISPOSABLE_CASH_SESSION=YES; an ordinary cash session is never accepted.'
}
foreach ($required in @($LicenseKey, $DeviceFingerprint, $SecurityToken, $CashSessionId)) {
  if ([string]::IsNullOrWhiteSpace($required)) {
    throw 'Set local-only LANZO_POS_TEST_LICENSE_KEY, LANZO_POS_TEST_DEVICE_FINGERPRINT, LANZO_POS_TEST_SECURITY_TOKEN, and LANZO_POS_TEST_CASH_SESSION_ID.'
  }
}
$psql = (Get-Command psql -ErrorAction Stop).Source
$suffix = ([guid]::NewGuid().ToString('N'))
$externalK = "f5ar2-executor-$suffix"
$conflictK = "f5ar2-conflict-$suffix"
$referenceId = "f5ar2-business-effect-$suffix"

function Escape-SqlLiteral([string]$Value) { return $Value.Replace("'", "''") }
function Invoke-Psql([string]$Sql) {
  $output = & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -A -t -q -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return ($output | Out-String).Trim()
}

$lk = Escape-SqlLiteral $LicenseKey
$df = Escape-SqlLiteral $DeviceFingerprint
$st = Escape-SqlLiteral $SecurityToken
$ss = Escape-SqlLiteral $StaffSessionToken
$session = Escape-SqlLiteral $CashSessionId
try {
  # The caller supplies an already-open, disposable local-test cash session.
  # Every fixture written below has this UUID-derived suffix and is removed in
  # finally; no production URL is accepted.
  $originSql = "select (private.validate_pos_sync_context('$lk','$df','$st',nullif('$ss','')) ->> 'license_id') || '|' || private.resolve_cash_actor_key(private.validate_pos_sync_context('$lk','$df','$st',nullif('$ss',''))) || '|' || coalesce((select cash_station_id from public.pos_cash_sessions where id='$session' and deleted_at is null),'');"
  $origin = (Invoke-Psql $originSql).Split('|', 3)
  if ($origin.Count -ne 3 -or [string]::IsNullOrWhiteSpace($origin[0]) -or [string]::IsNullOrWhiteSpace($origin[1])) { throw 'Local test auth/session fixture is invalid.' }
  $licenseId, $actorKey, $stationId = $origin
  $baseline = Invoke-Psql "select coalesce(cash_entries_total,0)::text || '|' || coalesce(cash_exits_total,0)::text || '|' || coalesce(expected_cash_total,0)::text || '|' || server_version::text || '|' || updated_at::text || '|' || coalesce(last_idempotency_key,'') from public.pos_cash_sessions where license_id='$licenseId'::uuid and id='$session' and metadata->>'financial_test_disposable'='true';"
  if ([string]::IsNullOrWhiteSpace($baseline)) { throw 'Cash session must be explicitly marked metadata.financial_test_disposable=true.' }
  $requestSql = "jsonb_build_object('cash_session_id','$session','type','entrada','amount','1.00','concept','F5A R2 public executor concurrency','source','test','reference_type','f5a-r2','reference_id','$referenceId')"
  $hashSql = "select private.financial_operation_hash('cash.movement',$requestSql,'$(Escape-SqlLiteral $actorKey)','$session',nullif('$(Escape-SqlLiteral $stationId)',''));"
  $hash = Invoke-Psql $hashSql
  $callSql = "select public.pos_execute_financial_operation_v1('$lk','$df','$st',nullif('$ss',''),'$externalK','$hash','cash.movement',$requestSql);"

  # T1 uses the real public executor.  The barrier observes the exact V1
  # tenant/K advisory lock, rather than assuming that a timer means T1 started.
  $t1 = Start-Job -ArgumentList $psql, $DatabaseUrl, $callSql -ScriptBlock {
    param($PsqlPath, $Url, $Sql)
    & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -c "begin; $Sql select pg_sleep(2); commit;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'T1 public executor failed' }
  }
  $lockSql = "select not pg_try_advisory_xact_lock(hashtextextended('$licenseId:$externalK',9152026));"
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  do { $locked = Invoke-Psql $lockSql } while ($locked -ne 't' -and $deadline.Elapsed.TotalSeconds -lt 10)
  if ($locked -ne 't') { throw 'Deterministic V1 advisory-lock barrier was not reached.' }
  $sameResult = Invoke-Psql $callSql
  Receive-Job -Job $t1 -Wait -AutoRemoveJob | Out-Null
  if ($sameResult -notmatch $externalK) { throw 'Same K/H did not return the public financial receipt.' }
  $movementCount = Invoke-Psql "select count(*) from public.pos_cash_movements where license_id='$licenseId'::uuid and metadata->>'reference_id'='$referenceId' and deleted_at is null;"
  if ($movementCount -ne '1') { throw "Same K/H replay business-effect count was $movementCount, expected 1." }

  # A second public-executor race uses the same K but distinct canonical H.
  $otherRequestSql = "jsonb_build_object('cash_session_id','$session','type','entrada','amount','2.00','concept','F5A R2 public executor concurrency','source','test','reference_type','f5a-r2','reference_id','$referenceId-conflict')"
  $otherHash = Invoke-Psql "select private.financial_operation_hash('cash.movement',$otherRequestSql,'$(Escape-SqlLiteral $actorKey)','$session',nullif('$(Escape-SqlLiteral $stationId)',''));"
  $firstConflictCall = "select public.pos_execute_financial_operation_v1('$lk','$df','$st',nullif('$ss',''),'$conflictK','$hash','cash.movement',$requestSql);"
  $t2 = Start-Job -ArgumentList $psql, $DatabaseUrl, $firstConflictCall -ScriptBlock {
    param($PsqlPath, $Url, $Sql)
    & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -c "begin; $Sql select pg_sleep(2); commit;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'T2 public executor failed' }
  }
  $lockConflictSql = "select not pg_try_advisory_xact_lock(hashtextextended('$licenseId:$conflictK',9152026));"
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  do { $locked = Invoke-Psql $lockConflictSql } while ($locked -ne 't' -and $deadline.Elapsed.TotalSeconds -lt 10)
  if ($locked -ne 't') { throw 'Deterministic conflict advisory-lock barrier was not reached.' }
  $conflictOutput = & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -A -t -q -c "select public.pos_execute_financial_operation_v1('$lk','$df','$st',nullif('$ss',''),'$conflictK','$otherHash','cash.movement',$otherRequestSql);" 2>&1
  Receive-Job -Job $t2 -Wait -AutoRemoveJob | Out-Null
  if ($LASTEXITCODE -eq 0 -or ($conflictOutput | Out-String) -notmatch 'IDEMPOTENCY_CONFLICT') { throw 'Same K/different H did not fail closed through the public executor.' }
  Write-Output 'shared terminal financial receipt concurrency: PASS'
}
finally {
  if ($licenseId) {
    $internalKeys = Invoke-Psql "select string_agg(quote_literal(legacy_idempotency_key), ',') from public.pos_financial_operations where license_id='$licenseId'::uuid and idempotency_key in ('$externalK','$conflictK');"
    $movementIds = Invoke-Psql "select string_agg(quote_literal(id), ',') from public.pos_cash_movements where license_id='$licenseId'::uuid and metadata->>'reference_id' in ('$referenceId','$referenceId-conflict');"
    $baselineParts = $baseline.Split('|', 6)
    # Exact disposable-fixture cleanup: movement/audit/sync/idempotency rows,
    # followed by the captured financial session baseline restoration.
    $cleanupSql = "delete from public.pos_cash_audit_events where license_id='$licenseId'::uuid and cash_session_id='$session' and payload->>'movement_id' in ($movementIds); delete from public.pos_sync_events where license_id='$licenseId'::uuid and idempotency_key in ($internalKeys); delete from public.pos_financial_operations where license_id='$licenseId'::uuid and idempotency_key in ('$externalK','$conflictK'); delete from public.pos_idempotency_keys where license_id='$licenseId'::uuid and idempotency_key in ($internalKeys); delete from public.pos_cash_movements where license_id='$licenseId'::uuid and id in ($movementIds); update public.pos_cash_sessions set cash_entries_total='$($baselineParts[0])'::numeric, cash_exits_total='$($baselineParts[1])'::numeric, expected_cash_total='$($baselineParts[2])'::numeric, server_version='$($baselineParts[3])'::integer, updated_at='$($baselineParts[4])'::timestamptz, last_idempotency_key=nullif('$($baselineParts[5])','') where license_id='$licenseId'::uuid and id='$session';"
    & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -q -c $cleanupSql
    $remaining = Invoke-Psql "select (select count(*) from public.pos_cash_movements where license_id='$licenseId'::uuid and metadata->>'reference_id' in ('$referenceId','$referenceId-conflict')) || '|' || (select count(*) from public.pos_financial_operations where license_id='$licenseId'::uuid and idempotency_key in ('$externalK','$conflictK')) || '|' || (select count(*) from public.pos_cash_audit_events where license_id='$licenseId'::uuid and cash_session_id='$session' and payload->>'movement_id' in ($movementIds));"
    if ($remaining -ne '0|0|0') { throw "Disposable fixture cleanup assertion failed: $remaining" }
  }
}
