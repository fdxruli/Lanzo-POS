import { BACKUP_DATA_CATEGORIES, BACKUP_TABLE_NAMES } from './backupScope';
import { db } from '../db/dexie';
import { STORES, productsRepository } from '../db';
import { generalRepository } from '../db/general';
import {
  captureActiveTenantWorkerContext,
  isActiveTenantWorkerContext
} from '../tenant/tenantWorkerContext';

export const PORTABLE_DATA_FORMAT = 'lanzo-portable-data';
export const PORTABLE_DATA_VERSION = 1;
export const PORTABLE_TRANSFER_TABLES = Object.freeze([
  'categories',
  'menu',
  'customers',
  'images',
  'ingredients'
]);

const EXCLUDED_FIELDS = new Set([
  'accesstoken', 'refreshtoken', 'authorization', 'password', 'passwordhash',
  'licensekey', 'licensetoken', 'deviceid', 'devicefingerprint',
  'openedbydeviceid', 'localstationkey', 'sessiontoken', 'privatekey',
  'backupkey', 'backupverifier', 'idempotencykey', 'tenantidentity',
  'databasename', 'cashstationdeviceid', 'apikey', 'credential', 'secret',
  'token', 'salt', 'verifier', 'cashstationkey', 'syncauthorization'
]);

const omitField = (key) => {
  const normalized = String(key).replace(/[_-]/g, '').toLowerCase();
  return EXCLUDED_FIELDS.has(normalized)
    || normalized.endsWith('token')
    || normalized.endsWith('apikey')
    || normalized.endsWith('password');
};
const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase();
const normalizeBarcode = (value) => String(value || '').trim().toUpperCase();
const csvDate = () => new Date().toISOString().slice(0, 10);

const assertCurrentContext = (context) => {
  if (!isActiveTenantWorkerContext(context)) throw new Error('DATA_TRANSFER_CONTEXT_CHANGED');
};

const getContext = () => {
  try {
    return captureActiveTenantWorkerContext();
  } catch {
    throw new Error('DATA_TRANSFER_TENANT_REQUIRED');
  }
};

const encodeBase64 = (bytes) => {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
};

const decodeBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

async function serializePortableValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      __lanzoBinary: true,
      type: value.type || 'application/octet-stream',
      data: encodeBase64(new Uint8Array(await value.arrayBuffer()))
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return Promise.all(value.map((item) => serializePortableValue(item, seen)));
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (omitField(key)) continue;
    result[key] = await serializePortableValue(item, seen);
  }
  seen.delete(value);
  return result;
}

const portableTransferRow = (tableName, source) => {
  const fieldsByTable = {
    categories: ['id', 'name', 'isActive', 'sortOrder', 'description'],
    menu: [
      'id', 'name', 'barcode', 'sku', 'description', 'categoryId', 'price', 'saleType',
      'productType', 'minStock', 'maxStock', 'isActive', 'trackStock', 'batchManagement',
      'recipe', 'modifiers', 'wholesaleTiers', 'prescriptionType', 'activeSubstance',
      'laboratory', 'sustancia', 'laboratorio', 'requiresPrescription', 'presentation',
      'expirationMode', 'shelfLifeValue', 'shelfLifeUnit', 'bulkData', 'conversionFactor',
      'unit', 'unitOfMeasure', 'brand', 'marca', 'talla', 'color', 'genero', 'modelo',
      'preparationTime', 'prepTime', 'alergenos', 'allergens', 'attributes', 'image'
    ],
    customers: ['id', 'name', 'phone', 'address', 'isActive'],
    images: ['id', 'blob', 'type'],
    ingredients: ['id', 'name', 'description', 'unit', 'unitOfMeasure', 'productType', 'saleType', 'isActive']
  };
  const fields = fieldsByTable[tableName] || [];
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(source || {}, field) && !omitField(field))
    .map((field) => [field, source[field]]));
};

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

const assertValidTableSelection = (tableNames) => {
  const selected = [...new Set(tableNames || BACKUP_TABLE_NAMES)];
  if (selected.length === 0 || selected.some((name) => !BACKUP_TABLE_NAMES.includes(name))) {
    throw new Error('DATA_TRANSFER_TABLE_NOT_SUPPORTED');
  }
  return BACKUP_TABLE_NAMES.filter((name) => selected.includes(name));
};

const buildTransferCatalogVariants = (batches = []) => {
  const grouped = new Map();
  for (const batch of batches) {
    const talla = String(batch?.attributes?.talla || '').trim();
    const color = String(batch?.attributes?.color || '').trim();
    if (!batch?.productId || (!talla && !color)) continue;
    const variant = {
      talla,
      color,
      sku: String(batch.sku || '').trim(),
      price: Number.isFinite(Number(batch.price)) && Number(batch.price) >= 0 ? Number(batch.price) : 0
    };
    const key = `${talla}\n${color}\n${variant.sku}`;
    if (!grouped.has(batch.productId)) grouped.set(batch.productId, new Map());
    if (!grouped.get(batch.productId).has(key)) grouped.get(batch.productId).set(key, variant);
  }
  return Object.fromEntries([...grouped].map(([productId, variants]) => [productId, [...variants.values()]]));
};

