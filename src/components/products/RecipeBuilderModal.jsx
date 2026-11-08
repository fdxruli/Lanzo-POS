import { useEffect, useMemo, useState } from 'react';
import { useAvailableIngredients } from '../../hooks/products/useAvailableIngredients';
import { getIngredientDefaultUnit, getRecipeIngredientId } from '../../utils/ingredientConfiguration';
import { roundCurrency, showMessageModal } from '../../services/utils';
import './RecipeBuilderModal.css';

const toMoney = (value) => Number(value || 0).toFixed(2);

export default function RecipeBuilderModal({ show, onClose, existingRecipe, onSave, productName }) {
  const { ingredients, isLoading, error, refresh } = useAvailableIngredients({ enabled: show });
  const ingredientsById = useMemo(() => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])), [ingredients]);
  const [recipeItems, setRecipeItems] = useState([]);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [useSmallUnit, setUseSmallUnit] = useState(false);

  const resetInput = () => {
    setSelectedIngredientId('');
    setQuantity('');
    setUnit('');
    setUseSmallUnit(false);
  };

  useEffect(() => {
    if (!show) return;
    setRecipeItems(existingRecipe || []);
    resetInput();
  }, [show, existingRecipe]);

  const handleIngredientSelect = (event) => {
    const id = event.target.value;
    setSelectedIngredientId(id);
    setUseSmallUnit(false);
    setUnit(id ? getIngredientDefaultUnit(ingredientsById.get(id)) : '');
  };
¶»§q«^