/**
 * Neon consumption client for the usage alert.
 *
 * Wraps the two Neon REST reads the alert needs:
 *
 *   - `GET /api/v2/projects` for the project's name (and the optional filter).
 *   - `GET /api/v2/consumption_history/v2/projects` for the consumed totals in
 *     the current billing period.
 *
 * The API key is read from the environment and only ever sent to Neon; it is
 * never stored in the database, never returned by an endpoint, and never logged.
 * A single metric read failing does not sink the whole poll: `fetchUsage`
 * resolves what it can and reports which metrics were unavailable, because a
 * missing storage number is not a reason to lose the compute alert.
 */

const NEON_API = 'https://console.neon.tech/api/v2';

/** Metric names accepted by the v2 consumption endpoint. */
const COMPUTE_METRIC = 'compute_unit_seconds';
const STORAGE_METRICS = ['root_branch_bytes_month', 'child_branch_bytes_month', 'instant_restore_bytes_month'];
const TRANSFER_METRICS = ['public_network_transfer_bytes', 'private_network_transfer_bytes'];

export function isNeonConfigured() {
  return Boolean(process.env.NEON_API_KEY);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.NEON_API_KEY}`,
    Accept: 'application/json',
  };
}

/** Reads the project's display name, or null when the id is unknown. */
export async function fetchProjectName(projectId, fetchImpl = fetch) {
  if (!projectId) return null;
  try {
    const response = await fetchImpl(`${NEON_API}/projects/${encodeURIComponent(projectId)}`, {
      headers: authHeaders(),
    });
    if (!response.ok) return null;
    const { project } = await response.json();
    return project?.name || null;
  } catch {
    return null;
  }
}

/**
 * Sums a consumption metric over the current period.
 *
 * The v2 endpoint returns one entry per project per time bucket; the alert wants
 * the period total, so the buckets are summed rather than taking the last one.
 */
async function sumMetric({ projectId, metric, from, to, granularity, fetchImpl }) {
  const url = new URL(`${NEON_API}/consumption_history/v2/projects`);
  url.searchParams.set('project_ids', projectId);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('granularity', granularity);
  url.searchParams.append('metrics', metric);

  const response = await fetchImpl(url.toString(), { headers: authHeaders() });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Neon consumption read failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = await response.json();
  const rows = payload?.projects || payload?.data || [];
  let total = 0;
  for (const row of rows) {
    // Only the requested project's rows, in case the API echoes the org.
    if (row.project_id && row.project_id !== projectId) continue;
    for (const point of row.consumption_history || row.metrics || []) {
      total += Number(point?.[metric]) || 0;
    }
    // Some shapes return the total directly on the row.
    if (!row.consumption_history && !row.metrics && row[metric] != null) {
      total += Number(row[metric]) || 0;
    }
  }
  return total;
}

/**
 * The usage figures the alert evaluates.
 *
 * `from` defaults to the start of the current calendar month and `to` to now,
 * which is the billing window on Neon's usage-based plans. A metric that fails
 * to read is omitted from the result and named in `unavailable`, so
 * `evaluateUsage` treats it as zero rather than failing the poll.
 */
export async function fetchUsage({
  projectId,
  from = startOfMonthISO(),
  to = new Date().toISOString(),
  granularity = 'daily',
  fetchImpl = fetch,
} = {}) {
  if (!projectId) throw new Error('A Neon project id is required to read usage');
  if (!isNeonConfigured()) throw new Error('NEON_API_KEY is not configured');

  const usage = {};
  const unavailable = [];

  const reads = [
    ['computeTimeSeconds', COMPUTE_METRIC],
    ['storageBytes', STORAGE_METRICS],
    ['transferBytes', TRANSFER_METRICS],
  ];

  for (const [key, metrics] of reads) {
    const list = Array.isArray(metrics) ? metrics : [metrics];
    let sum = 0;
    let ok = false;
    for (const metric of list) {
      try {
        sum += await sumMetric({ projectId, metric, from, to, granularity, fetchImpl });
        ok = true;
      } catch (error) {
        // A single unsupported metric (plan-dependent) must not hide the others.
        if (list.length === 1) unavailable.push({ key, message: error.message });
      }
    }
    if (ok) usage[key] = sum;
    else if (list.length > 1) unavailable.push({ key, message: 'no metric in this group could be read' });
  }

  return { usage, unavailable, from, to, granularity };
}

/** The first instant of the current UTC month, as an ISO string. */
export function startOfMonthISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
