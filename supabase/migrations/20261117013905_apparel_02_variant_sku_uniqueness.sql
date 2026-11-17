-- APPAREL-02: SKU variants are identified by their commercial size/color fields.
-- The variants feature is enabled only for Apparel in src/hooks/useFeatureConfig.js.
-- Abort before adding the constraint if existing Apparel rows already collide.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.pos_product_batches
    WHERE deleted_at IS NULL
      AND sku_key IS NOT NULL
      AND sku_key <> ''
      AND attributes ? 'talla'
      AND attributes ? 'color'
    GROUP BY license_id, sku_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'APPAREL_VARIANT_SKU_DUPLICATES_EXIST';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS pos_product_batches_license_apparel_variant_sku_uidx
  ON public.pos_product_batches (license_id, sku_key)
  WHERE deleted_at IS NULL
    AND sku_key IS NOT NULL
    AND sku_key <> ''
    AND attributes ? 'talla'
    AND attributes ? 'color';
