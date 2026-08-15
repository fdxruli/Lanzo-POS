param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [Parameter(Mandatory = $true)][string]$ExpectedDatabase,
  [int]$HoldSeconds = 4
)

# CONCURRENCY TEST — ISOLATED DATABASE — CLEANUP GUARANTEED.
# This intentionally commits inside two independent sessions so the competing
# session can observe the committed state. It must never target production.
$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw 'DATABASE_URL is required.'
}
if ($env:LANZO_ISOLATED_POSTGRES -ne '1') {
  throw 'Set LANZO_ISOLATED_POSTGRES=1 to explicitly acknowledge an isolated database.'
}
if ($ExpectedDatabase -notmatch '^(?i)(?!.*prod)(?=.*(test|local|ephemeral|ci|tmp))[a-z0-9_]+$') {
  throw 'ExpectedDatabase must be a non-production test/local/ephemeral database name.'
}
if ($HoldSeconds -lt 2 -or $HoldSeconds -gt 30) {
  throw 'HoldSeconds must be between 2 and 30.'
}

try { $databaseUri = [Uri]$DatabaseUrl } catch { throw 'DATABASE_URL must be a valid PostgreSQL URL.' }
if ($databaseUri.Scheme -notin @('postgres', 'postgresql')) {
  throw 'DATABASE_URL must use postgres or postgresql.'
}
if ($databaseUri.Host -notin @('localhost', '127.0.0.1', '::1')) {
  throw 'Refusing a non-loopback PostgreSQL host. Use a local isolated database only.'
}

$psql = (Get-Command psql -ErrorAction Stop).Source
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("lanzo-cash-close-concurrency-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

$runId = [Guid]::NewGuid().ToString('N')
$licenseId = [Guid]::NewGuid().ToString()
$adminUserId = [Guid]::NewGuid().ToString()
$deviceId = [Guid]::NewGuid().ToString()
$adminSessionId = [Guid]::NewGuid().ToString()
$licenseKey = "TEST-CASH-CONCURRENCY-$runId"
$fingerprint = "cash-concurrency-device-$runId"
$deviceToken = "cash-concurrency-device-token-$runId"
$adminToken = "cash-concurrency-admin-token-$runId"
$sessionA = "cash-concurrency-sale-first-$runId"
$sessionB = "cash-concurrency-close-first-$runId"
$saleA = "sale-concurrency-sale-first-$runId"
$saleB = "sale-concurrency-close-first-$runId"

function Write-SqlFile {
  param([string]$Name, [string]$Sql)
  $path = Join-Path $tempRoot $Name
  [IO.File]::WriteAllText($path, $Sql, [Text.UTF8Encoding]::new($false))
  return $path
}

function Invoke-PsqlText {
  param([string]$Sql, [string]$Name = 'sync.sql')
  $path = Write-SqlFile -Name $Name -Sql $Sql
  $output = & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -A -t -q -f $path 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $Name`n$($output | Out-String)" }
  return ($output | Out-String).Trim()
}

function Start-PsqlSession {
  param([string]$Sql, [string]$Name)
  $path = Write-SqlFile -Name $Name -Sql $Sql
  return Start-Job -ScriptBlock {
    param($PsqlPath, $Url, $SqlPath)
    $result = & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -f $SqlPath 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result | Out-String) }
    $result
  } -ArgumentList $psql, $DatabaseUrl, $path
}

function Receive-PsqlSession {
  param($Job, [string]$Name)
  Wait-Job $Job | Out-Null
  if ($Job.State -ne 'Completed') {
    $failure = Receive-Job $Job -ErrorAction SilentlyContinue | Out-String
    Remove-Job $Job -Force -ErrorAction SilentlyContinue
    throw "$Name failed with state $($Job.State)`n$failure"
  }
  $text = (Receive-Job $Job | Out-String).Trim()
  Remove-Job $Job -Force
  return $text
}

