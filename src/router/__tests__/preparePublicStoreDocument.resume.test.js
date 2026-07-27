// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { preparePublicStoreDocument } from '../preparePublicStoreDocument';
import {
  lockPublicDocumentScroll,
  resetPublicDocumentScroll
} from '../../utils/publicDocumentScroll';

describe('public document recovery', () => {
  afterEach(() => {
    resetPublicDocumentScroll();
    document.documentElement.className = '';
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('applies explicit layout classes and removes them deterministically', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const cleanup = preparePublicStoreDocument();
    expect(document.documentElement).toHaveClass('public-store-document');
    expect(document.body).toHaveClass('public-store-body');
    expect(document.getElementById('root')).toHaveClass('public-store-root');
    cleanup();
    expect(document.body).not.toHaveClass('public-store-body');
  });

  it('releases an orphaned overlay scroll lock during recovery', () => {
    document.body.style.overflow = 'auto';
    lockPublicDocumentScroll('overlay');
    expect(document.body.style.overflow).toBe('hidden');
    resetPublicDocumentScroll();
    expect(document.body.style.overflow).toBe('auto');
  });
});
