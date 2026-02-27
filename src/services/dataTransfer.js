import {
  saveData,
  saveBulkSafe,
  loadData,
  STORES,
  initDB,
  streamStoreToCSV,
  streamAllDataToJSONL
} from './database';
import { generateID } from './utils';
import Logger from './Logger';

// Encabezados para el CSV de Inventario
const CSV_HEADERS = [
  'id', 'name', 'barcode', 'description', 'price', 'cost', 'stock',
  'category', 'saleType', 'productType',
  'minStock', 'maxStock',
  'sustancia', 'laboratorio', 'requiresPrescription', 'presentation'
];

/**
 * 🚀 EXPORTACIÓN INTELIGENTE DE INVENTARIO (Streaming)
 */
export const downloadInventorySmart = async () => {
  const categories = await loadData(STORES.CATEGORIES);
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const headerRow = CSV_HEADERS.join(',') + '\n';
  const fileParts = [headerRow];

  const clean = (txt) => `"${(txt || '').replace(/"/g, '""')}"`;

  try {
    await streamStoreToCSV(
      STORES.MENU,
      (product) => {
        const catName = catMap.get(product.categoryId) || '';
        return [
          product.id,
          clean(product.name),
          product.barcode || '',
          clean(product.description),
          product.price || 0,
          product.cost || 0,
          product.stock || 0,
          clean(catName),
          product.saleType || 'unit',
          product.productType || 'sellable',
          product.minStock || '',
          product.maxStock || '',
          product.sustancia || '',
          product.laboratorio || '',
          product.requiresPrescription ? 'SI' : 'NO',
          product.presentation || ''
        ].join(',');
      },
      (chunkString) => {
        fileParts.push(chunkString);
      }
    );

    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob(fileParts, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `inventario_lanzo_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    Logger.error("Error en exportación inteligente:", error);
    throw error;
  }
};

/**
 * 🚀 EXPORTACIÓN INTELIGENTE DE VENTAS (Streaming)
 */
export const downloadSalesSmart = async () => {
  const headers = ['Fecha', 'Hora', 'Folio', 'Total', 'Metodo', 'Cliente', 'Items'].join(',') + '\n';
  const fileParts = [headers];
  const clean = (txt) => `"${(txt || '').replace(/"/g, '""')}"`;

  try {
    await streamStoreToCSV(
      STORES.SALES,
      (sale) => {
        const d = new Date(sale.timestamp);
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString();
        const itemsSummary = sale.items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
        const clientText = sale.customerId ? 'Registrado' : 'Público General';
        return [
          dateStr, timeStr,
          `#${sale.timestamp.slice(-6)}`,
          sale.total,
          sale.paymentMethod,
          clientText,
          clean(itemsSummary)
        ].join(',');
      },
      (chunkString) => {
        fileParts.push(chunkString);
      }
    );

    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob(fileParts, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `reporte_ventas_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    Logger.error("Error exportando ventas:", error);
    throw error;
  }
};

// ============================================================
// HELPERS DE NORMALIZACIÓN PARA IMPORTACIÓN
// ============================================================

/**
 * Parser CSV robusto que maneja:
 * - Campos entre comillas con comas internas
 * - Saltos de línea dentro de comillas
 * - Comillas escapadas ("")
 */
const parseCSVLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Comilla doble escapada ("")
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // Cierre de campo citado
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  result.push(current.trim());
  return result;
};

/**
 * Normaliza el campo saleType para que coincida con el schema.
 * Acepta: 'unit', 'bulk', 'unidad', 'pieza', 'pza', 'granel', 'kg', etc.
 */
const normalizeSaleType = (value) => {
  if (!value) return 'unit';
  const v = value.toString().toLowerCase().trim();
  const bulkValues = ['bulk', 'granel', 'kg', 'kilo', 'peso', 'gramos', 'litros', 'lt'];
  if (bulkValues.includes(v)) return 'bulk';
  // Todo lo demás (unit, unidad, pieza, pza, etc.) → unit
  return 'unit';
};

/**
 * Normaliza el campo productType para que coincida con el schema.
 * Acepta: 'sellable', 'ingredient', 'medicamento', 'producto', 'ingrediente', etc.
 */
const normalizeProductType = (value) => {
  if (!value) return 'sellable';
  const v = value.toString().toLowerCase().trim();
  const ingredientValues = ['ingredient', 'ingrediente', 'insumo', 'materia prima'];
  if (ingredientValues.includes(v)) return 'ingredient';
  // Todo lo demás (sellable, medicamento, producto, etc.) → sellable
  return 'sellable';
};

/**
 * Normaliza booleanos desde múltiples formatos de texto.
 * Acepta: 'SI', 'NO', 'TRUE', 'FALSE', 'True', 'False', '1', '0', 'yes', 'no', 'sí'
 */
const normalizeBoolean = (value) => {
  if (!value) return false;
  const v = value.toString().toLowerCase().trim();
  const trueValues = ['si', 'sí', 'yes', 'true', '1', 'verdadero'];
  return trueValues.includes(v);
};

// ============================================================
// IMPORTACIÓN CSV
// ============================================================

export const processImport = async (csvContent) => {
  // Normalizar saltos de línea (Windows \r\n, Mac \r, Linux \n)
  const normalizedContent = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.split('\n').filter(line => line.trim() !== '');

  if (lines.length < 2) {
    throw new Error('El archivo está vacío o solo tiene encabezados.');
  }

  // Parsear encabezados con el mismo parser robusto
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

  // Verificar columnas obligatorias (insensible a mayúsculas/espacios)
  if (!headers.includes('name') || !headers.includes('price')) {
    throw new Error('El archivo no tiene las columnas obligatorias: name, price');
  }

  const productsToSave = [];
  const batchesToSave = [];
  const errors = [];

  const existingCats = await loadData(STORES.CATEGORIES);
  const catNameMap = new Map(existingCats.map(c => [c.name.toLowerCase().trim(), c.id]));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // ✅ CORRECCIÓN PRINCIPAL: Usar el parser robusto en lugar del regex frágil
    const values = parseCSVLine(line);

    if (values.length < 2) continue;

    // Construir objeto fila (mapeo por nombre de columna)
    const row = {};
    headers.forEach((header, index) => {
      if (values[index] !== undefined) {
        row[header] = values[index];
      }
    });

    // Soporte para variantes de nombre de columna
    // saleType puede venir como: saletype, saleType, sale_type, tipo_venta
    const saleTypeRaw =
      row['saletype'] || row['saleType'] || row['sale_type'] ||
      row['tipo_venta'] || row['tipoventa'] || '';

    // productType puede venir como: producttype, productType, product_type, tipo_producto
    const productTypeRaw =
      row['producttype'] || row['productType'] || row['product_type'] ||
      row['tipo_producto'] || row['tipoproducto'] || '';

    // requiresPrescription puede venir como: requiresprescription, requiresPrescription, receta
    const prescriptionRaw =
      row['requiresprescription'] || row['requiresPrescription'] ||
      row['receta'] || row['requiere_receta'] || 'false';

    if (!row['name']) {
      errors.push(`Fila ${i + 1}: Falta el nombre del producto.`);
      continue;
    }

    const priceVal = parseFloat(row['price']);
    if (isNaN(priceVal)) {
      errors.push(`Fila ${i + 1} ("${row['name']}"): El precio no es un número válido.`);
      continue;
    }

    try {
      const newId = (row['id'] && row['id'].length > 5) ? row['id'] : generateID('prod');

      // Resolver categoría
      let catId = '';
      if (row['category']) {
        const catLower = row['category'].toLowerCase().trim();
        if (catNameMap.has(catLower)) {
          catId = catNameMap.get(catLower);
        }
      }

      const stock = parseFloat(row['stock']) || 0;
      const cost = parseFloat(row['cost']) || 0;

      const product = {
        id: newId,
        name: row['name'],
        barcode: row['barcode'] || '',
        description: row['description'] || '',
        price: priceVal,
        cost: cost,
        categoryId: catId,

        // ✅ CORRECCIÓN: Normalizar saleType y productType
        saleType: normalizeSaleType(saleTypeRaw),
        productType: normalizeProductType(productTypeRaw),

        minStock: row['minstock'] !== undefined && row['minstock'] !== ''
          ? parseFloat(row['minstock']) : null,
        maxStock: row['maxstock'] !== undefined && row['maxstock'] !== ''
          ? parseFloat(row['maxstock']) : null,

        // Campos farmacia
        sustancia: row['sustancia'] || null,
        laboratorio: row['laboratorio'] || null,

        // ✅ CORRECCIÓN: Normalizar boolean (acepta True/False/SI/NO/1/0)
        requiresPrescription: normalizeBoolean(prescriptionRaw),

        presentation: row['presentation'] || null,

        isActive: true,
        trackStock: true,
        stock: stock,
        createdAt: new Date().toISOString(),
        batchManagement: { enabled: true, selectionStrategy: 'fifo' },
        image: null
      };

      productsToSave.push(product);

      // Crear lote inicial si tiene stock o costo
      if (stock > 0 || cost > 0) {
        batchesToSave.push({
          id: `batch-imp-${newId}-${Date.now()}-${i}`,
          productId: newId,
          stock: stock,
          cost: cost,
          price: product.price,
          createdAt: new Date().toISOString(),
          expiryDate: null,
          isActive: stock > 0,
          trackStock: true,
          notes: 'Importado masivamente'
        });
      }

    } catch (err) {
      errors.push(`Fila ${i + 1} ("${row['name'] || '?'}"): Error procesando datos (${err.message})`);
    }
  }

  let successCount = 0;

  if (productsToSave.length > 0) {
    const result = await saveBulkSafe(STORES.MENU, productsToSave);
    if (result.success) {
      successCount = productsToSave.length;
    } else {
      Logger.error("Error importando productos:", result.error);
      errors.push(`FATAL: No se pudieron guardar los productos. ${result.error?.message || result.message}`);
      return { success: false, importedCount: 0, errors };
    }
  }

  if (batchesToSave.length > 0) {
    const batchResult = await saveBulkSafe(STORES.PRODUCT_BATCHES, batchesToSave);
    if (!batchResult.success) {
      Logger.error("Error importando lotes:", batchResult.error);
      errors.push(`ADVERTENCIA: Los productos se crearon, pero falló el registro de stock inicial. Error: ${batchResult.error?.message || batchResult.message}`);
    }
  }

  return {
    success: true,
    importedCount: successCount,
    errors
  };
};

/**
 * Utilería simple para descargar strings
 */
export const downloadFile = (content, filename) => {
  const blob = new Blob(["\ufeff" + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- REPORTES ESPECÍFICOS ---

export const generatePharmacyReport = (sales) => {
  const HEADERS = [
    'Fecha', 'Hora', 'Folio Venta',
    'Producto', 'Sustancia Activa', 'Cantidad',
    'Medico Prescriptor', 'Cedula Profesional', 'Notas'
  ];
  const rows = [];
  sales.forEach(sale => {
    if (sale.prescriptionDetails) {
      const dateObj = new Date(sale.timestamp);
      const fecha = dateObj.toLocaleDateString();
      const hora = dateObj.toLocaleTimeString();
      const folio = sale.timestamp.slice(-6);
      const doctor = sale.prescriptionDetails.doctorName || 'N/A';
      const cedula = sale.prescriptionDetails.licenseNumber || 'N/A';
      const notas = sale.prescriptionDetails.notes || '';
      sale.items.forEach(item => {
        if (item.requiresPrescription) {
          rows.push([
            fecha, hora, `#${folio}`,
            `"${item.name.replace(/"/g, '""')}"`,
            `"${(item.sustancia || '').replace(/"/g, '""')}"`,
            item.quantity,
            `"${doctor}"`, `"${cedula}"`, `"${notas.replace(/"/g, '""')}"`
          ].join(','));
        }
      });
    }
  });
  return [HEADERS.join(','), ...rows].join('\n');
};

export const generateFullBackup = async () => {
  const db = await initDB();
  const backupData = {
    version: 1,
    timestamp: new Date().toISOString(),
    stores: {}
  };
  const storesToBackup = Object.values(STORES);
  for (const storeName of storesToBackup) {
    const records = await loadData(storeName);
    backupData.stores[storeName] = records;
  }
  return JSON.stringify(backupData, null, 2);
};

/**
 * 🚀 RESPALDO OPTIMIZADO (Streaming)
 */
export const downloadBackupSmart = async () => {
  const fileName = `RESPALDO_LANZO_${new Date().toISOString().split('T')[0]}.jsonl`;

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'Respaldo Lanzo (JSON Lines)',
          accept: { 'application/json': ['.jsonl'] },
        }],
      });
      const writable = await handle.createWritable();
      await streamAllDataToJSONL(async (chunkString) => {
        await writable.write(chunkString);
      });
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      Logger.warn("FS API falló, usando fallback Blob...", err);
    }
  }

  const parts = [];
  await streamAllDataToJSONL((chunkString) => {
    parts.push(chunkString);
  });

  const blob = new Blob(parts, { type: 'application/x-jsonlines;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
};