### private.assert_restaurant_table_actor_v1

```json
{
  "OBJECT_NAME": "private.assert_restaurant_table_actor_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": " p_context jsonb, p_order public.pos_restaurant_orders, p_operation text ",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "private.assert_pos_permission"
  ],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "postgres only; PUBLIC/anon/authenticated revoked",
  "BEHAVIOR_CHANGE": "New server context, ownership and origin-device authorization.",
  "RISK_LEVEL": "MEDIUM",
  "CURRENT_SECURITY_DEFINER": null,
  "PROPOSED_SECURITY_DEFINER": false,
  "CURRENT_CONFIG": null,
  "PROPOSED_CONFIG": [
    "set search_path = '' as $function$"
  ],
  "CURRENT_RETURN": null,
  "PROPOSED_RETURN": "void",
  "SOURCE_LINE": 22
}
```

### private.record_restaurant_intervention_v1

```json
{
  "OBJECT_NAME": "private.record_restaurant_intervention_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": " p_context jsonb, p_order public.pos_restaurant_orders, p_operation text, p_expected_version timestamptz, p_reason text, p_idempotency_key text, p_result jsonb ",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "private.restaurant_table_interventions"
  ],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "postgres only; PUBLIC/anon/authenticated revoked",
  "BEHAVIOR_CHANGE": "New private durable audit insertion.",
  "RISK_LEVEL": "MEDIUM",
  "CURRENT_SECURITY_DEFINER": null,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": null,
  "PROPOSED_CONFIG": [
    "set search_path = '' as $function$"
  ],
  "CURRENT_RETURN": null,
  "PROPOSED_RETURN": "void",
  "SOURCE_LINE": 64
}
```

### public.pos_restaurant_table_capabilities_v1

```json
{
  "OBJECT_NAME": "public.pos_restaurant_table_capabilities_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": " p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_local_order_id text ",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "private.validate_pos_sync_context",
    "private.assert_cloud_sales_sync_base_enabled",
    "private.assert_restaurant_orders_food_service",
    "private.assert_restaurant_table_actor_v1"
  ],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "postgres owner; anon/authenticated EXECUTE; service_role EXECUTE inherited from postgres default ACL in public; PUBLIC revoked",
  "BEHAVIOR_CHANGE": "New custom-session authenticated read RPC, remote edit blocked.",
  "RISK_LEVEL": "MEDIUM",
  "CURRENT_SECURITY_DEFINER": null,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": null,
  "PROPOSED_CONFIG": [
    "set search_path = '' as $function$"
  ],
  "CURRENT_RETURN": null,
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 78
}
```

### private.assert_restaurant_settlement_permit_v1

```json
{
  "OBJECT_NAME": "private.assert_restaurant_settlement_permit_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": "p_context jsonb,p_local_order_id text",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "private.assert_restaurant_table_actor_v1",
    "private.restaurant_settlement_permits"
  ],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "postgres only; PUBLIC/anon/authenticated revoked",
  "BEHAVIOR_CHANGE": "New transaction/session permit gate for existing Restaurant parent.",
  "RISK_LEVEL": "MEDIUM",
  "CURRENT_SECURITY_DEFINER": null,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": null,
  "PROPOSED_CONFIG": [
    "set search_path='' as $function$"
  ],
  "CURRENT_RETURN": null,
  "PROPOSED_RETURN": "void",
  "SOURCE_LINE": 136
}
```

### private.pos_restaurant_order_to_jsonb

```json
{
  "OBJECT_NAME": "private.pos_restaurant_order_to_jsonb",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_row pos_restaurant_orders, p_station_code text DEFAULT NULL::text",
  "PROPOSED_SIGNATURE": "p_row pos_restaurant_orders, p_station_code text DEFAULT NULL::text",
  "DEPENDENCIES": [
    "private.pos_restaurant_order_item_to_jsonb",
    "public.pos_restaurant_order_items"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres}",
  "BEHAVIOR_CHANGE": "Adds immutable creator Staff/device/license serialization.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": false,
  "PROPOSED_SECURITY_DEFINER": false,
  "CURRENT_CONFIG": [
    "search_path=\"\""
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 153
}
```

