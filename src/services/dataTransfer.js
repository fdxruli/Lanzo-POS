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

// Encabezados para el CSV de Inventario
const CSV_HEADERS = [
  'id', 'name', 'barcode', 'description', 'price', 'cost', 'stock',
  'category', 'saleType', 'productType',
  'minStock', 'maxStock',
  'sustancia', 'laboratorio', 'requiresPrescription', 'presentation'
];

/**
 * 🚀 EXPORTACIÓN INTELIGENTE DE INVENTARIO (Streaming)
 * Reemplaza a la antigua 'generateCSV'.
 * Lee los productos uno por uno y descarga el archivo directamente.
 */
export const downloadInventorySmart = async () => {
  // 1. Cargamos categorías primero (son pocas, caben en memoria)
  const categories = await loadData(STORES.CATEGORIES);
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  // 2. Preparamos el inicio del archivo
  const headerRow = CSV_HEADERS.join(',') + '\n';
  const fileParts = [headerRow]; // Aquí acumularemos los trozos (chunks)

  // 3. Función auxiliar para limpiar textos (evitar romper el CSV con comillas)
  const clean = (txt) => `"${(txt || '').replace(/"/g, '""')}"`;

  try {
    // 4. Usamos el streaming de la base de datos
    await streamStoreToCSV(
      STORES.MENU, // Leemos la tienda de Productos
      (product) => {
        // --- LOGICA POR FILA ---
        const catName = catMap.get(product.categoryId) || '';

        // Nota: Confiamos en que 'product.stock' está sincronizado. 
        // Si usas lotes, asegúrate de correr "Sincronizar Stock" en Configuración antes.
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
        // --- CADA VEZ QUE SE LLENA UN BLOQUE (500 items) ---
        fileParts.push(chunkString);
      }
    );

    // 5. Crear y Descargar el Archivo
    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob(fileParts, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `inventario_lanzo_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Limpieza de memoria
    URL.revokeObjectURL(url);

    return true;

  } catch (error) {
    console.error("Error en exportación inteligente:", error);
    throw error;
  }
};

/**
 * 🚀 EXPORTACIÓN INTELIGENTE DE VENTAS (Streaming)
 * Nueva función para descargar miles de ventas sin crashear.
 */
export const downloadSalesSmart = async () => {
  const headers = ['Fecha', 'Hora', 'Folio', 'Total', 'Metodo', 'Cliente', 'Items'].join(',') + '\n';
  const fileParts = [headers];

  const clean = (txt) => `"${(txt || '').replace(/"/g, '""')}"`;

  try {
    await streamStoreToCSV(
      STORES.SALES,
      (sale) => {
        // Formatear fecha y hora
        const d = new Date(sale.timestamp);
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString();

        // Resumen de items
        const itemsSummary = sale.items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
        const clientText = sale.customerId ? 'Registrado' : 'Público General';

        return [
          dateStr,
          timeStr,
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
    console.error("Error exportando ventas:", error);
    throw error;
  }
};

// --- IMPORTACIÓN (Se mantiene igual, la lógica es compleja de streamear al subir) ---
export const processImport = async (csvContent) => {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  const headers = lines[0].split(',');

  if (!headers.includes('name') || !headers.includes('price')) {
    throw new Error('El archivo no tiene las columnas obligatorias: name, price');
  }

  const productsToSave = [];
  const batchesToSave = [];
  const errors = [];

  const existingCats = await loadData(STORES.CATEGORIES);
  const catNameMap = new Map(existingCats.map(c => [c.name.toLowerCase(), c.id]));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Regex para manejar comas dentro de comillas
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    const values = line.split(regex).map(val => val.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

    if (values.length < 2) continue;

    const row = {};
    headers.forEach((header, index) => {
      if (values[index] !== undefined) {
        row[header.trim()] = values[index];
      }
    });

    if (!row.name) {
      errors.push(`Fila ${i + 1}: Falta el nombre del producto.`);
      continue;
    }

    try {
      const newId = (row.id && row.id.length > 5) ? row.id : generateID('prod');

      let catId = '';
      if (row.category) {
        const catLower = row.category.toLowerCase();
        if (catNameMap.has(catLower)) {
          catId = catNameMap.get(catLower);
        }
      }

      const stock = parseFloat(row.stock) || 0;
      const cost = parseFloat(row.cost) || 0;

      const product = {
        id: newId,
        name: row.name,
        barcode: row.barcode || '',
        description: row.description || '',
        price: parseFloat(row.price) || 0,
        categoryId: catId,
        saleType: row.saleType || 'unit',
        productType: row.productType || 'sellable',
        minStock: row.minStock ? parseFloat(row.minStock) : null,
        maxStock: row.maxStock ? parseFloat(row.maxStock) : null,
        sustancia: row.sustancia || null,
        laboratorio: row.laboratorio || null,
        requiresPrescription: (row.requiresPrescription || '').toUpperCase() === 'SI',
        presentation: row.presentation || null,
        isActive: true,
        createdAt: new Date().toISOString(),
        trackStock: true,
        stock: stock,
        batchManagement: { enabled: true, selectionStrategy: 'fifo' },
        image: null
      };

      productsToSave.push(product);

      // Si tiene stock/costo, creamos un lote de importación
      if (stock > 0 || cost > 0) {
        batchesToSave.push({
          id: `batch-imp-${newId}-${Date.now()}`,
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
      errors.push(`Fila ${i + 1}: Error procesando datos (${err.message})`);
    }
  }

  let successCount = 0;

  // 1. Guardar Productos (Safe)
  if (productsToSave.length > 0) {
    const result = await saveBulkSafe(STORES.MENU, productsToSave);

    if (result.success) {
      successCount = productsToSave.length;
    } else {
      console.error("Error importando productos:", result.error);
      errors.push(`FATAL: No se pudieron guardar los productos. ${result.error.message}`);
      // Si fallan los productos, no intentamos guardar los lotes para evitar inconsistencia
      return { success: false, importedCount: 0, errors };
    }
  }

  // 2. Guardar Lotes (Safe)
  if (batchesToSave.length > 0) {
    const batchResult = await saveBulkSafe(STORES.PRODUCT_BATCHES, batchesToSave);

    if (!batchResult.success) {
      console.error("Error importando lotes:", batchResult.error);
      errors.push(`ADVERTENCIA: Los productos se crearon, pero falló el registro de stock inicial (Lotes). Error: ${batchResult.error.message}`);
    }
  }

  return {
    success: true,
    importedCount: successCount,
    errors
  };
};

/**
 * Utilería simple para descargar strings (usada por reportes pequeños)
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

// --- REPORTES ESPECÍFICOS (Se mantienen igual) ---

export const generatePharmacyReport = (sales) => {
  // ... (Tu código actual de farmacia se queda igual)
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
  // Nota: Esto sigue cargando todo a memoria para JSON.
  // Es aceptable para backups medianos, pero a futuro también debería ser streaming.
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
 * Escribe directamente al disco si es posible, o usa chunks de memoria.
 */
export const downloadBackupSmart = async () => {
  const fileName = `RESPALDO_LANZO_${new Date().toISOString().split('T')[0]}.jsonl`;

  // ESTRATEGIA A: File System Access API (PC/Chrome/Edge) - CERO RAM
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

      // Aquí ocurre la magia: escribimos directo al disco conforme leemos de la BD
      await streamAllDataToJSONL(async (chunkString) => {
        await writable.write(chunkString);
      });

      await writable.close();
      return true; // Éxito
    } catch (err) {
      if (err.name === 'AbortError') return false; // Usuario canceló
      console.warn("FS API falló, usando fallback Blob...", err);
      // Si falla, pasamos a la Estrategia B
    }
  }

  // ESTRATEGIA B: Fallback Clásico (Móviles/Firefox) - RAM Optimizada
  // Aún acumulamos en memoria, pero strings planos pesan menos que objetos JS.
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