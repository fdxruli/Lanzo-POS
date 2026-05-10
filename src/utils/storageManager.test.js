/**
 * storageManager.test.js - Utilities para verificar StorageManager en console
 * 
 * CÓMO USAR:
 * 1. Abre DevTools Console en tu PWA
 * 2. Pega el contenido de este archivo
 * 3. Ejecuta: runStorageManagerTests()
 */

// ============ VERIFICACIONES BÁSICAS ============

async function checkStorageSupport() {
  console.group('📋 Storage API Support Check');
  
  const checks = {
    'navigator.storage': !!navigator?.storage,
    'navigator.storage.persist': typeof navigator?.storage?.persist === 'function',
    'navigator.storage.estimate': typeof navigator?.storage?.estimate === 'function',
    'navigator.permissions.query': typeof navigator?.permissions?.query === 'function',
  };

  Object.entries(checks).forEach(([key, value]) => {
    console.log(`${value ? '✅' : '❌'} ${key}`);
  });

  console.groupEnd();
  return Object.values(checks).every(v => v === true);
}

async function checkStorageManagerState() {
  console.group('🔒 StorageManager State');
  
  // Assumimos que storageManager ya está cargado en global
  if (typeof storageManager === 'undefined') {
    console.error('❌ storageManager no encontrado. ¿Se inicializó correctamente?');
    return null;
  }

  const state = storageManager.getState();
  console.log('Estado actual:', state);
  
  console.log(`Persistence State: ${state.persistenceState}`);
  console.log(`Quota Usage: ${state.quotaUsage.percentUsed}%`);
  console.log(`Is Supported: ${state.isSupported}`);
  console.log(`Initialized: ${state.initialized}`);

  console.groupEnd();
  return state;
}

async function checkQuotaDetails() {
  console.group('📊 Detailed Quota Information');
  
  if (typeof storageManager === 'undefined') {
    console.error('❌ storageManager no encontrado');
    return null;
  }

  const quota = await storageManager.estimateQuota(true);
  
  const usageMB = (quota.usage / 1024 / 1024).toFixed(2);
  const quotaMB = (quota.quota / 1024 / 1024).toFixed(2);
  
  console.log(`Usage: ${usageMB} MB`);
  console.log(`Total Quota: ${quotaMB} MB`);
  console.log(`Percentage: ${quota.percentUsed}%`);
  console.log(`Is Critical (>90%): ${quota.isCritical}`);
  console.log(`Is Warning (75-90%): ${quota.isWarning}`);

  // Visualización ASCII
  const barLength = 30;
  const filledLength = Math.round((quota.percentUsed / 100) * barLength);
  const emptyLength = barLength - filledLength;
  const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
  console.log(`Progress: [${bar}] ${quota.percentUsed}%`);

  console.groupEnd();
  return quota;
}

// ============ SIMULACIÓN DE CASOS ============

async function testSaleGuardScenarios() {
  console.group('🧪 SaleGuard Test Scenarios');

  if (typeof saleGuard === 'undefined') {
    console.error('❌ saleGuard no encontrado');
    console.groupEnd();
    return;
  }

  // Test 1: Validación normal
  console.log('Test 1: Normal validation');
  const validation = await saleGuard.validate();
  console.log('Result:', validation);
  console.log(`Can Process: ${validation.allowed}`);

  // Test 2: Space check
  console.log('\nTest 2: Space validation');
  const spaceCheck = await saleGuard.validateSpace();
  console.log('Result:', spaceCheck);

  // Test 3: Warnings
  console.log('\nTest 3: Warning prompts');
  const warnings = await saleGuard.promptIfWarning();
  console.log(`Warnings found: ${warnings.length}`);
  warnings.forEach((w, i) => {
    console.log(`  ${i + 1}. [${w.type}] ${w.message}`);
  });

  // Test 4: Debug state
  console.log('\nTest 4: Complete debug state');
  const debugState = await saleGuard.debugState();
  console.log('Debug:', debugState);

  console.groupEnd();
}

// ============ VERIFICACIÓN DE BOOT ============

async function verifyBootSequence() {
  console.group('🚀 Boot Sequence Verification');

  console.log('1. Checking if StorageManager was initialized in main.jsx...');
  
  if (typeof storageManager === 'undefined') {
    console.error('❌ StorageManager not in global scope - boot initialization may have failed');
  } else {
    const state = storageManager.getState();
    if (state.initialized) {
      console.log('✅ StorageManager initialized successfully');
      console.log(`   Persistence state: ${state.persistenceState}`);
      console.log(`   Quota: ${state.quotaUsage.percentUsed}%`);
    } else {
      console.warn('⚠️ StorageManager exists but not initialized');
    }
  }

  console.log('\n2. Checking if PersistenceWarningBanner component is rendered...');
  const bannerEl = document.querySelector('.persistence-warning-banner');
  if (bannerEl) {
    console.log('✅ PersistenceWarningBanner is in DOM');
    console.log(`   Visibility: ${window.getComputedStyle(bannerEl).display}`);
  } else {
    console.log('⏳ PersistenceWarningBanner not found (may not be volatile)');
  }

  console.log('\n3. Checking Logger configuration...');
  if (typeof Logger !== 'undefined') {
    console.log('✅ Logger available');
  } else {
    console.warn('⚠️ Logger not found');
  }

  console.groupEnd();
}

