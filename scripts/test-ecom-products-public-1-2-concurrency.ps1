param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [int]$HoldSeconds = 4
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw 'DATABASE_URL is required. Use an owner-capable PostgreSQL connection; do not use a browser API key.'
}

$psql = (Get-Command psql -ErrorAction Stop).Source
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("lanzo-ecom-public-1-2-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

$licenseId = '27000000-0000-4000-8000-000000000001'
$portalId = '27000000-0000-4000-8000-000000000002'
$productId = '27000000-0000-4000-8000-000000000003'
$variantId = '27000000-0000-4000-8000-000000000004'
$groupId = '27000000-0000-4000-8000-000000000005'
$optionId = '27000000-0000-4000-8000-000000000006'
$slug = 'ecom-public-1-2-concurrency'

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
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for $Name`n$($output | Out-String)"
  }
  return ($output | Out-String).Trim()
}

function Start-PsqlSession {
  param([string]$Sql, [string]$Name)
  $path = Write-SqlFile -Name $Name -Sql $Sql
  return Start-Job -ScriptBlock {
    param($PsqlPath, $Url, $SqlPath)
    $result = & $PsqlPath $Url -X -v ON_ERROR_STOP=1 -A -t -q -f $SqlPath 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw ($result | Out-String)
    }
    $result
  } -ArgumentList $psql, $DatabaseUrl, $path
}

function Receive-PsqlSession {
  param($Job, [string]$Name)
  Wait-Job $Job | Out-Null
  if ($Job.State -ne 'Completed') {
    $failure = Receive-Job $Job -ErrorAction SilentlyContinue | Out-String
    throw "$Name failed with state $($Job.State)`n$failure"
  }
  $text = (Receive-Job $Job | Out-String).Trim()
  Remove-Job $Job -Force
  return $text
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function ConfigurationJson {
  param([decimal]$OptionPrice)
  return @"
{
  "type":"configurable",
  "version":1,
  "hasRecipe":false,
  "availabilitySource":"variant_aggregate",
  "variants":[{
    "sourceVariantRef":"variant-red-m",
    "localProductRef":"variant-red-m",
    "publicName":"Rojo / M",
    "optionValues":{"color":"Rojo","talla":"M"},
    "priceMode":"delta",
    "priceValue":10,
    "stockMode":"exact",
    "stockSnapshot":20,
    "sourceAvailable":true,
    "manualAvailable":true,
    "displayOrder":0
  }],
  "optionGroups":[{
    "sourceGroupRef":"extras",
    "publicName":"Extras",
    "selectionType":"multiple",
    "required":true,
    "minSelect":1,
    "maxSelect":2,
    "displayOrder":0,
    "options":[{
      "sourceOptionRef":"extra-cheese",
      "publicName":"Queso extra",
      "priceDelta":$OptionPrice,
      "tracksInventory":false,
      "manualAvailable":true,
      "sourceAvailable":true,
      "displayOrder":0
    }]
  }]
}
"@
}

function ApplyConfigurationSql {
  param([decimal]$OptionPrice, [string]$Revision)
  $configuration = ConfigurationJson -OptionPrice $OptionPrice
  return @"
select private.ecommerce_apply_product_configuration(
  '$licenseId'::uuid,
  '$productId'::uuid,
  `$json`$$configuration`$json`$::jsonb,
  '$Revision'
);
"@
}

$cleanupSql = @"
begin;
delete from public.ecommerce_orders where license_id = '$licenseId'::uuid;
delete from public.ecommerce_published_options where license_id = '$licenseId'::uuid;
delete from public.ecommerce_published_option_groups where license_id = '$licenseId'::uuid;
delete from public.ecommerce_published_product_variants where license_id = '$licenseId'::uuid;
delete from public.ecommerce_published_products where license_id = '$licenseId'::uuid;
delete from public.ecommerce_portals where license_id = '$licenseId'::uuid;
delete from public.pos_rpc_rate_limits where license_key = 'ecommerce-license:$licenseId';
delete from public.licenses where id = '$licenseId'::uuid;
commit;
"@

