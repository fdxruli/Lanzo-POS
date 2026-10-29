const NOT_FOUND_BARCODE_VALUES = Object.freeze({
  light: 'LANZO-POS-404-CLARO',
  dark: 'LANZO-POS-404-OSCURO',
});

export const getNotFoundBarcodeValue = (themeMode) => (
  themeMode === 'dark' ? NOT_FOUND_BARCODE_VALUES.dark : NOT_FOUND_BARCODE_VALUES.light
);

// Cada carácter ASCII se representa con sus 7 bits y un módulo separador.
// La secuencia incluye guardas visuales; no se usa para cobrar ni identificar productos.
export const encodeNotFoundBarcodeValue = (value) => {
  const characterBits = Array.from(String(value), (character) => (
    character.charCodeAt(0).toString(2).padStart(7, '0')
  ));

  return '101' + characterBits.join('0') + '101';
};

export const getNotFoundBarcodeBars = (value) => {
  const modules = encodeNotFoundBarcodeValue(value);

  return Array.from(modules, (module, index) => {
    if (module !== '1') return null;

    const isGuard = index < 3 || index >= modules.length - 3;
    return {
      x: index + 8,
      y: isGuard ? 6 : 15,
      height: isGuard ? 74 : 56,
    };
  }).filter(Boolean);
};
