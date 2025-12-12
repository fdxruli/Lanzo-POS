// src/schemas/customerSchema.js
import { z } from 'zod';

export const customerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "El nombre debe tener al menos 2 letras").trim(),
  phone: z.string().trim().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  debt: z.coerce.number().default(0),
  
  // Metadatos
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedTimestamp: z.string().optional()
});