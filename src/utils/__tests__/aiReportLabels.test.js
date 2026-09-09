import { describe, expect, it } from 'vitest';
import {
  getCoverageOrderLabel,
  getCoverageReasonLabel,
  getModuleLabel,
  getRouteLabel,
  getToolReferenceLabel,
  humanizeAIReportText,
  translateAIReportCode
} from '../aiReportLabels';

describe('AI report human labels', () => {
  it('translates coverage reasons and prioritization codes', () => {
    expect(translateAIReportCode('coverage_incomplete')).toBe('Análisis realizado con cobertura parcial');
    expect(getCoverageReasonLabel('provider_payload_limit')).toBe('Se envió una cantidad limitada de datos para mantener el análisis eficiente.');
    expect(getCoverageOrderLabel('impact_desc')).toBe('Elementos de mayor impacto primero.');
    expect(getCoverageOrderLabel('stock_priority')).toBe('Elementos con mayor riesgo de desabasto primero.');
    expect(getCoverageOrderLabel('stock_asc')).toBe('Elementos con menor existencia primero.');
    expect(getCoverageOrderLabel('revenue_desc')).toBe('Elementos con mayores ventas primero.');
  });

  it('translates modules, tool references, providers, and unknown codes safely', () => {
    expect(translateAIReportCode('common.dataQuality')).toBe('Calidad de datos');
    expect(translateAIReportCode('inventory.stockRisk')).toBe('Riesgo de inventario');
    expect(translateAIReportCode('operations.wasteImpact')).toBe('Impacto de mermas');
    expect(translateAIReportCode('retail.marginRisk')).toBe('Riesgo de margen');
    expect(getModuleLabel('products')).toBe('Productos');
    expect(getRouteLabel('/productos')).toBe('Ir al módulo Productos');
    expect(getToolReferenceLabel('inventory.stockRisk')).toBe('Riesgo de inventario');
    expect(translateAIReportCode('Local details')).toBe('Detalles locales');
    expect(translateAIReportCode('Top products')).toBe('Productos principales');
    expect(translateAIReportCode('localDetails')).toBe('Detalles locales');
    expect(translateAIReportCode('topProducts')).toBe('Productos principales');
    expect(translateAIReportCode('unknownInternalCode')).toBe('Unknown internal code');
    expect(translateAIReportCode('unknownInternalCode')).not.toBe('unknownInternalCode');
    expect(humanizeAIReportText('El sistema reportó unknown_internal_code y unknown.moduleCode.')).toBe('El sistema reportó Unknown internal code y Unknown / module code.');
  });

  it('turns permissions, routes, paths, and technical evidence into business text', () => {
    const readable = humanizeAIReportText('Permiso requerido: products; Ruta: /productos; outOfStockProducts.total=9; lowStockProducts.items; deadStockTotalTiedCapital=19045.9');

    expect(readable).toContain('Módulo necesario: Productos');
    expect(readable).toContain('Ir al módulo Productos');
    expect(readable).toContain('Productos agotados: 9');
    expect(readable).toContain('Productos con bajo stock');
    expect(readable).toContain('Capital inmovilizado: $19,045.90');
    expect(readable).not.toContain('products');
    expect(readable).not.toContain('outOfStockProducts');
    expect(readable).not.toContain('lowStockProducts');
  });
});
