-- SECURITY R1: pin the original seven search paths to pg_catalog.
-- Application relations and helper calls in these functions are explicitly
-- schema-qualified; pg_catalog remains first for built-in types/functions.

alter function private.normalize_sale_inventory_item(jsonb, bigint)
  set search_path = pg_catalog;

alter function private.rest_inv5_build_sale_inventory_requirements(text, jsonb, public.pos_products)
  set search_path = pg_catalog;

alter function private.rest_inv5_enrich_inventory_allocations(jsonb, jsonb)
  set search_path = pg_catalog;

alter function private.rest_inv5_expand_sale_inventory_items(uuid, jsonb, text)
  set search_path = pg_catalog;

alter function private.rest_inv5_modifier_inventory_quantity(jsonb)
  set search_path = pg_catalog;

alter function private.rest_inv5_modifier_tracks_inventory(jsonb)
  set search_path = pg_catalog;

alter function private.rest_inv5_safety_probe()
  set search_path = pg_catalog;
