import { z } from 'zod';
import { parseCustomerServerVersion } from '../services/db/customerServerVersion';

const customerServerVersionSchema = z.preprocess((value) => {
  if (value === 0 || value === '0' || value === '') return null;
  const parsed = parseCustomerServerVersion(value);
  return parsed.valid ? parsed.version : value;
}, z.number().int().positive().refine(Number.isSafeInteger).nullable().optional());

export const customerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "El nombre debe tener al menos 2 letras").trim(),
  phone: z.string().trim().optional().or(z.literal('')),
  phoneKey: z.string().optional().or(z.literal('')).nullable(),
  address: z.string().optional().or(z.literal('')),
  debt: z.coerce.number().default(0),
  debtCents: z.coerce.number().int().default(0),
  creditLimit: z.coerce.number().min(0).default(0),

  // Metadatos locales existentes
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedTimestamp: z.string().optional().nullable(),
  isActive: z.boolean().optional(),

  // Metadatos de sincronizacion POS PRO (Fase 1 clientes/directorio)
  syncStatus: z.enum(['local', 'pending', 'synced', 'conflict', 'error']).optional(),
  serverVersion: customerServerVersionSchema,
  lastSyncedAt: z.string().nullable().optional(),
  pendingOperationId: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  conflictReason: z.string().nullable().optional(),
  cloudUpdatedAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});