$cleanupSql = @"
begin;
delete from public.pos_sync_events where license_id='$licenseId'::uuid;
delete from public.pos_sale_audit_events where license_id='$licenseId'::uuid;
delete from public.pos_sales where license_id='$licenseId'::uuid;
delete from public.pos_cash_movements where license_id='$licenseId'::uuid;
delete from public.pos_cash_audit_events where license_id='$licenseId'::uuid;
delete from public.pos_idempotency_keys where license_id='$licenseId'::uuid;
delete from public.pos_cash_sessions where license_id='$licenseId'::uuid;
delete from public.license_admin_sessions where license_id='$licenseId'::uuid;
delete from public.license_devices where license_id='$licenseId'::uuid;
delete from public.license_admin_users where license_id='$licenseId'::uuid;
delete from public.pos_rpc_rate_limits where license_key='$licenseKey';
delete from public.licenses where id='$licenseId'::uuid;
commit;
select 'CLEANUP|sessions=' || (select count(*) from public.pos_cash_sessions where license_id='$licenseId'::uuid)
  || '|sales=' || (select count(*) from public.pos_sales where license_id='$licenseId'::uuid)
  || '|movements=' || (select count(*) from public.pos_cash_movements where license_id='$licenseId'::uuid)
  || '|audits=' || (select count(*) from public.pos_cash_audit_events where license_id='$licenseId'::uuid)
  || '|sync=' || (select count(*) from public.pos_sync_events where license_id='$licenseId'::uuid);
"@

$setupSql = @"
begin;
insert into public.licenses(id,license_key,license_type,status,expires_at,max_devices,product_name,features,plan_id)
values('$licenseId'::uuid,'$licenseKey','pro','active',clock_timestamp()+interval '1 day',2,'Cash concurrency fixture',
  '{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true}'::jsonb,
  (select id from public.plans where code='pro_monthly' limit 1));
insert into public.license_admin_users(id,license_id,username,display_name,password_hash,is_owner,is_active)
values('$adminUserId'::uuid,'$licenseId'::uuid,'cash_concurrency_$runId','Cash concurrency owner',extensions.crypt('password-$runId',extensions.gen_salt('bf',4)),true,true);
insert into public.license_devices(id,license_id,device_fingerprint,device_name,security_token,is_active,device_role)
values('$deviceId'::uuid,'$licenseId'::uuid,'$fingerprint','Cash concurrency device','$deviceToken',true,'admin');
insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
values('$adminSessionId'::uuid,'$licenseId'::uuid,'$adminUserId'::uuid,'$deviceId'::uuid,extensions.crypt('$adminToken',extensions.gen_salt('bf',4)),clock_timestamp()+interval '1 hour');
insert into public.pos_cash_sessions(id,license_id,device_id,admin_user_id,device_role,actor_key,status,opening_amount,expected_cash_total,responsible_name,server_version)
values('$sessionA','$licenseId'::uuid,'$deviceId'::uuid,'$adminUserId'::uuid,'admin','admin:$adminUserId','open',1196,1196,'Cash concurrency owner',1);
commit;
"@

$setupCaseB = @"
insert into public.pos_cash_sessions(id,license_id,device_id,admin_user_id,device_role,actor_key,status,opening_amount,expected_cash_total,responsible_name,server_version)
values('$sessionB','$licenseId'::uuid,'$deviceId'::uuid,'$adminUserId'::uuid,'admin','admin:$adminUserId','open',1196,1196,'Cash concurrency owner',1);
"@

$saleAJson = "jsonb_build_object('id','$saleA','local_sale_id','$saleA','total',30,'subtotal',30,'amount_paid',30,'payment_method','cash')"
$saleAItems = "jsonb_build_array(jsonb_build_object('id','$saleA-item','product_name','Venta concurrente','quantity',1,'unit_price',30,'line_total',30))"
$saleAPayments = "jsonb_build_array(jsonb_build_object('id','$saleA-payment','method','cash','amount',30,'received_amount',30,'change_amount',0))"
$saleBJson = "jsonb_build_object('id','$saleB','local_sale_id','$saleB','total',30,'subtotal',30,'amount_paid',30,'payment_method','cash')"
$saleBItems = "jsonb_build_array(jsonb_build_object('id','$saleB-item','product_name','Venta bloqueada','quantity',1,'unit_price',30,'line_total',30))"
$saleBPayments = "jsonb_build_array(jsonb_build_object('id','$saleB-payment','method','cash','amount',30,'received_amount',30,'change_amount',0))"

