import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";

export type OnlineProject = {
  projectCode: string;
  appName: string;
  appIdentifier: string;
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

type ProjectOptionsResponse = {
  code?: number;
  data?: Partial<FunnelFilterOptions>;
  projects?: OnlineProject[];
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
    .map((item) => item as Partial<OnlineProject>)
    .filter((item) => item.projectCode)
    .map((item) => ({
      projectCode: String(item.projectCode),
      appName: String(item.appName ?? ""),
      appIdentifier: String(item.appIdentifier ?? ""),
    }))
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode));
}

function normalizeOptions(payload: ProjectOptionsResponse): FunnelFilterOptions {
  const data = payload.data ?? payload;
  const versions = Array.isArray(data.versions) ? data.versions : [];
  return {
    projects: normalizeProjects(data.projects),
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
