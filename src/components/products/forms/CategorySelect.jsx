// src/components/products/forms/CategorySelect.jsx
import React, { useState, useEffect } from 'react';
import { db, STORES } from '../../../services/db/dexie'; // Ajusta la ruta si es necesario

export default function CategorySelect({ value, onChange, activeCategories, className }) {
    const [orphanedCategory, setOrphanedCategory] = useState(null);

    useEffect(() => {
        // Si el producto tiene un categoryId guardado, pero NO está en la lista de categorías activas
        if (value && !activeCategories.some(cat => cat.id === value)) {
            const fetchOrphanedCategory = async () => {
                try {
                    // Intenta buscar como string, si falla, intenta como número
                    const category = await db.table(STORES.CATEGORIES).get(value) ||
                        await db.table(STORES.CATEGORIES).get(Number(value));

                    if (category && category.isActive === false) {
                        setOrphanedCategory(category);
                    } else if (!category) {
                        onChange("");
                    }
                } catch (error) {
                    console.error("Error recuperando categoría inactiva:", error);
                }
            };
            fetchOrphanedCategory();
        } else {
            // Si el usuario selecciona una categoría activa, limpiamos la huérfana para que desaparezca
            setOrphanedCategory(null);
        }
    }, [value, activeCategories, onChange]);

    return (
        <select
            className={className}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">Sin categoría</option>

            {/* Inyectar la categoría inactiva solo si existe para este producto */}
            {orphanedCategory && (
                <option value={orphanedCategory.id} style={{ color: '#ef4444', fontWeight: 'bold' }}>
                    {orphanedCategory.name} (Inactiva)
                </option>
            )}

            {/* Mapeo normal de las categorías activas */}
            {activeCategories.map(cat => (
                <option key={cat.id} value={cat.id}>
                    {cat.name}
                </option>
            ))}
        </select>
    );
}