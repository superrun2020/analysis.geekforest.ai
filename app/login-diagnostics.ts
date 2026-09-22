export type LoginDiagnosticValue = string | number | boolean | null | undefined;
export type LoginDiagnosticEntry = {
  at: string;
  event: string;
  details: Record<string, string | number | boolean | null>;
};

export type LoginDiagnosticContext = {
  version: string;
  capturedAt: string;
  path: string;
  online: boolean;
  language: string;
  userAgent: string;
};

const MAX_LOGIN_DIAGNOSTIC_EVENTS = 40;
const SENSITIVE_KEY = /(email|password|passcode|code|token|authorization|cookie|secret|credential|session(?:_?id)?|sid|jsessionid|phpsessid)/i;

function sanitizeText(value: string) {
  const trimmed = value.trim();
  if (/^\d{6}$/.test(trimmed)) return "[redacted-code]";
  if (/^[A-Za-z0-9_-]{24,}$/.test(trimmed)) return "[redacted-token]";
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b((?:set-cookie|cookie|authorization)\s*[:=])\s*[^\r\n]+/gi, "$1 [redacted]")
    .replace(/\b((?:session(?:_id)?|sid|jsessionid|phpsessid)\s*[:=])\s*[^&\s;,]+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, "[redacted-token]")
    .replace(/((?:token|password|passcode|code|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 240);
}

function sanitizeDetails(details: Record<string, LoginDiagnosticValue>) {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => {
    if (SENSITIVE_KEY.test(key)) return [key, "[redacted]"];
    if (value === null || value === undefined) return [key, null];
    if (typeof value === "string") return [key, sanitizeText(value)];
    return [key, value];
  })) as LoginDiagnosticEntry["details"];
}

export function appendLoginDiagnostic(
  entries: LoginDiagnosticEntry[],
  event: string,
  details: Record<string, LoginDiagnosticValue> = {},
  at = new Date().toISOString(),
) {
  const next = [...entries, { at, event: sanitizeText(event), details: sanitizeDetails(details) }];
  return next.slice(-MAX_LOGIN_DIAGNOSTIC_EVENTS);
}

export function formatLoginDiagnostics(entries: LoginDiagnosticEntry[], context: LoginDiagnosticContext) {
  const header = [
    "Analysis login diagnostics",
    `version=${sanitizeText(context.version)}`,
    `capturedAt=${sanitizeText(context.capturedAt)}`,
    `path=${sanitizeText(context.path)}`,
    `online=${context.online}`,
    `language=${sanitizeText(context.language)}`,
    `userAgent=${sanitizeText(context.userAgent)}`,
  ];
  const events = entries.map((entry) => {
    const detailText = Object.entries(sanitizeDetails(entry.details))
      .map(([key, value]) => `${sanitizeText(key)}=${value === null ? "null" : sanitizeText(String(value))}`)
      .join(" ");
    return `[${sanitizeText(entry.at)}] ${sanitizeText(entry.event)}${detailText ? ` ${detailText}` : ""}`;
  });
  return [...header, "events:", ...events].join("\n");
}
