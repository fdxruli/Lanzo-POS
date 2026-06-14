// src/tests/__mocks__/pwa-register.js
// Mock del módulo virtual `virtual:pwa-register/react` que inyecta vite-plugin-pwa.
// Este módulo no existe en el entorno de tests (jsdom), así que lo reemplazamos
// con stubs vacíos para que los componentes que lo importan no fallen.

export const useRegisterSW = () => ({
  needRefresh: [false, () => {}],
  offlineReady: [false, () => {}],
  updateServiceWorker: () => Promise.resolve(),
});

export default useRegisterSW;
