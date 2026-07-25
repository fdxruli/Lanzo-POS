import { DB_NAME } from '../../config/dbConfig';
import { preflightAndRepairIndexedDb as runPreflightAndRepairIndexedDb } from './indexedDbPreflight';

const operationMaps = new Set();
const operationsByFactory = new WeakMap();
const fallbackOperations = new Map();

const getOperationMap = (factory) => {
  if (!factory || (typeof factory !== 'object' && typeof factory !== 'function')) {
    return fallbackOperations;
  }

  let operations = operationsByFactory.get(factory);
  if (!operations) {
    operations = new Map();
    operationsByFactory.set(factory, operations);
    operationMaps.add(operations);
  }
  return operations;
};

/**
 * Coordina el preflight completo por fábrica y nombre de base.
 *
 * No comparte una instancia IDBDatabase entre consumidores: todos los
 * reintentos concurrentes reciben la misma promesa de preparación completa,
 * que incluye inspección, backup, rebuild y validación. La propiedad se libera
 * únicamente cuando toda la preparación termina o falla realmente.
 */
export const preflightAndRepairIndexedDb = (options = {}) => {
  const factory = options.factory || globalThis.indexedDB;
  const databaseName = options.databaseName || DB_NAME;
  const operations = getOperationMap(factory);
  const existing = operations.get(databaseName);
  if (existing) return existing;

  const operation = Promise.resolve().then(() => runPreflightAndRepairIndexedDb({
    ...options,
    factory,
    databaseName
  }));

  operations.set(databaseName, operation);
  const cleanup = () => {
    if (operations.get(databaseName) === operation) operations.delete(databaseName);
  };
  operation.then(cleanup, cleanup);
  return operation;
};

export const getActiveIndexedDbPreflightOperations = () => Array.from(operationMaps)
  .flatMap((operations) => Array.from(operations.keys()));

export const resetIndexedDbPreflightCoordinatorForTests = () => {
  fallbackOperations.clear();
  operationMaps.forEach((operations) => operations.clear());
};