// ============ INTEGRACIÓN EN salesService ============

async function verifySalesServiceIntegration() {
  console.group('💳 SalesService Integration Check');

  // Buscar función createSale en window
  console.log('Checking for sale functions...');
  
  const saleFunctions = [
    'createSale',
    'addSale',
    'processSale',
    'checkoutSale',
    'saveSale',
    'createSaleWithPersistenceCheck',
  ];

  let foundFunctions = [];
  saleFunctions.forEach(name => {
    if (typeof window[name] === 'function' || typeof globalThis[name] === 'function') {
      console.log(`✅ Found: ${name}`);
      foundFunctions.push(name);
    }
  });

  if (foundFunctions.length === 0) {
    console.warn('⚠️ No sale functions found in global scope');
    console.log('   (This is normal if they are module exports)');
  }

  console.log('\nTo verify saleGuard integration:');
  console.log('1. Create a test sale object');
  console.log('2. Call: await saleGuard.validate()');
  console.log('3. If returns { allowed: false }, integration is working');

  console.groupEnd();
}

// ============ FUNCIÓN PRINCIPAL ============

async function runStorageManagerTests() {
  console.clear();
  console.log(
    '%c🔒 STORAGE MANAGER TEST SUITE\n%c' +
    '================================\n' +
    'Running comprehensive verification...\n',
    'font-size: 16px; font-weight: bold; color: #ff6b6b;',
    'font-size: 12px; color: #999;'
  );

  // Run all tests
  const supportOk = await checkStorageSupport();
  if (!supportOk) {
    console.error('❌ This browser does not support StorageManager API');
    console.error('   Required: Chrome 55+, Firefox 57+, Safari 13.1+');
    return;
  }

  await checkStorageManagerState();
  await checkQuotaDetails();
  await testSaleGuardScenarios();
  await verifyBootSequence();
  await verifySalesServiceIntegration();

  console.log(
    '\n%c✅ Test Suite Complete\n%c' +
    'For detailed logs, check individual sections above.',
    'font-size: 14px; font-weight: bold; color: #51cf66;',
    'font-size: 12px; color: #999;'
  );
}

// ============ MANUAL DEBUGGING COMMANDS ============

async function simulateCriticalStorage() {
  console.warn('⚠️ SIMULATING CRITICAL STORAGE (90%+)');
  
  if (typeof storageManager === 'undefined') {
    console.error('StorageManager not found');
    return;
  }

  // Simular cuota crítica
  storageManager.quotaUsage = {
    usage: 450 * 1024 * 1024, // 450 MB
    quota: 500 * 1024 * 1024, // 500 MB total
    percentUsed: 90,
    isCritical: true,
    isWarning: false,
  };

  console.log('Simulated quota:', storageManager.quotaUsage);
  console.log('Now try: await saleGuard.validate()');
  console.log('Expected: { allowed: false, reason: "...", severity: "critical" }');
}

async function resetStorageState() {
  console.warn('🔄 RESETTING STORAGE STATE');
  
  if (typeof storageManager === 'undefined') {
    console.error('StorageManager not found');
    return;
  }

  // Re-estimate real quota
  await storageManager.estimateQuota(true);
  console.log('Quota re-estimated:', storageManager.quotaUsage);
}

// ============ CONSOLE OUTPUT ============

console.log(
  '%c📝 Storage Manager Test Commands Ready\n%c' +
  'Available functions:\n' +
  '  • runStorageManagerTests() - Run full test suite\n' +
  '  • checkStorageSupport() - Check API support\n' +
  '  • checkQuotaDetails() - View storage quota\n' +
  '  • testSaleGuardScenarios() - Test sale blocking\n' +
  '  • simulateCriticalStorage() - Simulate 90%+ storage\n' +
  '  • resetStorageState() - Reset to real quota\n' +
  '  • verifyBootSequence() - Check initialization\n',
  'font-size: 12px; font-weight: bold; color: #2196F3;',
  'font-size: 11px; color: #666;'
);

// Auto-export for use
if (typeof window !== 'undefined') {
  window.runStorageManagerTests = runStorageManagerTests;
  window.checkStorageSupport = checkStorageSupport;
  window.checkQuotaDetails = checkQuotaDetails;
  window.testSaleGuardScenarios = testSaleGuardScenarios;
  window.simulateCriticalStorage = simulateCriticalStorage;
  window.resetStorageState = resetStorageState;
  window.verifyBootSequence = verifyBootSequence;
  window.verifySalesServiceIntegration = verifySalesServiceIntegration;
}
