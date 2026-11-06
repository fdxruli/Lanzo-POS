import { create } from 'zustand';
import { createPWASlice } from '../../../src/store/slices/createPWASlice';
// Isolated test state. Never imports a license, tenant or commercial runtime.
export const useAppStore = create(createPWASlice);
