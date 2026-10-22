function parseByteRange(header, size) {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0 || typeof header !== 'string') return false;

  const value = header.trim();
  if (!value.toLowerCase().startsWith('bytes=') || value.includes(',')) return false;
  const spec = value.slice(6);
  const dash = spec.indexOf('-');
  if (dash < 0 || spec.indexOf('-', dash + 1) >= 0) return false;
  const first = spec.slice(0, dash);
  const second = spec.slice(dash + 1);
  const isDigits = text => text.length > 0 && [...text].every(char => char >= '0' && char <= '9');
  if ((!first && !isDigits(second)) || (first && !isDigits(first)) ||
      (second && !isDigits(second))) return false;

  let start;
  let end;
  if (!first) {
    const suffixLength = Number(second);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(first);
    end = second ? Number(second) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return false;
  return { start, end };
}

module.exports = parseByteRange;
