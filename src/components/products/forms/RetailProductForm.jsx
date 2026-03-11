import React from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import WholesaleManagerModal from '../WholesaleManagerModal';
import RetailApparelInfoBanner from './retail/RetailApparelInfoBanner';
import RetailModules from './retail/RetailModules';
import RetailFormActions from './retail/RetailFormActions';
import { useRetailProductFormController } from './retail/useRetailProductFormController';

export default function RetailProductForm({
  onSave,
  onCancel,
  productToEdit,
  categories,
  onOpenCategoryManager,
  activeRubroContext,
  features
}) {
  const common = useProductCommon(productToEdit);

  const controller = useRetailProductFormController({
    productToEdit,
    activeRubroContext,
    features,
    common,
    onSave
  });

  return (
    <>
      <form onSubmit={controller.handleSubmit}>
        <RetailApparelInfoBanner isVisible={controller.isApparel} />

        <CommonProductFields
          common={common}
          categories={categories}
          onOpenCategoryManager={onOpenCategoryManager}
        />

        <RetailModules
          features={features}
          common={common}
          saleType={controller.saleType}
          setSaleType={controller.setSaleType}
          unit={controller.unit}
          setUnit={controller.setUnit}
          shelfLife={controller.shelfLife}
          setShelfLife={controller.setShelfLife}
          minStock={controller.minStock}
          setMinStock={controller.setMinStock}
          maxStock={controller.maxStock}
          setMaxStock={controller.setMaxStock}
          supplier={controller.supplier}
          setSupplier={controller.setSupplier}
          conversionFactor={controller.conversionFactor}
          setConversionFactor={controller.setConversionFactor}
          isApparel={controller.isApparel}
          existingVariants={controller.existingVariants}
          setQuickVariants={controller.setQuickVariants}
          onOpenWholesaleModal={() => controller.setIsWholesaleModalOpen(true)}
        />

        <RetailFormActions isSaving={common.isSaving} onCancel={onCancel} />
      </form>

      <WholesaleManagerModal
        show={controller.isWholesaleModalOpen}
        onClose={() => controller.setIsWholesaleModalOpen(false)}
        tiers={controller.wholesaleTiers}
        onSave={controller.setWholesaleTiers}
        basePrice={Number.parseFloat(common.price)}
      />
    </>
  );
}
