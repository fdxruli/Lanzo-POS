const isShareCancellation = (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

export const downloadCustomerMessageImage = ({ blob, filename }, {
  documentRef = globalThis.document,
  urlApi = globalThis.URL
} = {}) => {
  if (!blob || !documentRef?.createElement || !urlApi?.createObjectURL) {
    return { status: 'unsupported', code: 'IMAGE_DOWNLOAD_UNSUPPORTED' };
  }
  let objectUrl;
  try {
    objectUrl = urlApi.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename || 'comprobante.png';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    documentRef.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return {
      status: 'downloaded',
      code: null,
      message: 'Imagen descargada. Adjuntala manualmente desde la aplicacion que prefieras.'
    };
  } catch (error) {
    return { status: 'failed', code: 'IMAGE_DOWNLOAD_FAILED', error };
  } finally {
    if (objectUrl) urlApi.revokeObjectURL(objectUrl);
  }
};

export const shareCustomerMessageImage = async (imageResult, {
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  title = 'Comprobante de Lanzo POS'
} = {}) => {
  if (!imageResult?.ok || !imageResult.file) {
    return { status: 'failed', code: imageResult?.code || 'IMAGE_RESULT_INVALID' };
  }
  const files = [imageResult.file];
  if (typeof navigatorRef?.share === 'function') {
    const canShare = typeof navigatorRef.canShare !== 'function' || navigatorRef.canShare({ files });
    if (canShare) {
      try {
        await navigatorRef.share({ files, title });
        return { status: 'shared', code: null };
      } catch (error) {
        return isShareCancellation(error)
          ? { status: 'cancelled', code: 'IMAGE_SHARE_CANCELLED' }
          : { status: 'failed', code: 'IMAGE_SHARE_FAILED', error };
      }
    }
  }
  return downloadCustomerMessageImage(imageResult, { documentRef, urlApi });
};