### public.pos_execute_financial_operation_v1

```json
{
  "OBJECT_NAME": "public.pos_execute_financial_operation_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb",
  "PROPOSED_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb",
  "DEPENDENCIES": [
    "public.pos_financial_operations",
    "public.pos_restaurant_orders",
    "private.validate_pos_sync_context",
    "private.resolve_cash_actor_key",
    "public.enforce_pos_rpc_rate_limit_v2",
    "public.build_pos_rpc_rate_limited_response",
    "private.assert_cloud_layaways_enabled",
    "private.assert_pos_permission",
    "private.canonical_financial_request_v1",
    "private.financial_execution_request_v1",
    "private.lock_restaurant_order_settlement_v1",
    "private.assert_restaurant_table_actor_v1",
    "private.resolve_financial_cash_station_v1",
    "public.pos_cash_sessions",
    "private.layaway_request_cash_session_id_v1",
    "private.layaway_payment_payload_v1",
    "private.layaway_request_numeric_v1",
    "private.layaway_request_id_v1",
    "private.layaway_request_bool_v1",
    "public.pos_layaways",
    "private.canonical_layaway_request_v1",
    "private.layaway_execution_request_v1",
    "private.reserve_financial_operation_v1",
    "private.public_financial_response_v1",
    "private.restaurant_settlement_permits",
    "public.pos_open_cash_session",
    "public.pos_register_cash_movement",
    "public.pos_adjust_initial_cash_fund",
    "public.pos_close_cash_session",
    "public.pos_admin_close_cash_session",
    "public.pos_create_cloud_sale_cashier",
    "public.pos_create_cloud_sale_cashier_inventory",
    "public.pos_create_cloud_sale_credit",
    "private.execute_split_sale_financial_v1",
    "private.execute_layaway_completion_financial_v1",
    "public.pos_cancel_cloud_sale",
    "private.execute_layaway_create_financial_v1",
    "private.execute_layaway_payment_financial_v1",
    "private.execute_layaway_cancel_financial_v1",
    "public.pos_close_restaurant_order_after_checkout_unlimited",
    "private.record_restaurant_intervention_v1",
    "private.complete_financial_operation_v1"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}",
  "BEHAVIOR_CHANGE": "Restaurant actor check, mandatory parent version, private permit and audit; shared dispatcher branches preserved.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\"",
    "statement_timeout=45s",
    "lock_timeout=20s"
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''",
    "SET statement_timeout TO '45s'",
    "SET lock_timeout TO '20s'"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 207
}
```

### private.execute_split_sale_financial_v1

```json
{
  "OBJECT_NAME": "private.execute_split_sale_financial_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_split jsonb, p_internal_idempotency_key text",
  "PROPOSED_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_split jsonb, p_internal_idempotency_key text",
  "DEPENDENCIES": [
    "private.financial_text_v1",
    "private.financial_first_nonblank_scalar_v1",
    "public.pos_restaurant_orders",
    "private.validate_pos_sync_context",
    "private.assert_cloud_sales_sync_base_enabled",
    "private.assert_pos_permission",
    "private.lock_restaurant_order_settlement_v1",
    "private.assert_restaurant_table_actor_v1",
    "private.assert_restaurant_settlement_permit_v1",
    "private.assert_cash_session_station",
    "private.pos_sale_jsonb_numeric",
    "private.normalize_pos_sale_payment_method",
    "private.financial_payment_method_v1",
    "private.assert_cloud_sales_credit_enabled",
    "public.pos_create_cloud_sale_credit_unlimited",
    "private.assert_cloud_sales_inventory_enabled",
    "public.pos_create_cloud_sale_cashier_inventory_unlimited",
    "private.assert_cloud_sales_cashier_enabled",
    "public.pos_create_cloud_sale_cashier_unlimited",
    "public.pos_close_restaurant_order_after_checkout_unlimited",
    "public.pos_sync_events"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres}",
  "BEHAVIOR_CHANGE": "Requires Restaurant actor and transaction permit before financial children.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\""
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 574
}
```

