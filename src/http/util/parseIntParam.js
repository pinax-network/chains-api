export function parseIntParam(param) {
  if (typeof param === 'number') {
    return Number.isInteger(param) ? param : null;
  }

  if (typeof param !== 'string') {
    return null;
  }

  const normalized = param.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
