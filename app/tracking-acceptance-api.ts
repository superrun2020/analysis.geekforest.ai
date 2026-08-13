export type AcceptanceResultStatus = "PENDING" | "PASSED" | "PARAM_INVALID" | "CHAIN_INVALID" | "NOT_RECEIVED";
export type AcceptanceRun = {
  runId: string; projectCode: string; configRevisionId: string; snapshotId: string; appIdentifier: string;
  appVersion: string; buildNumber?: string; platform: string; environment: string; testerName?: string;
  status: string; expectedCount: number; passedCount: number; failedCount: number; pendingCount: number;
  p0ExpectedCount: number; p0PassedCount: number; completionRate: number; passThreshold: number; startedAt?: string;
};
export type AcceptanceEvent = {
  eventName: string; displayName?: string; module?: string; priority: string; trackingLocation?: string; triggerTiming?: string;
  sceneStatus: "NOT_EXECUTED" | "EXECUTED"; resultStatus: AcceptanceResultStatus; receivedCount: number;
  missingParams: string[]; invalidParams: string[]; chainErrors: string[]; lastReceivedAt?: string;
};
export type AcceptanceDetail = { run: AcceptanceRun; events: AcceptanceEvent[] };

const baseUrl = (process.env.NEXT_PUBLIC_TRACKING_API_BASE_URL ?? "").replace(/\/$/, "");
const securePath = (process.env.NEXT_PUBLIC_TRACKING_API_SECURE_PATH ?? "").replace(/^\//, "").replace(/\/$/, "");
const adminBase = `${baseUrl}/api/v3/${securePath}/tracking-acceptance`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl || !securePath) throw new Error("尚未配置打点验收后端地址");
  const response = await fetch(`${adminBase}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json() as { code: number; msg: string; data: T };
  if (!response.ok || body.code !== 0) throw new Error(body.msg || `请求失败 ${response.status}`);
  return body.data;
}

export const acceptanceApi = {
  list: (projectCode?: string) => request<{ items: AcceptanceRun[] }>(`/runs${projectCode ? `?projectCode=${encodeURIComponent(projectCode)}` : ""}`),
  detail: (runId: string) => request<AcceptanceDetail>(`/runs/detail?runId=${encodeURIComponent(runId)}`),
  create: (payload: { projectCode: string; configRevisionId: string; appIdentifier: string; appVersion: string; buildNumber?: string; platform: "Android" | "iOS"; environment?: string; testerName?: string; deviceIdHash?: string }) =>
    request<AcceptanceDetail>("/runs/create", { method: "POST", body: JSON.stringify(payload) }),
  markScene: (runId: string, eventNames: string[], executed = true) => request<AcceptanceDetail>("/runs/mark-scene", { method: "POST", body: JSON.stringify({ runId, eventNames, executed }) }),
};
