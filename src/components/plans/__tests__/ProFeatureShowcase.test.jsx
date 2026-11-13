// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProFeatureShowcase from '../ProFeatureShowcase';

describe('ProFeatureShowcase content position', () => {
  it('keeps additional content after features by default', () => {
    render(
      <MemoryRouter>
        <ProFeatureShowcase
          variant="card"
          title="Showcase"
          features={[{ title: 'Feature', description: 'Feature description' }]}
          benefits={['Benefit']}
          offerTitle="Offer"
        >
          <p data-testid="additional-content">Additional content</p>
        </ProFeatureShowcase>
      </MemoryRouter>
    );

    const feature = screen.getByRole('heading', { name: 'Feature' });
    const benefit = screen.getByText('Benefit');
    const additionalContent = screen.getByTestId('additional-content');
    const offer = screen.getByRole('heading', { name: 'Offer' });

    expect(feature.compareDocumentPosition(benefit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(benefit.compareDocumentPosition(additionalContent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(additionalContent.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
