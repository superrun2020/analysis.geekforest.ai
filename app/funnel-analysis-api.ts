import { getCompanyAuthToken } from "./company-auth";

export type FunnelPageKey = "overview" | "workbench" | "diagnosis" | "cohort" | "path" | "evidence" | "issues" | "snapshot";

export type FunnelQuery = {
  page: FunnelPageKey;
  dateFrom: string;
  dateTo: string;
  projectCode?: string;
  appIdentifier?: string;
  platform?: "android" | "ios";
  country?: string;
  appVersion?: string;
  domain?: "ads" | "vpn" | "quality";
  unit?: "users" | "events";
  dimension?: string;
  startStep?: string;
  endStep?: string;
  screenName?: string;
  evidenceMode?: "user" | "ad";
  onlyAbnormal?: boolean;
  keyword?: string;
  pageIndex?: number;
  pageSize?: number;
  issueId?: string;
};

export type FunnelApiEnvelope<T = Record<string, unknown>> = { code?: number; msg?: string; data?: T; error?: string };

const baseUrl = (process.env.NEXT_PUBLIC_TRACKING_API_BASE_URL ?? "https://pupu.apptilaus.com").replace(/\/$/, "");

/** Call the OA-protected operational API and preserve actionable failure states. */
export async function queryFunnel<T = Record<string, unknown>>(query: FunnelQuery, signal?: AbortSignal): Promise<T> {
  if (!baseUrl) throw new Error("未配置漏斗分析服务地址");
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");

  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/query`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(query),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as FunnelApiEnvelope<T>;
  if (response.status === 401) throw new Error("登录已失效，请重新登录");
  if (response.status === 403) throw new Error(payload.error === "project_forbidden" ? "没有该项目的数据权限" : "当前账号无权访问漏斗分析");
  if (response.status === 422) throw new Error(payload.msg || payload.error || "筛选条件不合法");
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) throw new Error(payload.msg || payload.error || `漏斗接口返回 HTTP ${response.status}`);
  if (!payload.data) throw new Error("漏斗接口未返回数据");
  return payload.data;
}
