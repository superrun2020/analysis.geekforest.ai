import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";

export type OnlineProject = {
  projectCode: string;
  appName: string;
  appIdentifier: string;
  platform?: string;
  firebaseBindingCount?: number;
  firebaseBindingStatus?: string;
  firebaseConnectionStatus?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
  projectSource?: string;
};

export type FunnelFilterOptions = {
  projects: OnlineProject[];
  platforms: string[];
  countries: string[];
  appVersions: string[];
  buildNumbers: string[];
  versions: { appVersion: string; buildNumber?: number | string | null }[];
  dateRange?: { min?: string | null; max?: string | null };
};

export type DateSessionSummaryRow = {
  date: string;
  projectCode: string;
  appIdentifier?: string;
  platform?: string;
  sessionCount: number;
  userCount: number;
  eventCount: number;
  latestEventAt?: string | null;
  computedAt?: string | null;
  source?: string;
  fallback?: boolean;
};

export type DateSessionSummary = {
  dateFrom: string;
  dateTo: string;
  domain: "ads" | "vpn" | "quality";
  projectCode?: string;
  rows: DateSessionSummaryRow[];
  bestDate?: string | null;
  bestSessionCount?: number;
  totalSessionCount?: number;
  source?: string;
  fallback?: boolean;
  queriedAt?: string;
  usageHint?: string;
};

type ProjectOptionsResponse = {
  code?: number;
  data?: Partial<FunnelFilterOptions> & Record<string, unknown>;
  projects?: unknown[];
  items?: unknown[];
  rows?: unknown[];
  platforms?: string[];
  countries?: string[];
  appVersions?: string[];
  buildNumbers?: string[];
  versions?: FunnelFilterOptions["versions"];
  dateRange?: FunnelFilterOptions["dateRange"];
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function normalizeProjects(values: unknown): OnlineProject[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => item as Partial<OnlineProject> & Record<string, unknown>)
    .map((item) => ({
      projectCode: String(item.projectCode ?? item.project_code ?? item.code ?? item.project ?? "").trim(),
      appName: String(item.appName ?? item.app_name ?? item.name ?? item.project_name ?? item.product_name ?? "").trim(),
      appIdentifier: String(item.appIdentifier ?? item.app_identifier ?? item.package_name ?? item.bundle_id ?? item.packageName ?? "").trim(),
      platform: String(item.platform ?? "").trim(),
      firebaseBindingCount: Number(item.firebaseBindingCount ?? item.firebase_binding_count ?? 0) || 0,
      firebaseBindingStatus: String(item.firebaseBindingStatus ?? item.firebase_binding_status ?? "").trim(),
      firebaseConnectionStatus: String(item.firebaseConnectionStatus ?? item.firebase_connection_status ?? "").trim(),
      firebaseProjectId: String(item.firebaseProjectId ?? item.firebase_project_id ?? "").trim(),
      firebaseAppId: String(item.firebaseAppId ?? item.firebase_app_id ?? "").trim(),
      projectSource: String(item.projectSource ?? item.project_source ?? "").trim(),
    }))
    .filter((item) => item.projectCode)
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode));
}

function normalizeOptions(payload: ProjectOptionsResponse): FunnelFilterOptions {
  const data = payload.data ?? payload;
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const rawProjects = data.projects ?? payload.projects ?? data.items ?? payload.items ?? data.rows ?? payload.rows ?? [];
  return {
    projects: normalizeProjects(rawProjects),
    platforms: uniqueStrings(data.platforms),
    countries: uniqueStrings(data.countries),
    appVersions: uniqueStrings(data.appVersions),
    buildNumbers: uniqueStrings(data.buildNumbers),
    versions: versions
      .map((item) => ({
        appVersion: String(item?.appVersion ?? "").trim(),
        buildNumber: item?.buildNumber ?? null,
      }))
      .filter((item) => item.appVersion),
    dateRange: data.dateRange,
  };
}

async function readOptions(path: "/projects" | "/options", signal?: AbortSignal): Promise<FunnelFilterOptions> {
  const baseUrl = trackingApiBaseUrl();
  if (!baseUrl) {
    throw new Error("未配置线上项目接口");
  }
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");

  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status === 401) throw new Error("登录已失效，请重新登录");
  if (response.status === 403) throw new Error("没有可访问的项目权限");
  if (!response.ok) {
    throw new Error(`线上筛选接口返回 HTTP ${response.status}`);
  }

  return normalizeOptions(await response.json() as ProjectOptionsResponse);
}

/** Read the canonical online filter values exposed by the funnel analysis backend. */
export async function fetchFunnelFilterOptions(signal?: AbortSignal): Promise<FunnelFilterOptions> {
  return readOptions("/options", signal);
}

/** Read the canonical project list exposed by the funnel analysis backend. */
export async function fetchOnlineProjects(signal?: AbortSignal): Promise<OnlineProject[]> {
  return (await readOptions("/projects", signal)).projects;
}

export async function fetchDateSessionSummary(params: {
  dateFrom?: string;
  dateTo?: string;
  projectCode?: string;
  appIdentifier?: string;
  platform?: "android" | "ios";
  country?: string;
  appVersion?: string;
  domain?: "ads" | "vpn" | "quality";
}, signal?: AbortSignal): Promise<DateSessionSummary> {
  const baseUrl = trackingApiBaseUrl();
  if (!baseUrl) throw new Error("未配置日期数据量接口");
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      search.set(key, String(value));
    }
  });

  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/date-session-summary?${search.toString()}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status === 401) throw new Error("登录已失效，请重新登录");
  if (response.status === 403) throw new Error("没有该项目的数据权限");
  if (response.status === 422) {
    const payload = await response.json().catch(() => ({})) as { msg?: string; error?: string };
    throw new Error(payload.msg || payload.error || "日期筛选条件不合法");
  }
  if (!response.ok) throw new Error(`日期数据量接口返回 HTTP ${response.status}`);

  const payload = await response.json().catch(() => ({})) as { code?: number; msg?: string; data?: DateSessionSummary };
  if (payload.code !== undefined && payload.code !== 0) throw new Error(payload.msg || "日期数据量接口返回失败");
  return payload.data ?? {
    dateFrom: params.dateFrom ?? "",
    dateTo: params.dateTo ?? "",
    domain: params.domain ?? "ads",
    rows: [],
  };
}