$setupSql = @"
$cleanupSql
begin;
insert into public.licenses(id,license_key,license_type,status,expires_at,features)
values(
  '$licenseId'::uuid,
  'ECOM-PUBLIC-1-2-CONCURRENCY',
  'free',
  'active',
  clock_timestamp()+interval '1 day',
  jsonb_build_object(
    'ecommerce_portal_enabled',true,
    'ecommerce_order_inbox',true,
    'ecommerce_whatsapp_checkout',true,
    'ecommerce_max_published_products',10,
    'ecommerce_max_open_orders_per_day',100,
    'ecommerce_stock_visibility',true
  )
);
insert into public.ecommerce_portals(
  id,license_id,slug,status,name,ordering_enabled,pickup_enabled,business_hours_enabled
) values(
  '$portalId'::uuid,'$licenseId'::uuid,'$slug','published',
  'PUBLIC 1.2 concurrency',true,true,false
);
insert into public.ecommerce_published_products(
  id,portal_id,license_id,local_product_ref,public_name,price,is_published,
  manual_available,source_available,configuration_type,has_variants,
  has_option_groups,requires_configuration,availability_source,stock_mode,source_state
) values(
  '$productId'::uuid,'$portalId'::uuid,'$licenseId'::uuid,
  'cfg-product','Configurable',100,true,true,true,'configurable',true,true,true,
  'variant_aggregate','hidden','in_stock'
);
insert into public.ecommerce_published_product_variants(
  id,published_product_id,portal_id,license_id,source_variant_ref,local_product_ref,
  public_name,option_values,price_mode,price_value,stock_mode,stock_snapshot,
  manual_available,source_available,is_available,display_order
) values(
  '$variantId'::uuid,'$productId'::uuid,'$portalId'::uuid,'$licenseId'::uuid,
  'variant-red-m','variant-red-m','Rojo / M','{"color":"Rojo","talla":"M"}',
  'delta',10,'exact',20,true,true,true,0
);
insert into public.ecommerce_published_option_groups(
  id,published_product_id,portal_id,license_id,source_group_ref,public_name,
  selection_type,required,min_select,max_select,display_order
) values(
  '$groupId'::uuid,'$productId'::uuid,'$portalId'::uuid,'$licenseId'::uuid,
  'extras','Extras','multiple',true,1,2,0
);
insert into public.ecommerce_published_options(
  id,group_id,published_product_id,portal_id,license_id,source_option_ref,
  public_name,price_delta,manual_available,source_available,is_available,display_order
) values(
  '$optionId'::uuid,'$groupId'::uuid,'$productId'::uuid,'$portalId'::uuid,
  '$licenseId'::uuid,'extra-cheese','Queso extra',5,true,true,true,0
);
commit;
"@

