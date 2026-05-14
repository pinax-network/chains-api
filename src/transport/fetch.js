import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';

const SUPPORTED_FORMATS = new Set(['json', 'text']);

/**
 * Fetch JSON or text from a URL using proxyFetch.
 * Returns null on error rather than throwing, so loaders can use
 * Promise.allSettled-style handling with consistent shapes.
 */
export async function fetchData(url, format = 'json') {
  // Validate before issuing any network I/O so unsupported callers fail
  // deterministically without a wasted outbound request.
  if (!SUPPORTED_FORMATS.has(format)) {
    logger.error({ url, format }, 'Unsupported fetch format');
    incCounter('chains_api_source_fetch_total', { url, outcome: 'bad_format' });
    return null;
  }

  try {
    const response = await proxyFetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the body BEFORE incrementing the success counter so a body-parse
    // failure doesn't double-count as both success and error in the catch.
    const body = format === 'json' ? await response.json() : await response.text();
    incCounter('chains_api_source_fetch_total', { url, outcome: 'success' });
    return body;
  } catch (error) {
    logger.error({ url, err: error.message }, 'Source fetch failed');
    incCounter('chains_api_source_fetch_total', { url, outcome: 'error' });
    return null;
  }
}
