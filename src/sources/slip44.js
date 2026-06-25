/**
 * Parse SLIP-0044 markdown to extract coin types.
 *
 * The upstream table layout has changed over time, so the parser is
 * header-driven rather than positional:
 *   - 4 columns: | Coin type | Path component | Symbol | Coin |  (legacy)
 *   - 3 columns: | Coin type | Symbol | Coin |                   (current)
 *
 * When the "Path component" column is absent it is derived from the coin type
 * using the SLIP-0044 hardened-path convention (0x80000000 + coinType), which
 * reproduces the historical values exactly (e.g. 60 -> 0x8000003c).
 */
export function parseSLIP44(markdown) {
  if (!markdown) return {};

  const slip44Data = {};
  const lines = markdown.split('\n');
  let cols = null;

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = splitTableRow(line);
    if (cells.length === 0) continue;

    // First pipe-row containing a "Coin type" header defines the columns.
    if (cols === null) {
      const lower = cells.map(c => c.toLowerCase());
      const coinType = lower.indexOf('coin type');
      if (coinType !== -1) {
        cols = {
          coinType,
          path: lower.indexOf('path component'),
          symbol: lower.indexOf('symbol'),
          coin: lower.indexOf('coin')
        };
        cols.max = Math.max(cols.coinType, cols.path, cols.symbol, cols.coin);
      }
      continue;
    }

    // Skip the header/body separator row (e.g. |-----|-----|).
    if (cells.every(c => c === '' || /^:?-+:?$/.test(c))) continue;

    // Row must span every declared column (interior cells may be empty, but a
    // truncated row that doesn't reach the last column is malformed).
    if (cells.length <= cols.max) continue;

    const coinTypeNum = Number.parseInt(cells[cols.coinType], 10);
    if (Number.isNaN(coinTypeNum)) continue;

    const pathComponent = cols.path !== -1 && cells[cols.path]
      ? cells[cols.path]
      : `0x${(0x80000000 + coinTypeNum).toString(16)}`;

    slip44Data[coinTypeNum] = {
      coinType: coinTypeNum,
      pathComponent,
      symbol: cols.symbol !== -1 ? (cells[cols.symbol] ?? '') : '',
      coin: cols.coin !== -1 ? (cells[cols.coin] ?? '') : ''
    };
  }

  return slip44Data;
}

/**
 * Split a markdown table row into trimmed cells, dropping only the empty
 * edges created by the leading/trailing pipes. Interior empty cells are
 * preserved so columns stay aligned (e.g. coin type 1 has no symbol).
 */
function splitTableRow(line) {
  const parts = line.split('|');
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map(cell => cell.trim());
}
