/**
 * Attempts to read the QR printed on a supplier invoice without uploading the
 * photo. A QR is only an additional verification signal: the invoice still
 * goes through OCR and human review before it can be recorded.
 */
export async function readSupplierInvoiceQr(source: Blob): Promise<string | undefined> {
  const objectUrl = URL.createObjectURL(source);
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(objectUrl);
    const value = result.getText().trim();
    return value || undefined;
  } catch {
    // QR codes are optional and several supplier invoices use only a security
    // token. OCR must remain fully usable when no code can be decoded.
    return undefined;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