try {
  Invoke-PsqlText -Sql $setupSql -Name 'setup.sql' | Out-Null

  $detailA = Invoke-PsqlText -Name 'detail-a.sql' -Sql @"
select 'A|'
  || (d #>> '{product,configurationRevision}')
  || '|' || (d #>> '{groups,0,options,0,priceDelta}')
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
"@
  $partsA = $detailA.Split('|')
  Assert-True ($partsA.Length -eq 3 -and [decimal]$partsA[2] -eq 5) "Initial detail A was not coherent: $detailA"
  $revisionA = $partsA[1]

  # Case A: reader first. The canonical writer must wait for the reader SHARE lock.
  $readerA = Start-PsqlSession -Name 'case-a-reader.sql' -Sql @"
begin;
select 'CASE_A|'
  || (d #>> '{product,configurationRevision}')
  || '|' || (d #>> '{groups,0,options,0,priceDelta}')
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
select pg_sleep($HoldSeconds);
commit;
"@
  Start-Sleep -Milliseconds 700
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $writerA = Start-PsqlSession -Name 'case-a-writer.sql' -Sql @"
begin;
$(ApplyConfigurationSql -OptionPrice 7 -Revision 'concurrency-a-b')
commit;
select 'CASE_A_WRITER_DONE';
"@
  $writerAOutput = Receive-PsqlSession -Job $writerA -Name 'Case A writer'
  $watch.Stop()
  $readerAOutput = Receive-PsqlSession -Job $readerA -Name 'Case A reader'
  Assert-True ($watch.Elapsed.TotalSeconds -ge ($HoldSeconds - 1.5)) "Case A writer did not wait for reader lock: $($watch.Elapsed.TotalSeconds)s"
  Assert-True ($readerAOutput -match 'CASE_A\|[0-9a-f]{64}\|5') "Case A reader mixed snapshots: $readerAOutput"
  Assert-True ($writerAOutput -match 'CASE_A_WRITER_DONE') "Case A writer did not complete"

  $detailB = Invoke-PsqlText -Name 'detail-b.sql' -Sql @"
select 'B|'
  || (d #>> '{product,configurationRevision}')
  || '|' || (d #>> '{groups,0,options,0,priceDelta}')
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
"@
  $partsB = $detailB.Split('|')
  Assert-True ($partsB.Length -eq 3 -and [decimal]$partsB[2] -eq 7) "Post-writer detail B was not coherent: $detailB"
  Assert-True ($partsB[1] -ne $revisionA) 'Case A did not change configurationRevision'

  # Case B: writer first. Reader must wait, then receive complete B=9.
  $writerB = Start-PsqlSession -Name 'case-b-writer.sql' -Sql @"
begin;
$(ApplyConfigurationSql -OptionPrice 9 -Revision 'concurrency-b')
select pg_sleep($HoldSeconds);
commit;
"@
  Start-Sleep -Milliseconds 700
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $readerB = Start-PsqlSession -Name 'case-b-reader.sql' -Sql @"
select 'CASE_B|'
  || (d #>> '{product,configurationRevision}')
  || '|' || (d #>> '{groups,0,options,0,priceDelta}')
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
"@
  $readerBOutput = Receive-PsqlSession -Job $readerB -Name 'Case B reader'
  $watch.Stop()
  Receive-PsqlSession -Job $writerB -Name 'Case B writer' | Out-Null
  Assert-True ($watch.Elapsed.TotalSeconds -ge ($HoldSeconds - 1.5)) "Case B reader did not wait for writer lock: $($watch.Elapsed.TotalSeconds)s"
  Assert-True ($readerBOutput -match 'CASE_B\|[0-9a-f]{64}\|9') "Case B reader did not receive complete B: $readerBOutput"

  $revisionC = Invoke-PsqlText -Name 'revision-c.sql' -Sql @"
select d #>> '{product,configurationRevision}'
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
"@

  # Case C: checkout first. Writer waits until order and item snapshot A commit.
  $checkoutC = Start-PsqlSession -Name 'case-c-checkout.sql' -Sql @"
begin;
select 'CASE_C_ORDER|'
  || (r #>> '{order,id}')
  || '|' || (r #>> '{order,total}')
from (
  select public.ecommerce_create_order(
    '$slug',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object(
      'productId','$productId'::uuid,
      'quantity',1,
      'variantId','$variantId'::uuid,
      'selections',jsonb_build_array(jsonb_build_object(
        'groupId','$groupId'::uuid,
        'optionIds',jsonb_build_array('$optionId'::uuid)
      )),
      'configurationVersion',1,
      'configurationRevision','$revisionC'
    )),
    'ecom-public-1-2-concurrency-c'
  ) r
) x;
select pg_sleep($HoldSeconds);
commit;
"@
  Start-Sleep -Milliseconds 700
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $writerC = Start-PsqlSession -Name 'case-c-writer.sql' -Sql @"
begin;
$(ApplyConfigurationSql -OptionPrice 11 -Revision 'concurrency-c-b')
commit;
"@
  Receive-PsqlSession -Job $writerC -Name 'Case C writer' | Out-Null
  $watch.Stop()
  $checkoutCOutput = Receive-PsqlSession -Job $checkoutC -Name 'Case C checkout'
  Assert-True ($watch.Elapsed.TotalSeconds -ge ($HoldSeconds - 1.5)) "Case C writer did not wait for checkout lock: $($watch.Elapsed.TotalSeconds)s"
  Assert-True ($checkoutCOutput -match 'CASE_C_ORDER\|[0-9a-f-]{36}\|119') "Case C checkout did not confirm price A=119: $checkoutCOutput"

  $snapshotC = Invoke-PsqlText -Name 'case-c-snapshot.sql' -Sql @"
select 'CASE_C_SNAPSHOT|'
  || oi.unit_price::text
  || '|' || (oi.options ->> 'configurationRevision')
from public.ecommerce_order_items oi
join public.ecommerce_orders o on o.id=oi.order_id
where o.portal_id='$portalId'::uuid
  and o.idempotency_key='ecom-public-1-2-concurrency-c';
"@
  $snapshotParts = $snapshotC.Split('|')
  Assert-True ($snapshotParts.Length -eq 3 -and [decimal]$snapshotParts[1] -eq 119) "Case C item price is not A: $snapshotC"
  Assert-True ($snapshotParts[2] -eq $revisionC) "Case C snapshot revision differs from checkout revision: $snapshotC"

  # Case D: A is now stale after writer B=11 and must be rejected.
  $staleCode = Invoke-PsqlText -Name 'case-d-stale.sql' -Sql @"
select r #>> '{error,code}'
from (
  select public.ecommerce_create_order(
    '$slug',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object(
      'productId','$productId'::uuid,
      'quantity',1,
      'variantId','$variantId'::uuid,
      'selections',jsonb_build_array(jsonb_build_object(
        'groupId','$groupId'::uuid,
        'optionIds',jsonb_build_array('$optionId'::uuid)
      )),
      'configurationVersion',1,
      'configurationRevision','$revisionC'
    )),
    'ecom-public-1-2-concurrency-stale'
  ) r
) x;
"@
  Assert-True ($staleCode -eq 'ECOMMERCE_CONFIGURATION_CHANGED') "Case D stale revision was not rejected: $staleCode"

  $detailFinal = Invoke-PsqlText -Name 'detail-final.sql' -Sql @"
select 'FINAL|'
  || (d #>> '{product,configurationRevision}')
  || '|' || (d #>> '{groups,0,options,0,priceDelta}')
from (select public.ecommerce_get_product_configuration('$slug','$productId'::uuid) d) x;
"@
  $finalParts = $detailFinal.Split('|')
  Assert-True ($finalParts.Length -eq 3 -and [decimal]$finalParts[2] -eq 11) "Final detail is not complete B=11: $detailFinal"
  Assert-True ($finalParts[1] -ne $revisionC) 'Final revision did not change after writer C'

  Write-Host 'PASS: reader-first, writer-first, checkout-first and stale-revision concurrency cases.'
}
finally {
  try { Invoke-PsqlText -Sql $cleanupSql -Name 'cleanup.sql' | Out-Null } catch { Write-Warning $_ }
  Get-Job | Where-Object { $_.State -in @('Running','NotStarted') } | Stop-Job -ErrorAction SilentlyContinue
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
}