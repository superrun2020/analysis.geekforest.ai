import type { V18EventParameter } from "./v18-event-catalog";
import { trackingConfigDataSource, trackingDatabaseEventRows, trackingDatabaseFieldRowsForEvent } from "./tracking-config-repository";

export type TrackingPriority = "P0" | "P1" | "P2";
export type TrackingConfigStatus = "DRAFT" | "REVIEWING" | "PUBLISHED" | "ARCHIVED";

export type TrackingCatalogEvent = {
  id: string;
  name: string;
  displayName: string;
  sourceAlias: string;
  stage: string;
  capability: string;
  priority: TrackingPriority;
  parameterCount: number;
  parameters: V18EventParameter[];
  chainKey: "session_id" | "vpn_session_id";
  scene: string;
  provider: string;
  platform: "Android+iOS" | "Android";
  state: "READY" | "WARNING";
  analysisGoal: string;
  trackingLocation: string;
  triggerTiming: string;
  metricPurpose: string;
  page: string;
  operation: string;
  clickTarget: string;
  expectedResult: string;
};

export type TrackingConfigRecord = {
  id: string;
  name: string;
  version: string;
  category: string;
  projects: string[];
  platform: string;
  selectedCount: number;
  totalCount: number;
  p0Count: number;
  p1Count: number;
  p2Count: number;
  sceneCount: number;
  selectedEventIds?: string[];
  status: TrackingConfigStatus;
  snapshotId?: string;
  updatedBy: string;
  updatedAt: string;
};

const p0Events = new Set([
  "app_background", "app_first_open", "app_foreground", "consent_result",
  "vpn_connection_result", "vpn_disconnection", "ad_eligibility_check", "ad_opportunity",
  "ad_request", "ad_load_failed", "ad_load_success", "ad_ready", "ad_cache_hit",
  "ad_cache_miss", "ad_show_attempt", "ad_show_failed", "ad_impression", "ad_paid_event",
]);

const p1Events = new Set([
  "session_heartbeat", "screen_exit", "screen_view", "core_action", "purchase_result",
  "ad_sdk_init_failed", "ad_sdk_init_start", "ad_sdk_init_success", "ad_cache_expired",
  "ad_cache_put", "ad_cache_take", "ad_click", "ad_dismissed", "ad_show_blocked",
  "ad_show_success", "banner_visible", "api_request_result", "telemetry_batch_failed",
  "telemetry_batch_send", "telemetry_backend_ack",
]);

const capabilityByModule: Record<string, string> = {
  "App生命周期": "公共基础",
  "页面行为": "公共基础",
  "核心行为": "核心行为",
  "VPN业务": "VPN",
  "付费业务": "订阅",
  "隐私与SDK": "隐私合规",
  "广告机会": "广告",
  "广告请求": "广告",
  "广告加载": "广告",
  "广告缓存": "广告",
  "广告展示": "广告",
  "广告收入": "广告",
  "Banner专项": "广告",
  "接口质量": "接口质量",
  "上报健康": "上报健康",
};

const pageByModule: Record<string, string> = {
  "App生命周期": "App 启动与前后台",
  "页面行为": "对应业务页面",
  "核心行为": "核心功能页面",
  "VPN业务": "VPN 首页 / 服务器列表",
  "付费业务": "会员 / 支付页面",
  "隐私与SDK": "首次启动授权与 SDK 初始化",
  "广告机会": "广告触发业务场景",
  "广告请求": "广告请求管理器",
  "广告加载": "广告 SDK 加载回调",
  "广告缓存": "广告缓存管理器",
  "广告展示": "广告触发页 / 全屏广告回调",
  "广告收入": "广告 Paid Event 回调",
  "Banner专项": "包含 Banner 的业务页面",
  "接口质量": "业务接口请求场景",
  "上报健康": "Telemetry SDK 上报队列",
};

