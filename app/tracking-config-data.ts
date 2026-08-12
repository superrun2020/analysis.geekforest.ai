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

function inferCapability(eventName: string, fallback: string) {
  if (eventName.startsWith("jk_ad_")) return "广告";
  if (/vpn|connect|disconnect|reconnect|server_|ip_(before|after)_connect/.test(eventName)) return "VPN";
  if (/consent|permission/.test(eventName)) return "隐私合规";
  if (/subscription/.test(eventName)) return "订阅";
  if (/attribution|install_source/.test(eventName)) return "归因";
  if (/scan_|clean_/.test(eventName)) return "清理";
  if (/launcher|theme_|home_gesture|widget_|search_open/.test(eventName)) return "Launcher";
  if (/app_|session_|network_|page_view|notification_|crash_/.test(eventName)) return "公共基础";
  return fallback;
}

const testInstructions: Record<string, { page: string; operation: string; clickTarget: string; expectedResult: string }> = {
  "公共基础": { page: "App 启动与生命周期", operation: "冷启动 App，等待首页完全展示；再切到后台并返回", clickTarget: "从桌面点击 App 图标；随后点击系统 Home 键并重新进入", expectedResult: "启动、前后台和会话事件按顺序收到" },
  "隐私合规": { page: "首次启动授权弹窗", operation: "清除数据后首次启动，完成隐私同意与系统授权", clickTarget: "点击“同意并继续”，再点击系统授权弹窗的“允许”", expectedResult: "同意结果和权限结果均被上报" },
  "VPN": { page: "VPN 首页 / 服务器列表", operation: "选择一个节点，发起连接，等待连接成功后再断开并重连", clickTarget: "首页点击“连接”；如需选节点，点击“服务器”→选择节点", expectedResult: "连接开始、成功、断开和重连链路完整" },
  "广告": { page: "VPN 连接成功页 / 广告触发页", operation: "满足广告资格后到达配置广告位，分别执行缓存命中与非缓存场景", clickTarget: "完成一次 VPN 连接；停留至广告展示，点击广告或关闭按钮", expectedResult: "Opportunity→Request/Cache→Show→Impression→Dismiss/Paid 完整" },
  "订阅": { page: "会员 / 去广告页", operation: "打开订阅页并发起一次测试购买，完成或取消支付", clickTarget: "首页点击“会员/去广告”→选择套餐→点击“继续”", expectedResult: "订阅页、发起购买及结果事件收到" },
  "归因": { page: "首次启动归因初始化", operation: "通过测试安装链接安装并首次启动，等待归因 SDK 返回", clickTarget: "从测试投放链接安装后点击“打开”并停留 10 秒", expectedResult: "归因和安装来源事件收到；无值时按规则降级" },
  "清理": { page: "清理首页 / 扫描结果页", operation: "执行扫描，进入结果页并完成一次清理", clickTarget: "点击“开始扫描”→选择垃圾项→点击“立即清理”", expectedResult: "扫描开始、结果、清理开始与成功事件完整" },
  "Launcher": { page: "桌面设置 / 主题中心", operation: "设置默认桌面，应用主题并完成一次桌面手势", clickTarget: "点击“设为默认桌面”→主题→应用；回桌面上滑一次", expectedResult: "默认桌面、主题和桌面交互事件收到" },
};

export const trackingEventCatalog: TrackingCatalogEvent[] = Array.from({ length: 100 }, (_, index) => {
  const sequence = index + 1;
  const stageIndex = index % stages.length;
  const priority: TrackingPriority = index < 45 ? "P0" : index < 70 ? "P1" : index < 80 ? "P2" : index % 3 === 0 ? "P0" : index % 3 === 1 ? "P1" : "P2";
  const name = importantEventNames[index] ?? `jk_business_event_${String(sequence).padStart(3, "0")}`;
  const capability = inferCapability(name, capabilities[stageIndex]);
  const instruction = testInstructions[capability];
  return {
    id: `EVT-${String(sequence).padStart(3, "0")}`,
    name,
    stage: stages[stageIndex],
    capability,
    priority,
    parameterCount: 5 + (index % 11),
    scene: `${String((index % 12) + 1).padStart(2, "0")} ${stages[stageIndex]}场景`,
    provider: providers[stageIndex],
    platform: index % 9 === 0 ? "Android" : "Android+iOS",
    state: index === 86 || index === 94 ? "WARNING" : "READY",
    ...instruction,
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
    selectedEventIds: defaultSelectedEventIds,
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
    selectedEventIds: trackingEventCatalog.slice(0, 66).map((event) => event.id),
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
    selectedEventIds: trackingEventCatalog.slice(0, 64).map((event) => event.id),
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
    selectedEventIds: trackingEventCatalog.slice(0, 72).map((event) => event.id),
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
    selectedEventIds: trackingEventCatalog.slice(0, 68).map((event) => event.id),
    status: "PUBLISHED",
    snapshotId: "SNP-LAUNCHER-130-002",
    updatedBy: "Liam",
    updatedAt: "2026-08-03 09:44",
  },
];

export function configsForProject(projectCode: string) {
  return trackingConfigs.filter((config) => config.status === "PUBLISHED" && config.projects.includes(projectCode));
}
