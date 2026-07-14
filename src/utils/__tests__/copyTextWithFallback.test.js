// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { copyTextWithFallback } from '../copyTextWithFallback';

describe('copyTextWithFallback', () => {
  it('uses the asynchronous clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyTextWithFallback('https://lanzo-store.vercel.app', {
      navigatorRef: { clipboard: { writeText } },
      documentRef: document
    })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://lanzo-store.vercel.app');
  });

  it('uses the document fallback when clipboard rejects', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const documentRef = document.implementation.createHTMLDocument('copy');
    documentRef.execCommand = execCommand;

    await expect(copyTextWithFallback('enlace', {
      navigatorRef: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } },
      documentRef
    })).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(documentRef.querySelector('textarea')).toBeNull();
  });
});

