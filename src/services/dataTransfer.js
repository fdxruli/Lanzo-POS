// src/services/dataTransfer.js
import { saveData, saveBulk, loadData, STORES } from './database';

// Definimos las columnas que tendrá nuestro Excel/CSV
const CSV_HEADERS = [
  'id', 'name', 'barcode', 'description', 'price', 'cost', 'stock', 
  'category', 'saleType', 'productType', 
  'minStock', 'maxStock', 
  'sustancia', 'laboratorio', 'requiresPrescription', 'presentation'
];

/**
 * Convierte un array de objetos a formato CSV string
 */
export const generateCSV = (products, batches, categories) => {
  // Mapa de categorías para exportar el Nombre en vez del ID
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  // Mapa de lotes para obtener costo y stock total actual
  const batchMap = new Map();
  batches.forEach(b => {
    if (!b.isActive) return;
    if (!batchMap.has(b.productId)) {
      batchMap.set(b.productId, { stock: 0, cost: 0 });
    }
    const current = batchMap.get(b.productId);
    current.stock += b.stock;
    // Usamos el costo del último lote (o promedio) para la exportación
    current.cost = b.cost; 
  });

  // Construimos las filas
  const rows = products.map(p => {
    const batchInfo = batchMap.get(p.id) || { stock: 0, cost: p.cost || 0 };
    const catName = catMap.get(p.categoryId) || '';
    
    return [
      p.id,
      `"${(p.name || '').replace(/"/g, '""')}"`, // Escapar comillas en nombres
      p.barcode || '',
      `"${(p.description || '').replace(/"/g, '""')}"`,
      p.price || 0,
      batchInfo.cost || 0,
      batchInfo.stock || 0,
      `"${catName}"`,
      p.saleType || 'unit',
      p.productType || 'sellable',
      p.minStock || '',
      p.maxStock || '',
      p.sustancia || '',
      p.laboratorio || '',
      p.requiresPrescription ? 'SI' : 'NO',
      p.presentation || ''
    ].join(',');
  });

  return [CSV_HEADERS.join(','), ...rows].join('\n');
};

/**
 * Procesa el contenido de un archivo CSV y guarda los productos
 */
export const processImport = async (csvContent) => {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  const headers = lines[0].split(',');
  
  // Validar headers mínimos
  if (!headers.includes('name') || !headers.includes('price')) {
    throw new Error('El archivo no tiene las columnas obligatorias: name, price');
  }

  const productsToSave = [];
  const batchesToSave = [];
  const errors = [];
  
  // Cargamos categorías existentes para intentar vincularlas por nombre
  const existingCats = await loadData(STORES.CATEGORIES);
  const catNameMap = new Map(existingCats.map(c => [c.name.toLowerCase(), c.id]));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Regex para separar por comas pero ignorar las que están entre comillas
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/; 
    const values = line.split(regex).map(val => val.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

    if (values.length < 2) continue; // Línea vacía

    // Mapear valores a un objeto basado en headers
    const row = {};
    headers.forEach((header, index) => {
      row[header.trim()] = values[index];
    });

    // VALIDACIONES BÁSICAS
    if (!row.name) {
      errors.push(`Fila ${i + 1}: Falta el nombre del producto.`);
      continue;
    }

    try {
      const newId = row.id && row.id.length > 5 ? row.id : `prod-imp-${Date.now()}-${i}`;
      
      // Resolver Categoría
      let catId = '';
      if (row.category) {
        const catLower = row.category.toLowerCase();
        if (catNameMap.has(catLower)) {
          catId = catNameMap.get(catLower);
        } else {
          // Opcional: Crear categoría si no existe (por ahora lo dejamos sin categoría)
        }
      }

      // 1. OBJETO PRODUCTO
      const product = {
        id: newId,
        name: row.name,
        barcode: row.barcode || '',
        description: row.description || '',
        price: parseFloat(row.price) || 0,
        categoryId: catId,
        saleType: row.saleType || 'unit',
        productType: row.productType || 'sellable',
        // Campos avanzados
        minStock: row.minStock ? parseFloat(row.minStock) : null,
        maxStock: row.maxStock ? parseFloat(row.maxStock) : null,
        sustancia: row.sustancia || null,
        laboratorio: row.laboratorio || null,
        requiresPrescription: (row.requiresPrescription || '').toUpperCase() === 'SI',
        presentation: row.presentation || null,
        
        isActive: true,
        createdAt: new Date().toISOString(),
        batchManagement: { enabled: true, selectionStrategy: 'fifo' },
        // Campos de imagen (no se importan por CSV, se dejan null)
        image: null 
      };
      
      productsToSave.push(product);

      // 2. OBJETO LOTE (Si trae stock o costo)
      const stock = parseFloat(row.stock) || 0;
      const cost = parseFloat(row.cost) || 0;

      if (stock > 0 || cost > 0) {
        batchesToSave.push({
          id: `batch-imp-${newId}-${Date.now()}`,
          productId: newId,
          stock: stock,
          cost: cost,
          price: product.price, // Precio del lote igual al producto
          createdAt: new Date().toISOString(),
          expiryDate: null, // El CSV simple no suele traer fechas, pero se podría agregar
          isActive: stock > 0,
          trackStock: true,
          notes: 'Importado masivamente'
        });
      }

    } catch (err) {
      errors.push(`Fila ${i + 1}: Error procesando datos (${err.message})`);
    }
  }

  // GUARDADO MASIVO (Transaccional-ish)
  if (productsToSave.length > 0) {
    await saveBulk(STORES.MENU, productsToSave);
  }
  if (batchesToSave.length > 0) {
    await saveBulk(STORES.PRODUCT_BATCHES, batchesToSave);
  }

  return { 
    success: true, 
    importedCount: productsToSave.length, 
    errors 
  };
};

/**
 * Descarga un string como archivo .csv en el navegador
 */
export const downloadFile = (content, filename) => {
  const blob = new Blob(["\ufeff" + content], { type: 'text/csv;charset=utf-8;' }); // \ufeff es BOM para que Excel lea UTF-8
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};