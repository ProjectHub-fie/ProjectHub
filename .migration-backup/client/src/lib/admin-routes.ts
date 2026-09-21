/**
 * Base path of the administration dashboard.
 *
 * The dashboard is one logical area of the public deployment, reachable only at
 * /pbad (no /pbad/dashboard, no separate admin domain, no /admin route).
 */
export const ADMIN_BASE_PATH = "/pbad";

/**
 * Query flag the dashboard guard appends when it bounces an anonymous visitor,
 * so the login screen can explain why they were redirected.
 */
export const ADMIN_UNAUTHORIZED_PARAM = "unauthorized";