export type TrackingPriority = "P0" | "P1" | "P2";
export type TrackingConfigStatus = "DRAFT" | "REVIEWING" | "PUBLISHED" | "ARCHIVED";

export type TrackingCatalogEvent = {
  id: string;
  name: string;
  stage: string;
  capability: string;
  priority: TrackingPriority;
  parameterCount: number;
  scene: string;
  provider: string;
  platform: "Android+iOS" | "Android";
  state: "READY" | "WARNING";
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
  status: TrackingConfigStatus;
  snapshotId?: string;
  updatedBy: string;
  updatedAt: string;
};

const importantEventNames = [
  "app_first_open", "app_open", "app_foreground", "app_background", "session_start",
  "consent_result", "permission_request", "permission_result", "network_change", "page_view",
  "vpn_home_view", "server_list_view", "server_select", "connect_start", "connect_success",
  "connect_failed", "disconnect_start", "disconnect_success", "reconnect_start", "reconnect_success",
  "jk_ad_eligibility_check", "jk_ad_opportunity", "jk_ad_preload_trigger", "jk_ad_request", "jk_ad_load_success",
  "jk_ad_load_failed", "jk_ad_cache_store", "jk_ad_cache_hit", "jk_ad_cache_miss", "jk_ad_cache_expired",
  "jk_ad_cache_evicted", "jk_ad_show_attempt", "jk_ad_show_failed", "jk_ad_impression", "jk_ad_click",
  "jk_ad_paid_event", "jk_ad_dismiss", "subscription_view", "subscription_start", "subscription_success",
  "subscription_cancel", "attribution_ready", "install_source_ready", "ip_before_connect_ready", "ip_after_connect_ready",
  "scan_start", "scan_progress", "scan_result", "clean_start", "clean_success",
  "launcher_first_open", "default_launcher_request", "default_launcher_result", "theme_view", "theme_apply",
  "home_gesture", "widget_add", "search_open", "notification_permission", "crash_recovered",
];

const stages = ["启动与会话", "权限与隐私", "VPN连接", "广告资格", "广告请求", "广告展示", "订阅", "归因", "清理", "Launcher"];
const capabilities = ["公共基础", "隐私合规", "VPN", "广告", "广告", "广告", "订阅", "归因", "清理", "Launcher"];
const providers = ["CommonProvider", "ConsentProvider", "VpnContextProvider", "AdContextProvider", "AdContextProvider", "AdSdkProvider", "SubscriptionProvider", "AttributionProvider", "CleanProvider", "LauncherProvider"];

export const trackingEventCatalog: TrackingCatalogEvent[] = Array.from({ length: 100 }, (_, index) => {
  const sequence = index + 1;
  const stageIndex = index % stages.length;
  const priority: TrackingPriority = index < 45 ? "P0" : index < 70 ? "P1" : index < 80 ? "P2" : index % 3 === 0 ? "P0" : index % 3 === 1 ? "P1" : "P2";
  return {
    id: `EVT-${String(sequence).padStart(3, "0")}`,
    name: importantEventNames[index] ?? `jk_business_event_${String(sequence).padStart(3, "0")}`,
    stage: stages[stageIndex],
    capability: capabilities[stageIndex],
    priority,
    parameterCount: 5 + (index % 11),
    scene: `${String((index % 12) + 1).padStart(2, "0")} ${stages[stageIndex]}场景`,
    provider: providers[stageIndex],
    platform: index % 9 === 0 ? "Android" : "Android+iOS",
    state: index === 86 || index === 94 ? "WARNING" : "READY",
  };
});

export const defaultSelectedEventIds = trackingEventCatalog.slice(0, 80).map((event) => event.id);

export const trackingConfigs: TrackingConfigRecord[] = [
  {
    id: "CFG-VPN-1.8-PROD",
    name: "VPN 正式版打点配置",
    version: "V1.8",
    category: "套利 VPN",
    projects: ["IRAN-VPN-01", "FAST-VPN-02"],
    platform: "Android+iOS",
    selectedCount: 80,
    totalCount: 100,
    p0Count: 45,
    p1Count: 25,
    p2Count: 10,
    sceneCount: 12,
    status: "PUBLISHED",
    snapshotId: "SNP-VPN-180-001",
    updatedBy: "Oliver",
    updatedAt: "2026-08-12 15:40",
  },
  {
    id: "CFG-CLEAN-3.2",
    name: "清理正式版打点配置",
    version: "V3.2",
    category: "清理",
    projects: ["CLEAN-MAX-03", "TURBO-CLEAN-05"],
    platform: "Android",
    selectedCount: 66,
    totalCount: 100,
    p0Count: 38,
    p1Count: 20,
    p2Count: 8,
    sceneCount: 10,
    status: "DRAFT",
    updatedBy: "Mia",
    updatedAt: "2026-08-12 14:18",
  },
  {
    id: "CFG-CLEAN-3.1-PROD",
    name: "清理线上打点配置",
    version: "V3.1",
    category: "清理",
    projects: ["CLEAN-MAX-03", "TURBO-CLEAN-05"],
    platform: "Android",
    selectedCount: 64,
    totalCount: 100,
    p0Count: 36,
    p1Count: 20,
    p2Count: 8,
    sceneCount: 9,
    status: "PUBLISHED",
    snapshotId: "SNP-CLEAN-310-004",
    updatedBy: "Mia",
    updatedAt: "2026-08-06 11:20",
  },
  {
    id: "CFG-LAUNCHER-1.4",
    name: "Launcher 新版打点配置",
    version: "V1.4",
    category: "Launcher",
    projects: ["AIVORA-LAUNCHER"],
    platform: "Android",
    selectedCount: 72,
    totalCount: 100,
    p0Count: 40,
    p1Count: 23,
    p2Count: 9,
    sceneCount: 11,
    status: "REVIEWING",
    updatedBy: "Liam",
    updatedAt: "2026-08-12 13:02",
  },
  {
    id: "CFG-LAUNCHER-1.3-PROD",
    name: "Launcher 线上打点配置",
    version: "V1.3",
    category: "Launcher",
    projects: ["AIVORA-LAUNCHER"],
    platform: "Android",
    selectedCount: 68,
    totalCount: 100,
    p0Count: 38,
    p1Count: 22,
    p2Count: 8,
    sceneCount: 10,
    status: "PUBLISHED",
    snapshotId: "SNP-LAUNCHER-130-002",
    updatedBy: "Liam",
    updatedAt: "2026-08-03 09:44",
  },
];

export function configsForProject(projectCode: string) {
  return trackingConfigs.filter((config) => config.status === "PUBLISHED" && config.projects.includes(projectCode));
}
