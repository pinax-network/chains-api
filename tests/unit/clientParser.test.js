import { describe, it, expect } from 'vitest';
import { parseClientVersion } from '../../clientParser.js';

describe('parseClientVersion', () => {
  describe('null / empty inputs', () => {
    it('returns null for null', () => {
      expect(parseClientVersion(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseClientVersion(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseClientVersion('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseClientVersion('   ')).toBeNull();
    });

    it('returns null for the "unavailable" sentinel', () => {
      expect(parseClientVersion('unavailable')).toBeNull();
      expect(parseClientVersion('UNAVAILABLE')).toBeNull();
    });

    it('returns null for non-string values', () => {
      expect(parseClientVersion(42)).toBeNull();
      expect(parseClientVersion({})).toBeNull();
      expect(parseClientVersion([])).toBeNull();
    });
  });

  describe('known clients', () => {
    it('parses a full Geth version string', () => {
      const result = parseClientVersion('Geth/v1.14.5-stable-xxx/linux-amd64/go1.22.5');
      expect(result).toMatchObject({
        name: 'geth',
        version: 'v1.14.5-stable-xxx',
        os: 'linux-amd64',
        runtime: 'go1.22.5',
        repo: 'ethereum/go-ethereum',
        language: 'Go',
        layer: 'execution',
        known: true
      });
      expect(result.raw).toBe('Geth/v1.14.5-stable-xxx/linux-amd64/go1.22.5');
    });

    it('parses erigon', () => {
      const result = parseClientVersion('erigon/v2.60.0/linux-amd64/go1.22.5');
      expect(result.name).toBe('erigon');
      expect(result.version).toBe('v2.60.0');
      expect(result.repo).toBe('erigontech/erigon');
      expect(result.known).toBe(true);
    });

    it('parses besu', () => {
      const result = parseClientVersion('besu/v24.5.1/linux-x86_64/openjdk-java-21');
      expect(result.name).toBe('besu');
      expect(result.repo).toBe('hyperledger/besu');
      expect(result.language).toBe('Java');
    });

    it('parses nethermind with build metadata in version', () => {
      const result = parseClientVersion('Nethermind/v1.26.0+commit.abc123');
      expect(result.name).toBe('nethermind');
      expect(result.version).toBe('v1.26.0+commit.abc123');
      expect(result.os).toBeNull();
      expect(result.runtime).toBeNull();
      expect(result.known).toBe(true);
    });

    it('strips the @instance suffix so nodes on one release aggregate together', () => {
      const a = parseClientVersion('mega-reth/v2.0.21-213cf2a@GS-Prod-TYO-VM4');
      const b = parseClientVersion('mega-reth/v2.0.21-213cf2a@megaeth-arch44');
      expect(a.name).toBe('mega-reth');
      expect(a.version).toBe('v2.0.21-213cf2a');
      // Same release on two different nodes must parse to the same version.
      expect(b.version).toBe(a.version);
      // The full node-specific string is still available via raw.
      expect(a.raw).toBe('mega-reth/v2.0.21-213cf2a@GS-Prod-TYO-VM4');
    });

    it('drops a trailing @ with no instance label', () => {
      expect(parseClientVersion('mega-reth/v2.0.21@').version).toBe('v2.0.21');
    });

    it('leaves a version untouched when @ leads the segment (no release before it)', () => {
      // Nothing precedes the '@', so there is no release to keep — the segment
      // is left as-is rather than collapsing to an empty version.
      expect(parseClientVersion('weird/@instance-only').version).toBe('@instance-only');
    });

    it('parses reth', () => {
      const result = parseClientVersion('reth/v1.0.0-rc.1/x86_64-unknown-linux-gnu');
      expect(result.name).toBe('reth');
      expect(result.repo).toBe('paradigmxyz/reth');
    });

    it('parses Polygon bor', () => {
      const result = parseClientVersion('bor/v1.3.0/linux-amd64/go1.21.0');
      expect(result.name).toBe('bor');
      expect(result.repo).toBe('maticnetwork/bor');
    });
  });

  describe('unknown clients', () => {
    it('still parses structure and marks known=false', () => {
      const result = parseClientVersion('some-new-client/v0.1.0/linux/rust1.75');
      expect(result).toMatchObject({
        name: 'some-new-client',
        version: 'v0.1.0',
        os: 'linux',
        runtime: 'rust1.75',
        repo: null,
        language: null,
        website: null,
        layer: null,
        known: false
      });
    });

    it('handles a single-segment unknown client', () => {
      const result = parseClientVersion('mystery-node');
      expect(result).toMatchObject({
        name: 'mystery-node',
        version: null,
        os: null,
        runtime: null,
        known: false
      });
    });
  });

  describe('edge cases', () => {
    it('normalizes name case', () => {
      expect(parseClientVersion('GETH/v1.14.0').name).toBe('geth');
      expect(parseClientVersion('Erigon/v2.60.0').name).toBe('erigon');
    });

    it('trims surrounding whitespace', () => {
      const result = parseClientVersion('  geth/v1.14.0  ');
      expect(result.name).toBe('geth');
      expect(result.version).toBe('v1.14.0');
    });

    it('preserves segment positions on doubled slashes (version stays null)', () => {
      // Doubled slashes must NOT shift later segments into the version slot —
      // that would silently mis-label OS strings as versions.
      const result = parseClientVersion('geth//linux-amd64');
      expect(result.name).toBe('geth');
      expect(result.version).toBeNull();
      expect(result.os).toBe('linux-amd64');
    });

    it('strips trailing whitespace suffix from name segment', () => {
      const result = parseClientVersion('geth node/v1.14.0');
      expect(result.name).toBe('geth');
    });
  });
});
