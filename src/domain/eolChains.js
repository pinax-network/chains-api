// Networks the ecosystem has shut down but that carry no `status` in any
// upstream source: chains.json marks only ~123 entries deprecated, and the
// famous dead testnets (Ropsten, Rinkeby, Goerli, Kovan-era L2s, Mumbai) are
// not among them — they simply have no status field, and the TheGraph
// registry no longer lists them at all. This curated list is the seed the
// indexer uses to mark them; an explicit upstream status always wins.
//
// Tokens are matched case-insensitively against the chain name. They are
// distinctive network names, not generic words — verified against the full
// registry for false positives before each addition.
export const EOL_NAME_TOKENS = [
  'goerli',
  'görli',
  'ropsten',
  'rinkeby',
  'kovan',
  'mumbai',
  'morden'
];

// Dead networks a name token can't express (chain renamed, ambiguous word…).
export const EOL_CHAIN_IDS = new Set();

// Whole-word match, so a future chain whose name merely embeds a token inside
// a longer word ("Mumbaicoin") is not swept up. Built once at module load.
const EOL_NAME_RE = new RegExp(`\\b(?:${EOL_NAME_TOKENS.join('|')})\\b`, 'i');

/** True when a chain is on the curated end-of-life list. */
export function isKnownEolChain(chain) {
  if (EOL_CHAIN_IDS.has(chain.chainId)) return true;
  return EOL_NAME_RE.test(chain.name || '');
}
