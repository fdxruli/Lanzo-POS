// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesHistory from './SalesHistory';

const parseCsv = (value) => {
  const input = value.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' && input[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...records] = rows;
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
};

class CapturedBlob {
  constructor(parts) {
    this.content = parts.map((part) => String(part)).join('');
  }
}

const salesPage = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1;
  const isPaid = number % 2 === 1;
  return {
    id: `sale-${number}`,
    cloudSaleId: `cloud-${number}`,
    folio: `F-${String(number).padStart(3, '0')}`,
    timestamp: '2026-11-07T10:00:00.000Z',
    customerName: number === 1 ? '=HYPERLINK("https://example.invalid")\n<script>alert(1)</script>' : `Cliente ${number}, "Niño Norte"`,
    paymentMethod: isPaid ? 'cash' : 'mixed_credit',
    paymentStatus: isPaid ? 'paid' : 'partial',
    sourceMode: 'cloud_committed',
    status: 'closed',
    total: 30,
    amountPaid: isPaid ? 30 : 10,
    balanceDue: isPaid ? 0 : 20,
    items: []
  };
});

describe('SalesHistory visible-page export', () => {
  let createdBlob;

  beforeEach(() => {
    createdBlob = null;
    vi.stubGlobal('Blob', CapturedBlob);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob) => {
        createdBlob = blob;
        return 'blob:history';
      })
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(window, 'setTimeout').mockImplementation(() => 1);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps total history separate from the 50 loaded rows and exports only filtered authorized page rows', async () => {
    render(
      <SalesHistory
        sales={salesPage}
        source={{ mode: 'cloud_final', final: true, stale: false }}
        isCloudFinal
        totalCount={60}
        queryScope="license"
        dateRange={{ date_from: '2026-11-01T00:00:00.000Z', date_to: '2026-11-08T23:59:59.000Z' }}
        currentPageIndex={0}
        hasMore
      />
    );

    expect(screen.getByText(/6 de 6 registros cargados visibles en página 1 · 60 disponibles/)).toBeInTheDocument();
    expect(screen.getByText(/aplican solo a los registros cargados de esta página/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por estado de pago' }), { target: { value: 'paid' } });
    expect(screen.getByText(/CSV e impresión incluirán solo 3 venta\(s\) filtradas de las 6 cargadas/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CSV · página' }));
    expect(createdBlob).toBeTruthy();
    const csv = createdBlob.content;
    const exportedRows = parseCsv(csv);
    const exportedIds = exportedRows.map((row) => row.venta_id);
    const expectedIds = salesPage.filter((sale) => sale.paymentStatus === 'paid').map((sale) => sale.id);

    expect(exportedIds).toEqual(expectedIds);
    expect(new Set(exportedIds).size).toBe(3);
    expect(exportedIds).not.toContain('sale-51');
    expect(exportedRows[0]).toMatchObject({
      alcance: 'Negocio, según permisos actuales',
      origen_datos: 'Cloud oficial final',
      cobertura: 'Solo página 1: 3 de 6 registro(s) cargado(s) tras los filtros locales',
      registros_cargados_en_pagina: '6',
      registros_exportados: '3',
      total_disponible_en_consulta: '60'
    });
    expect(exportedRows[0].cliente).toBe("'=HYPERLINK(\"https://example.invalid\")\n<script>alert(1)</script>");
    expect(exportedRows[1].cliente).toBe('Cliente 3, "Niño Norte"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('<script>alert(1)</script>');
  });

  it('includes the full end date and excludes records whose date cannot be verified', () => {
    render(
      <SalesHistory
        sales={[
          { id: 'sale-end-of-day', folio: 'F-001', timestamp: '2026-11-07T23:59:59.999Z', total: 10 },
          { id: 'sale-next-day', folio: 'F-002', timestamp: '2026-11-08T00:00:00.000Z', total: 20 },
          { id: 'sale-no-date', folio: 'F-003', timestamp: null, total: 30 }
        ]}
        source={{ mode: 'local', local: ['sales'] }}
        currentPageIndex={0}
      />
    );

    fireEvent.change(screen.getByLabelText('Fecha final'), { target: { value: '2026-11-07' } });

    expect(screen.getByText(/1 de 3 registros cargados visibles/)).toBeInTheDocument();
    expect(screen.getByText(/CSV e impresión incluirán solo 1 venta\(s\) filtradas/)).toBeInTheDocument();
  });

  it('exports Free/Local page data with a local source label', () => {
    render(
      <SalesHistory
        sales={[{
          id: 'local-sale-1',
          folio: 'LOCAL-001',
          timestamp: '2026-11-07T10:00:00.000Z',
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'closed',
          total: 20
        }]}
        source={{ mode: 'local', local: ['sales'] }}
        currentPageIndex={0}
      />
    );

    expect(screen.getByText(/Origen: Local/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CSV · página' }));

    const exportedRows = parseCsv(createdBlob.content);
    expect(exportedRows.map((row) => row.venta_id)).toEqual(['local-sale-1']);
    expect(exportedRows[0]).toMatchObject({
      origen_datos: 'Local',
      cobertura: 'Solo página 1: 1 de 1 registro(s) cargado(s) tras los filtros locales'
    });
  });
});
