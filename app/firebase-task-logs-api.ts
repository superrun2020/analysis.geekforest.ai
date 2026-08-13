export type FirebaseLogList<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};

export type FirebaseSyncRunLog = {
  runId: number | string;
  connectionId?: number | string;
  bindingId?: number | string | null;
  runType?: string;
  status?: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  sourceRows?: number;
  adbRows?: number;
  durationMs?: number | null;
  externalJobId?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  connectionName?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  appName?: string | null;
  packageName?: string | null;
  platform?: string | null;
  firebaseProjectId?: string | null;
  firebaseAppId?: string | null;
  firebaseAppIdentifier?: string | null;
};

export type FirebaseCheckLog = {
  logId: number | string;
  connectionId?: number | string;
  bindingId?: number | string | null;
  checkType?: string;
  status?: string;
  durationMs?: number | null;
  errorCode?: string | null;
  message?: string | null;
  context?: Record<string, unknown> | null;
  checkedAt?: string | null;
  createdAt?: string | null;
  connectionName?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  appName?: string | null;
  packageName?: string | null;
  platform?: string | null;
  firebaseProjectId?: string | null;
  firebaseAppId?: string | null;
  firebaseAppIdentifier?: string | null;
};

export type FirebaseLogQuery = {
  keyword?: string;
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

const baseUrl = (process.env.NEXT_PUBLIC_TRACKING_API_BASE_URL ?? "").replace(/\/$/, "");
const securePath = (process.env.NEXT_PUBLIC_TRACKING_API_SECURE_PATH ?? "").replace(/^\//, "").replace(/\/$/, "");
const adminBase = `${baseUrl}/api/v3/${securePath}/firebase-integration`;

const toSearch = (query: FirebaseLogQuery) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const search = params.toString();
  return search ? `?${search}` : "";
};

async function request<T>(path: string, query: FirebaseLogQuery): Promise<T> {
  if (!baseUrl || !securePath) {
    throw new Error("尚未配置 Firebase 绑定日志后端地址");
  }

  const response = await fetch(`${adminBase}${path}${toSearch(query)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json()) as { code: number; msg: string; data: T };
  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || `请求失败 ${response.status}`);
  }

  return body.data;
}

export const firebaseTaskLogsApi = {
  syncRuns: (query: FirebaseLogQuery = {}) =>
    request<FirebaseLogList<FirebaseSyncRunLog>>("/sync-runs", { page: 1, pageSize: 20, ...query }),
  checkLogs: (query: FirebaseLogQuery = {}) =>
    request<FirebaseLogList<FirebaseCheckLog>>("/check-logs", { page: 1, pageSize: 20, ...query }),
};
