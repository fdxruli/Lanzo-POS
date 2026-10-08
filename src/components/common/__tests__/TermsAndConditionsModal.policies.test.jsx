// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legalPreviewState = vi.hoisted(() => ({ enabled: false }));

vi.mock('../../../services/supabase', () => ({
  fetchLegalTerms: vi.fn(),
  fetchLegalPolicyPreview: vi.fn(),
  isLegalPolicyPreviewEnabled: () => legalPreviewState.enabled,
  acceptLegalTerms: vi.fn()
}));
vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() }
}));
vi.mock('../../../services/utils', () => ({
  showMessageModal: vi.fn()
}));

import { fetchLegalPolicyPreview, fetchLegalTerms } from '../../../services/supabase';
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
    legalPreviewState.enabled = false;
    fetchLegalPolicyPreview.mockResolvedValue(null);
    fetchLegalTerms.mockImplementation(async (type) => (
      type === 'terms_of_use' ? termsDocument : null
    ));
  });

  afterEach(() => {
    cleanup();
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

    fireEvent.click(screen.getByRole('button', { name: /Lía e inteligencia artificial/ }));
    expect(await screen.findByText(/Este documento está en preparación/)).toBeTruthy();
    expect(fetchLegalTerms).not.toHaveBeenCalledWith('ai_policy');
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