### public.pos_cancel_restaurant_order_from_pos_v1

```json
{
  "OBJECT_NAME": "public.pos_cancel_restaurant_order_from_pos_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_expected_parent_version text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text",
  "PROPOSED_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_expected_parent_version text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "public.pos_idempotency_keys",
    "private.validate_pos_sync_context",
    "private.assert_cloud_sales_sync_base_enabled",
    "private.assert_pos_permission",
    "private.assert_restaurant_orders_food_service",
    "private.lock_restaurant_order_settlement_v1",
    "private.assert_restaurant_table_actor_v1",
    "private.insert_pos_idempotency_processing",
    "public.pos_restaurant_order_items",
    "private.record_pos_sync_event",
    "private.record_restaurant_intervention_v1",
    "private.complete_pos_idempotency"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}",
  "BEHAVIOR_CHANGE": "Valid Admin may cancel remotely; Staff owner/origin only; durable audit.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\"",
    "statement_timeout=45s",
    "lock_timeout=20s"
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''",
    "SET statement_timeout TO '45s'",
    "SET lock_timeout TO '20s'"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 1082
}
```

### public.pos_upsert_restaurant_order_unlimited

```json
{
  "OBJECT_NAME": "public.pos_upsert_restaurant_order_unlimited",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_order jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text",
  "PROPOSED_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_order jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "public.pos_restaurant_order_items",
    "public.pos_sync_events",
    "public.pos_idempotency_keys",
    "private.validate_pos_sync_context",
    "private.assert_cloud_sales_sync_base_enabled",
    "private.assert_restaurant_order_write_permission",
    "private.assert_restaurant_orders_food_service",
    "private.ensure_default_preparation_station",
    "private.lock_restaurant_order_settlement_v1",
    "private.assert_restaurant_table_actor_v1",
    "private.insert_pos_idempotency_processing",
    "private.normalize_restaurant_order_status",
    "private.safe_jsonb_numeric",
    "private.resolve_restaurant_order_station",
    "private.record_pos_sync_event",
    "private.pos_restaurant_order_to_jsonb",
    "private.record_restaurant_intervention_v1",
    "private.complete_pos_idempotency"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres}",
  "BEHAVIOR_CHANGE": "Immutable parent and creator; terminal guard; expected version; same-origin Admin reason; cross-parent line guard.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\""
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 1188
}
```

### public.pos_close_restaurant_order_after_checkout_unlimited

```json
{
  "OBJECT_NAME": "public.pos_close_restaurant_order_after_checkout_unlimited",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_paid_sale_id text DEFAULT NULL::text, p_paid_sale_folio text DEFAULT NULL::text, p_paid_total numeric DEFAULT NULL::numeric, p_payment_summary jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text",
  "PROPOSED_SIGNATURE": "p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_paid_sale_id text DEFAULT NULL::text, p_paid_sale_folio text DEFAULT NULL::text, p_paid_total numeric DEFAULT NULL::numeric, p_payment_summary jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text",
  "DEPENDENCIES": [
    "public.pos_restaurant_orders",
    "public.pos_sync_events",
    "public.pos_idempotency_keys",
    "private.validate_pos_sync_context",
    "private.assert_cloud_sales_sync_base_enabled",
    "private.assert_restaurant_order_write_permission",
    "private.assert_restaurant_orders_food_service",
    "private.assert_restaurant_settlement_permit_v1",
    "private.insert_pos_idempotency_processing",
    "private.complete_pos_idempotency",
    "private.pos_restaurant_order_to_jsonb",
    "public.pos_restaurant_order_items",
    "private.record_pos_sync_event"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres,service_role=X/postgres}",
  "BEHAVIOR_CHANGE": "Private transaction permit required on existing parent.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\""
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 1525
}
```

### private.r2b_authorize_sale_financial_request_v1

