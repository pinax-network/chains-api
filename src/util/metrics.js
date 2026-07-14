/**
 * Lightweight, dependency-free Prometheus-format metrics.
 *
 * Tracks counters (monotonic) and gauges (point-in-time). Counters are
 * incremented from anywhere; gauges are computed on /metrics scrape from
 * the cache so they always reflect current state without an updater loop.
 *
 * Exposes a single render() function that emits Prometheus text exposition
 * format (https://prometheus.io/docs/instrumenting/exposition_formats/).
 */

const counters = new Map();
const histograms = new Map();

const DEFAULT_HTTP_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Escape a string for use as a Prometheus label value. Per the exposition
 * format spec, label values must escape `\` (as `\\`), `"` (as `\"`), and
 * newlines (as `\n`). Order matters: backslash first, otherwise the literal
 * `\` inserted by the quote-escape would itself get re-escaped.
 */
function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function counterKey(name, labels) {
  const labelStr = Object.entries(labels || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(',');
  return labelStr ? `${name}{${labelStr}}` : name;
}

export function incCounter(name, labels = {}, value = 1) {
  const key = counterKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function observeHistogram(
  name,
  labels = {},
  value,
  buckets = DEFAULT_HTTP_DURATION_BUCKETS
) {
  if (!Number.isFinite(value) || value < 0) return;
  const key = counterKey(name, labels);
  let histogram = histograms.get(key);
  if (!histogram) {
    histogram = {
      buckets: [...buckets].sort((a, b) => a - b),
      counts: new Array(buckets.length).fill(0),
      count: 0,
      sum: 0
    };
    histograms.set(key, histogram);
  }
  histogram.count += 1;
  histogram.sum += value;
  histogram.buckets.forEach((upperBound, index) => {
    if (value <= upperBound) histogram.counts[index] += 1;
  });
}

function formatCounters(lines) {
  // Group by metric name for proper HELP/TYPE headers.
  const byName = new Map();
  for (const [key, value] of counters.entries()) {
    const name = key.split('{')[0];
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push([key, value]);
  }
  for (const [name, entries] of byName.entries()) {
    lines.push(`# HELP ${name} ${METRIC_HELP[name] || ''}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [key, value] of entries) {
      lines.push(`${key} ${value}`);
    }
  }
}

function addLabel(key, label) {
  const braceIndex = key.indexOf('{');
  if (braceIndex === -1) return `${key}{${label}}`;
  return `${key.slice(0, -1)},${label}}`;
}

function suffixMetricName(key, suffix) {
  const braceIndex = key.indexOf('{');
  if (braceIndex === -1) return `${key}${suffix}`;
  return `${key.slice(0, braceIndex)}${suffix}${key.slice(braceIndex)}`;
}

