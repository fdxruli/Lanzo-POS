import { z } from 'zod';

export const productSchema = z.object({
  // Identificadores y Texto
  id: z.string().min(1, "El ID es obligatorio"),
  name: z.string().min(1, "El nombre no puede estar vacío").trim(),
  barcode: z.string().trim().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  rubroContext: z.string().optional(),
  
  // Relaciones y Multimedia
  categoryId: z.string().optional().or(z.literal('')),
  image: z.any().optional(), 
  location: z.string().optional(),

  // Precios y Costos
  price: z.coerce.number().min(0).default(0),
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
  
  // Objetos Complejos
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

  recipe: z.array(z.any()).optional(), 
  modifiers: z.array(z.any()).optional(),
  wholesaleTiers: z.array(z.any()).optional(),

  // --- CORRECCIÓN FARMACIA ---
  // Agregamos los campos exactos que envía PharmacyProductForm.jsx
  
  // 1. Tipo de Prescripción (Vital para que no se resetee a OTC)
  prescriptionType: z.enum(['otc', 'antibiotic', 'controlled']).optional(),

  // 2. Datos Específicos (Nombres en inglés como los envía el formulario)
  activeSubstance: z.string().optional(),
  laboratory: z.string().optional(),
  
  // Mantenemos compatibilidad con versiones anteriores o backups (Nombres en español)
  sustancia: z.string().optional().nullable(),
  laboratorio: z.string().optional().nullable(),
  requiresPrescription: z.boolean().optional(),
  presentation: z.string().optional().nullable(),
  
  // Caducidad
  shelfLife: z.string().optional().nullable(), 

  // Fechas
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedTimestamp: z.string().optional()
});