const cedulaWeights = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2] as const;
const rncWeights = [7, 9, 8, 6, 5, 4, 3, 2] as const;
const dominicanDocumentCharacters = /^[\d\s-]+$/;

export function normalizeDominicanDocument(value: string) {
  return value.replace(/\D/g, '');
}

function isTrivialDocument(digits: string) {
  return /^(\d)\1+$/.test(digits) || /^0+\d$/.test(digits);
}

export function validateDominicanCedula(value: string) {
  if (!dominicanDocumentCharacters.test(value.trim())) {
    return false;
  }

  const digits = normalizeDominicanDocument(value);

  if (digits.length !== 11 || !/^\d+$/.test(digits) || isTrivialDocument(digits)) {
    return false;
  }

  let sum = 0;

  for (let index = 0; index < 10; index += 1) {
    let product = Number(digits[index]) * cedulaWeights[index];

    if (product >= 10) {
      product = Math.floor(product / 10) + (product % 10);
    }

    sum += product;
  }

  const expectedVerifier = (10 - (sum % 10)) % 10;
  return expectedVerifier === Number(digits[10]);
}

export function validateDominicanRnc(value: string) {
  if (!dominicanDocumentCharacters.test(value.trim())) {
    return false;
  }

  const digits = normalizeDominicanDocument(value);

  if (digits.length !== 9 || !/^\d+$/.test(digits) || isTrivialDocument(digits)) {
    return false;
  }

  let sum = 0;

  for (let index = 0; index < 8; index += 1) {
    sum += Number(digits[index]) * rncWeights[index];
  }

  const remainder = sum % 11;
  let expectedVerifier = 11 - remainder;

  if (remainder === 0) {
    expectedVerifier = 2;
  } else if (remainder === 1) {
    expectedVerifier = 1;
  }

  return expectedVerifier === Number(digits[8]);
}

export function validateDominicanDocument(type: 'RNC' | 'CEDULA', value: string) {
  if (type === 'RNC') {
    return validateDominicanRnc(value);
  }

  return validateDominicanCedula(value);
}

export function formatDominicanDocument(type: 'RNC' | 'CEDULA', value: string) {
  const digits = normalizeDominicanDocument(value);

  if (type === 'RNC' && digits.length === 9) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 3)}-${digits.slice(3, 8)}-${digits.slice(8)}`;
  }

  if (type === 'CEDULA' && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
  }

  return digits;
}
