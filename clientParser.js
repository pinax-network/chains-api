import { lookupClient } from './clientRegistry.js';

/**
 * Parse a `web3_clientVersion` response into structured client metadata.
 *
 * Client strings follow a loose `name/version/os/runtime` convention:
 *   - "Geth/v1.14.5-stable-xxx/linux-amd64/go1.22.5"
 *   - "erigon/v2.60.0/linux-amd64/go1.22.5"
 *   - "besu/v24.5.1/linux-x86_64/openjdk-java-21"
 *   - "Nethermind/v1.26.0+xyz"
 *   - "reth/v1.0.0-xxx"
 *
 * Returns null for empty / sentinel values ("unavailable", "") so callers can
 * distinguish "no data" from "data we couldn't recognize".
 *
 * @param {string|null|undefined} raw
 * @returns {{
 *   raw: string,
 *   name: string,
 *   version: string|null,
 *   os: string|null,
 *   runtime: string|null,
 *   repo: string|null,
 *   language: string|null,
 *   website: string|null,
 *   layer: string|null,
 *   known: boolean
 * } | null}
 */
export function parseClientVersion(raw) {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unavailable') return null;

  // Split on '/' but DO NOT collapse empty segments — doing so would shift
  // later segments into earlier slots (e.g. "geth//linux" would mis-report
  // "linux" as the version). Preserve positional meaning instead.
  const parts = trimmed.split('/').map(p => p.trim());
  const nameSegment = parts[0];
  if (!nameSegment) return null;

  const name = normalizeName(nameSegment);
  const version = parts[1] ? normalizeVersion(parts[1]) : null;
  const os = parts[2] || null;
  const runtime = parts[3] || null;

  const meta = lookupClient(name);

  return {
    raw: trimmed,
    name,
    version,
    os,
    runtime,
    repo: meta?.repo ?? null,
    language: meta?.language ?? null,
    website: meta?.website ?? null,
    layer: meta?.layer ?? null,
    known: meta !== null
  };
}

/**
 * Normalize a client name segment to the lowercase form used as registry key.
 * Strips surrounding whitespace and any trailing build suffix after a space.
 */
function normalizeName(segment) {
  return segment.split(/\s+/)[0].toLowerCase();
}

/**
 * Trim the version segment. We intentionally keep build metadata, pre-release
 * tags, and any other suffix the client emits (e.g. "v1.26.0+commit.abc")
 * so the version string aggregates downstream as the client author meant it.
 * The raw input is still available via `raw` for callers that need it.
 */
function normalizeVersion(segment) {
  return segment.trim();
}
