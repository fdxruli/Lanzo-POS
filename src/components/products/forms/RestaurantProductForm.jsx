import React from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import RecipeBuilderModal from '../RecipeBuilderModal';
import RestaurantConfigSection from './restaurant/RestaurantConfigSection';
import RestaurantFormActions from './restaurant/RestaurantFormActions';
import { useRestaurantProductFormController } from './restaurant/useRestaurantProductFormController';

export default function RestaurantProductForm({
  onSave,
  onCancel,
  productToEdit,
  categories,
  onOpenCategoryManager,
  activeRubroContext
}) {
  const common = useProductCommon(productToEdit);
  const controller = useRestaurantProductFormController({
    productToEdit,
    activeRubroContext,
    common,
    onSave
  });

  return (
    <>
      <form onSubmit={controller.handleSubmit}>
        <CommonProductFields
          common={common}
          categories={categories}
          onOpenCategoryManager={onOpenCategoryManager}
          readOnlyCost={controller.isCostReadOnly}
        />

        <RestaurantConfigSection
          productType={controller.productType}
          setProductType={controller.setProductType}
          onManageRecipe={() => controller.setIsRecipeModalOpen(true)}
          printStation={controller.printStation}
          setPrintStation={controller.setPrintStation}
          prepTime={controller.prepTime}
          setPrepTime={controller.setPrepTime}
          modifiers={controller.modifiers}
          setModifiers={controller.setModifiers}
          recipeCount={controller.recipe.length}
          currentCost={common.cost}
        />

        <RestaurantFormActions
          isSaving={common.isSaving}
          productType={controller.productType}
          onCancel={onCancel}
        />
      </form>

      <RecipeBuilderModal
        show={controller.isRecipeModalOpen}
        onClose={() => controller.setIsRecipeModalOpen(false)}
        existingRecipe={controller.recipe}
        onSave={controller.setRecipe}
        productName={common.name}
      />
    </>
  );
}

