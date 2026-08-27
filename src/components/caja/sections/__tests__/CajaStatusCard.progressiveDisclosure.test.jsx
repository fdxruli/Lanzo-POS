// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/cajaProjection', () => ({
  resolveCashSessionAmounts: () => ({
    fondoInicial: '100', ventasContado: '50', abonosFiado: '10',
    entradasEfectivo: '5', salidasEfectivo: '2', totalTeorico: '163',
    reconciliation: {
      unlinkedTechnicalPayments: [{ id: 'unlinked' }],
      unlinkedTechnicalPaymentsAmount: '3',
      paymentsWithMissingCashMovementRecord: [{ id: 'missing', amount: '4' }],
      paymentsWithInvalidCashMovementLink: [],
      probableLegacyCashBackingAmount: '0',
      unverifiedHistoricalPaymentsAmount: '4',
      layawayCashCollected: '0', customerCreditCollections: '0',
      manualEntries: '0', positiveAdjustments: '0',
      recognizedSales: '50', layawayCompletedRevenue: '0',
      layawayPendingAdvances: '0', layawayCompletedGrossProfit: '0',
      unclassifiedDifference: '0'
    }
  })
}));
vi.mock('../../../../services/layawayFinancialProjection', () => ({
  hasHistoricalIntegrityWarning: () => true
}));

import CajaStatusCard from '../CajaStatusCard';

afterEach(cleanup);

describe('CajaStatusCard progressive disclosure', () => {
  it('keeps the hero and integrity warning visible while detailed metrics stay collapsed', () => {
    render(
      <CajaStatusCard
        cajaActual={{ monto_inicial: '100', fecha_apertura: '2026-08-14T10:00:00.000Z', responsable_apertura: 'Ana' }}
        totalesTurno={{ ventasContado: '50', abonosFiado: '10' }}
        excesoLiquidez={false}
        porcentajeLiquidez={20}
        CAJA_CONFIG={{ MAX_CASH_THRESHOLD: 50000 }}
        isBackupLoading={false}
        isCloudCash={false}
        onEditarFondoInicial={vi.fn()}
        onBackup={vi.fn()}
        onReporte={vi.fn()}
        onResumen={vi.fn()}
        onImprimir={vi.fn()}
      />
    );

    expect(screen.getByText(/Efectivo te.rico de mi caja/)).toBeVisible();
    expect(screen.getByText(/Advertencia de integridad hist.rica/)).toBeVisible();
    expect(screen.getByText('Fondo inicial')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Respaldo' })).not.toBeVisible();

    fireEvent.click(screen.getByText('Ver desglose del turno'));
    expect(screen.getByText('Fondo inicial')).toBeVisible();
    fireEvent.click(screen.getByText('Más herramientas'));
    expect(screen.getByRole('button', { name: 'Respaldo' })).toBeVisible();
  });
});
