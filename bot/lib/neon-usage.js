/**
 * Neon consumption client for the usage alert.
 *
 * Wraps the Neon REST reads the alert needs:
 *
 *   - `GET /api/v2/projects` for project names.
 *   - `GET /api/v2/consumption_history/v2/projects` for consumed totals in the
 *     current billing period.
 *
 * The API key is read from the environment and only ever sent to Neon; it is
 * never stored in the database, never returned by an endpoint, and never logged.
 * A single metric read failing does not sink the whole poll: `fetchUsage`
 * resolves what it can and reports which metrics were unavailable, because a
 * missing storage number is not a reason to lose the compute alert.
 *
 * ## Scope: one project, a list, or the whole organization
 *
 * Neon's consumption endpoint accepts `project_ids` as an optional filter. When
 * it is omitted the response covers every project in the organization (across
 * pages, driven by `cursor`); when it is present the response is limited to those
 * projects. That optionality is what makes an organization-wide reading possible,
 * so the scope is expressed here rather than pinned to a single id:
 *
 *   - no ids        -> every project in the organization (optionally `org_id`)
 *   - one/many ids  -> just those projects
 *
 * Consumption is summed across whatever the scope matched, so the configured
 * limits are read as organization-wide quotas, which is how Neon's usage-based
 * plans bill. `perProject` carries the breakdown so a human can see which project
 * is responsible.
 */

const NEON_API = 'https://console.neon.tech/api/v2';

/** Metric names accepted by the v2 consumption endpoint. */
const COMPUTE_METRIC = 'compute_unit_seconds';
const STORAGE_METRICS = ['root_branch_bytes_month', 'child_branch_bytes_month', 'instant_restore_bytes_month'];
const TRANSFER_METRICS = ['public_network_transfer_bytes', 'private_network_transfer_bytes'];

/** The API caps a page at 100 for the consumption read. */
const PAGE_LIMIT = 100;
/** Bounded so a pagination bug cannot loop forever. */
const MAX_PAGES = 50;

export function isNeonConfigured() {
  return Boolean(process.env.NEON_API_KEY);
}

/**
 * The project scope from the environment, in priority order.
 *
 * `NEON_PROJECT_IDS` (comma separated) wins over the single `NEON_PROJECT_ID`,
 * and neither set means "the whole organization". Returned as `null` rather than
 * an empty array for the org case, so the caller can tell "everything" from
 * "nothing".
 */
