export type DgiiEcfQrPayload = {
  /** Valor decodificado, conservado solamente durante la revisión OCR actual. */
  rawValue: string;
  /** RNC o cédula del emisor indicado por el Timbre Electrónico de DGII. */
  issuerRnc: string;
  buyerRnc?: string;
  eNcf: string;
  issueDate?: string;
  taxTotal?: number;
  total?: number;
};

const dgiiQrHosts = new Set(['ecf.dgii.gov.do', 'fc.dgii.gov.do']);

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

/**
 * Lee localmente el Timbre Electrónico de un e-CF de la DGII. La especificación
 * oficial usa una URL HTTPS de ConsultaTimbre con RncEmisor, ENCF,
 * FechaEmision y MontoTotal; algunos formatos incluyen además ITBIS.
 *
 * Se rechaza cualquier QR que no sea una URL oficial de DGII o que no tenga
 * tanto RNC del emisor como e-NCF válidos. Nunca se consulta la URL ni se envía
 * el contenido del QR fuera del navegador.
 */
export function parseDgiiEcfQrPayload(value: string): DgiiEcfQrPayload | undefined {
  const url = parseDgiiTimbreUrl(value);
  if (!url) return undefined;

  const parameters = new Map<string, string>();
  for (const [key, parameterValue] of url.searchParams) {
    const normalizedKey = key.replace(/[\s_-]/g, '').toLowerCase();
    if (normalizedKey && !parameters.has(normalizedKey)) {
      parameters.set(normalizedKey, parameterValue.trim());
    }
  }

  const issuerRnc = normalizeRnc(parameters.get('rncemisor'));
  const eNcf = normalizeElectronicNcf(parameters.get('encf'));
  if (!issuerRnc || !eNcf) return undefined;

  return {
    rawValue: value.trim(),
    issuerRnc,
    buyerRnc: normalizeRnc(parameters.get('rnccomprador')),
    eNcf,
    issueDate: parseDgiiDate(parameters.get('fechaemision')),
    taxTotal: parseDgiiAmount(
      parameters.get('totalitbis') ?? parameters.get('montoitbis') ?? parameters.get('itbis'),
    ),
    total: parseDgiiAmount(
      parameters.get('montototal') ??
        parameters.get('totalpagar') ??
        parameters.get('importetotal') ??
        parameters.get('total'),
    ),
  };
}

function parseDgiiTimbreUrl(value: string) {
  const compactValue = value.trim().replace(/[\r\n\t]/g, '');
  if (!/^https:\/\//i.test(compactValue)) return undefined;

  try {
    const url = new URL(compactValue);
    if (url.protocol !== 'https:' || !dgiiQrHosts.has(url.hostname.toLowerCase())) {
      return undefined;
    }
    // La DGII publica variantes para e-CF, factura de consumo y ambiente de
    // pruebas, pero todas usan el servicio ConsultaTimbre.
    if (!/consultatimbre/i.test(url.pathname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function normalizeRnc(value: string | undefined) {
  const digits = value?.replace(/\D/g, '');
  return digits && (digits.length === 9 || digits.length === 11) ? digits : undefined;
}

function normalizeElectronicNcf(value: string | undefined) {
  const normalized = value?.replace(/[\s-]/g, '').toUpperCase();
  // El e-NCF tiene la serie E seguida de doce dígitos (13 caracteres).
  return normalized && /^E\d{12}$/.test(normalized) ? normalized : undefined;
}

function parseDgiiDate(value: string | undefined) {
  const match = value?.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function parseDgiiAmount(value: string | undefined) {
  const compact = value?.replace(/(?:RD\$|DOP)/gi, '').replace(/\s/g, '');
  if (!compact || !/^[\d.,]+$/.test(compact)) return undefined;

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastDot > lastComma
        ? compact.replaceAll(',', '')
        : compact.replaceAll('.', '').replace(',', '.');
  } else if (lastComma >= 0) {
    normalized =
      compact.slice(lastComma + 1).length <= 2
        ? compact.replace(',', '.')
        : compact.replaceAll(',', '');
  } else if (lastDot >= 0 && compact.slice(lastDot + 1).length > 2) {
    normalized = compact.replaceAll('.', '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? roundCurrency(parsed) : undefined;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
