import { HttpsProxyAgent } from 'https-proxy-agent';
import { PROXY_URL, PROXY_ENABLED } from './config.js';
import { logger } from './src/util/logger.js';

/**
 * Proxy-aware fetch wrapper
 * Supports HTTP/HTTPS proxies via the PROXY_URL environment variable
 * Falls back to standard fetch if no proxy is configured
 */

let proxyAgent = null;

if (PROXY_ENABLED) {
  try {
    proxyAgent = new HttpsProxyAgent(PROXY_URL);
    logger.info({ proxy: PROXY_URL.replace(/:[^:@]*@/, ':****@') }, 'Proxy enabled');
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to initialize proxy agent; continuing without proxy');
  }
}

/**
 * Proxy-aware fetch function
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function proxyFetch(url, options = {}) {
  // If proxy is enabled and agent is initialized, add it to options
  if (proxyAgent && (url.startsWith('http://') || url.startsWith('https://'))) {
    // Create a new options object to avoid mutating the original
    const proxyOptions = {
      ...options,
      // Use dispatcher for undici (Node's fetch implementation)
      dispatcher: proxyAgent
    };
    return fetch(url, proxyOptions);
  }
  
  // Use standard fetch if no proxy configured
  return fetch(url, options);
}

/**
 * Get proxy status information
 * @returns {object} Proxy status
 */
export function getProxyStatus() {
  return {
    enabled: PROXY_ENABLED,
    url: PROXY_ENABLED ? PROXY_URL.replace(/:[^:@]*@/, ':****@') : null
  };
}
