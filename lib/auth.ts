// IMPORTANT: imported by proxy.ts (Edge runtime). Use Web APIs only — no Node Buffer/fs.

const APP_USERNAME = process.env.APP_USERNAME ?? "";
const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

export function validateBasicAuth(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(authHeader.slice(6));
    const colon = decoded.indexOf(":");
    if (colon < 0) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    return user === APP_USERNAME && pass === APP_PASSWORD;
  } catch {
    return false;
  }
}