export async function createPortableDataBundle({
  tableNames = BACKUP_TABLE_NAMES,
  transferOnly = false,
  assertAuthorized = () => {}
} = {}) {
  const context = getContext();
  assertAuthorized();
  const requestedTableNames = assertValidTableSelection(tableNames);
  const selectedTableNames = transferOnly
    ? [...new Set([...PORTABLE_TRANSFER_TABLES, 'product_batches'])]
    : requestedTableNames;
  const packageTableNames = transferOnly
    ? PORTABLE_TRANSFER_TABLES
    : selectedTableNames;
  await db.open();
  assertCurrentContext(context);
  const recordsByTable = await db.transaction('r', selectedTableNames.map((name) => db.table(name)), async () => {
    const values = {};
    for (const tableName of selectedTableNames) {
      values[tableName] = await db.table(tableName).toArray();
    }
    return values;
  });
  assertAuthorized();
  assertCurrentContext(context);

  const portableTables = {};
  for (const tableName of packageTableNames) {
    const rows = tableName === 'sequences'
      ? recordsByTable[tableName].filter((row) => row?.id === 'sale_folio')
      : recordsByTable[tableName];
    const projectedRows = transferOnly
      ? rows.map((row) => portableTransferRow(tableName, row))
      : rows;
    portableTables[tableName] = await serializePortableValue(projectedRows);
  }
  assertAuthorized();
  assertCurrentContext(context);
  const tableCounts = Object.fromEntries(packageTableNames.map((tableName) => [
    tableName,
    portableTables[tableName].length
  ]));
  const bundle = {
    format: PORTABLE_DATA_FORMAT,
    version: PORTABLE_DATA_VERSION,
    createdAt: new Date().toISOString(),
    schemaVersion: db.verno,
    dataKind: transferOnly ? 'catalog-transfer' : 'business-data-export',
    datasetId: crypto.randomUUID(),
    tableCounts,
    categories: BACKUP_DATA_CATEGORIES,
    transfer: {
      datasetId: '',
      tables: transferOnly
        ? [...PORTABLE_TRANSFER_TABLES]
        : selectedTableNames.filter((name) => PORTABLE_TRANSFER_TABLES.includes(name)),
      catalogVariants: buildTransferCatalogVariants(recordsByTable.product_batches),
      rules: {
        inventory: 'Excluded from catalog transfer; new businesses start with zero stock.',
        financialHistory: 'Sales, credit history, payments, cash sessions, and movements are never imported by catalog transfer.'
      }
    },
    data: { tables: portableTables }
  };
  bundle.transfer.datasetId = bundle.datasetId;
  return bundle;
}

export async function downloadPortableDataPackage(options = {}) {
  const bundle = await createPortableDataBundle(options);
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json;charset=utf-8' });
  const fileName = `lanzo_portabilidad_${csvDate()}.lanzo.json`;
  options.assertAuthorized?.();
  downloadBlob(blob, fileName);
  return { fileName, size: blob.size, tableCounts: bundle.tableCounts };
}

export const formulaSafeCell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = typeof value === 'object'
    ? JSON.stringify(value, (_key, item) => (item instanceof Blob ? '[imagen; consulta el paquete JSON]' : item))
    : String(value);
  if (/^[=+@-]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export async function downloadPortableTableCsv(tableName, { assertAuthorized = () => {} } = {}) {
  if (!BACKUP_TABLE_NAMES.includes(tableName)) throw new Error('DATA_TRANSFER_TABLE_NOT_SUPPORTED');
  const context = getContext();
  assertAuthorized();
  await db.open();
  assertCurrentContext(context);
  const rows = await db.transaction('r', [db.table(tableName)], () => db.table(tableName).toArray());
  assertAuthorized();
  assertCurrentContext(context);
  const portableRows = tableName === 'sequences'
    ? rows.filter((row) => row?.id === 'sale_folio')
    : rows;
  const sanitized = await serializePortableValue(portableRows);
  assertAuthorized();
  const columns = [...new Set(sanitized.flatMap((row) => Object.keys(row || {})))];
  const csv = [columns.map(formulaSafeCell).join(','), ...sanitized.map((row) => (
    columns.map((column) => formulaSafeCell(row?.[column])).join(',')
  ))].join('\r\n');
  const fileName = `lanzo_${tableName}_${csvDate()}.csv`;
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), fileName);
  return { fileName, rowCount: sanitized.length };
}

export function parseCsvDocument(csvContent) {
  const input = String(csvContent || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('El CSV tiene comillas sin cerrar.');
  row.push(field.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

const parseCsvProducts = (csvContent) => {
  const rows = parseCsvDocument(csvContent);
  if (rows.length < 2) throw new Error('El archivo está vacío o solo tiene encabezados.');
  const headers = rows[0].map((value) => value.toLowerCase().trim());
  if (!headers.includes('name') || !headers.includes('price')) {
    throw new Error('El archivo debe incluir las columnas name y price.');
  }
  return rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? '']))
  }));
};

