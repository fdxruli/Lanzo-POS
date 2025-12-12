// src/schemas/productSchema.js
import { z } from 'zod';

export const productSchema = z.object({
  // Identificadores y Texto
  id: z.string().min(1, "El ID es obligatorio"),
  name: z.string().min(1, "El nombre no puede estar vacío").trim(),
  barcode: z.string().trim().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  
  // Relaciones y Multimedia
  categoryId: z.string().optional().or(z.literal('')),
  image: z.any().optional(), // Acepta string (ID/URL) o null
  location: z.string().optional(),

  // Precios y Costos (Coerce convierte strings a números automáticamente)
  price: z.coerce.number().min(0, "El precio no puede ser negativo").default(0),
  cost: z.coerce.number().min(0).default(0),
  
  // Stock e Inventario
  stock: z.coerce.number().default(0),
  minStock: z.coerce.number().nullable().optional(),
  maxStock: z.coerce.number().nullable().optional(),
  trackStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  
  // Tipos y Lógica de Negocio
  productType: z.enum(['sellable', 'ingredient']).default('sellable'),
  saleType: z.enum(['unit', 'bulk']).default('unit'),
  
  // Objetos Complejos (Features)
  // Usamos .passthrough() o definimos su estructura si queremos ser estrictos
  bulkData: z.object({
    purchase: z.object({ unit: z.string().optional() }).optional()
  }).optional(),
  
  conversionFactor: z.object({
    enabled: z.boolean().optional(),
    factor: z.coerce.number().optional(),
    purchaseUnit: z.string().optional()
  }).optional(),

  batchManagement: z.object({
    enabled: z.boolean(),
    selectionStrategy: z.string().optional()
  }).optional(),

  // Arrays (Recetas, Modificadores, Mayoreo)
  recipe: z.array(z.any()).optional(), // Puedes detallar más si quieres
  modifiers: z.array(z.any()).optional(),
  wholesaleTiers: z.array(z.any()).optional(),

  // Farmacia
  sustancia: z.string().optional().nullable(),
  laboratorio: z.string().optional().nullable(),
  requiresPrescription: z.boolean().optional(),
  presentation: z.string().optional().nullable(),

  // Fechas (Como strings ISO)
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedTimestamp: z.string().optional() // Para la papelera
});