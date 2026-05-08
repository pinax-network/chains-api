import {
  DATA_SOURCE_THE_GRAPH,
  DATA_SOURCE_CHAINLIST,
  DATA_SOURCE_CHAINS,
  DATA_SOURCE_SLIP44
} from '../../config.js';
import { fetchData } from '../transport/fetch.js';
import { parseSLIP44 } from '../sources/slip44.js';
import { fetchL2Beat } from '../sources/l2beat.js';
import { indexData } from '../store/indexer.js';
import { cachedData, applyDataToCache } from '../store/cache.js';
import {
  readSnapshotFromDisk,
  writeSnapshotToDiskAtomic,
  DATA_CACHE_PATH
} from '../store/snapshot.js';

const DATA_SOURCES = {
  theGraph: DATA_SOURCE_THE_GRAPH,
  chainlist: DATA_SOURCE_CHAINLIST,
  chains: DATA_SOURCE_CHAINS,
  slip44: DATA_SOURCE_SLIP44
};

let dataRefreshPromise = null;
let startupInitializationPromise = null;
let startupInitialized = false;

function countLoadedSources(data) {
  let loaded = 0;
  if (data.theGraph !== null) loaded++;
  if (data.chainlist !== null) loaded++;
  if (data.chains !== null) loaded++;
  if (data.slip44Text !== null) loaded++;
  return loaded;
}

async function fetchAndBuildData() {
  console.log('Loading data from all sources...');

  const results = await Promise.allSettled([
    fetchData(DATA_SOURCES.theGraph),
    fetchData(DATA_SOURCES.chainlist),
    fetchData(DATA_SOURCES.chains),
    fetchData(DATA_SOURCES.slip44, 'text'),
    fetchL2Beat()
  ]);

  const theGraph = results[0].status === 'fulfilled' ? results[0].value : null;
  const chainlist = results[1].status === 'fulfilled' ? results[1].value : null;
  const chains = results[2].status === 'fulfilled' ? results[2].value : null;
  const slip44Text = results[3].status === 'fulfilled' ? results[3].value : null;
  const l2beat = results[4].status === 'fulfilled' ? results[4].value : null;

  const sourceNames = ['theGraph', 'chainlist', 'chains', 'slip44', 'l2beat'];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Failed to load ${sourceNames[i]}: ${result.reason?.message || result.reason}`);
    }
  });

  const slip44 = parseSLIP44(slip44Text);
  const indexed = indexData(theGraph, chainlist, chains, slip44, l2beat);

  return {
    data: {
      theGraph,
      chainlist,
      chains,
      slip44,
      l2beat,
      indexed,
      lastUpdated: new Date().toISOString(),
      rpcHealth: {},
      lastRpcCheck: null
    },
    loadedSourceCount: countLoadedSources({ theGraph, chainlist, chains, slip44Text })
  };
}

async function refreshDataWithGuard(options = {}) {
  const { requireAtLeastOneSource = false, logSuccessMessage = true } = options;

  if (dataRefreshPromise) return dataRefreshPromise;

  dataRefreshPromise = (async () => {
    const { data, loadedSourceCount } = await fetchAndBuildData();

    if (requireAtLeastOneSource && loadedSourceCount === 0) {
      throw new Error('All data sources failed during data refresh');
    }

    applyDataToCache(data);
    await writeSnapshotToDiskAtomic(cachedData);

    if (logSuccessMessage) {
      console.log(`Data loaded successfully. Total chains: ${cachedData.indexed.all.length}`);
    }

    return cachedData;
  })();

  try {
    return await dataRefreshPromise;
  } finally {
    dataRefreshPromise = null;
  }
}

export async function loadData() {
  return refreshDataWithGuard({ requireAtLeastOneSource: true });
}

/**
 * Stale-first startup:
 *  1. Load valid snapshot from disk if available.
 *  2. Trigger background refresh; keep serving stale data on failure.
 *  3. Fall back to a blocking load if no valid snapshot exists.
 */
export async function initializeDataOnStartup(options = {}) {
  const { onBackgroundRefreshSuccess } = options;

  if (startupInitialized) return cachedData;
  if (startupInitializationPromise) return startupInitializationPromise;

  startupInitializationPromise = (async () => {
    const snapshotData = await readSnapshotFromDisk();

    if (snapshotData) {
      applyDataToCache(snapshotData);
      startupInitialized = true;
      console.log(`Loaded cached snapshot from ${DATA_CACHE_PATH}. Total chains: ${cachedData.indexed.all.length}`);

      refreshDataWithGuard({ requireAtLeastOneSource: true })
        .then(() => {
          console.log('Background refresh completed successfully.');
          if (typeof onBackgroundRefreshSuccess === 'function') {
            onBackgroundRefreshSuccess();
          }
        })
        .catch(error => {
          console.error(`Background refresh failed; continuing with cached data: ${error.message || error}`);
        });

      return cachedData;
    }

    console.log('No valid cache snapshot found. Loading data from remote sources...');
    const loadedData = await loadData();
    startupInitialized = true;
    return loadedData;
  })();

  try {
    return await startupInitializationPromise;
  } finally {
    startupInitializationPromise = null;
  }
}
