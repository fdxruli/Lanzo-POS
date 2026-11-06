export const db = {
  sales: {
    where() {
      throw new Error('This Cloud UI fixture must never read IndexedDB.');
    }
  }
};
