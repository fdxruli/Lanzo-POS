import { create } from 'zustand';
import { createUISlice } from './slices/createUISlice';
import { createLicenseSlice } from './slices/createLicenseSlice';
import { createProfileSlice } from './slices/createProfileSlice';

export const useAppStore = create((...a) => ({
  ...createUISlice(...a),
  ...createLicenseSlice(...a),
  ...createProfileSlice(...a)
}));