import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";

export type OnlineCoverageEvent = {
  eventName: string;
  received: boolean;
  eventCount: number;
  acceptedCount?: number;
  users?: number;
  quarantineCount?: number;
  typeMismatchCount?: number;
  p0FieldTotal?: number;
  p0FieldPresent?: number;
  p0CompletenessRate?: number | null;
  latestAt?: string | null;
  source: "DWS_SUMMARY" | "DWD_FALLBACK" | "NOT_FOUND";
};

export type OnlineCoverageResult = {
  projectCode: string;
  appIdentifier: string;
  date: string;
  events: OnlineCoverageEvent[];
  queryPlan: {
    summaryTable: string;
    detailFallbackTable: string;
    summaryMatched: number;
    detailFallbackChecked: number;
    queriedAt: string;
  };
};

export async function queryTrackingOnlineCoverage(payload: { projectCode: string; appIdentifier?: string; date: string; eventNames: string[] }): Promise<OnlineCoverageResult> {
  const baseUrl = trackingApiBaseUrl();
  const token = getCompanyAuthToken();
  if (!baseUrl || !token) throw new Error("登录或线上查询服务未配置");
  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/tracking-event-coverage`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string; error?: string; data?: OnlineCoverageResult };
  if (!response.ok || (body.code !== undefined && body.code !== 0) || !body.data) throw new Error(body.msg || body.error || `线上打点查询失败 HTTP ${response.status}`);
  return body.data;
}
