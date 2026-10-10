import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";

export type FunnelPageKey = "overview" | "workbench" | "diagnosis" | "cohort" | "path" | "evidence" | "issues" | "snapshot" | "network_failure_matrix" | "server_vpn_overall" | "server_vpn_hourly_overall" | "version_comparison" | "ad_overall" | "ad_dns_report" | "exit_ip_quality" | "domain_report";

export type FunnelQuery = {
  page: FunnelPageKey;
  dateFrom: string;
  dateTo: string;
  projectCode?: string;
  appIdentifier?: string;
  platform?: "android" | "ios";
  country?: string;
  nodeCountry?: string;
  appVersion?: string;
  networkType?: string;
  asn?: string;
  serverId?: string;
  protocol?: string;
  domain?: "ads" | "vpn" | "quality";
  unit?: "users" | "sessions" | "events";
  dimension?: string;
  dimensions?: string[];
  versionProduct?: "vpn" | "launcher";
  startStep?: string;
  endStep?: string;
  screenName?: string;
  evidenceMode?: "user" | "ad";
  onlyAbnormal?: boolean;
  keyword?: string;
  ipKey?: string;
  ipTarget?: string;
  ipGranularity?: "exact" | "small" | "large";
  ipQualityStatus?: "suspect" | "watch" | "healthy" | "insufficient";
  minSessionCount?: number;
  minFailedSessionCount?: number;
  minTcpAttemptCount?: number;
  maxTcpSuccessRate?: number;
  maxAdLoadSuccessRate?: number;
  forceRefresh?: boolean;
  optionsOnly?: boolean;
  riskOnly?: boolean;
  pageIndex?: number;
  pageSize?: number;
  issueId?: string;
};

export type FunnelApiEnvelope<T = Record<string, unknown>> = { code?: number; msg?: string; data?: T; error?: string };
export type FunnelQueryPackageItem = {
  key: string;
  query: FunnelQuery;
};
export type FunnelQueryPackage<T = Record<string, unknown>> = {
  items: Record<string, T>;
  errors: Record<string, string>;
};

type AnyRecord = Record<string, any>;

async function enrichLocalVpnLifecycle<T>(data: T, query: FunnelQuery, signal?: AbortSignal): Promise<T> {
  if (query.page !== "workbench" || query.domain !== "vpn" || !query.projectCode || !query.dateFrom || !query.dateTo) return data;
  const current = data as AnyRecord;
  const summary: AnyRecord = current.summary ?? {};
  const existingSources: AnyRecord = current.vpnLifecycleSources ?? {};
  const legacyDws = {
    dauUsers: summary.dauUsers,
    vpnConnectionStartUsers: summary.connectAttemptUsers,
    vpnConnectionSuccessUsers: summary.connectSuccessUsers,
    postConnectOpportunityUsers: summary.postConnectOpportunityUsers,
    impressionUsers: summary.postConnectImpressionUsers ?? summary.impressionUsers,
    vpnSessionCount: current.fulfillment?.vpnSessionCount,
    connectionAttemptCount: summary.connectAttemptCount,
    connectionResultCount: current.fulfillment?.connectionResultCount,
    connectionSuccessCount: summary.connectSuccessCount,
    connectionFailedCount: current.fulfillment?.connectionFailedCount,
    vpnPermissionAttemptCount: current.vpnPermissionAttemptCount,
    vpnPermissionSuccessCount: current.vpnPermissionSuccessCount,
    vpnNodeSelectionCount: current.vpnNodeSelectionCount,
    vpnValidNodeSelectionCount: current.vpnValidNodeSelectionCount,
    vpnConnectionP95Ms: current.fulfillment?.vpnConnectP95Ms,
    postConnectOpportunityCount: summary.opportunityCount,
    postConnectImpressionCount: summary.impressionCount,
  };
  let localDwd: AnyRecord = {};
  let localDws: AnyRecord = {};
  let localSequential: AnyRecord = {};
  if (typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    try {
      const response = await fetch("/api/local/vpn-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCode: query.projectCode, dateFrom: query.dateFrom, dateTo: query.dateTo }),
        signal,
      });
      if (response.ok) {
        const local = (await response.json()) as AnyRecord;
        localDwd = local.data ?? {};
        localDws = local.dws ?? {};
        localSequential = local.sequential ?? {};
      }
    } catch {
      // The local DWD supplement is optional; the OA response remains usable.
    }
  }
  return {
    ...current,
    vpnLifecycleSources: {
      dwd: { ...localDwd, ...(existingSources.dwd ?? {}) },
      dws: { ...legacyDws, ...localDws, ...(existingSources.dws ?? {}) },
      sequential: { ...localSequential, ...(existingSources.sequential ?? {}) },
    },
  } as T;
}

/** Call the OA-protected operational API and preserve actionable failure states. */
export async function queryFunnel<T = Record<string, unknown>>(query: FunnelQuery, signal?: AbortSignal): Promise<T> {
  const baseUrl = trackingApiBaseUrl();
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
  return enrichLocalVpnLifecycle(payload.data, query, signal);
}

/**
 * Load a complete UI package for one filter snapshot.
 *
 * The production API currently exposes one query endpoint. This wrapper keeps
 * the UX contract we want: one visible loading operation, then local tab
 * switching without additional requests. When the backend exposes a physical
 * package endpoint, only this function needs to change.
 */
export async function queryFunnelPackage<T = Record<string, unknown>>(items: FunnelQueryPackageItem[], signal?: AbortSignal): Promise<FunnelQueryPackage<T>> {
  const settled = await Promise.allSettled(items.map((item) => queryFunnel<T>(item.query, signal)));
  const data: Record<string, T> = {};
  const errors: Record<string, string> = {};

  settled.forEach((result, index) => {
    const key = items[index]?.key;
    if (!key) return;
    if (result.status === "fulfilled") {
      data[key] = result.value;
    } else {
      errors[key] = result.reason instanceof Error ? result.reason.message : "未知错误";
    }
  });

  if (Object.keys(data).length === 0) {
    throw new Error(Object.values(errors)[0] || "筛选包没有返回可用数据");
  }

  return { items: data, errors };
}