function formatHistograms(lines) {
  const grouped = new Map();
  for (const [key, value] of histograms.entries()) {
    const name = key.split('{')[0];
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push([key, value]);
  }
  for (const [name, entries] of grouped.entries()) {
    lines.push(`# HELP ${name} ${METRIC_HELP[name] || ''}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const [key, histogram] of entries) {
      histogram.buckets.forEach((upperBound, index) => {
        lines.push(`${addLabel(key, `le="${upperBound}"`)} ${histogram.counts[index]}`);
      });
      lines.push(`${addLabel(key, 'le="+Inf"')} ${histogram.count}`);
      lines.push(`${suffixMetricName(key, '_sum')} ${histogram.sum}`);
      lines.push(`${suffixMetricName(key, '_count')} ${histogram.count}`);
    }
  }
}

const METRIC_HELP = {
  chains_api_source_fetch_total: 'Number of source fetch attempts by source and outcome',
  chains_api_refresh_total: 'Number of background refresh runs by refresher and outcome',
  chains_api_rpc_check_total: 'Number of RPC endpoint health checks by outcome',
  chains_api_assistant_requests_total: 'Number of assistant chat requests by outcome (ok, degraded)',
  chains_api_assistant_tool_calls_total: 'Number of assistant tool executions by tool and outcome',
  chains_api_assistant_llm_calls_total: 'Number of LLM round-trips made by the assistant by outcome',
  chains_api_assistant_reply_sanitized_total: 'Number of assistant replies altered by the sanitizer, by kind (leak, whole_repeat)',
  chains_api_source_selfheal_total: 'Number of source self-healing attempts by outcome',
  chains_api_http_requests_total: 'Number of HTTP responses by method, route, and status code',
  chains_api_http_request_duration_seconds: 'HTTP response latency in seconds by method and route'
};

/**
 * Emit Prometheus exposition format. Gauges are computed on the fly from
 * the live cache to avoid drift.
 */
export function renderMetrics({ cache, rpcStatus, l2beatStatus, validationSummary }) {
  const lines = [];

  formatCounters(lines);
  formatHistograms(lines);

  // Gauges
  lines.push('# HELP chains_api_chains_total Total chains in the index');
  lines.push('# TYPE chains_api_chains_total gauge');
  lines.push(`chains_api_chains_total ${cache?.indexed?.all?.length ?? 0}`);

  const rpcResults = Object.values(cache?.rpcHealth || {}).flatMap(results =>
    Array.isArray(results) ? results : []
  );
  const workingRpcEndpoints = rpcResults.filter(result => result?.ok).length;
  lines.push('# HELP chains_api_rpc_endpoints Total monitored RPC endpoints by status');
  lines.push('# TYPE chains_api_rpc_endpoints gauge');
  lines.push(`chains_api_rpc_endpoints{status="working"} ${workingRpcEndpoints}`);
  lines.push(`chains_api_rpc_endpoints{status="failed"} ${rpcResults.length - workingRpcEndpoints}`);

  const memory = process.memoryUsage();
  lines.push('# HELP chains_api_process_uptime_seconds Node.js process uptime in seconds');
  lines.push('# TYPE chains_api_process_uptime_seconds gauge');
  lines.push(`chains_api_process_uptime_seconds ${process.uptime()}`);
  lines.push('# HELP chains_api_process_memory_bytes Node.js process memory by area');
  lines.push('# TYPE chains_api_process_memory_bytes gauge');
  lines.push(`chains_api_process_memory_bytes{area="resident"} ${memory.rss}`);
  lines.push(`chains_api_process_memory_bytes{area="heap_used"} ${memory.heapUsed}`);

  lines.push('# HELP chains_api_source_loaded Source loaded status (1=loaded, 0=not)');
  lines.push('# TYPE chains_api_source_loaded gauge');
  lines.push(`chains_api_source_loaded{source="theGraph"} ${cache?.theGraph != null ? 1 : 0}`);
  lines.push(`chains_api_source_loaded{source="chainlist"} ${cache?.chainlist != null ? 1 : 0}`);
  lines.push(`chains_api_source_loaded{source="chains"} ${cache?.chains != null ? 1 : 0}`);
  lines.push(`chains_api_source_loaded{source="slip44"} ${cache?.slip44 != null ? 1 : 0}`);
  lines.push(`chains_api_source_loaded{source="l2beat"} ${cache?.l2beat?.projects?.length > 0 ? 1 : 0}`);

  if (cache?.lastUpdated) {
    const age = Math.max(0, Math.round((Date.now() - new Date(cache.lastUpdated).getTime()) / 1000));
    lines.push('# HELP chains_api_data_age_seconds Age of indexed data in seconds');
    lines.push('# TYPE chains_api_data_age_seconds gauge');
    lines.push(`chains_api_data_age_seconds ${age}`);
  }

  if (l2beatStatus?.lastRefreshAt) {
    const age = Math.max(0, Math.round((Date.now() - new Date(l2beatStatus.lastRefreshAt).getTime()) / 1000));
    lines.push('# HELP chains_api_l2beat_refresh_age_seconds Seconds since the last L2BEAT refresh');
    lines.push('# TYPE chains_api_l2beat_refresh_age_seconds gauge');
    lines.push(`chains_api_l2beat_refresh_age_seconds ${age}`);
  }

  if (rpcStatus?.lastUpdated) {
    const age = Math.max(0, Math.round((Date.now() - new Date(rpcStatus.lastUpdated).getTime()) / 1000));
    lines.push('# HELP chains_api_rpc_check_age_seconds Seconds since the last RPC health sweep');
    lines.push('# TYPE chains_api_rpc_check_age_seconds gauge');
    lines.push(`chains_api_rpc_check_age_seconds ${age}`);
  }

  if (validationSummary) {
    lines.push('# HELP chains_api_validation_errors Total validation errors by rule number');
    lines.push('# TYPE chains_api_validation_errors gauge');
    for (const [ruleKey, count] of Object.entries(validationSummary)) {
      lines.push(`chains_api_validation_errors{rule="${escapeLabelValue(ruleKey)}"} ${count}`);
    }
  }

  return lines.join('\n') + '\n';
}

// Test-only helper.
export function _resetMetricsForTests() {
  counters.clear();
  histograms.clear();
}
