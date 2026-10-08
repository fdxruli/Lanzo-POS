// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legalPreviewState = vi.hoisted(() => ({ enabled: false }));

vi.mock('../../../services/supabase', () => ({
  fetchLegalTerms: vi.fn(),
  fetchLegalPolicyPreview: vi.fn(),
  fetchLegalPolicyState: vi.fn(),
  fetchAcceptedLegalDocument: vi.fn(),
  isLegalPolicyPreviewEnabled: () => legalPreviewState.enabled,
  acceptLegalTerms: vi.fn()
}));
vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() }
}));
vi.mock('../../../services/utils', () => ({
  showMessageModal: vi.fn()
}));

import {
  acceptLegalTerms,
  fetchAcceptedLegalDocument,
  fetchLegalPolicyPreview,
  fetchLegalPolicyState,
  fetchLegalTerms
} from '../../../services/supabase';
import TermsAndConditionsModal, { LEGAL_DOCUMENT_TYPES } from '../TermsAndConditionsModal';

const termsDocument = {
  id: 'legal-term-1',
  type: 'terms_of_use',
  version: '1.0',
  content_html: '<h2>Términos de uso vigentes</h2>'
};

describe('TermsAndConditionsModal policy navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('lanzo_license', JSON.stringify({ license_key: 'LANZO-TEST-KEY' }));
    legalPreviewState.enabled = false;
    fetchLegalPolicyPreview.mockResolvedValue(null);
    fetchLegalPolicyState.mockResolvedValue({
      success: true,
      pending_documents: [],
      accepted_documents: []
    });
    fetchAcceptedLegalDocument.mockResolvedValue({ success: false, code: 'NOT_FOUND' });
    acceptLegalTerms.mockResolvedValue({ success: true });
    fetchLegalTerms.mockImplementation(async (type) => (
      type === 'terms_of_use' ? termsDocument : null
    ));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows separate legal categories and loads supported documents on selection', async () => {
    render(
      <TermsAndConditionsModal
        isOpen
        onClose={vi.fn()}
        readOnly
        showDocumentIndex
        documentTypes={LEGAL_DOCUMENT_TYPES}
      />
    );

    expect(await screen.findByText('Términos de uso vigentes')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Políticas y avisos' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Aviso de privacidad/ }));
    await waitFor(() => expect(fetchLegalTerms).toHaveBeenCalledWith('privacy_policy'));
    expect(await screen.findByText(/todavía no tiene una versión activa publicada/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();

    const productionDocuments = [
      [/Lía e inteligencia artificial/, 'ai_policy'],
      [/Pagos y suscripciones/, 'payment_policy'],
      [/Cancelaciones y reembolsos/, 'refund_policy'],
      [/Aviso legal/, 'legal_notice']
    ];

    for (const [label, type] of productionDocuments) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(fetchLegalTerms).toHaveBeenCalledWith(type));
      expect(await screen.findByText(/todavía no tiene una versión activa publicada/)).toBeTruthy();
    }
  });


  it('loads review-only drafts from the isolated preview table', async () => {
    legalPreviewState.enabled = true;
    fetchLegalPolicyPreview.mockImplementation(async (type) => ({
      id: `draft-${type}`,
      document_type: type,
      version: 'borrador-0.3',
      content_html: `<h2>${type} para revisión</h2>`
    }));

    render(
      <TermsAndConditionsModal
        isOpen
        onClose={vi.fn()}
        readOnly
        showDocumentIndex
        documentTypes={LEGAL_DOCUMENT_TYPES}
      />
    );

    expect(await screen.findByText('terms_of_use para revisión')).toBeTruthy();
    expect(screen.getByText(/documentos en revisión; no están vigentes/i)).toBeTruthy();
    expect(fetchLegalTerms).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Lía e inteligencia artificial/ }));
    expect(await screen.findByText('ai_policy para revisión')).toBeTruthy();
    expect(fetchLegalPolicyPreview).toHaveBeenCalledWith('ai_policy');
    expect(screen.getByRole('button', { name: /Lía e inteligencia artificial, Disponible/ })).toBeTruthy();
  });

  it('identifies updated documents and records acceptance for each new version', async () => {
    const onClose = vi.fn();
    const legalPolicyState = {
      success: true,
      status: 'ready',
      pending_documents: [
        { id: 'privacy-v2', type: 'privacy_policy', version: '2.0' },
        { id: 'ai-v2', type: 'ai_policy', version: '1.1' }
      ],
      accepted_documents: []
    };

    render(
      <TermsAndConditionsModal
        isOpen
        onClose={onClose}
        isUpdateNotification
        showDocumentIndex
        legalPolicyState={legalPolicyState}
        updateDocuments={legalPolicyState.pending_documents}
        updateCheckStatus="ready"
      />
    );

    expect(await screen.findByText('Términos de uso vigentes')).toBeTruthy();
    expect(screen.getByText(/Aviso de privacidad · versión 2.0/)).toBeTruthy();
    expect(screen.getByText(/Lía e inteligencia artificial · versión 1.1/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Aceptar documentos actualizados/ }));

    await waitFor(() => {
      expect(acceptLegalTerms).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(acceptLegalTerms).toHaveBeenNthCalledWith(1, 'LANZO-TEST-KEY', 'privacy-v2');
    expect(acceptLegalTerms).toHaveBeenNthCalledWith(2, 'LANZO-TEST-KEY', 'ai-v2');
  });

  it('shows accepted versions and downloads the exact accepted document', async () => {
    const acceptedDocument = {
      term_id: 'privacy-v1',
      term_type: 'privacy_policy',
      term_version: '1.0',
      term_published_at: '2026-10-01T12:00:00.000Z',
      accepted_at: '2026-10-02T12:00:00.000Z'
    };
    const fileBlobs = [];
    const createObjectURL = vi.fn((blob) => {
      fileBlobs.push(blob);
      return 'blob:accepted-legal-document';
    });
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL: vi.fn()
    });
    let downloadedFilename = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload() {
      downloadedFilename = this.download;
    });

    fetchAcceptedLegalDocument.mockResolvedValue({
      success: true,
      document: {
        type: 'privacy_policy',
        version: '1.0',
        published_at: '2026-10-01T12:00:00.000Z',
        content_html: '<h2>Texto exacto de la versión aceptada</h2>'
      }
    });

    render(
      <TermsAndConditionsModal
        isOpen
        onClose={vi.fn()}
        readOnly
        showDocumentIndex
        documentTypes={LEGAL_DOCUMENT_TYPES}
        legalPolicyState={{
          success: true,
          status: 'ready',
          pending_documents: [],
          accepted_documents: [acceptedDocument]
        }}
      />
    );

    expect(await screen.findByText('Versión 1.0')).toBeTruthy();
    const historyRegion = screen.getByRole('region', { name: 'Historial de documentos aceptados' });
    expect(historyRegion.textContent).toContain('Aviso de privacidad');
    fireEvent.click(screen.getByRole('button', { name: /Descargar Aviso de privacidad versión 1.0/ }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(fetchAcceptedLegalDocument).toHaveBeenCalledWith('LANZO-TEST-KEY', 'privacy-v1');
    expect(downloadedFilename).toBe('lanzo-aviso-de-privacidad-v1.0.html');

    const downloadedHtml = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(fileBlobs[0]);
    });
    expect(downloadedHtml).toContain('Texto exacto de la versión aceptada');
  });

  it('keeps the existing single-terms behavior when the document index is omitted', async () => {
    render(
      <TermsAndConditionsModal
        isOpen
        onClose={vi.fn()}
        readOnly
      />
    );

    expect(await screen.findByText('Términos de uso vigentes')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Políticas y avisos' })).toBeNull();
    expect(fetchLegalTerms).toHaveBeenCalledTimes(1);
    expect(fetchLegalTerms).toHaveBeenCalledWith('terms_of_use');
  });
});
