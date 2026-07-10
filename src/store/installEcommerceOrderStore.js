import { useAppStore } from './useAppStore';
import { createEcommerceOrderSlice } from './slices/createEcommerceOrderSlice';

let installed = false;

export function installEcommerceOrderStore() {
  if (installed) return;
  const slice = createEcommerceOrderSlice(useAppStore.setState, useAppStore.getState);
  useAppStore.setState(slice);
  installed = true;
}

installEcommerceOrderStore();
