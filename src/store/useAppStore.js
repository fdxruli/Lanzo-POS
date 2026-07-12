import { create } from 'zustand';
import { createUISlice } from './slices/createUISlice';
import { createLicenseSlice } from './slices/createLicenseSlice';
import { createProfileSlice } from './slices/createProfileSlice';
import { createPWASlice } from './slices/createPWASlice';
import { createDriveSlice } from './slices/createDriveSlice';
import { createNotificationSlice } from './slices/createNotificationSlice';
import { createEcommercePublishedStockAlertSlice } from './slices/createEcommercePublishedStockAlertSlice';

export const useAppStore = create((...a) => ({
  ...createUISlice(...a),
  ...createLicenseSlice(...a),
  ...createProfileSlice(...a),
  ...createPWASlice(...a),
  ...createDriveSlice(...a),
  ...createNotificationSlice(...a),
  ...createEcommercePublishedStockAlertSlice(...a)
}));
