import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';

/**
 * Fetch JSON or text from a URL using proxyFetch.
 * Returns null on error rather than throwing, so loaders can use
 * Promise.allSettled-style handling with consistent shapes.
 */
export async function fetchData(url, format = 'json') {
  try {
    const response = await proxyFetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (format === 'json') {
      incCounter('chains_api_source_fetch_total', { url, outcome: 'success' });
      return await response.json();
    }
    if (format === 'text') {
      incCounter('chains_api_source_fetch_total', { url, outcome: 'success' });
      return await response.text();
    }
    // Unknown format — surface as a failed fetch rather than returning undefined.
    logger.error({ url, format }, 'Unsupported fetch format');
    incCounter('chains_api_source_fetch_total', { url, outcome: 'bad_format' });
    return null;
  } catch (error) {
    logger.error({ url, err: error.message }, 'Source fetch failed');
    incCounter('chains_api_source_fetch_total', { url, outcome: 'error' });
    return null;
  }
}
