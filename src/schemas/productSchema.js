import { z } from 'zod';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const legacyOptionalObject = (schema) => z.preprocess(
  (value) => (isRecord(value) ? value : undefined),
  schema.optional()
);
const legacyArray = (schema) => z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  schema
);

export const productSchema = z.object({
  // Identificadores y Texto
  id: z.string().min(1, "El ID es obligatorio"),
  name: z.string().min(1, "El nombre no puede estar vacío").trim(),
  barcode: z.string().trim().optional().or(z.literal('')),
  sku: z.string().trim().optional().or(z.literal('')),
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
  committedStock: z.coerce.number().default(0),
  minStock: z.coerce.number().catch(null).nullable().optional(),
  maxStock: z.coerce.number().catch(null).nullable().optional(),
  trackStock: z.boolean().default(true),
  isActive: z.boolean().default(true),

  // Tipos y Lógica de Negocio
  productType: z.enum(['sellable', 'ingredient']).default('sellable'),
  saleType: z.enum(['unit', 'bulk']).default('unit'),

  // Objetos Complejos
  bulkData: legacyOptionalObject(z.object({
    purchase: z.object({ unit: z.string().optional() }).optional()
  })),

  conversionFactor: legacyOptionalObject(z.object({
    enabled: z.boolean().optional(),
    factor: z.coerce.number().optional(),
    purchaseUnit: z.string().optional()
  })),

  batchManagement: legacyOptionalObject(z.object({
    enabled: z.boolean(),
    selectionStrategy: z.string().optional()
  })),

  recipe: legacyArray(z.array(z.any())),
  modifiers: legacyArray(z.array(z.any())),
  wholesaleTiers: legacyArray(z.array(z.any())),

  // --- CORRECCIÓN FARMACIA ---
  // Campos farmacéuticos persistidos por el formulario canónico.

  // Compatibilidad: prescription representa receta ordinaria sin confundirla con control especial.
  prescriptionType: z.enum(['otc', 'antibiotic', 'controlled', 'prescription']).optional(),

  // 2. Datos Específicos (Nombres en inglés como los envía el formulario)
  activeSubstance: z.string().optional(),
  laboratory: z.string().optional(),

  // Mantenemos compatibilidad con versiones anteriores o backups (Nombres en español)
  sustancia: z.string().optional().nullable(),
  laboratorio: z.string().optional().nullable(),
  requiresPrescription: z.boolean().optional(),
  presentation: z.string().optional().nullable(),
  pharmacy: z.object({
    version: z.number().optional(),
    kind: z.enum(['medicine', 'other']),
    fraction: z.enum(['I','II','III','IV','V','VI']).nullable().optional(),
    status: z.enum(['confirmed', 'pending']),
    antibiotic: z.boolean(),
    concentration: z.string().optional(),
    dosageForm: z.string().optional(),
    sanitaryRegistration: z.string().optional()
  }).passthrough().optional(),

  // Caducidad — SSOT: La fecha real vive en batch.expiryDate
  // Este flag solo indica el modo de expiración del producto.
  expirationMode: z.enum(['STRICT', 'SHELF_LIFE', 'NONE']).default('NONE'),
  shelfLifeValue: z.coerce.number().optional().nullable(),
  shelfLifeUnit: z.string().optional().nullable(),

  // Fechas
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedTimestamp: z.string().optional()
}).passthrough();
