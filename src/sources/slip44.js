/**
 * Parse SLIP-0044 markdown to extract coin types.
 * Table structure: | Coin type | Path component | Symbol | Coin |
 */
export function parseSLIP44(markdown) {
  if (!markdown) return {};

  const slip44Data = {};
  const lines = markdown.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !line.includes('|')) continue;

    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);

    if (cells[0] === 'Coin type' || cells[0].includes('-')) {
      inTable = true;
      continue;
    }

    if (!inTable || cells.length < 4) continue;

    const coinTypeNum = Number.parseInt(cells[0], 10);
    if (Number.isNaN(coinTypeNum)) continue;

    slip44Data[coinTypeNum] = {
      coinType: coinTypeNum,
      pathComponent: cells[1],
      symbol: cells[2],
      coin: cells[3]
    };
  }

  return slip44Data;
}
