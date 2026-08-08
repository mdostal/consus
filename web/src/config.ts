/**
 * [frontend-api-integration]: the Consus API base URL. Defaults to "" (a
 * same-origin relative path, e.g. "/api/decisions") so requests go through
 * Vite's dev proxy (vite.config.ts: "/api" -> "http://localhost:8722") —
 * the server has no CORS headers, so a direct cross-origin fetch from the
 * :5173 dev origin to :8722 would be blocked by the browser. Overridable
 * via VITE_API_BASE_URL for a deployment where the API is reverse-proxied
 * behind a different absolute origin.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";
