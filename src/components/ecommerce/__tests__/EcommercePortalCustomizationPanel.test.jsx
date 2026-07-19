// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommercePortalCustomizationPanel from '../EcommercePortalCustomizationPanel';
import { uploadImageFile } from '../../../services/storage/imageUploadService';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo', BUSINESS_COVER: 'business-cover' },
  uploadImageFile: vi.fn()
}));

const portal = {
  templateCode: 'showcase',
  theme: {},
  logoUrl: 'https://cdn.example/logo-before.png',
  coverImageUrl: 'https://cdn.example/cover-before.png'
};
const lastChange = (changes) => changes.at(-1);

describe('EcommercePortalCustomizationPanel image intents', () => {
  let changes;

  beforeEach(() => {
    changes = [];
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview-image'),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderPanel = (props = {}) => render(
    <EcommercePortalCustomizationPanel
      isPro
      portal={portal}
      licenseKey="license-fixture"
      onChange={(value) => changes.push(value)}
      {...props}
    />
  );

  it('hydrates existing images as preserve and clears only the logo when requested', async () => {
    renderPanel();
    await waitFor(() => expect(lastChange(changes).logo).toEqual({
      value: portal.logoUrl, intent: 'preserve'
    }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Desvincular' })[0]);

    await waitFor(() => expect(lastChange(changes).logo).toEqual({ value: null, intent: 'clear' }));
    expect(lastChange(changes).cover).toEqual({ value: portal.coverImageUrl, intent: 'preserve' });
  });

  it('marks a successfully uploaded HTTPS logo as set', async () => {
    uploadImageFile.mockResolvedValue({ publicUrl: 'https://cdn.example/logo-after.png' });
    renderPanel();
    const input = document.querySelector('input[type="file"]');
    const file = new File(['image'], 'logo.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(lastChange(changes).logo).toEqual({
      value: 'https://cdn.example/logo-after.png', intent: 'set'
    }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-image');
  });

  it('restores the prior image and intent when upload fails', async () => {
    uploadImageFile.mockRejectedValue(new Error('Upload fallido'));
    renderPanel();
    const input = document.querySelector('input[type="file"]');
    const file = new File(['image'], 'logo.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(lastChange(changes).logo).toEqual({
      value: portal.logoUrl, intent: 'preserve'
    }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-image');
  });

  it('clears the cover on reset while preserving the logo', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));

    await waitFor(() => expect(lastChange(changes).cover).toEqual({ value: null, intent: 'clear' }));
    expect(lastChange(changes).logo).toEqual({ value: portal.logoUrl, intent: 'preserve' });
  });

  it('rehydrates response values as preserve after a save', async () => {
    const { rerender } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Desvincular' })[0]);
    await waitFor(() => expect(lastChange(changes).logo.intent).toBe('clear'));

    rerender(
      <EcommercePortalCustomizationPanel
        isPro
        portal={{ ...portal, logoUrl: null, coverImageUrl: 'https://cdn.example/cover-saved.png' }}
        licenseKey="license-fixture"
        onChange={(value) => changes.push(value)}
      />
    );

    await waitFor(() => expect(lastChange(changes).logo).toEqual({ value: null, intent: 'preserve' }));
    expect(lastChange(changes).cover).toEqual({
      value: 'https://cdn.example/cover-saved.png', intent: 'preserve'
    });
  });

  it('does not expose upload controls on Free', () => {
    renderPanel({ isPro: false });
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(uploadImageFile).not.toHaveBeenCalled();
  });
});
