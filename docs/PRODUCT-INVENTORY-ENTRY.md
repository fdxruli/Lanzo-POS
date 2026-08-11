# PRODUCT.INVENTORY.ENTRY.2

`addInventoryEntry()` is the only ENTRY.2 operation for positive inventory deltas. It never sends or applies an absolute stock value.

## Authority

- Batch-managed products: `product_batches.stock` is authoritative; the parent product is recalculated from active batches, including weighted average cost for non-variant batches.
- Non-batch products: `pos_products.stock` is authoritative.
- Apparel variants: a batch with `attributes` is authoritative. A caller must select that batch; parent stock is never incremented directly.

## Local and offline contract

One Dexie transaction updates the authority, parent projection, a semantic `INVENTORY_ENTRY` event, and exactly one `inventory_entry` outbox record. The outbox payload contains `baseQuantity` (a delta), never a final stock value. Its idempotency key is the stable `operationId` and is also the local event identity.

Retries with the same payload return the stored local result. Reusing an operation ID with different data is rejected as `IDEMPOTENCY_PAYLOAD_MISMATCH`.

## Cloud contract

`public.pos_add_inventory_entry` validates POS context and product-write permission, rate limits the mutation, claims the idempotency key, locks the product/batch, applies the additive delta, recalculates a batch parent, records one `manual_in` movement with `source=inventory_entry`, and emits catalog/inventory sync events in one PostgreSQL transaction.

Strict-expiry products cannot create a new layer without manufacturer batch and expiry. Recipe products and stock-disabled products are rejected. Apparel UI support remains deferred to ENTRY.3, but the engine safely requires a selected variant batch.

## ENTRY.3 pending

Unit conversions, advanced apparel cost handling, pharmacy receiving layers, restaurant-specific eligibility, and specialized fragmented/bulk flows are deliberately outside ENTRY.2.
