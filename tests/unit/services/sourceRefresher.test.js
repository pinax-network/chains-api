import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/loader.js', () => ({
  getFailedSources: vi.fn(),
  refreshAllSources: vi.fn()
}));

import { runSourceHealCheck } from '../../../src/services/sourceRefresher.js';
import { getFailedSources, refreshAllSources } from '../../../src/services/loader.js';

beforeEach(() => vi.clearAllMocks());

describe('source self-healer', () => {
  it('does nothing when all sources are loaded', async () => {
    getFailedSources.mockReturnValue([]);
    const result = await runSourceHealCheck();
    expect(refreshAllSources).not.toHaveBeenCalled();
    expect(result.healed).toBe(false);
  });

  it('re-fetches and reports healed when a failed source recovers', async () => {
    // failed before the refresh, loaded after.
    getFailedSources.mockReturnValueOnce(['chainlist']).mockReturnValueOnce([]);
    refreshAllSources.mockResolvedValue({});
    const result = await runSourceHealCheck();
    expect(refreshAllSources).toHaveBeenCalledOnce();
    expect(result.healed).toBe(true);
  });

  it('reports not healed when the source is still failing after a refresh', async () => {
    getFailedSources.mockReturnValue(['theGraph']);
    refreshAllSources.mockResolvedValue({});
    const result = await runSourceHealCheck();
    expect(refreshAllSources).toHaveBeenCalledOnce();
    expect(result.healed).toBe(false);
  });

  it('swallows refresh errors and reports not healed', async () => {
    getFailedSources.mockReturnValue(['chains']);
    refreshAllSources.mockRejectedValue(new Error('network'));
    const result = await runSourceHealCheck();
    expect(result.healed).toBe(false);
  });
});
