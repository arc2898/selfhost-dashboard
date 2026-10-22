function isAllowedWebSocketOrigin(origin, requestHost) {
  // Non-browser clients may omit Origin; session-cookie authentication still applies.
  if (!origin) return true;
  if (!requestHost || typeof origin !== 'string') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.host.toLowerCase() === String(requestHost).toLowerCase();
  } catch {
    return false;
  }
}

module.exports = { isAllowedWebSocketOrigin };
