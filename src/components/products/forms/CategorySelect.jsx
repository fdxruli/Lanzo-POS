// src/components/products/forms/CategorySelect.jsx
import { useState, useEffect } from 'react';
import { db, STORES } from '../../../services/db/dexie';

const EMPTY_ACTIVE_CATEGORIES = [];

export default function CategorySelect({ id, value, onChange, activeCategories = EMPTY_ACTIVE_CATEGORIES, className }) {
    const categoryId = value === '' || value === null || value === undefined ? null : value;
    const selectedValue = categoryId === null ? '' : String(categoryId);
    const hasActiveCategory = categoryId !== null && activeCategories.some((category) => (
        String(category.id) === String(categoryId)
    ));
    const [unavailableCategory, setUnavailableCategory] = useState(null);

    useEffect(() => {
        if (categoryId === null || hasActiveCategory) {
            setUnavailableCategory(null);
            return undefined;
        }

        let cancelled = false;
        const selectedCategoryId = categoryId;
        setUnavailableCategory({ id: selectedCategoryId, category: null });

        const loadCategory = async () => {
            try {
                const categoryTable = db.table(STORES.CATEGORIES);
                const numericId = Number(selectedCategoryId);
                const category = await categoryTable.get(selectedCategoryId)
                    || (Number.isNaN(numericId) ? null : await categoryTable.get(numericId));
                if (!cancelled) {
                    setUnavailableCategory({ id: selectedCategoryId, category: category || null });
                }
            } catch (error) {
                console.error('Error recuperando categoría local:', error);
                if (!cancelled) setUnavailableCategory({ id: selectedCategoryId, category: null });
            }
        };

        void loadCategory();
        return () => { cancelled = true; };
    }, [activeCategories, categoryId, hasActiveCategory]);

    const fallbackCategory = unavailableCategory
        && String(unavailableCategory.id) === String(categoryId)
        ? unavailableCategory.category
        : null;

    return (
        <select
            id={id}
            className={className}
            value={selectedValue}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">Sin categoría</option>

            {categoryId !== null && !hasActiveCategory && (
                <option value={selectedValue}>
                    {fallbackCategory?.name
                        ? `${fallbackCategory.name}${fallbackCategory.isActive === false ? ' (Inactiva)' : ''}`
                        : 'Categoría no disponible'}
                </option>
            )}

            {activeCategories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                    {category.name}
                </option>
            ))}
        </select>
    );
}
