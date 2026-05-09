import { L2BEAT_REFRESH_INTERVAL_MS } from '../../config.js';
import { fetchL2Beat } from '../sources/l2beat.js';
import { cachedData } from '../store/cache.js';
import { indexL2BeatSource } from '../store/indexer.js';

let refreshTimer = null;
let refreshInProgress = false;
let refreshPending = false;
let lastRefreshAt = null;
let lastRefreshSource = null;
let lastRefreshError = null;
let lastRefreshProjectCount = 0;

export async function runL2BeatRefresh() {
  if (!cachedData.indexed) {
    console.warn('L2BEAT refresh skipped: data not loaded');
    return { skipped: 'no-data' };
  }

  const dataVersion = cachedData.lastUpdated;
  let fresh;
  try {
    fresh = await fetchL2Beat();
  } catch (err) {
    lastRefreshError = err.message;
    console.error('L2BEAT refresh failed:', err.message);
    return { skipped: 'fetch-error', error: err.message };
  }

  if (cachedData.lastUpdated !== dataVersion) {
    console.warn('L2BEAT refresh skipped: data changed during run');
    return { skipped: 'data-changed' };
  }

  cachedData.l2beat = fresh;
  indexL2BeatSource(fresh, cachedData.indexed);

  lastRefreshAt = new Date().toISOString();
  lastRefreshSource = fresh.source;
  lastRefreshError = null;
  lastRefreshProjectCount = fresh.projects.length;

  console.log(
    `L2BEAT refresh completed (source=${fresh.source}, projects=${fresh.projects.length})`
  );
  return { source: fresh.source, projectCount: fresh.projects.length };
}

function scheduleNext() {
  if (refreshInProgress) {
    refreshPending = true;
    return;
  }
  refreshInProgress = true;
  refreshPending = false;

  runL2BeatRefresh()
    .catch(err => {
      lastRefreshError = err.message;
      console.error('L2BEAT refresh failed:', err.message || err);
    })
    .finally(() => {
      refreshInProgress = false;
      if (refreshPending) {
        refreshPending = false;
        scheduleNext();
      }
    });
}

export function startL2BeatRefresh() {
  if (refreshTimer) return;

  // Kick off immediately so the first sweep populates cache.l2beat without
  // waiting for the first interval tick. Subsequent runs are interval-driven.
  scheduleNext();

  refreshTimer = setInterval(scheduleNext, L2BEAT_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

export function stopL2BeatRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getL2BeatRefreshStatus() {
  return {
    isRefreshing: refreshInProgress,
    lastRefreshAt,
    lastRefreshSource,
    lastRefreshError,
    lastRefreshProjectCount,
    intervalMs: L2BEAT_REFRESH_INTERVAL_MS
  };
}
