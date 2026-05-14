// Curated registry of known blockchain client software.
// Key is the lowercased client name as it appears in `web3_clientVersion`
// responses (hyphens preserved — see `op-geth`, `op-reth`). Add new entries
// as they're observed in production — unknown names still round-trip
// through the parser with `repo: null`.

export const CLIENT_REGISTRY = {
  // Ethereum execution clients
  geth:       { repo: 'ethereum/go-ethereum',       language: 'Go',     website: 'https://geth.ethereum.org', layer: 'execution' },
  erigon:     { repo: 'erigontech/erigon',          language: 'Go',     website: 'https://erigon.tech',       layer: 'execution' },
  nethermind: { repo: 'NethermindEth/nethermind',   language: 'C#',     website: 'https://nethermind.io',     layer: 'execution' },
  besu:       { repo: 'hyperledger/besu',           language: 'Java',   website: 'https://besu.hyperledger.org', layer: 'execution' },
  reth:       { repo: 'paradigmxyz/reth',           language: 'Rust',   website: 'https://reth.rs',           layer: 'execution' },

  // Ethereum consensus (beacon) clients — mostly reported via a different RPC surface,
  // but listed here so beacon endpoints can be resolved when discovered.
  lighthouse: { repo: 'sigp/lighthouse',            language: 'Rust',   website: 'https://lighthouse.sigmaprime.io', layer: 'consensus' },
  prysm:      { repo: 'OffchainLabs/prysm',         language: 'Go',     website: 'https://prysmaticlabs.com', layer: 'consensus' },
  teku:       { repo: 'Consensys/teku',             language: 'Java',   website: 'https://consensys.io/teku', layer: 'consensus' },
  nimbus:     { repo: 'status-im/nimbus-eth2',      language: 'Nim',    website: 'https://nimbus.guide',      layer: 'consensus' },
  lodestar:   { repo: 'ChainSafe/lodestar',         language: 'TypeScript', website: 'https://lodestar.chainsafe.io', layer: 'consensus' },

  // L2 / alt-EVM clients
  bor:        { repo: 'maticnetwork/bor',           language: 'Go',     website: 'https://polygon.technology', layer: 'execution' },
  'op-geth':  { repo: 'ethereum-optimism/op-geth',  language: 'Go',     website: 'https://optimism.io',       layer: 'execution' },
  // op-reth ships as a binary inside the reth monorepo; no separate repo.
  'op-reth':  { repo: 'paradigmxyz/reth',           language: 'Rust',   website: 'https://reth.rs',           layer: 'execution' },

  // Non-EVM chains that still respond to JSON-RPC health probes
  parity:     { repo: 'openethereum/openethereum',  language: 'Rust',   website: null, layer: 'execution', deprecated: true },
  openethereum: { repo: 'openethereum/openethereum', language: 'Rust',  website: null, layer: 'execution', deprecated: true }
};

/**
 * Look up registry metadata for a parsed client name.
 * Matches are case-insensitive; returns null when the name is unknown.
 *
 * @param {string} name Normalized client name (e.g. "geth", "erigon")
 * @returns {{ repo: string|null, language: string|null, website: string|null, layer: string|null, deprecated?: boolean }|null}
 */
export function lookupClient(name) {
  if (!name || typeof name !== 'string') return null;
  const key = name.toLowerCase();
  return CLIENT_REGISTRY[key] ?? null;
}