```json
{
  "OBJECT_NAME": "private.r2b_authorize_sale_financial_request_v1",
  "OBJECT_TYPE": "FUNCTION",
  "EXISTS_IN_PRODUCTION": true,
  "CURRENT_SIGNATURE": "p_operation_type text, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb, p_cash_session_id text, p_customer_id text, p_idempotency_key text",
  "PROPOSED_SIGNATURE": "p_operation_type text, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb, p_cash_session_id text, p_customer_id text, p_idempotency_key text",
  "DEPENDENCIES": [
    "public.pos_products",
    "public.pos_product_batches",
    "public.ecommerce_orders",
    "public.pos_customers",
    "private.validate_pos_sync_context",
    "private.assert_pos_permission",
    "private.pos_sale_jsonb_text",
    "extensions.gen_random_uuid",
    "private.assert_restaurant_settlement_permit_v1",
    "private.pos_sale_jsonb_numeric",
    "private.has_pos_permission",
    "public.ecommerce_order_items",
    "public.ecommerce_published_products",
    "private.r2b_authoritative_modifiers_v1",
    "private.r2b_normalize_discount_v1",
    "private.normalize_pos_sale_payment_method",
    "private.r2b_assert_sale_idempotency_v1"
  ],
  "CURRENT_PERMISSIONS": "{postgres=X/postgres}",
  "PROPOSED_PERMISSIONS": "{postgres=X/postgres}",
  "BEHAVIOR_CHANGE": "Shared cashier/inventory/credit authorization gains Restaurant permit gate.",
  "RISK_LEVEL": "HIGH",
  "CURRENT_SECURITY_DEFINER": true,
  "PROPOSED_SECURITY_DEFINER": true,
  "CURRENT_CONFIG": [
    "search_path=\"\""
  ],
  "PROPOSED_CONFIG": [
    "SET search_path TO ''"
  ],
  "CURRENT_RETURN": "jsonb",
  "PROPOSED_RETURN": "jsonb",
  "SOURCE_LINE": 1713
}
```

### private.restaurant_table_interventions

```json
{
  "OBJECT_NAME": "private.restaurant_table_interventions",
  "OBJECT_TYPE": "TABLE",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": "create table if not exists private.restaurant_table_interventions (\n  id bigint generated always as identity primary key,\n  license_id uuid not null,\n  order_id text not null,\n  actor_type text not null check (actor_type in ('admin','staff')),\n  actor_id uuid not null,\n  actor_session_id uuid not null,\n  device_id uuid not null,\n  operation text not null,\n  expected_version timestamptz not null,\n  reason text,\n  idempotency_key text not null,\n  result jsonb not null,\n  created_at timestamptz not null default now(),\n  unique (license_id, operation, idempotency_key)\n);",
  "DEPENDENCIES": [],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "PUBLIC/anon/authenticated ALL revoked; RLS enabled; postgres owner",
  "BEHAVIOR_CHANGE": "Append durable operation audit; no history rewrites.",
  "RISK_LEVEL": "MEDIUM"
}
```

### private.restaurant_settlement_permits

```json
{
  "OBJECT_NAME": "private.restaurant_settlement_permits",
  "OBJECT_TYPE": "TABLE",
  "EXISTS_IN_PRODUCTION": false,
  "CURRENT_SIGNATURE": null,
  "PROPOSED_SIGNATURE": "create table private.restaurant_settlement_permits (\n  transaction_id xid8 not null,\n  license_id uuid not null,\n  order_id text not null,\n  actor_session_id uuid not null,\n  primary key (transaction_id,license_id,order_id)\n);",
  "DEPENDENCIES": [],
  "CURRENT_PERMISSIONS": null,
  "PROPOSED_PERMISSIONS": "PUBLIC/anon/authenticated ALL revoked; RLS enabled; postgres owner",
  "BEHAVIOR_CHANGE": "Transient transaction/session permit; inserted/deleted only by settlement dispatcher.",
  "RISK_LEVEL": "MEDIUM"
}
```
