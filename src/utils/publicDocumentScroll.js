const locks = new Set();
let snapshot = null;

const capture = (documentRef) => ({
  overflow: documentRef.body.style.overflow,
  position: documentRef.body.style.position,
  inset: documentRef.body.style.inset,
  htmlOverflow: documentRef.documentElement.style.overflow
});

const restore = (documentRef, values) => {
  if (!values) return;
  documentRef.body.style.overflow = values.overflow;
  documentRef.body.style.position = values.position;
  documentRef.body.style.inset = values.inset;
  documentRef.documentElement.style.overflow = values.htmlOverflow;
};

export function lockPublicDocumentScroll(owner, documentRef = document) {
  if (!owner || locks.has(owner)) return;
  if (locks.size === 0) snapshot = capture(documentRef);
  locks.add(owner);
  documentRef.body.style.overflow = 'hidden';
}

export function unlockPublicDocumentScroll(owner, documentRef = document) {
  locks.delete(owner);
  if (locks.size > 0) return;
  restore(documentRef, snapshot);
  snapshot = null;
}

export function resetPublicDocumentScroll(documentRef = document) {
  locks.clear();
  restore(documentRef, snapshot);
  snapshot = null;
  if (documentRef.body.style.overflow === 'hidden') documentRef.body.style.overflow = '';
}
