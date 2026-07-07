// Community names that no longer appear in a chain's canonical registry name
// (renames like Optimism → "OP Mainnet"). searchChains resolves these before
// substring matching so the names everyone still uses keep working. Keys are
// lowercase; each maps to the chainId(s) the alias means. Keep this list to
// well-known renames — anything still present in a chain's name or shortName
// does not belong here.
export const CHAIN_ALIASES = {
  optimism: [10], // renamed "OP Mainnet"
  bsc: [56], // "BNB Smart Chain Mainnet"
  binance: [56],
  'binance smart chain': [56],
  xdai: [100], // renamed "Gnosis"
  matic: [137] // renamed "Polygon Mainnet"
};
