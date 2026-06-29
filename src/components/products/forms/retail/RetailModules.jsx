import React from 'react';
import AbarrotesFields from '../../fieldsets/AbarrotesFields';
import FruteriaFields from '../../fieldsets/FruteriaFields';
import QuickVariantEntry from '../../QuickVariantEntry';

export default function RetailModules({
  features,
  common,
  saleType,
  setSaleType,
  unit,
  setUnit,
  minStock,
  setMinStock,
  maxStock,
  setMaxStock,
  supplier,
  setSupplier,
  conversionFactor,
  setConversionFactor,
  isApparel,
  existingVariants,
  setQuickVariants,
  onOpenWholesaleModal
}) {
  return (
    <>
      {features.hasDailyPricing && (
        <section className="product-form-section">
          <div className="product-form-section__header">
            <div className="product-form-section__heading">
              <h4 className="product-form-section__title">Venta por peso o unidad</h4>
              <p className="product-form-section__subtitle">
                Configura cómo se venderá este producto en mostrador.
              </p>
            </div>
          </div>
          <FruteriaFields
            saleType={saleType}
            setSaleType={setSaleType}
            unit={unit}
            setUnit={setUnit}
            common={common}
          />
        </section>
      )}

      {(features.hasBulk || features.hasMinMax) && !features.hasDailyPricing && common.doesTrackStock && (
        <section className="product-form-section">
          <div className="product-form-section__header">
            <div className="product-form-section__heading">
              <h4 className="product-form-section__title">Logística e inventario</h4>
              <p className="product-form-section__subtitle">
                Define ubicación, proveedor, venta a granel y alertas de stock.
              </p>
            </div>
          </div>
          <AbarrotesFields
            saleType={saleType}
            setSaleType={setSaleType}
            unit={unit}
            setUnit={setUnit}
            onManageWholesale={onOpenWholesaleModal}
            minStock={minStock}
            setMinStock={setMinStock}
            maxStock={maxStock}
            setMaxStock={setMaxStock}
            supplier={supplier}
            setSupplier={setSupplier}
            location={common.storageLocation}
            setLocation={common.setStorageLocation}
            conversionFactor={conversionFactor}
            setConversionFactor={setConversionFactor}
            showSuppliers={features.hasSuppliers}
            showBulk={features.hasBulk}
            showWholesale={features.hasWholesale}
            showStockAlerts={features.hasMinMax}

          />
        </section>
      )}

      {isApparel && features.hasVariants && (
        <section className="product-form-section">
          <div className="product-form-section__header">
            <div className="product-form-section__heading">
              <h4 className="product-form-section__title">Variantes</h4>
              <p className="product-form-section__subtitle">
                Configura tallas, colores y variantes del producto.
              </p>
            </div>
          </div>
          <QuickVariantEntry
            basePrice={Number.parseFloat(common.price) || 0}
            baseCost={Number.parseFloat(common.cost) || 0}
            onVariantsChange={setQuickVariants}
            initialData={existingVariants}
          />
        </section>
      )}
    </>
  );
}