export function projectScopeFromEnv(env = process.env) {
  const many = (env.NEON_PROJECT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (many.length) return many;
  const one = (env.NEON_PROJECT_ID || '').trim();
  return one ? [one] : null;
}

export function orgIdFromEnv(env = process.env) {
  return (env.NEON_ORG_ID || '').trim() || null;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.NEON_API_KEY}`,
    Accept: 'application/json',
  };
}

/**
 * Maps project ids to display names.
 *
 * Best-effort: a failure here only costs the alert its readable names, so this
 * resolves an empty map instead of throwing. Each id is fetched directly, so an
 * org with many projects does not page through all of them to label a few.
 */
export async function fetchProjectNames(projectIds = [], fetchImpl = fetch) {
  const ids = (projectIds || []).filter(Boolean);
  const map = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetchImpl(`${NEON_API}/projects/${encodeURIComponent(id)}`, {
          headers: authHeaders(),
        });
        if (!response.ok) return;
        const { project } = await response.json();
        if (project?.name) map[id] = project.name;
      } catch {
        // Names are cosmetic; never fail the alert over one.
      }
    }),
  );
  return map;
}

/**
 * Sums one consumption metric over the current period, for the whole scope.
 *
 * The endpoint returns one entry per project per time bucket, so buckets are
 * summed rather than taking the last one. Pagination is followed to the end,
 * because a partial page would silently under-report usage, the opposite of
 * what an alert should do.
 *
 * Returns the scope total and the per-project breakdown in a single pass, so the
 * alert does not need a second read to say who is responsible.
 */
async function readMetric({ projectIds, orgId, metric, from, to, granularity, fetchImpl }) {
  const perProject = {};
  let total = 0;
  let cursor = null;
  let pages = 0;
  const unavailableProjectIds = new Set();

  do {
    const url = new URL(`${NEON_API}/consumption_history/v2/projects`);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('granularity', granularity);
    url.searchParams.append('metrics', metric);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    // Omitted entirely for the org-wide read: that is what asks Neon for every
    // project rather than a filtered subset.
    if (projectIds?.length) {
      for (const id of projectIds) url.searchParams.append('project_ids', id);
    }
    if (orgId) url.searchParams.set('org_id', orgId);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetchImpl(url.toString(), { headers: authHeaders() });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Neon consumption read failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }

    const payload = await response.json();
    for (const id of payload?.unavailable_project_ids || []) unavailableProjectIds.add(id);

    const rows = payload?.projects || payload?.data || [];
    for (const row of rows) {
      const rowId = row.project_id || row.projectId || 'unknown';
      let rowTotal = 0;
      for (const point of row.consumption_history || row.metrics || []) {
        rowTotal += Number(point?.[metric]) || 0;
      }
      // Some shapes return the total directly on the row.
      if (!row.consumption_history && !row.metrics && row[metric] != null) {
        rowTotal += Number(row[metric]) || 0;
      }
      perProject[rowId] = (perProject[rowId] || 0) + rowTotal;
      total += rowTotal;
    }

    cursor = payload?.pagination?.cursor || null;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return { total, perProject, unavailableProjectIds: [...unavailableProjectIds] };
}

/**
 * The usage figures the alert evaluates.
 *
 * `from` defaults to the start of the current calendar month and `to` to now,
 * which is the billing window on Neon's usage-based plans. A metric that fails
 * to read is omitted from the result and named in `unavailable`, so
 * `evaluateUsage` treats it as zero rather than failing the poll.
 *
 * With no `projectIds`, the read covers every project in the organization. Pass
 * an array to narrow it to specific projects.
 */
export async function fetchUsage({
  projectIds = null,
  orgId = orgIdFromEnv(),
  from = startOfMonthISO(),
  to = new Date().toISOString(),
  granularity = 'daily',
  fetchImpl = fetch,
} = {}) {
  if (!isNeonConfigured()) throw new Error('NEON_API_KEY is not configured');

  const ids = Array.isArray(projectIds) && projectIds.length ? projectIds : null;
  const scope = ids ? 'projects' : 'org';

  const usage = {};
  const unavailable = [];
  const perProject = {};
  const unavailableProjectIds = new Set();

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
        const result = await readMetric({ projectIds: ids, orgId, metric, from, to, granularity, fetchImpl });
        sum += result.total;
        ok = true;
        for (const [id, value] of Object.entries(result.perProject)) {
          perProject[id] = perProject[id] || {};
          perProject[id][key] = (perProject[id][key] || 0) + value;
        }
        for (const id of result.unavailableProjectIds) unavailableProjectIds.add(id);
      } catch (error) {
        // A single unsupported metric (plan-dependent) must not hide the others.
        if (list.length === 1) unavailable.push({ key, message: error.message });
      }
    }
    if (ok) usage[key] = sum;
    else if (list.length > 1) unavailable.push({ key, message: 'no metric in this group could be read' });
  }

  const projects = Object.entries(perProject)
    .map(([id, values]) => ({ id, ...values }))
    // Largest compute first: the embed lists who to look at.
    .sort((a, b) => (b.computeTimeSeconds || 0) - (a.computeTimeSeconds || 0));

  return {
    usage,
    perProject: projects,
    projectCount: projects.length,
    scope,
    unavailable,
    unavailableProjectIds: [...unavailableProjectIds],
    from,
    to,
    granularity,
  };
}

/** The first instant of the current UTC month, as an ISO string. */
export function startOfMonthISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
