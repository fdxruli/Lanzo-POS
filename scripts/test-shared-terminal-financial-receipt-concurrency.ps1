param(
  [string]$DatabaseUrl = $env:LANZO_POS_TEST_DATABASE_URL
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw 'Set LANZO_POS_TEST_DATABASE_URL to an authorized migrated local PostgreSQL test database.'
}
$psql = (Get-Command psql -ErrorAction Stop).Source
$licenseId = [guid]::NewGuid().ToString()
$suffix = $licenseId.Replace('-', '')
$licenseKey = "F5AR1-CONC-$suffix"
$externalK = "f5ar1-concurrent-$suffix"
$canonical = "{`"sale_id`":`"sale-$suffix`",`"reason`":`"concurrency`"}"

function Invoke-Psql([string]$Sql) {
  $output = & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -A -t -q -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return ($output | Out-String).Trim()
}

try {
  Invoke-Psql "insert into public.licenses (id, license_key, license_type, max_devices, status, product_name, features) values ('$licenseId', '$licenseKey', 'pro', 1, 'active', 'F5A R1 concurrency', '{}'::jsonb);" | Out-Null
  $hash = Invoke-Psql "select private.financial_operation_hash('sale.cancel', '$canonical'::jsonb, 'actor:concurrency', null, null);"
  $otherHash = Invoke-Psql "select private.financial_operation_hash('sale.cancel', jsonb_build_object('sale_id','other-$suffix','reason','concurrency'), 'actor:concurrency', null, null);"
  $reserve = "select (private.reserve_financial_operation_v1('$licenseId'::uuid, '$externalK', '$hash', 'sale.cancel', '$canonical'::jsonb, 'actor:concurrency', null, null)).status;"

  # T1 owns the transaction-scoped tenant/K advisory lock while reserving.
  $t1 = Start-Job -ArgumentList $psql, $DatabaseUrl, $reserve -ScriptBlock {
    param($PsqlPath, $Url, $ReserveSql)
    & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -c "begin; $ReserveSql select pg_sleep(2); commit;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'T1 reservation failed' }
  }
  Start-Sleep -Milliseconds 250
  $sameResult = Invoke-Psql "begin; $reserve commit;"
  Receive-Job -Job $t1 -Wait -AutoRemoveJob | Out-Null
  if ((Invoke-Psql "select count(*) from public.pos_financial_operations where license_id='$licenseId'::uuid and idempotency_key='$externalK';") -ne '1') {
    throw 'same K/H created more than one financial reservation'
  }
  if ($sameResult -notmatch 'processing') { throw "same K/H did not converge to the authoritative reservation: $sameResult" }

  $externalK2 = "$externalK-conflict"
  $reserve1 = "select (private.reserve_financial_operation_v1('$licenseId'::uuid, '$externalK2', '$hash', 'sale.cancel', '$canonical'::jsonb, 'actor:concurrency', null, null)).status;"
  $t2 = Start-Job -ArgumentList $psql, $DatabaseUrl, $reserve1 -ScriptBlock {
    param($PsqlPath, $Url, $ReserveSql)
    & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -c "begin; $ReserveSql select pg_sleep(2); commit;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'T1 conflict reservation failed' }
  }
  Start-Sleep -Milliseconds 250
  $conflictSql = "begin; select private.reserve_financial_operation_v1('$licenseId'::uuid, '$externalK2', '$otherHash', 'sale.cancel', jsonb_build_object('sale_id','other-$suffix','reason','concurrency'), 'actor:concurrency', null, null); commit;"
  $conflictOutput = & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -A -t -q -c $conflictSql 2>&1
  Receive-Job -Job $t2 -Wait -AutoRemoveJob | Out-Null
  if ($LASTEXITCODE -eq 0 -or ($conflictOutput | Out-String) -notmatch 'IDEMPOTENCY_CONFLICT') {
    throw "K/H1 versus K/H2 did not fail closed: $($conflictOutput | Out-String)"
  }
  Write-Output 'shared terminal financial receipt concurrency: PASS'
}
finally {
  if ($licenseId) { & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -q -c "delete from public.licenses where id='$licenseId'::uuid;" 2>$null }
}
