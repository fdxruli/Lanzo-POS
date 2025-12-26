import { z } from 'zod';
import { productSchema } from './productSchema';

// 1. Esquema RESTAURANTE
// Regla: Si es "Platillo" (sellable), DEBE tener receta.
export const restaurantSchema = productSchema.extend({
    printStation: z.enum(['kitchen', 'bar', 'dessert', 'none']).default('kitchen'),
    prepTime: z.coerce.number().optional(),
    modifiers: z.array(z.any()).optional()
}).superRefine((data, ctx) => {
    if (data.productType === 'sellable' && (!data.recipe || data.recipe.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Los platillos de venta requieren al menos 1 ingrediente en la receta.",
            path: ["recipe"]
        });
    }
});

// 2. Esquema FARMACIA
// Regla: Si requiere receta, validamos campos extra si es necesario
export const pharmacySchema = productSchema.extend({
    sustancia: z.string().optional(),
    laboratorio: z.string().optional(),
    requiresPrescription: z.boolean().default(false),
    presentation: z.string().optional()
});

// 3. Esquema RETAIL (Abarrotes/Ropa)
// Regla: Validación de variantes si es ropa
export const retailSchema = productSchema.extend({
    wholesaleTiers: z.array(z.any()).optional(),
    conversionFactor: z.object({
        enabled: z.boolean().optional(),
        factor: z.coerce.number().optional(),
        purchaseUnit: z.string().optional()
    }).optional()
});