const stableHash = async (value) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const csvDestinationSnapshot = ({ existingProducts = [], existingCategories = [], existingBatches = [] }) => JSON.stringify({
  products: existingProducts.map((product) => ({
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    transferSourceKey: product.transferSourceKey,
    stock: product.stock,
    committedStock: product.committedStock,
    cost: product.cost,
    hasBatches: product.hasBatches
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  categories: existingCategories.map(({ id, name }) => ({ id, name }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  batchIds: existingBatches.map(({ id }) => id).sort((left, right) => String(left).localeCompare(String(right)))
});

const safeProductFields = (source) => {
  const result = { ...source };
  for (const field of [
    'stock', 'committedStock', 'cost', 'hasBatches', 'activeStockStatus',
    'lowStockAlertStatus', 'pendingOperationId', 'syncStatus', 'serverVersion',
    'lastSyncedAt', 'cloudUpdatedAt', 'cloudSaleId', 'cloudSalesSyncStatus'
  ]) delete result[field];
  for (const key of Object.keys(result)) if (omitField(key)) delete result[key];
  return result;
};

const readCsvRows = (csvContent) => parseCsvProducts(csvContent).map(({ rowNumber, values }) => {
  const name = String(values.name || '').trim();
  const price = values.price === '' ? Number.NaN : Number(values.price);
  const stock = values.stock === undefined || values.stock === '' ? 0 : Number(values.stock);
  const cost = values.cost === undefined || values.cost === '' ? 0 : Number(values.cost);
  const sourceId = String(values.id || '').trim();
  const barcode = String(values.barcode || '').trim();
  const sourceKey = sourceId ? `id:${sourceId}` : barcode ? `barcode:${normalizeBarcode(barcode)}` : '';
  const errors = [];
  if (!name) errors.push('Falta el nombre.');
  if (!Number.isFinite(price) || price < 0) errors.push('El precio debe ser un número válido no negativo.');
  if (!Number.isFinite(stock) || stock < 0) errors.push('El stock debe ser un número válido no negativo.');
  if (!Number.isFinite(cost) || cost < 0) errors.push('El costo debe ser un número válido no negativo.');
  if (!sourceKey) errors.push('Agrega un ID o código de barras para que la importación repetida sea idempotente.');
  const categoryName = String(values.category || '').trim();
  const source = { ...values };
  return {
    rowNumber,
    sourceId,
    sourceKey,
    name,
    barcode,
    categoryName,
    normalizedCategory: normalizeName(categoryName),
    price,
    stock,
    cost,
    errors,
    source
  };
});

const makeProductFromCsv = (entry, id, categoryId, marker) => {
  const source = entry.source;
  const product = {
    id,
    name: entry.name,
    barcode: entry.barcode,
    description: source.description || '',
    price: entry.price,
    cost: entry.cost,
    categoryId: categoryId || '',
    saleType: ['bulk', 'granel', 'kg', 'kilo', 'peso', 'gramos', 'litros', 'lt'].includes(String(source.saletype || source.sale_type || source.tipo_venta || 'unit').toLowerCase()) ? 'bulk' : 'unit',
    productType: ['ingredient', 'ingrediente', 'insumo', 'materia prima'].includes(String(source.producttype || source.product_type || source.tipo_producto || 'sellable').toLowerCase()) ? 'ingredient' : 'sellable',
    minStock: source.minstock ? Number(source.minstock) : null,
    maxStock: source.maxstock ? Number(source.maxstock) : null,
    stock: entry.stock,
    committedStock: 0,
    isActive: true,
    trackStock: true,
    batchManagement: { enabled: true, selectionStrategy: 'fifo' },
    requiresPrescription: ['si', 'sí', 'yes', 'true', '1'].includes(String(source.requiresprescription || source.receta || '').toLowerCase()),
    createdAt: new Date().toISOString(),
    transferSourceKey: marker
  };
  for (const [field, value] of Object.entries(source)) {
    if ([
      'marca', 'brand', 'talla', 'size', 'color', 'genero', 'gender', 'modelo', 'model',
      'active_substance', 'activeingredient', 'sustancia', 'laboratorio', 'laboratory',
      'presentation', 'preparacion_minutos', 'preparationtime', 'preptime', 'alergenos',
      'allergens', 'unidad_medida', 'unit', 'unitofmeasure'
    ].includes(field) && !omitField(field) && value !== '') product[field] = value;
  }
  return product;
};

async function buildCsvImportPlan(csvContent, { existingProducts, existingCategories, existingBatches = [] }) {
  const entries = readCsvRows(csvContent);
  const errors = [];
  const existingByMarker = new Map(existingProducts
    .filter((product) => product.transferSourceKey)
    .map((product) => [product.transferSourceKey, product]));
  const existingByBarcode = new Map();
  for (const product of existingProducts) {
    const barcode = normalizeBarcode(product.barcode);
    if (!barcode) continue;
    if (!existingByBarcode.has(barcode)) existingByBarcode.set(barcode, []);
    existingByBarcode.get(barcode).push(product);
  }
  const categoriesByName = new Map();
  for (const category of existingCategories) {
    const key = normalizeName(category.name);
    if (!key) continue;
    if (!categoriesByName.has(key)) categoriesByName.set(key, []);
    categoriesByName.get(key).push(category);
  }
  const categoryCreates = new Map();
  const accepted = [];
  const updates = [];
  const duplicates = [];
  const conflicts = [];
  const rejected = [];
  const seenSources = new Set();

  for (const entry of entries) {
    if (entry.errors.length) {
      rejected.push(entry);
      errors.push(`Fila ${entry.rowNumber}: ${entry.errors.join(' ')}`);
      continue;
    }
    const marker = `csv:${entry.sourceKey}`;
    if (seenSources.has(marker)) {
      conflicts.push(entry);
      errors.push(`Fila ${entry.rowNumber}: ID o código de barras repetido dentro del archivo.`);
      continue;
    }
    seenSources.add(marker);
    let categoryId = '';
    if (entry.normalizedCategory) {
      const matches = categoriesByName.get(entry.normalizedCategory) || [];
      if (matches.length > 1) {
        conflicts.push(entry);
        errors.push(`Fila ${entry.rowNumber}: Hay varias categorías con ese nombre; resuelve el conflicto antes de importar.`);
        continue;
      }
      if (matches.length === 1) categoryId = matches[0].id;
      else {
        let category = categoryCreates.get(entry.normalizedCategory);
        if (!category) {
          const id = `transfer-category-${await stableHash(entry.normalizedCategory)}`;
          const occupiedId = existingCategories.find((candidate) => candidate.id === id);
          if (occupiedId) {
            conflicts.push(entry);
            errors.push(`Fila ${entry.rowNumber}: El identificador generado para la categoría ya está ocupado.`);
            continue;
          }
          category = { id, name: entry.categoryName, isActive: true };
          categoryCreates.set(entry.normalizedCategory, category);
        }
        categoryId = category.id;
      }
    }
    const existing = existingByMarker.get(marker);
    if (existing) {
      if (normalizeName(existing.name) !== normalizeName(entry.name)
        || normalizeBarcode(existing.barcode) !== normalizeBarcode(entry.barcode)) {
        conflicts.push(entry);
        errors.push(`Fila ${entry.rowNumber}: El ID o código del archivo ya pertenece a otro producto importado.`);
        continue;
      }
      updates.push({ entry, existing, marker, categoryId });
      continue;
    }
    const barcodeMatches = entry.barcode ? existingByBarcode.get(normalizeBarcode(entry.barcode)) || [] : [];
    if (barcodeMatches.length > 0) {
      if (barcodeMatches.length === 1 && normalizeName(barcodeMatches[0].name) === normalizeName(entry.name)) {
        duplicates.push(entry);
        continue;
      }
      conflicts.push(entry);
      errors.push(`Fila ${entry.rowNumber}: El código de barras ya pertenece a otro producto.`);
      continue;
    }
    const id = `transfer-product-${await stableHash(entry.sourceKey)}`;
    if (existingProducts.some((product) => product.id === id)) {
      conflicts.push(entry);
      errors.push(`Fila ${entry.rowNumber}: El identificador interno ya existe; revisa el archivo antes de importar.`);
      continue;
    }
    const batchId = entry.stock > 0 ? `transfer-batch-${await stableHash(marker)}` : null;
    if (batchId && existingBatches.some((batch) => batch.id === batchId)) {
      conflicts.push(entry);
      errors.push(`Fila ${entry.rowNumber}: El identificador del lote inicial ya está ocupado.`);
      continue;
    }
    accepted.push({ entry, id, categoryId, marker, batchId });
  }
  return {
    accepted,
    updates,
    duplicates,
    conflicts,
    rejected,
    errors,
    categoryCreates: [...categoryCreates.values()],
    summary: {
      total: entries.length,
      valid: entries.length - rejected.length - conflicts.length,
      create: accepted.length,
      update: updates.length,
      duplicates: duplicates.length,
      conflicts: conflicts.length,
      rejected: rejected.length,
      initialInventoryProducts: accepted.filter(({ entry }) => entry.stock > 0).length,
      categoriesCreated: categoryCreates.size
    }
  };
}

export async function previewProductCsvImport(csvContent, { assertAuthorized = () => {} } = {}) {
  const context = getContext();
  assertAuthorized();
  await db.open();
  const snapshot = await db.transaction('r', [db.table(STORES.MENU), db.table(STORES.CATEGORIES), db.table(STORES.PRODUCT_BATCHES)], async () => ({
    existingProducts: await db.table(STORES.MENU).toArray(),
    existingCategories: await db.table(STORES.CATEGORIES).toArray(),
    existingBatches: await db.table(STORES.PRODUCT_BATCHES).toArray()
  }));
  assertAuthorized();
  assertCurrentContext(context);
  return buildCsvImportPlan(csvContent, snapshot);
}

export async function importProductCsv(csvContent, { assertAuthorized = () => {} } = {}) {
  const context = getContext();
  assertAuthorized();
  await db.open();
  assertCurrentContext(context);
  const snapshot = await db.transaction('r', [
    db.table(STORES.MENU), db.table(STORES.CATEGORIES), db.table(STORES.PRODUCT_BATCHES)
  ], async () => ({
    existingProducts: await db.table(STORES.MENU).toArray(),
    existingCategories: await db.table(STORES.CATEGORIES).toArray(),
    existingBatches: await db.table(STORES.PRODUCT_BATCHES).toArray()
  }));
  assertAuthorized();
  assertCurrentContext(context);
  const plan = await buildCsvImportPlan(csvContent, snapshot);
  if (plan.conflicts.length > 0) throw new Error('DATA_TRANSFER_CONFLICTS_REVIEW');
  let result;
  await db.transaction('rw', [
    db.table(STORES.MENU), db.table(STORES.CATEGORIES), db.table(STORES.PRODUCT_BATCHES)
  ], async () => {
    assertAuthorized();
    assertCurrentContext(context);
    const currentSnapshot = {
      existingProducts: await db.table(STORES.MENU).toArray(),
      existingCategories: await db.table(STORES.CATEGORIES).toArray(),
      existingBatches: await db.table(STORES.PRODUCT_BATCHES).toArray()
    };
    if (csvDestinationSnapshot(currentSnapshot) !== csvDestinationSnapshot(snapshot)) {
      throw new Error('DATA_TRANSFER_DESTINATION_CHANGED_REVIEW_AGAIN');
    }
    const currentProductsById = new Map(currentSnapshot.existingProducts.map((product) => [product.id, product]));
    for (const category of plan.categoryCreates) {
      assertAuthorized();
      await db.table(STORES.CATEGORIES).put(category);
    }
    for (const { entry, id, categoryId, marker, batchId } of plan.accepted) {
      const product = makeProductFromCsv(entry, id, categoryId, marker);
      const batches = entry.stock > 0 ? [{
        id: batchId,
        productId: id,
        stock: entry.stock,
        committedStock: 0,
        cost: entry.cost,
        price: entry.price,
        expiryDate: entry.source.expirydate || entry.source.fecha_caducidad || null,
        manufacturerBatchId: entry.source.manufacturerbatchid || entry.source.lote_fabricante || null,
        trackStock: true,
        isActive: true,
        notes: 'Inventario inicial importado'
      }] : [];
      assertAuthorized();
      await productsRepository.createProductWithInitialInventory(product, batches);
      assertCurrentContext(context);
    }
    for (const { entry, existing, marker, categoryId } of plan.updates) {
      const currentExisting = currentProductsById.get(existing.id);
      if (!currentExisting) throw new Error('DATA_TRANSFER_DESTINATION_CHANGED_REVIEW_AGAIN');
      const updated = {
        ...currentExisting,
        ...safeProductFields(makeProductFromCsv(entry, currentExisting.id, categoryId || currentExisting.categoryId || '', marker)),
        id: currentExisting.id,
        stock: currentExisting.stock,
        committedStock: currentExisting.committedStock,
        cost: currentExisting.cost,
        hasBatches: currentExisting.hasBatches,
        updatedAt: new Date().toISOString()
      };
      assertAuthorized();
      await generalRepository.save(STORES.MENU, updated);
      assertCurrentContext(context);
    }
    result = {
      success: true,
      importedCount: plan.accepted.length,
      updatedCount: plan.updates.length,
      duplicateCount: plan.duplicates.length,
      conflicts: plan.conflicts.length,
      errors: plan.errors,
      summary: plan.summary
    };
  });
  assertAuthorized();
  assertCurrentContext(context);
  return result;
}

const decodePortableValue = (value) => {
  if (Array.isArray(value)) return value.map(decodePortableValue);
  if (!value || typeof value !== 'object') return value;
  if (value.__lanzoBinary === true && typeof value.data === 'string') {
    return new Blob([decodeBase64(value.data)], { type: value.type || 'application/octet-stream' });
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodePortableValue(item)]));
};

const getPortableTables = (bundle) => {
  if (bundle?.format !== PORTABLE_DATA_FORMAT || bundle?.version !== PORTABLE_DATA_VERSION) {
    throw new Error('El archivo de portabilidad no es compatible.');
  }
  if (bundle?.dataKind !== 'catalog-transfer') {
    throw new Error('Selecciona un paquete de transferencia de catálogo, no una exportación de consulta.');
  }
  if (!bundle?.transfer?.datasetId || !Array.isArray(bundle.transfer.tables)
    || !bundle?.data?.tables || typeof bundle.data.tables !== 'object') {
    throw new Error('El archivo no contiene un catálogo transferible válido.');
  }
  const tables = bundle.data.tables;
  if (PORTABLE_TRANSFER_TABLES.some((name) => !bundle.transfer.tables.includes(name) || !Array.isArray(tables[name]))) {
    throw new Error('El paquete no contiene todas las tablas necesarias para transferir el catálogo.');
  }
  if (bundle.transfer.tables.some((name) => !PORTABLE_TRANSFER_TABLES.includes(name))) {
    throw new Error('El paquete solicita importar una tabla no admitida como catálogo.');
  }
  for (const name of bundle.transfer.tables) {
    if (bundle.tableCounts?.[name] !== tables[name].length) {
      throw new Error(`El archivo está incompleto en la tabla ${name}.`);
    }
  }
  return Object.fromEntries(PORTABLE_TRANSFER_TABLES.map((name) => [name, Array.isArray(tables[name]) ? tables[name] : []]));
};

const catalogDestinationReviewSnapshot = (existing) => ({
  categories: existing.categories.map(({ id, name, isActive }) => ({ id, name, isActive }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  products: existing.products.map(({ id, name, barcode, categoryId, price, updatedAt, stock, committedStock, transferSourceKey }) => ({
    id, name, barcode, categoryId, price, updatedAt, stock, committedStock, transferSourceKey
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  customers: existing.customers.map(({ id, name, phone, updatedAt, metadata }) => ({
    id, name, phone, updatedAt, portabilitySourceKey: metadata?.portabilitySourceKey || ''
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  images: existing.images.map(({ id, transferSourceKey }) => ({ id, transferSourceKey }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  ingredients: existing.ingredients.map(({ id, name, transferSourceKey }) => ({ id, name, transferSourceKey }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  productBatches: (existing.productBatches || []).map(({ id }) => id)
    .sort((left, right) => String(left).localeCompare(String(right)))
});

async function buildCatalogTransferPlan(bundle, existing) {
  const source = getPortableTables(bundle);
  const datasetId = String(bundle.transfer.datasetId);
  const errors = [];
  const conflicts = [];
  const categoryCreates = [];
  const categoryIdMap = new Map();
  const categorySourceById = new Map(source.categories.map((row) => [row?.id, row]));
  const existingCategories = existing.categories;
  const categoriesByName = new Map();
  for (const category of existingCategories) {
    const normalized = normalizeName(category.name);
    if (!normalized) continue;
    if (!categoriesByName.has(normalized)) categoriesByName.set(normalized, []);
    categoriesByName.get(normalized).push(category);
  }

  for (const category of source.categories) {
    if (!category?.id || !String(category.name || '').trim()) {
      errors.push('Se omitió una categoría sin identificador o nombre.');
      continue;
    }
    const normalized = normalizeName(category.name);
    if (categoryIdMap.has(category.id)) {
      conflicts.push(`Categoría “${category.name}”: el archivo repite su identificador.`);
      continue;
    }
    const existingMatches = categoriesByName.get(normalized) || [];
    if (existingMatches.length === 1) {
      categoryIdMap.set(category.id, existingMatches[0].id);
    } else if (existingMatches.length > 1) {
      conflicts.push(`Categoría “${category.name}”: hay varias coincidencias en este negocio.`);
    } else {
      const duplicateInFile = categoryCreates.find((row) => normalizeName(row.name) === normalized);
      const id = `transfer-category-${await stableHash(`${datasetId}:category:${category.id}`)}`;
      if (!duplicateInFile && existingCategories.some((candidate) => candidate.id === id)) {
        conflicts.push(`Categoría “${category.name}”: el identificador generado ya está ocupado en este negocio.`);
        continue;
      }
      const target = duplicateInFile || { id, name: String(category.name).trim(), isActive: category.isActive !== false };
      if (!duplicateInFile) categoryCreates.push(target);
      categoryIdMap.set(category.id, target.id);
    }
  }

  const sourceProducts = source.menu;
  const sourceProductIds = new Set(sourceProducts.map((row) => row?.id).filter(Boolean));
  const existingProductsByMarker = new Map(existing.products
    .filter((product) => product.transferSourceKey)
    .map((product) => [product.transferSourceKey, product]));
  const existingProductsById = new Map(existing.products.map((product) => [product.id, product]));
  const existingProductsByBarcode = new Map();
  for (const product of existing.products) {
    const key = normalizeBarcode(product.barcode);
    if (!key) continue;
    if (!existingProductsByBarcode.has(key)) existingProductsByBarcode.set(key, []);
    existingProductsByBarcode.get(key).push(product);
  }
  const productIdMap = new Map();
  const newProducts = [];
  const productUpdates = [];
  const productDuplicates = [];
  const productConflicts = [];
  const seenSourceIds = new Set();
  const seenSourceBarcodes = new Set();

  for (const product of sourceProducts) {
    if (!product?.id || !String(product.name || '').trim() || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) {
      errors.push(`Se rechazó un producto sin ID, nombre o precio válido.`);
      continue;
    }
    if (seenSourceIds.has(product.id)) {
      productConflicts.push(`Producto ${product.name}: el archivo repite el identificador de origen.`);
      continue;
    }
    seenSourceIds.add(product.id);
    const barcode = normalizeBarcode(product.barcode);
    if (barcode && seenSourceBarcodes.has(barcode)) {
      productConflicts.push(`Producto ${product.name}: el archivo repite el código de barras.`);
      continue;
    }
    if (barcode) seenSourceBarcodes.add(barcode);
    const marker = `${datasetId}:menu:${product.id}`;
    const found = existingProductsByMarker.get(marker);
    const targetId = found?.id || `transfer-product-${await stableHash(marker)}`;
    productIdMap.set(product.id, targetId);
    if (found) {
      const conflictingBarcode = barcode && (existingProductsByBarcode.get(barcode) || [])
        .some((match) => match.id !== found.id);
      if (conflictingBarcode) {
        productConflicts.push(`Producto ${product.name}: su código de barras coincide con otro producto de este negocio.`);
        continue;
      }
      productUpdates.push({ source: product, existing: found, targetId, marker });
      continue;
    }
    const idCollision = existingProductsById.get(targetId);
    if (idCollision) {
      productConflicts.push(`Producto ${product.name}: el identificador generado ya está ocupado.`);
      continue;
    }
    const barcodeMatches = barcode ? existingProductsByBarcode.get(barcode) || [] : [];
    if (barcodeMatches.length > 0) {
      if (barcodeMatches.length === 1 && normalizeName(barcodeMatches[0].name) === normalizeName(product.name)) {
        productDuplicates.push({ source: product, existing: barcodeMatches[0] });
        productIdMap.set(product.id, barcodeMatches[0].id);
      } else {
        productConflicts.push(`Producto ${product.name}: el código de barras ya existe en otro producto.`);
      }
      continue;
    }
    const sourceCategory = product.categoryId ? categorySourceById.get(product.categoryId) : null;
    if (product.categoryId && !sourceCategory) {
      productConflicts.push(`Producto ${product.name}: no se encontró su categoría de origen.`);
      continue;
    }
    if (product.categoryId && !categoryIdMap.has(product.categoryId)) {
      productConflicts.push(`Producto ${product.name}: su categoría tiene un conflicto de nombre.`);
      continue;
    }
    const sourceIngredientIds = new Set(source.ingredients.map((ingredient) => ingredient?.id).filter(Boolean));
    const missingRecipe = (Array.isArray(product.recipe) ? product.recipe : []).some((component) => {
      const productId = component?.productId;
      const ingredientId = component?.ingredientId || component?.ingredient_id;
      return (productId && !sourceProductIds.has(productId))
        || (ingredientId && !sourceIngredientIds.has(ingredientId));
    });
    if (missingRecipe) {
      productConflicts.push(`Producto ${product.name}: una receta apunta a un insumo ausente del archivo.`);
      continue;
    }
    const variants = (Array.isArray(bundle.transfer.catalogVariants?.[product.id])
      ? bundle.transfer.catalogVariants[product.id]
      : []).map((variant) => ({
      talla: String(variant?.talla || '').trim(),
      color: String(variant?.color || '').trim(),
      sku: String(variant?.sku || '').trim(),
      price: Number.isFinite(Number(variant?.price)) && Number(variant.price) >= 0
        ? Number(variant.price)
        : Number(product.price)
    })).filter((variant) => variant.talla || variant.color);
    const variantBatches = await Promise.all(variants.map(async (variant) => ({
      id: `transfer-variant-${await stableHash(`${datasetId}:variant:${product.id}:${variant.talla}:${variant.color}:${variant.sku}`)}`,
      productId: targetId,
      stock: 0,
      committedStock: 0,
      cost: 0,
      price: variant.price,
      sku: variant.sku || null,
      attributes: { talla: variant.talla, color: variant.color },
      trackStock: true,
      isActive: true,
      status: 'active',
      notes: 'Variante transferida sin existencias'
    })));
    const existingBatchIds = new Set((existing.productBatches || []).map(({ id: batchId }) => batchId));
    const plannedBatchIds = new Set();
    if (variantBatches.some(({ id: batchId }) => {
      if (existingBatchIds.has(batchId) || plannedBatchIds.has(batchId)) return true;
      plannedBatchIds.add(batchId);
      return false;
    })) {
      productConflicts.push(`Producto ${product.name}: el identificador de una variante ya está ocupado.`);
      continue;
    }
    newProducts.push({ source: product, targetId, marker, variants, variantBatches });
  }

  const existingCustomersByMarker = new Map(existing.customers
    .filter((customer) => customer.metadata?.portabilitySourceKey)
    .map((customer) => [customer.metadata.portabilitySourceKey, customer]));
  const existingCustomersById = new Map(existing.customers.map((customer) => [customer.id, customer]));
  const existingCustomersByPhone = new Map();
  for (const customer of existing.customers) {
    const key = String(customer.phone || '').replace(/\D/g, '');
    if (!key) continue;
    if (!existingCustomersByPhone.has(key)) existingCustomersByPhone.set(key, []);
    existingCustomersByPhone.get(key).push(customer);
  }
  const customerCreates = [];
  const customerDuplicates = [];
  const customerConflicts = [];
  const seenCustomerPhones = new Set();
  for (const customer of source.customers) {
    if (!customer?.id || String(customer.name || '').trim().length < 2) {
      errors.push('Se omitió un cliente sin ID o nombre válido.');
      continue;
    }
    const marker = `${datasetId}:customers:${customer.id}`;
    if (existingCustomersByMarker.has(marker)) {
      customerDuplicates.push(customer);
      continue;
    }
    const phone = String(customer.phone || '').replace(/\D/g, '');
    if (phone && seenCustomerPhones.has(phone)) {
      customerConflicts.push(`Cliente ${customer.name}: el archivo repite el teléfono.`);
      continue;
    }
    if (phone) seenCustomerPhones.add(phone);
    const phoneMatches = phone ? existingCustomersByPhone.get(phone) || [] : [];
    if (phoneMatches.length > 0) {
      if (phoneMatches.length === 1 && normalizeName(phoneMatches[0].name) === normalizeName(customer.name)) {
        customerDuplicates.push(customer);
      } else {
        customerConflicts.push(`Cliente ${customer.name}: el teléfono ya está asociado a otro nombre.`);
      }
      continue;
    }
    const targetId = `transfer-customer-${await stableHash(marker)}`;
    if (existingCustomersById.has(targetId)) {
      customerConflicts.push(`Cliente ${customer.name}: el identificador generado ya está ocupado en este negocio.`);
      continue;
    }
    customerCreates.push({ source: customer, targetId, marker });
  }

  const sourceImages = source.images;
  const existingImagesByMarker = new Map(existing.images
    .filter((image) => image.transferSourceKey)
    .map((image) => [image.transferSourceKey, image]));
  const existingImagesById = new Map(existing.images.map((image) => [image.id, image]));
  const imageIdMap = new Map();
  const imageCreates = [];
  const imageDuplicates = [];
  for (const image of sourceImages) {
    if (!image?.id) continue;
    const marker = `${datasetId}:images:${image.id}`;
    const found = existingImagesByMarker.get(marker);
    const id = found?.id || `transfer-image-${await stableHash(marker)}`;
    imageIdMap.set(image.id, id);
    if (found) imageDuplicates.push(image);
    else if (existingImagesById.has(id)) conflicts.push(`Imagen ${image.id}: el identificador generado ya está ocupado en este negocio.`);
    else if (image.blob) imageCreates.push({ source: image, targetId: id, marker });
  }

  const existingIngredientsByMarker = new Map(existing.ingredients
    .filter((ingredient) => ingredient.transferSourceKey)
    .map((ingredient) => [ingredient.transferSourceKey, ingredient]));
  const existingIngredientsById = new Map(existing.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const ingredientIdMap = new Map();
  const ingredientCreates = [];
  const ingredientDuplicates = [];
  for (const ingredient of source.ingredients) {
    if (!ingredient?.id || !String(ingredient.name || '').trim()) {
      errors.push('Se omitió un insumo sin identificador o nombre válido.');
      continue;
    }
    const marker = `${datasetId}:ingredients:${ingredient.id}`;
    const existingIngredient = existingIngredientsByMarker.get(marker);
    const targetId = existingIngredient?.id || `transfer-ingredient-${await stableHash(marker)}`;
    ingredientIdMap.set(ingredient.id, targetId);
    if (existingIngredient) {
      ingredientDuplicates.push(ingredient);
      continue;
    }
    if (existingIngredientsById.has(targetId)) {
      conflicts.push(`Insumo ${ingredient.name}: el identificador generado ya está ocupado en este negocio.`);
      continue;
    }
    ingredientCreates.push({
      source: ingredient,
      targetId,
      marker
    });
  }

  const reviewSnapshot = catalogDestinationReviewSnapshot(existing);
  const reviewSnapshotJson = JSON.stringify(reviewSnapshot);
  const reviewToken = await stableHash(JSON.stringify({ datasetId, reviewSnapshot }));

  const excludedTableCounts = Object.fromEntries(Object.keys(bundle.tableCounts || {})
    .filter((tableName) => !PORTABLE_TRANSFER_TABLES.includes(tableName))
    .map((tableName) => [tableName, Number(bundle.tableCounts?.[tableName]) || 0]));
  return {
    source,
    datasetId,
    categoryIdMap,
    categoryCreates,
    productIdMap,
    ingredientIdMap,
    imageIdMap,
    newProducts,
    productUpdates,
    productDuplicates,
    productConflicts,
    customerCreates,
    customerDuplicates,
    customerConflicts,
    imageCreates,
    imageDuplicates,
    ingredientCreates,
    ingredientDuplicates,
    conflicts: [...conflicts, ...productConflicts, ...customerConflicts],
    errors,
    reviewToken,
    reviewSnapshotJson,
    summary: {
      categories: { create: categoryCreates.length, reuse: categoryIdMap.size - categoryCreates.length, conflicts: conflicts.length },
      products: { create: newProducts.length, update: productUpdates.length, duplicates: productDuplicates.length, conflicts: productConflicts.length },
      customers: { create: customerCreates.length, duplicates: customerDuplicates.length, conflicts: customerConflicts.length },
      images: { create: imageCreates.length, duplicates: imageDuplicates.length },
      ingredients: { create: ingredientCreates.length, duplicates: ingredientDuplicates.length },
      rejected: errors.length,
      excludedTableCounts
    }
  };
}

const loadCatalogDestination = async () => ({
  categories: await db.table(STORES.CATEGORIES).toArray(),
  products: await db.table(STORES.MENU).toArray(),
  customers: await db.table(STORES.CUSTOMERS).toArray(),
  images: await db.table(STORES.IMAGES).toArray(),
  ingredients: await db.table(STORES.INGREDIENTS).toArray(),
  productBatches: await db.table(STORES.PRODUCT_BATCHES).toArray()
});

export async function previewCatalogTransfer(bundle, { assertAuthorized = () => {} } = {}) {
  const context = getContext();
  assertAuthorized();
  getPortableTables(bundle);
  await db.open();
  const tables = [db.table(STORES.CATEGORIES), db.table(STORES.MENU), db.table(STORES.CUSTOMERS), db.table(STORES.IMAGES), db.table(STORES.INGREDIENTS), db.table(STORES.PRODUCT_BATCHES)];
  const snapshot = await db.transaction('r', tables, loadCatalogDestination);
  const plan = await buildCatalogTransferPlan(bundle, snapshot);
  assertAuthorized();
  assertCurrentContext(context);
  return { summary: plan.summary, conflicts: plan.conflicts, errors: plan.errors, reviewToken: plan.reviewToken };
}

const decodeProductImageRefs = (product, imageIdMap) => {
  const result = { ...product };
  for (const field of ['image', 'imageRef', 'image_ref']) {
    if (imageIdMap.has(result[field])) result[field] = imageIdMap.get(result[field]);
    else if (typeof result[field] === 'string' && result[field].startsWith('img-')) result[field] = null;
  }
  return result;
};

const remapRecipeReferences = (recipe, productIdMap, ingredientIdMap) => (Array.isArray(recipe) ? recipe.map((component) => {
  if (!component || typeof component !== 'object') return component;
  const next = { ...component };
  for (const field of ['ingredientId', 'ingredient_id']) {
    if (ingredientIdMap.has(next[field])) next[field] = ingredientIdMap.get(next[field]);
  }
  if (productIdMap.has(next.productId)) next.productId = productIdMap.get(next.productId);
  return next;
}) : []);

const portableCatalogProduct = (source, targetId, categoryId, marker, imageIdMap, productIdMap, ingredientIdMap, variants = []) => {
  const product = safeProductFields(source);
  const remapped = decodeProductImageRefs(product, imageIdMap);
  const portableFields = [
    'barcode', 'sku', 'description', 'location', 'rubroContext', 'saleType', 'productType',
    'minStock', 'maxStock', 'trackStock', 'batchManagement', 'recipe', 'modifiers',
    'wholesaleTiers', 'prescriptionType', 'activeSubstance', 'laboratory', 'sustancia',
    'laboratorio', 'requiresPrescription', 'presentation', 'expirationMode',
    'shelfLifeValue', 'shelfLifeUnit', 'bulkData', 'conversionFactor', 'unit',
    'unitOfMeasure', 'brand', 'marca', 'talla', 'color', 'genero', 'modelo',
    'preparationTime', 'prepTime', 'alergenos', 'allergens', 'attributes'
  ];
  const selectedFields = Object.fromEntries(portableFields
    .filter((field) => !omitField(field) && Object.prototype.hasOwnProperty.call(remapped, field))
    .map((field) => [field, remapped[field]]));
  return {
    ...selectedFields,
    id: targetId,
    name: String(source.name).trim(),
    price: Number(source.price),
    cost: 0,
    stock: 0,
    committedStock: 0,
    hasBatches: false,
    categoryId: categoryId || '',
    recipe: remapRecipeReferences(source.recipe, productIdMap, ingredientIdMap),
    transferSourceKey: marker,
    hasVariants: variants.length > 0,
    isActive: source.isActive !== false
  };
};

export async function importCatalogTransfer(bundle, expectedPreview = null, { assertAuthorized = () => {} } = {}) {
  const context = getContext();
  assertAuthorized();
  getPortableTables(bundle);
  await db.open();
  assertCurrentContext(context);
  let result;
  const tables = [
    db.table(STORES.CATEGORIES), db.table(STORES.MENU), db.table(STORES.CUSTOMERS),
    db.table(STORES.IMAGES), db.table(STORES.INGREDIENTS), db.table(STORES.PRODUCT_BATCHES)
  ];
  const snapshot = await db.transaction('r', tables, loadCatalogDestination);
  const plan = await buildCatalogTransferPlan(bundle, snapshot);
  if (expectedPreview?.reviewToken && plan.reviewToken !== expectedPreview.reviewToken) {
    throw new Error('DATA_TRANSFER_DESTINATION_CHANGED_REVIEW_AGAIN');
  }
  if (plan.conflicts.length > 0 || plan.errors.length > 0) {
    throw new Error('DATA_TRANSFER_CONFLICTS_REVIEW');
  }
  assertAuthorized();
  assertCurrentContext(context);
  await db.transaction('rw', tables, async () => {
    assertAuthorized();
    assertCurrentContext(context);
    const currentSnapshot = await loadCatalogDestination();
    const currentReviewSnapshotJson = JSON.stringify(catalogDestinationReviewSnapshot(currentSnapshot));
    if (currentReviewSnapshotJson !== plan.reviewSnapshotJson) {
      throw new Error('DATA_TRANSFER_DESTINATION_CHANGED_REVIEW_AGAIN');
    }
    for (const category of plan.categoryCreates) {
      assertAuthorized();
      await db.table(STORES.CATEGORIES).put(category);
    }
    for (const image of plan.imageCreates) {
      const decoded = decodePortableValue(image.source);
      assertAuthorized();
      await db.table(STORES.IMAGES).put({ ...decoded, id: image.targetId, transferSourceKey: image.marker });
    }
    for (const ingredient of plan.ingredientCreates) {
      const row = safeProductFields(decodePortableValue(ingredient.source));
      for (const field of ['id', 'stock', 'committedStock', 'cost', 'transferSourceKey']) delete row[field];
      assertAuthorized();
      await db.table(STORES.INGREDIENTS).put({
        ...row,
        id: ingredient.targetId,
        transferSourceKey: ingredient.marker
      });
    }

    for (const item of plan.newProducts) {
      const sourceCategoryId = item.source.categoryId;
      const categoryId = sourceCategoryId ? plan.categoryIdMap.get(sourceCategoryId) : '';
      const product = portableCatalogProduct(
        item.source,
        item.targetId,
        categoryId,
        `${plan.datasetId}:menu:${item.source.id}`,
        plan.imageIdMap,
        plan.productIdMap,
        plan.ingredientIdMap,
        item.variants
      );
      await productsRepository.createProductWithInitialInventory(product, item.variantBatches);
      assertCurrentContext(context);
    }
    for (const item of plan.productUpdates) {
      const sourceCategoryId = item.source.categoryId;
      const categoryId = sourceCategoryId ? plan.categoryIdMap.get(sourceCategoryId) : '';
      const incoming = portableCatalogProduct(
        item.source,
        item.targetId,
        categoryId,
        `${plan.datasetId}:menu:${item.source.id}`,
        plan.imageIdMap,
        plan.productIdMap,
        plan.ingredientIdMap,
        Array.isArray(bundle.transfer.catalogVariants?.[item.source.id])
          ? bundle.transfer.catalogVariants[item.source.id]
          : []
      );
      const existing = await db.table(STORES.MENU).get(item.targetId);
      const updated = {
        ...existing,
        ...incoming,
        stock: existing.stock,
        committedStock: existing.committedStock,
        cost: existing.cost,
        hasBatches: existing.hasBatches,
        updatedAt: new Date().toISOString()
      };
      assertAuthorized();
      await generalRepository.save(STORES.MENU, updated);
      assertCurrentContext(context);
    }
    for (const item of plan.customerCreates) {
      const source = item.source;
      assertAuthorized();
      await generalRepository.save(STORES.CUSTOMERS, {
        id: item.targetId,
        name: String(source.name).trim(),
        phone: String(source.phone || '').trim(),
        address: String(source.address || '').trim(),
        debt: 0,
        debtCents: 0,
        creditLimit: 0,
        isActive: source.isActive !== false,
        syncStatus: 'local',
        metadata: { portabilitySourceKey: item.marker }
      });
      assertCurrentContext(context);
    }
    result = {
      imported: {
        categories: plan.categoryCreates.length,
        products: plan.newProducts.length,
        productsUpdated: plan.productUpdates.length,
        customers: plan.customerCreates.length,
        images: plan.imageCreates.length,
        ingredients: plan.ingredientCreates.length
      },
      skippedDuplicates: {
        products: plan.productDuplicates.length,
        customers: plan.customerDuplicates.length,
        images: plan.imageDuplicates.length,
        ingredients: plan.ingredientDuplicates.length
      },
      excludedTableCounts: plan.summary.excludedTableCounts
    };
  });
  assertAuthorized();
  assertCurrentContext(context);
  return result;
}

export const portableDataTransferInternals = Object.freeze({
  formulaSafeCell,
  portableTransferRow,
  buildTransferCatalogVariants,
  getPortableTables,
  normalizeName,
  normalizeBarcode,
  safeProductFields,
  buildCsvImportPlan,
  buildCatalogTransferPlan,
  decodePortableValue,
  remapRecipeReferences
});
