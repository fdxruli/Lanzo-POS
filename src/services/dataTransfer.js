import {
  loadData,
  STORES,
  streamStoreToCSV
} from './database';
import Logger from './Logger';
import { buildPharmacyDispensationRows } from './reports/pharmacyDispensationReport';
import {
  formulaSafeCell,
  importProductCsv,
  downloadPortableDataPackage,
  downloadPortableTableCsv,
  previewProductCsvImport,
  previewCatalogTransfer,
  importCatalogTransfer
} from './backup/portableDataTransfer';
export {
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF,
  downloadBackupSmart
} from './backup/backupManager';


const BASE_HEADERS = [
  'id', 'name', 'barcode', 'description', 'price', 'cost', 'stock',
  'category', 'saleType', 'productType', 'minStock', 'maxStock'
];

// Define los campos exactos que necesitas por cada rubro.
// ⚠️ Las claves DEBEN coincidir con los valores de RUBRO_FEATURES en useFeatureConfig.js
const RUBRO_HEADERS = {
  farmacia: ['sustancia', 'laboratorio', 'requiresPrescription', 'presentation'],
  apparel: ['marca', 'talla', 'color', 'genero', 'modelo'],
  food_service: ['preparacion_minutos', 'alergenos'],
  hardware: ['unidad_medida', 'fecha_caducidad'],
  abarrotes: ['unidad_medida', 'fecha_caducidad'],
  'verduleria/fruteria': ['unidad_medida', 'fecha_caducidad'],
  otro: []
};

// Lista de rubros válidos para validación
const VALID_RUBROS = Object.keys(RUBRO_HEADERS);

export const getHeadersForRubro = (rubro) => {
  const specificHeaders = RUBRO_HEADERS[rubro] || [];
  return [...BASE_HEADERS, ...specificHeaders];
};

export const downloadTemplate = (rubro) => {
  // Validar que el rubro sea reconocido — nunca generar plantilla genérica
  if (!rubro || !VALID_RUBROS.includes(rubro)) {
    throw new Error(`Rubro no reconocido: "${rubro || '(vacío)'}".
 Rubros válidos: ${VALID_RUBROS.join(', ')}`);
  }

  const headers = getHeadersForRubro(rubro);
  // Agregamos una fila de ejemplo para guiar al usuario
  const exampleRow = headers.map(h => {
    if (h === 'name') return '"Ejemplo Producto"';
    if (h === 'price' || h === 'cost') return '150.00';
    if (h === 'stock') return '10';
    return '""';
  });

  const content = headers.join(',') + '\n' + exampleRow.join(',');
  const date = new Date().toISOString().split('T')[0];
  downloadFile(content, `plantilla_importacion_${rubro}_${date}.csv`);
};

/**
 * 🚀 EXPORTACIÓN INTELIGENTE DE INVENTARIO (Streaming)
 */
export const downloadInventorySmart = async (rubro) => {
  const categories = await loadData(STORES.CATEGORIES);
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const headers = getHeadersForRubro(rubro);
  const headerRow = headers.map(formulaSafeCell).join(',') + '\n';
  const fileParts = [headerRow];

  try {
    await streamStoreToCSV(
      STORES.MENU,
      (product) => {
        const catName = catMap.get(product.categoryId) || '';

        // Mapeo dinámico: Recorremos los headers correspondientes a este rubro
        const rowData = headers.map(header => {
           if (header === 'category') return formulaSafeCell(catName);
           if (header === 'requiresPrescription') return formulaSafeCell(product.requiresPrescription ? 'SI' : 'NO');
           // Si el valor no existe en el producto, devolvemos vacío
           return product[header] !== undefined && product[header] !== null
                  ? formulaSafeCell(product[header])
                  : '';
        });

        return rowData.join(',');
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
  const headers = ['sale_id', 'timestamp_utc', 'total', 'currency', 'payment_method', 'customer_id', 'cash_session_id', 'items_json'].join(',') + '\r\n';
  const fileParts = [headers];

  try {
    await streamStoreToCSV(
      STORES.SALES,
      (sale) => {
        const items = Array.isArray(sale.items) ? sale.items : [];
        return [sale.id, sale.timestamp, sale.total, sale.currency || '', sale.paymentMethod || '',
          sale.customerId || '', sale.cash_session_id || '', JSON.stringify(items)]
          .map(formulaSafeCell).join(',') + '\r\n';
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

export const processImport = async (csvContent, options = {}) => importProductCsv(csvContent, options);

export {
  downloadPortableDataPackage,
  downloadPortableTableCsv,
  previewProductCsvImport,
  previewCatalogTransfer,
  importCatalogTransfer
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

export const buildPharmacyReport = (sales, options = {}) => {
  const report = buildPharmacyDispensationRows(sales, options);
  const csv = [
    report.headers.map(formulaSafeCell).join(','),
    ...report.rows.map(row => row.map(formulaSafeCell).join(','))
  ].join('\r\n');
  return { ...report, csv };
};

// Compatibilidad con consumidores anteriores del generador CSV.
export const generatePharmacyReport = (sales, options) => buildPharmacyReport(sales, options).csv;


