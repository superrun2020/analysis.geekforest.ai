export function trackingApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_TRACKING_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin.replace(/\/$/, "");
  }

  return "";
}