export const trackingEventCatalog: TrackingCatalogEvent[] = trackingDatabaseEventRows.map((row) => {
  const fields = trackingDatabaseFieldRowsForEvent(row.eventId);
  const parameters = fields.map((field) => ({
    name: field.fieldName,
    displayName: field.displayName,
    dataType: field.dataType,
    reportingMode: field.reportingMode,
    description: field.description,
  }));
  return {
    id: row.eventId,
    name: row.standardEventName,
    displayName: row.displayName,
    sourceAlias: row.sourceAlias,
    stage: row.module,
    capability: capabilityByModule[row.module] ?? row.module,
    priority: row.priority,
    chainKey: row.chainKey,
    parameterCount: parameters.length,
    parameters,
    scene: row.module,
    provider: row.provider,
    platform: row.platforms.includes("Android/iOS") ? "Android+iOS" : "Android",
    state: "READY",
    analysisGoal: row.analysisGoal,
    trackingLocation: row.trackingLocation,
    triggerTiming: row.triggerTiming,
    metricPurpose: row.metricPurpose,
    page: pageByModule[row.module] ?? row.module,
    operation: row.triggerTiming,
    clickTarget: row.trackingLocation,
    expectedResult: `${row.standardEventName} 被收到；用于${row.metricPurpose}`,
  };
});

const allEventIds = trackingEventCatalog.map((event) => event.id);
const excludeNames = (names: string[]) => trackingEventCatalog.filter((event) => !names.includes(event.name)).map((event) => event.id);
const vpnEventIds = excludeNames(["business_task_completed", "purchase_result"]);
const cleanEventIds = excludeNames(["vpn_connection_result", "vpn_disconnection"]);
const launcherEventIds = excludeNames(["vpn_connection_result", "vpn_disconnection", "business_task_completed"]);

export const defaultSelectedEventIds = vpnEventIds;

function makeConfig(record: Omit<TrackingConfigRecord, "selectedCount" | "totalCount" | "p0Count" | "p1Count" | "p2Count" | "sceneCount">): TrackingConfigRecord {
  const selectedIds = record.selectedEventIds ?? [];
  const events = trackingEventCatalog.filter((event) => selectedIds.includes(event.id));
  return {
    ...record,
    selectedCount: events.length,
    totalCount: trackingEventCatalog.length,
    p0Count: events.filter((event) => event.priority === "P0").length,
    p1Count: events.filter((event) => event.priority === "P1").length,
    p2Count: events.filter((event) => event.priority === "P2").length,
    sceneCount: new Set(events.map((event) => event.stage)).size,
  };
}

export const trackingConfigs: TrackingConfigRecord[] = [
  makeConfig({ id: "CFG-VPN-1.8-PROD", name: "VPN 正式版打点配置", version: "V1.8", category: "套利 VPN", projects: ["IRAN-VPN-01", "FAST-VPN-02"], platform: "Android+iOS", selectedEventIds: vpnEventIds, status: "PUBLISHED", snapshotId: "SNP-VPN-180-001", updatedBy: "Oliver", updatedAt: "2026-08-12 15:40" }),
  makeConfig({ id: "CFG-CLEAN-3.2", name: "清理正式版打点配置", version: "V3.2", category: "清理", projects: ["CLEAN-MAX-03", "TURBO-CLEAN-05"], platform: "Android", selectedEventIds: cleanEventIds.slice(0, 36), status: "DRAFT", updatedBy: "Mia", updatedAt: "2026-08-12 14:18" }),
  makeConfig({ id: "CFG-CLEAN-3.1-PROD", name: "清理线上打点配置", version: "V3.1", category: "清理", projects: ["CLEAN-MAX-03", "TURBO-CLEAN-05"], platform: "Android", selectedEventIds: cleanEventIds.slice(0, 34), status: "PUBLISHED", snapshotId: "SNP-CLEAN-310-004", updatedBy: "Mia", updatedAt: "2026-08-06 11:20" }),
  makeConfig({ id: "CFG-LAUNCHER-1.4", name: "Launcher 新版打点配置", version: "V1.4", category: "Launcher", projects: ["AIVORA-LAUNCHER"], platform: "Android", selectedEventIds: launcherEventIds.slice(0, 37), status: "REVIEWING", updatedBy: "Liam", updatedAt: "2026-08-12 13:02" }),
  makeConfig({ id: "CFG-LAUNCHER-1.3-PROD", name: "Launcher 线上打点配置", version: "V1.3", category: "Launcher", projects: ["AIVORA-LAUNCHER"], platform: "Android", selectedEventIds: launcherEventIds.slice(0, 35), status: "PUBLISHED", snapshotId: "SNP-LAUNCHER-130-002", updatedBy: "Liam", updatedAt: "2026-08-03 09:44" }),
];

export function configsForProject(projectCode: string) {
  return trackingConfigs.filter((config) => config.status === "PUBLISHED" && config.projects.includes(projectCode));
}

export const trackingCatalogTotal = allEventIds.length;

export { trackingConfigDataSource };
