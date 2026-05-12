import { proxyFetch } from '../../fetchUtil.js';

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

    if (format === 'json') return await response.json();
    if (format === 'text') return await response.text();
    // Unknown format — surface as a failed fetch rather than returning undefined.
    console.error(`Error fetching data from ${url}: unsupported format "${format}"`);
    return null;
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error.message);
    return null;
  }
}