try {
  $identity = Invoke-PsqlText -Name 'guardrail.sql' -Sql "select current_database() || '|' || current_user || '|' || coalesce(inet_server_addr()::text,'local');"
  $identityParts = $identity.Split('|')
  Assert-True ($identityParts.Length -eq 3 -and $identityParts[0] -eq $ExpectedDatabase) "Connected database does not match ExpectedDatabase: $($identityParts[0])"
  Invoke-PsqlText -Sql $setupSql -Name 'setup.sql' | Out-Null

  # Case A: sale owns the session row lock. Close must wait and then observe 1196 + 30.
  $saleJob = Start-PsqlSession -Name 'case-a-sale.sql' -Sql @"
begin;
select 'CASE_A_SALE|' || (r #>> '{success}') || '|' || (r #>> '{cash_session,expected_cash_total}')
from (select public.pos_create_cloud_sale_cashier('$licenseKey','$fingerprint','$deviceToken','$adminToken',$saleAJson,$saleAItems,$saleAPayments,'$sessionA','case-a-sale-$runId') r) x;
select pg_sleep($HoldSeconds);
commit;
"@
  Start-Sleep -Milliseconds 700
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $closeJob = Start-PsqlSession -Name 'case-a-close.sql' -Sql @"
begin;
select 'CASE_A_CLOSE|' || (r #>> '{success}') || '|' || (r #>> '{cash_session,expected_cash_total}') || '|' || (r #>> '{cash_session,cash_difference}')
from (select public.pos_admin_close_cash_session('$licenseKey','$fingerprint','$deviceToken','$adminToken','$sessionA','admin_audited',1226,0,'operational_error','Concurrent sale committed first.',2,'case-a-close-$runId') r) x;
commit;
"@
  $closeOutput = Receive-PsqlSession -Job $closeJob -Name 'Case A close'
  $watch.Stop()
  $saleOutput = Receive-PsqlSession -Job $saleJob -Name 'Case A sale'
  Assert-True ($watch.Elapsed.TotalSeconds -ge ($HoldSeconds - 1.5)) "CASE A close did not wait for the sale lock: $($watch.Elapsed.TotalSeconds)s"
  Assert-True ($saleOutput -match 'CASE_A_SALE\|true\|1226') "CASE A sale failed: $saleOutput"
  Assert-True ($closeOutput -match 'CASE_A_CLOSE\|true\|1226\|0') "CASE A close did not observe expected 1226: $closeOutput"
  $caseAVerify = Invoke-PsqlText -Name 'case-a-verify.sql' -Sql @"
select 'CASE_A_VERIFY|'
  || (select count(*) from public.pos_sales where id='$saleA')
  || '|' || (select count(*) from public.pos_cash_movements where license_id='$licenseId'::uuid and sale_id='$saleA')
  || '|' || (select expected_cash_total::text from public.pos_cash_sessions where id='$sessionA')
  || '|' || (select close_detail->>'expected_cash_total' from public.pos_cash_sessions where id='$sessionA')
  || '|' || (select status from public.pos_cash_sessions where id='$sessionA')
  || '|' || (select count(*) from public.pos_cash_audit_events where cash_session_id='$sessionA' and event_type='ADMIN_CLOSED_AUDITED')
  || '|' || (select count(*) from public.pos_sync_events where entity_type='cash_session' and entity_id='$sessionA' and operation='close')
  || '|' || (select cash_sales_total::text from public.pos_cash_sessions where id='$sessionA');
"@
  Assert-True ($caseAVerify -match 'CASE_A_VERIFY\|1\|1\|1226\|1226\|closed\|1\|1\|30') "CASE A financial state is incoherent: $caseAVerify"
  Write-Host 'CASE A: SALE -> CLOSE | LOCK WAIT: PASS | CLOSE EXPECTED: 1226 | RESULT: PASS'

  Invoke-PsqlText -Sql $setupCaseB -Name 'setup-case-b.sql' | Out-Null

  # Case B: close owns the session row lock. Sale waits, then the real RPC rejects the closed session.
  $closeFirstJob = Start-PsqlSession -Name 'case-b-close.sql' -Sql @"
begin;
select 'CASE_B_CLOSE|' || (r #>> '{success}') || '|' || (r #>> '{cash_session,status}')
from (select public.pos_admin_close_cash_session('$licenseKey','$fingerprint','$deviceToken','$adminToken','$sessionB','admin_audited',1196,0,'operational_error','Concurrent close committed first.',1,'case-b-close-$runId') r) x;
select pg_sleep($HoldSeconds);
commit;
"@
  Start-Sleep -Milliseconds 700
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $saleAfterCloseJob = Start-PsqlSession -Name 'case-b-sale.sql' -Sql @"
begin;
do `$test`$
begin
  begin
    perform public.pos_create_cloud_sale_cashier('$licenseKey','$fingerprint','$deviceToken','$adminToken',$saleBJson,$saleBItems,$saleBPayments,'$sessionB','case-b-sale-$runId');
    raise exception 'SALE_ACCEPTED_AFTER_CLOSE';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_NOT_OPEN' then raise; end if;
    raise notice 'CASE_B_SALE_REJECTED|%', sqlerrm;
  end;
end;
`$test`$;
commit;
"@
  $saleAfterCloseOutput = Receive-PsqlSession -Job $saleAfterCloseJob -Name 'Case B sale'
  $watch.Stop()
  $closeFirstOutput = Receive-PsqlSession -Job $closeFirstJob -Name 'Case B close'
  Assert-True ($watch.Elapsed.TotalSeconds -ge ($HoldSeconds - 1.5)) "CASE B sale did not wait for the close lock: $($watch.Elapsed.TotalSeconds)s"
  Assert-True ($closeFirstOutput -match 'CASE_B_CLOSE\|true\|closed') "CASE B close failed: $closeFirstOutput"
  Assert-True ($saleAfterCloseOutput -match 'CASE_B_SALE_REJECTED\|CASH_SESSION_NOT_OPEN') "CASE B sale was not rejected by the real closed-session contract: $saleAfterCloseOutput"
  $caseBVerify = Invoke-PsqlText -Name 'case-b-verify.sql' -Sql @"
select 'CASE_B_VERIFY|'
  || (select count(*) from public.pos_sales where id='$saleB')
  || '|' || (select count(*) from public.pos_cash_movements where license_id='$licenseId'::uuid and sale_id='$saleB')
  || '|' || (select expected_cash_total::text from public.pos_cash_sessions where id='$sessionB')
  || '|' || (select status from public.pos_cash_sessions where id='$sessionB')
  || '|' || (select count(*) from public.pos_sale_audit_events where license_id='$licenseId'::uuid and sale_id='$saleB')
  || '|' || (select count(*) from public.pos_sync_events where license_id='$licenseId'::uuid and entity_type='sale' and entity_id='$saleB');
"@
  Assert-True ($caseBVerify -match 'CASE_B_VERIFY\|0\|0\|1196\|closed\|0\|0') "CASE B created financial effects after close: $caseBVerify"
  Write-Host 'CASE B: CLOSE -> SALE | LOCK WAIT: PASS | SALE REJECTION: PASS | NO SALE CREATED: PASS | RESULT: PASS'
  Write-Host 'PASS: isolated concurrent cash sale/close cases.'
}
finally {
  Get-Job | Where-Object { $_.State -in @('Running','NotStarted') } | Stop-Job -ErrorAction SilentlyContinue
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  try {
    $cleanup = Invoke-PsqlText -Sql $cleanupSql -Name 'cleanup.sql'
    Assert-True ($cleanup -match 'CLEANUP\|sessions=0\|sales=0\|movements=0\|audits=0\|sync=0') "Fixture cleanup failed: $cleanup"
    Write-Host 'CLEANUP: remaining test sessions = 0 | sales = 0 | movements = 0 | audits = 0 | sync = 0'
  } finally {
    Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
  }
}
