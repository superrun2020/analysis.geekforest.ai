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
const securePath = (process.env.NEXT_PUBLIC_TRACKING_API_SECURE_PATH ?? "").replace(/^\//, "").replace(/\/$/, "");

/** Read the canonical project list exposed by the funnel analysis backend. */
export async function fetchOnlineProjects(signal?: AbortSignal): Promise<OnlineProject[]> {
  if (!baseUrl || !securePath) {
    throw new Error("未配置线上项目接口");
  }

  const response = await fetch(`${baseUrl}/api/v3/${securePath}/funnel-analysis/options`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`项目接口返回 HTTP ${response.status}`);
  }

  const payload = await response.json() as ProjectOptionsResponse;
  const projects = payload.data?.projects ?? payload.projects ?? [];
  return projects
    .filter((item) => item.projectCode)
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode));
}
