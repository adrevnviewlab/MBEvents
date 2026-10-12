// Same-origin check for state-changing requests. Browsers always send Origin on
// cross-site POST/PATCH/DELETE, so a missing header means a non-browser client.
export function hasAllowedWriteOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (process.env.MB_PUBLIC_ORIGIN && origin === process.env.MB_PUBLIC_ORIGIN.replace(/\/$/, "")) return true;
  const requestUrl = new URL(request.url);
  if (origin === requestUrl.origin) return true;
  // Reverse proxies can expose the public host while the app sees an internal port.
  // Browsers cannot set Host, so matching the public Host still rejects cross-site writes.
  const originUrl = new URL(origin);
  const publicHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const publicProtocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.slice(0, -1);
  return originUrl.host === publicHost && originUrl.protocol === `${publicProtocol}:`;
}

// Use the customer-facing domain for emails and payment redirects behind a proxy.
export function publicOrigin(request: Request): string {
  const configured = process.env.MB_PUBLIC_ORIGIN?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

// Client IP as reported by Vercel's edge (first x-forwarded-for hop).
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
