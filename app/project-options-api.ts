import { getCompanyAuthToken } from "./company-auth";

export type OnlineProject = {
  projectCode: string;
  appName: string;
  appIdentifier: string;
};

type ProjectOptionsResponse = {
  code?: number;
  data?: { projects?: OnlineProject[] };
  projects?: OnlineProject[];
};

const baseUrl = (process.env.NEXT_PUBLIC_TRACKING_API_BASE_URL ?? "").replace(/\/$/, "");

/** Read the canonical project list exposed by the funnel analysis backend. */
export async function fetchOnlineProjects(signal?: AbortSignal): Promise<OnlineProject[]> {
  if (!baseUrl) {
    throw new Error("未配置线上项目接口");
  }
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");

  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/options`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status === 401) throw new Error("登录已失效，请重新登录");
  if (response.status === 403) throw new Error("没有可访问的项目权限");
  if (!response.ok) {
    throw new Error(`项目接口返回 HTTP ${response.status}`);
  }

  const payload = await response.json() as ProjectOptionsResponse;
  const projects = payload.data?.projects ?? payload.projects ?? [];
  return projects
    .filter((item) => item.projectCode)
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode));
}
