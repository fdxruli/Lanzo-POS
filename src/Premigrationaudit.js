// preMigrationAudit.js
// Script para ejecutar ANTES de actualizar a la nueva versión

import { initDB, loadData, saveData, STORES } from './services/database';
import Logger from './services/Logger';

/**
 * 🔍 AUDITORÍA PRE-MIGRACIÓN
 * 
 * Este script verifica la consistencia entre productos padre y sus lotes.
 * Debe ejecutarse ANTES de actualizar a la nueva versión de sales.js
 */
export async function runPreMigrationAudit() {
  Logger.log("🔍 Iniciando auditoría pre-migración...");
  
  const results = {
    totalProducts: 0,
    productsWithBatches: 0,
    inconsistencies: [],
    autoFixed: [],
    manualReviewNeeded: []
  };

  try {
    await initDB();

    // 1. Cargar todos los productos
    const allProducts = await loadData(STORES.MENU);
    results.totalProducts = allProducts.length;

    // 2. Cargar todos los lotes
    const allBatches = await loadData(STORES.PRODUCT_BATCHES);
    const batchesByProduct = new Map();

    allBatches.forEach(batch => {
      if (!batchesByProduct.has(batch.productId)) {
        batchesByProduct.set(batch.productId, []);
      }
      batchesByProduct.get(batch.productId).push(batch);
    });

    // 3. Verificar cada producto que usa lotes
    for (const product of allProducts) {
      if (!product.batchManagement?.enabled) continue;
      if (!product.trackStock) continue;

      results.productsWithBatches++;

      const batches = batchesByProduct.get(product.id) || [];
      const activeBatches = batches.filter(b => b.isActive && b.stock > 0);

      // Calcular stock teórico (suma de lotes)
      const theoreticalStock = activeBatches.reduce((sum, b) => sum + (b.stock || 0), 0);
      const currentStock = product.stock || 0;

      // Detectar inconsistencia (tolerancia de 0.01 para errores de redondeo)
      const difference = Math.abs(theoreticalStock - currentStock);

      if (difference > 0.01) {
        const issue = {
          productId: product.id,
          productName: product.name,
          currentStock,
          theoreticalStock,
          difference,
          activeBatches: activeBatches.length,
          severity: difference > 5 ? 'HIGH' : difference > 1 ? 'MEDIUM' : 'LOW'
        };

        results.inconsistencies.push(issue);

        // Clasificar según severidad
        if (issue.severity === 'HIGH') {
          results.manualReviewNeeded.push(issue);
        } else {
          results.autoFixed.push(issue);
        }
      }
    }

    // 4. Generar reporte
    Logger.log("\n" + "=".repeat(60));
    Logger.log("📊 REPORTE DE AUDITORÍA PRE-MIGRACIÓN");
    Logger.log("=".repeat(60));
    Logger.log(`Total de productos: ${results.totalProducts}`);
    Logger.log(`Productos con gestión de lotes: ${results.productsWithBatches}`);
    Logger.log(`Inconsistencias detectadas: ${results.inconsistencies.length}`);
    
    if (results.inconsistencies.length > 0) {
      Logger.log("\n⚠️ INCONSISTENCIAS ENCONTRADAS:\n");
      
      results.inconsistencies.forEach(issue => {
        const icon = issue.severity === 'HIGH' ? '🚨' : 
                     issue.severity === 'MEDIUM' ? '⚠️' : 'ℹ️';
        
        Logger.log(`${icon} ${issue.productName}`);
        Logger.log(`   Stock actual: ${issue.currentStock}`);
        Logger.log(`   Stock teórico (lotes): ${issue.theoreticalStock}`);
        Logger.log(`   Diferencia: ${issue.difference > 0 ? '+' : ''}${(issue.theoreticalStock - issue.currentStock).toFixed(2)}`);
        Logger.log(`   Severidad: ${issue.severity}`);
        Logger.log("");
      });

      if (results.manualReviewNeeded.length > 0) {
        Logger.log("🚨 REQUIEREN REVISIÓN MANUAL:");
        results.manualReviewNeeded.forEach(issue => {
          Logger.log(`   - ${issue.productName} (diferencia: ${Math.abs(issue.currentStock - issue.theoreticalStock).toFixed(2)})`);
        });
      }
    } else {
      Logger.log("\n✅ No se encontraron inconsistencias. ¡Listo para migrar!");
    }

    Logger.log("=".repeat(60) + "\n");

    return results;

  } catch (error) {
    Logger.error("❌ Error durante la auditoría:", error);
    throw error;
  }
}

/**
 * 🔧 CORRECCIÓN AUTOMÁTICA (OPCIONAL)
 * 
 * Ajusta el stock del padre para que coincida con la suma de lotes.
 * Solo ejecutar si estás seguro de que los lotes son la fuente de verdad.
 */
export async function autoFixInconsistencies(auditResults, options = {}) {
  const { dryRun = true, onlySeverity = ['LOW', 'MEDIUM'] } = options;

  Logger.log(`\n🔧 ${dryRun ? 'SIMULACIÓN DE' : 'EJECUTANDO'} CORRECCIÓN AUTOMÁTICA...`);

  let fixed = 0;
  let skipped = 0;

  for (const issue of auditResults.inconsistencies) {
    // Saltar si la severidad no está en la lista permitida
    if (!onlySeverity.includes(issue.severity)) {
      Logger.log(`⏭️ Saltando ${issue.productName} (severidad: ${issue.severity})`);
      skipped++;
      continue;
    }

    if (dryRun) {
      Logger.log(`✓ [DRY RUN] ${issue.productName}: ${issue.currentStock} → ${issue.theoreticalStock}`);
      fixed++;
    } else {
      try {
        // Actualizar el producto con el stock correcto
        const product = await loadData(STORES.MENU, issue.productId);
        if (product) {
          product.stock = issue.theoreticalStock;
          product.updatedAt = new Date().toISOString();
          await saveData(STORES.MENU, product);
          
          Logger.log(`✅ ${issue.productName}: ${issue.currentStock} → ${issue.theoreticalStock}`);
          fixed++;
        }
      } catch (error) {
        Logger.error(`❌ Error corrigiendo ${issue.productName}:`, error);
      }
    }
  }

  Logger.log(`\n📊 Resumen:`);
  Logger.log(`   Corregidos: ${fixed}`);
  Logger.log(`   Omitidos: ${skipped}`);
  
  if (dryRun) {
    Logger.log("\n💡 Esto fue una simulación. Para aplicar los cambios, ejecuta:");
    Logger.log("   autoFixInconsistencies(results, { dryRun: false })");
  }

  return { fixed, skipped };
}

/**
 * 📄 EXPORTAR REPORTE A CSV
 * 
 * Genera un CSV con todas las inconsistencias para revisión manual
 */
export function exportAuditReport(auditResults) {
  if (auditResults.inconsistencies.length === 0) {
    Logger.log("✅ No hay inconsistencias para exportar.");
    return null;
  }

  const headers = [
    'ID Producto',
    'Nombre',
    'Stock Actual',
    'Stock Teórico',
    'Diferencia',
    'Lotes Activos',
    'Severidad'
  ];

  const rows = auditResults.inconsistencies.map(issue => [
    issue.productId,
    issue.productName,
    issue.currentStock,
    issue.theoreticalStock,
    (issue.theoreticalStock - issue.currentStock).toFixed(2),
    issue.activeBatches,
    issue.severity
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  // Crear y descargar archivo
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `auditoria_pre_migracion_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  Logger.log("📥 Reporte exportado exitosamente.");
  return csvContent;
}