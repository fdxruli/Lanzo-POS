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
        <div
          className="module-section"
          style={{ borderTop: '2px solid #86efac', marginTop: '20px', paddingTop: '15px' }}
        >
          <FruteriaFields
            saleType={saleType}
            setSaleType={setSaleType}
            unit={unit}
            setUnit={setUnit}
            common={common}
          />
        </div>
      )}

      {(features.hasBulk || features.hasMinMax) && !features.hasDailyPricing && common.doesTrackStock && (
        <div
          className="module-section"
          style={{
            borderTop: '2px dashed #94a3b8',
            marginTop: '20px',
            paddingTop: '15px',
            position: 'relative'
          }}
        >
          <span className="section-label-floating">Logistica & Inventario</span>
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
        </div>
      )}

      {isApparel && features.hasVariants && (
        <div className="module-section" style={{ marginTop: '20px' }}>
          <QuickVariantEntry
            basePrice={Number.parseFloat(common.price) || 0}
            baseCost={Number.parseFloat(common.cost) || 0}
            onVariantsChange={setQuickVariants}
            initialData={existingVariants}
          />
        </div>
      )}
    </>
  );
}
