"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionDialog, type DialogKey, type DialogResult } from "./action-dialog";
import { FirebaseConfiguration } from "./firebase-configuration";
import { trackingConfigs, trackingEventCatalog, type TrackingConfigRecord } from "./tracking-config-data";
import { TrackingConfigWorkspace, type TrackingConfigSubmission } from "./tracking-config-workspace";

type PageKey =
  | "overview"
  | "workbench"
  | "diagnosis"
  | "cohort"
  | "path"
  | "evidence"
  | "issues"
  | "snapshot";

type FunnelMode = "product" | "monetization";
type UnitMode = "users" | "events";
type TrendMetric = "viewer" | "opportunity";
type AdMobDimension = "format" | "placement" | "country";
type ConfigPackageTab = "events" | "fields" | "enums" | "providers";
type TaskFilter = "all" | "failed" | "running";
type TrackingResultFilter = "all" | "passed" | "failed" | "pending";
type FunnelStage = { label: string; event: string; value: string; rate: string; delta: string };
type TransitionSelection = { from: string; to: string; rate: string; scope: "users" | "events" };
type ModuleKey = "global" | "project" | "funnel" | "admob" | "firebase" | "reconcile" | "tracking" | "config" | "tasks";
const moduleKeys = new Set<ModuleKey>(["global", "project", "funnel", "admob", "firebase", "reconcile", "tracking", "config", "tasks"]);
const pageKeys = new Set<PageKey>(["overview", "workbench", "diagnosis", "cohort", "path", "evidence", "issues", "snapshot"]);

function readInitialAnalysisView(): { module: ModuleKey; page: PageKey; embedded: boolean } {
  if (typeof window === "undefined") {
    return { module: "funnel", page: "overview", embedded: false };
  }

  const params = new URLSearchParams(window.location.search);
  const requestedModule = params.get("module");
  const requestedPage = params.get("page");
  return {
    module: moduleKeys.has(requestedModule as ModuleKey) ? requestedModule as ModuleKey : "funnel",
    page: pageKeys.has(requestedPage as PageKey) ? requestedPage as PageKey : "overview",
    embedded: params.get("embedded") === "1",
  };
}

const moduleMenus: Array<{ key: ModuleKey; index: string; label: string; group: "经营分析" | "质量治理" }> = [
  { key: "global", index: "01", label: "全局项目总览", group: "经营分析" },
  { key: "project", index: "02", label: "单项目诊断", group: "经营分析" },
  { key: "funnel", index: "03", label: "漏斗分析", group: "经营分析" },
  { key: "admob", index: "04", label: "AdMob 分析", group: "经营分析" },
  { key: "firebase", index: "05", label: "Firebase 分析", group: "经营分析" },
  { key: "reconcile", index: "06", label: "数据对账", group: "经营分析" },
  { key: "tracking", index: "07", label: "打点验收中心", group: "质量治理" },
  { key: "config", index: "08", label: "规范与项目配置", group: "质量治理" },
  { key: "tasks", index: "09", label: "数据任务与告警", group: "质量治理" },
];

const moduleCopy: Record<ModuleKey, { title: string; description: string; action: string }> = {
  global: { title: "全局项目总览", description: "统一查看所有项目的用户、投放、收入、利润和数据健康度", action: "导出项目日报" },
  project: { title: "单项目诊断", description: "围绕单个项目串联用户增长、产品漏斗、广告变现和数据质量", action: "创建诊断任务" },
  funnel: { title: "漏斗分析中心", description: "从多项目异常发现到事件证据、修复重测和效果验证的完整诊断闭环", action: "新建诊断任务" },
  admob: { title: "AdMob 分析", description: "分析请求、匹配、展示、广告浏览用户、eCPM和收入变化", action: "导出 AdMob 报表" },
  firebase: { title: "Firebase 分析", description: "监控活跃用户、事件覆盖、参数质量、版本分布和实时数据延迟", action: "查看事件字典" },
  reconcile: { title: "数据对账", description: "对比 Firebase、AdMob、中台与 ADB 的用户、展示和收入口径", action: "发起重新对账" },
  tracking: { title: "打点验收中心", description: "按项目品类和测试快照验证应收事件、必填参数与完整关联链", action: "新建验收 Run" },
  config: { title: "规范与项目配置", description: "从事件主库组装项目打点配置，发布不可变快照并供验收Run引用", action: "新建打点配置" },
  tasks: { title: "数据任务与告警", description: "监控采集、同步、聚合与对账任务，并闭环处理数据异常", action: "新建告警规则" },
};

const moduleDialog: Record<ModuleKey, DialogKey> = {
  global: "project-report",
  project: "diagnosis",
  funnel: "diagnosis",
  admob: "admob-report",
  firebase: "event-dictionary",
  reconcile: "reconcile-run",
  tracking: "tracking-run",
  config: "config-version",
  tasks: "alert-rule",
};

const pages: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: "overview", label: "多项目漏斗总览", hint: "发现异常项目" },
  { key: "workbench", label: "单项目漏斗分析", hint: "定位异常步骤" },
  { key: "diagnosis", label: "步骤转化诊断", hint: "拆解流失原因" },
  { key: "cohort", label: "分群对比分析", hint: "找到问题人群" },
  { key: "path", label: "路径与流失分析", hint: "还原用户行为" },
  { key: "evidence", label: "事件证据明细", hint: "验证事件链" },
  { key: "issues", label: "问题与效果验证", hint: "修复闭环" },
  { key: "snapshot", label: "漏斗口径快照", hint: "确认计算规则" },
];

const projects = [
  { code: "IRAN-VPN-01", name: "Iran Fast VPN", category: "套利 VPN", dau: "128,430", viewer: "23.1%", opportunity: "28.4%", completion: "42.6%", revenue: "$4,821", status: "严重", issue: "Eligible → Opportunity" },
  { code: "FAST-VPN-02", name: "Fast VPN", category: "套利 VPN", dau: "96,510", viewer: "35.8%", opportunity: "42.1%", completion: "48.9%", revenue: "$4,103", status: "正常", issue: "—" },
  { code: "CLEAN-MAX-03", name: "Clean Max", category: "清理", dau: "76,210", viewer: "38.7%", opportunity: "45.1%", completion: "51.2%", revenue: "$2,104", status: "预警", issue: "机会履约率下降" },
  { code: "AIVORA-LAUNCHER", name: "Aivora Launcher", category: "Launcher", dau: "54,870", viewer: "31.4%", opportunity: "37.6%", completion: "46.3%", revenue: "$1,887", status: "正常", issue: "—" },
  { code: "TURBO-CLEAN-05", name: "Turbo Cleaner", category: "清理", dau: "41,360", viewer: "19.8%", opportunity: "24.5%", completion: "39.1%", revenue: "$986", status: "严重", issue: "机会未履约率高" },
];

const projectDisplayProfiles: Record<string, { name: string; packageName: string; category: string; owner: string; version: string; health: string; healthTone: "good" | "warn" | "bad"; newUsers: string; revenueDelta: string; arpDau: string; retention: string }> = {
  "IRAN-VPN-01": { name: "Iran Fast VPN", packageName: "com.jkcl.iran.vpn", category: "套利 VPN", owner: "Oliver", version: "1.8.0 (108)", health: "72", healthTone: "warn", newUsers: "31,842", revenueDelta: "-8.4%", arpDau: "$0.0375", retention: "34.8%" },
  "FAST-VPN-02": { name: "Fast VPN", packageName: "com.jkcl.fast.vpn", category: "套利 VPN", owner: "Aiden", version: "2.3.1 (231)", health: "91", healthTone: "good", newUsers: "19,486", revenueDelta: "+4.7%", arpDau: "$0.0425", retention: "38.2%" },
  "CLEAN-MAX-03": { name: "Clean Max", packageName: "com.jkcl.clean.max", category: "清理", owner: "Mia", version: "3.2.0 (320)", health: "78", healthTone: "warn", newUsers: "14,702", revenueDelta: "-1.8%", arpDau: "$0.0276", retention: "29.7%" },
  "AIVORA-LAUNCHER": { name: "Aivora Launcher", packageName: "com.aivora.launcher", category: "Launcher", owner: "Liam", version: "1.4.0 (140)", health: "86", healthTone: "good", newUsers: "12,618", revenueDelta: "+2.1%", arpDau: "$0.0344", retention: "41.1%" },
  "TURBO-CLEAN-05": { name: "Turbo Cleaner", packageName: "com.jkcl.turbo.clean", category: "清理", owner: "Noah", version: "2.1.6 (216)", health: "61", healthTone: "bad", newUsers: "9,864", revenueDelta: "-12.6%", arpDau: "$0.0238", retention: "25.9%" },
};

const productStages = [
  { label: "DAU", event: "app_active", value: "128,430", rate: "100%", delta: "+2.8%" },
  { label: "VPN 首页", event: "vpn_home_view", value: "117,804", rate: "91.7%", delta: "+1.4%" },
  { label: "点击连接", event: "connect_start", value: "82,361", rate: "69.9%", delta: "-3.2%" },
  { label: "权限通过", event: "permission_result", value: "76,409", rate: "92.8%", delta: "-0.6%" },
  { label: "连接成功", event: "connect_success", value: "64,276", rate: "84.1%", delta: "-5.9%" },
  { label: "稳定连接", event: "session_active", value: "54,729", rate: "85.1%", delta: "-2.1%" },
];

const monetizationEventStages: FunnelStage[] = [
  { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "356,410", rate: "100%", delta: "+3.8%" },
  { label: "Eligible", event: "jk_ad_eligibility_check · eligible=1", value: "283,006", rate: "79.4%", delta: "-1.1%" },
  { label: "Opportunity", event: "jk_ad_opportunity", value: "214,306", rate: "75.7%", delta: "-6.4%" },
  { label: "Show Attempt", event: "jk_ad_show_attempt", value: "144,871", rate: "67.6%", delta: "-2.6%" },
  { label: "Impression", event: "jk_ad_impression", value: "137,628", rate: "95.0%", delta: "-0.4%" },
  { label: "Paid Event", event: "jk_ad_paid_event", value: "136,392", rate: "99.1%", delta: "+0.1%" },
];

const opportunityFulfillment = {
  opportunity: 214306,
  cacheHit: 146812,
  cacheMiss: 67494,
  realtimeRequest: 63204,
  realtimeLoad: 61940,
  showFromCache: 101810,
  showFromRealtime: 43061,
  showAttempt: 144871,
  unfulfilled: 69435,
};

const preloadInventory = {
  trigger: 258420,
  request: 243118,
  loadSuccess: 226102,
  cacheStore: 221504,
  cacheHit: 146812,
  expired: 31806,
  evicted: 12702,
  unusedReady: 30184,
};

const projectFunnelProfiles: Record<string, { userStages: FunnelStage[]; viewerTrend: number[]; opportunityTrend: number[]; fulfillmentRate: string; preloadSuccess: string; cacheHitRate: string }> = {
  "IRAN-VPN-01": {
    userStages: [
      { label: "DAU", event: "app_active", value: "128,430", rate: "100%", delta: "+2.8%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "101,284", rate: "78.9%", delta: "-0.8%" },
      { label: "Eligible", event: "eligible=1", value: "83,106", rate: "82.1%", delta: "-1.3%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "36,474", rate: "43.9%", delta: "-12.8%" },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "31,682", rate: "86.9%", delta: "-1.8%" },
      { label: "AV", event: "jk_ad_impression", value: "29,671", rate: "93.7%", delta: "-0.7%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "29,404", rate: "99.1%", delta: "+0.1%" },
    ],
    viewerTrend: [34.9, 35.4, 34.6, 35.1, 31.8, 26.7, 23.1], opportunityTrend: [41.2, 41.6, 40.8, 40.9, 37.6, 32.9, 28.4], fulfillmentRate: "86.9%", preloadSuccess: "93.0%", cacheHitRate: "68.5%",
  },
  "FAST-VPN-02": {
    userStages: [
      { label: "DAU", event: "app_active", value: "96,510", rate: "100%", delta: "+1.6%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "79,426", rate: "82.3%", delta: "+0.4%" },
      { label: "Eligible", event: "eligible=1", value: "69,153", rate: "87.1%", delta: "+0.2%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "40,631", rate: "58.8%", delta: "+0.8%" },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "36,984", rate: "91.0%", delta: "+0.3%" },
      { label: "AV", event: "jk_ad_impression", value: "34,551", rate: "93.4%", delta: "+0.5%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "34,274", rate: "99.2%", delta: "+0.1%" },
    ],
    viewerTrend: [34.8, 35.1, 35.3, 35.0, 35.5, 35.6, 35.8], opportunityTrend: [41.4, 41.7, 41.8, 41.6, 41.9, 42.0, 42.1], fulfillmentRate: "91.0%", preloadSuccess: "94.6%", cacheHitRate: "72.4%",
  },
  "CLEAN-MAX-03": {
    userStages: [
      { label: "DAU", event: "app_active", value: "76,210", rate: "100%", delta: "+0.9%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "63,402", rate: "83.2%", delta: "+0.1%" },
      { label: "Eligible", event: "eligible=1", value: "55,924", rate: "88.2%", delta: "-0.3%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "34,371", rate: "61.5%", delta: "-0.7%" },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "31,108", rate: "90.5%", delta: "-5.1%" },
      { label: "AV", event: "jk_ad_impression", value: "29,493", rate: "94.8%", delta: "-0.8%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "29,198", rate: "99.0%", delta: "0.0%" },
    ],
    viewerTrend: [39.4, 39.0, 39.2, 38.9, 38.6, 38.9, 38.7], opportunityTrend: [46.2, 46.0, 45.8, 45.5, 45.2, 45.3, 45.1], fulfillmentRate: "90.5%", preloadSuccess: "88.2%", cacheHitRate: "61.6%",
  },
  "AIVORA-LAUNCHER": {
    userStages: [
      { label: "DAU", event: "app_active", value: "54,870", rate: "100%", delta: "+4.1%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "43,106", rate: "78.6%", delta: "+0.6%" },
      { label: "Eligible", event: "eligible=1", value: "38,950", rate: "90.4%", delta: "+0.2%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "20,632", rate: "53.0%", delta: "-0.5%" },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "18,604", rate: "90.2%", delta: "-0.4%" },
      { label: "AV", event: "jk_ad_impression", value: "17,229", rate: "92.6%", delta: "+0.3%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "17,108", rate: "99.3%", delta: "+0.1%" },
    ],
    viewerTrend: [30.5, 30.8, 31.0, 30.9, 31.2, 31.1, 31.4], opportunityTrend: [36.9, 37.1, 37.0, 37.4, 37.2, 37.5, 37.6], fulfillmentRate: "90.2%", preloadSuccess: "92.1%", cacheHitRate: "70.8%",
  },
  "TURBO-CLEAN-05": {
    userStages: [
      { label: "DAU", event: "app_active", value: "41,360", rate: "100%", delta: "-0.4%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "32,111", rate: "77.6%", delta: "-1.2%" },
      { label: "Eligible", event: "eligible=1", value: "27,840", rate: "86.7%", delta: "-0.9%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "10,133", rate: "36.4%", delta: "-8.1%" },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "8,854", rate: "87.4%", delta: "-3.4%" },
      { label: "AV", event: "jk_ad_impression", value: "8,189", rate: "92.5%", delta: "-1.0%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "8,098", rate: "98.9%", delta: "-0.2%" },
    ],
    viewerTrend: [28.1, 27.4, 25.8, 24.0, 22.7, 20.9, 19.8], opportunityTrend: [33.9, 32.8, 30.6, 29.3, 27.6, 25.6, 24.5], fulfillmentRate: "87.4%", preloadSuccess: "84.8%", cacheHitRate: "49.7%",
  },
};

const reasons = [
  { code: "NO_OPPORTUNITY", label: "满足资格但没有生成广告机会", users: "24,613", share: 52.8, impact: "$1,482", owner: "产品 / 客户端" },
  { code: "SCENE_NOT_REACHED", label: "未到达配置的广告触发场景", users: "9,384", share: 20.1, impact: "$565", owner: "产品" },
  { code: "FREQUENCY_CAPPED", label: "命中频控或冷却时间", users: "5,817", share: 12.5, impact: "$350", owner: "广告策略" },
  { code: "APP_BACKGROUND", label: "触发前 App 进入后台", users: "3,921", share: 8.4, impact: "$236", owner: "客户端" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端触发但 Firebase 未收到", users: "1,937", share: 4.2, impact: "$117", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "948", share: 2.0, impact: "$57", owner: "数据" },
];

const fulfillmentReasons = [
  { code: "CACHE_CONTEXT_LOST", label: "缓存对象未绑定当前机会，无法继续展示", users: "28,417", share: 40.9, impact: "$1,116", owner: "客户端 / 广告" },
  { code: "SHOW_CONDITION_BLOCKED", label: "到达机会后被页面状态、频控或订阅状态阻止", users: "16,842", share: 24.3, impact: "$662", owner: "产品 / 广告策略" },
  { code: "REALTIME_LOAD_FAILED", label: "缓存未命中后的实时加载失败或超时", users: "11,204", share: 16.1, impact: "$441", owner: "广告 SDK" },
  { code: "APP_BACKGROUND", label: "履约完成前 App 进入后台", users: "7,983", share: 11.5, impact: "$314", owner: "客户端" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端已执行但 Firebase 未收到关联事件", users: "3,601", share: 5.2, impact: "$142", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "1,388", share: 2.0, impact: "$55", owner: "数据" },
];

const cohortRows = [
  { value: "伊朗", volume: "48,420", base: "52.1%", current: "31.8%", change: "-20.3pp", lost: "9,829", impact: "$592", level: "bad" },
  { value: "埃及", volume: "18,304", base: "49.6%", current: "42.7%", change: "-6.9pp", lost: "1,263", impact: "$76", level: "warn" },
  { value: "土耳其", volume: "15,887", base: "47.2%", current: "45.4%", change: "-1.8pp", lost: "286", impact: "$17", level: "ok" },
  { value: "巴基斯坦", volume: "12,641", base: "44.8%", current: "46.1%", change: "+1.3pp", lost: "—", impact: "+$10", level: "good" },
  { value: "印度尼西亚", volume: "9,218", base: "41.3%", current: "40.7%", change: "-0.6pp", lost: "55", impact: "$3", level: "ok" },
];

const eventRows = [
  { time: "10:20:01.012", name: "jk_ad_request", result: "有效", detail: "request_type=preload · opportunity_id省略", id: "evt_2a10", source: "Firebase", requestType: "preload", cacheStatus: "—" },
  { time: "10:20:01.806", name: "jk_ad_load_success", result: "有效", detail: "ad_instance_id=ins_671 · preload", id: "evt_2a11", source: "Firebase", requestType: "preload", cacheStatus: "loaded" },
  { time: "10:20:01.842", name: "jk_ad_cache_store", result: "有效", detail: "cache_slot=vpn_interstitial · ttl=3600s", id: "evt_2a12", source: "Firebase", requestType: "preload", cacheStatus: "stored" },
  { time: "10:27:04.132", name: "jk_ad_eligibility_check", result: "有效", detail: "eligible=1 · placement=vpn_connect_success", id: "evt_2a18", source: "Firebase", requestType: "—", cacheStatus: "ready" },
  { time: "10:27:04.146", name: "jk_ad_opportunity", result: "有效", detail: "opportunity_id=opp_82c · scene已到达", id: "evt_2a19", source: "Firebase", requestType: "—", cacheStatus: "ready" },
  { time: "10:27:04.188", name: "jk_ad_cache_hit", result: "有效", detail: "ad_instance_id=ins_671 · 绑定当前opportunity", id: "evt_2a20", source: "Firebase", requestType: "—", cacheStatus: "hit" },
  { time: "10:27:05.106", name: "jk_ad_show_attempt", result: "P1缺失", detail: "visibility_reason 缺失 · 不阻断 P0", id: "evt_2a21", source: "Firebase", requestType: "—", cacheStatus: "consumed" },
  { time: "10:27:05.419", name: "jk_ad_impression", result: "链路异常", detail: "缓存实例正常 · opportunity_id 未关联", id: "evt_2a22", source: "Firebase", requestType: "—", cacheStatus: "consumed" },
  { time: "10:27:05.438", name: "jk_ad_paid_event", result: "有效", detail: "value_micros=2814 · currency=USD", id: "evt_2a23", source: "Firebase", requestType: "—", cacheStatus: "consumed" },
];

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "blue" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "bad" | "good" }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone ? `metric-${tone}` : ""}`}>{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

function Segmented({ items, active, onChange, label }: { items: Array<{ key: string; label: string }>; active: string; onChange: (key: string) => void; label: string }) {
  return (
    <div className="segmented" aria-label={label}>
      {items.map((item) => (
        <button key={item.key} className={active === item.key ? "selected" : ""} onClick={() => onChange(item.key)}>{item.label}</button>
      ))}
    </div>
  );
}

function ModulePage({ module, project, configs, onProjectChange, openModule, openDialog, openConfigEditor, notify }: { module: Exclude<ModuleKey, "funnel">; project: string; configs: TrackingConfigRecord[]; onProjectChange: (project: string) => void; openModule: (next: ModuleKey) => void; openDialog: (dialog: DialogKey) => void; openConfigEditor: (config: TrackingConfigRecord | null) => void; notify: (message: string) => void }) {
  const [admobDimension, setAdmobDimension] = useState<AdMobDimension>("format");
  const [trackingResultFilter, setTrackingResultFilter] = useState<TrackingResultFilter>("all");
  const [trackingConfigId, setTrackingConfigId] = useState("CFG-VPN-1.8-PROD");
  const [selectedTestCapability, setSelectedTestCapability] = useState("all");
  const [configPackageTab, setConfigPackageTab] = useState<ConfigPackageTab>("events");
  const [selectedCategory, setSelectedCategory] = useState("套利 VPN");
  const [selectedConfigId, setSelectedConfigId] = useState("CFG-VPN-1.8-PROD");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const projectItem = projects.find((item) => item.code === project) ?? projects[0];
  const displayProfile = projectDisplayProfiles[project] ?? projectDisplayProfiles["IRAN-VPN-01"];
  const selectedConfigRecord = configs.find((config) => config.id === selectedConfigId) ?? configs[0];
  const compatibleTrackingConfigs = configs.filter((config) => config.status === "PUBLISHED" && config.projects.includes(project));
  const selectedTrackingConfig = compatibleTrackingConfigs.find((config) => config.id === trackingConfigId) ?? compatibleTrackingConfigs[0];
  const expectedTrackingEvents = trackingEventCatalog.filter((event) => selectedTrackingConfig?.selectedEventIds?.includes(event.id));
  const trackingOutcomes: Record<string, "PASSED" | "NOT_RECEIVED" | "SCENE_NOT_EXECUTED" | "PARAM_INVALID" | "CHAIN_INVALID"> = {
    ad_impression: "CHAIN_INVALID",
    ad_dismissed: "NOT_RECEIVED",
    ad_cache_hit: "SCENE_NOT_EXECUTED",
    app_background: "PARAM_INVALID",
  };
  const expectedResults = expectedTrackingEvents.map((event) => ({ event, conclusion: trackingOutcomes[event.name] ?? "PASSED" }));
  const resultCounts = {
    passed: expectedResults.filter((item) => item.conclusion === "PASSED").length,
    failed: expectedResults.filter((item) => ["NOT_RECEIVED", "PARAM_INVALID", "CHAIN_INVALID"].includes(item.conclusion)).length,
    pending: expectedResults.filter((item) => item.conclusion === "SCENE_NOT_EXECUTED").length,
  };
  const capabilityTasks = Array.from(new Set(expectedTrackingEvents.map((event) => event.capability))).map((capability) => {
    const events = expectedResults.filter((item) => item.event.capability === capability);
    const failed = events.filter((item) => ["NOT_RECEIVED", "PARAM_INVALID", "CHAIN_INVALID"].includes(item.conclusion)).length;
    const pending = events.filter((item) => item.conclusion === "SCENE_NOT_EXECUTED").length;
    const guide = events[0]?.event;
    return { capability, events, failed, pending, passed: events.length - failed - pending, guide, status: failed ? "异常" : pending ? "待操作" : "已完成" };
  });
  const visibleExpectedResults = expectedResults.filter((item) => {
    const matchesCapability = selectedTestCapability === "all" || item.event.capability === selectedTestCapability;
    const matchesResult = trackingResultFilter === "all"
      || (trackingResultFilter === "passed" && item.conclusion === "PASSED")
      || (trackingResultFilter === "failed" && ["NOT_RECEIVED", "PARAM_INVALID", "CHAIN_INVALID"].includes(item.conclusion))
      || (trackingResultFilter === "pending" && item.conclusion === "SCENE_NOT_EXECUTED");
    return matchesCapability && matchesResult;
  });

  function changeTrackingProduct(nextProject: string) {
    onProjectChange(nextProject);
    const nextConfig = configs.find((config) => config.status === "PUBLISHED" && config.projects.includes(nextProject));
    setTrackingConfigId(nextConfig?.id ?? "");
    setSelectedTestCapability("all");
    setTrackingResultFilter("all");
  }
  const admobRows: Record<AdMobDimension, string[][]> = {
    format: [["插屏","128,420","100%","72.4%","90,216","21,904","4.12","$38.42","$3,466","正常"],["激励视频","31,842","99.8%","81.6%","25,912","12,404","2.09","$42.18","$1,093","正常"],["Banner","41,682","100%","51.4%","21,500","18,621","1.15","$12.19","$262","预警"]],
    placement: [["vpn_connect_success","86,204","100%","74.8%","62,104","18,406","3.37","$41.20","$2,558","正常"],["vpn_home_banner","41,682","100%","51.4%","21,500","18,621","1.15","$12.19","$262","预警"],["server_select","38,214","99.7%","67.2%","24,908","9,682","2.57","$36.44","$908","正常"],["vpn_disconnect","35,844","100%","76.5%","29,116","8,204","3.55","$37.54","$1,093","正常"]],
    country: [["伊朗","122,804","100%","68.1%","81,620","17,904","4.56","$32.84","$2,680","预警"],["埃及","31,442","99.9%","73.8%","22,942","6,802","3.37","$38.21","$877","正常"],["土耳其","24,606","100%","75.4%","18,406","4,106","4.48","$42.19","$776","正常"],["其他","23,092","99.8%","72.3%","14,660","4,018","3.65","$33.29","$488","正常"]],
  };
  const configTables: Record<ConfigPackageTab, { headers: string[]; rows: string[][] }> = {
    events: { headers: ["事件","业务阶段","优先级","适用条件","参数数","移动端可得性","降级口径","状态"], rows: [["jk_ad_request","广告请求","P0","真实Load前","13","稳定可得","缺失阻断","已发布"],["jk_ad_impression","广告展示","P0","SDK回调","11","依赖广告SDK","缺失阻断","已发布"],["connect_success","VPN连接","P0","成功回调","10","依赖业务模块","缺失阻断","已发布"],["app_background","生命周期","P2","后台时","4","推断可得","unknown/省略","已发布"]] },
    fields: { headers: ["字段","类型","级别","Provider","适用事件","空值规则","Firebase承载","状态"], rows: [["event_id","String","P0","公共Provider","全部","缺失阻断","event_param","已发布"],["opportunity_id","String","条件P0","广告Context","机会后事件","不适用时省略","event_param","已发布"],["ip_after_connect","String(脱敏)","P1","VPN Provider","广告拉取事件","unknown/省略","BigQuery only","已发布"],["background_reason","String","P2","生命周期Provider","app_background","unknown","event_param","已发布"]] },
    enums: { headers: ["枚举组","枚举值","含义","适用字段","未知值","废弃策略","版本","状态"], rows: [["request_type","preload / realtime","预加载或实时请求","request_type","unknown","禁止静默新增","V1.7","已发布"],["cache_status","stored / hit / expired / evicted","缓存生命周期","cache_status","unknown","向后兼容","V1.7","已发布"],["background_reason","home / lock / system / unknown","进入后台原因","background_reason","unknown","允许扩展","V1.6","已发布"]] },
    providers: { headers: ["Provider","负责模块","输出字段","可用平台","不可用原因上报","负责人","健康度","状态"], rows: [["CommonProvider","基础信息","项目/版本/设备","Android/iOS","provider_unavailable","客户端架构组","100%","正常"],["AdContextProvider","广告Context","request/opportunity/instance","Android/iOS","context_missing","广告变现组","97.8%","预警"],["VpnContextProvider","VPN连接","IP/协议/服务器","Android/iOS","vpn_context_missing","VPN组","99.2%","正常"],["AttributionProvider","归因","channel/campaign/media","Android/iOS","sdk_unavailable","增长组","94.6%","预警"]] },
  };
  const taskRows = [
    { name:"Firebase增量拉取", project:"全部项目", batch:"15:30", start:"15:31", duration:"2m18s", volume:"8.42M", sla:"≤10m", status:"成功" },
    { name:"OSS Raw归档", project:"全部项目", batch:"fb_1530", start:"15:34", duration:"1m06s", volume:"4.8GB", sla:"≤15m", status:"成功" },
    { name:"ADB事件标准化", project:"IRAN-VPN-01", batch:"batch_8241", start:"15:35", duration:"运行8m", volume:"2.14M", sla:"≤15m", status:"运行中" },
    { name:"中台DAU聚合", project:"CLEAN-MAX-03", batch:"2026-08-11", start:"15:20", duration:"失败", volume:"76,210", sla:"≤20m", status:"失败" },
    { name:"AdMob T+3同步", project:"全部项目", batch:"2026-08-08", start:"14:10", duration:"12m44s", volume:"24项目", sla:"≤60m", status:"成功" },
  ].filter((row) => taskFilter === "all" || (taskFilter === "failed" && row.status === "失败") || (taskFilter === "running" && row.status === "运行中"));
  if (module === "global") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="项目数" value="28" note="在线 24 · 灰度 4" /><Metric label="总 DAU" value="1,284,630" note="较昨日 +4.1%" tone="good" /><Metric label="总收入" value="$48,921" note="较昨日 +2.7%" tone="good" /><Metric label="投放消耗" value="$31,406" note="ROAS 155.8%" /><Metric label="预估利润" value="$17,515" note="利润率 35.8%" tone="good" /><Metric label="异常项目" value="4" note="严重 2 · 预警 2" tone="bad" /></section>
      <section className="portfolio-health"><div><Badge tone="bad">2</Badge><strong>变现严重异常</strong><p>广告浏览者比例或收入连续下降</p></div><div><Badge tone="warn">2</Badge><strong>数据质量预警</strong><p>Firebase 与中台 DAU 差异超阈值</p></div><div><Badge tone="blue">3</Badge><strong>待完成验收</strong><p>新版本尚未达到 P0 100%</p></div><div><Badge tone="good">21</Badge><strong>项目运行正常</strong><p>核心指标处于历史基线范围</p></div></section>
      <section className="two-column wide-left">
        <div className="surface"><div className="surface-title"><div><h2>项目经营总览</h2><p>点击项目会保留所选项目进入诊断</p></div><button className="text-button" onClick={() => openModule("project")}>进入单项目诊断</button></div><div className="table-wrap"><table><thead><tr><th>项目</th><th>品类</th><th>DAU</th><th>收入</th><th>消耗</th><th>ROAS</th><th>广告浏览者比例</th><th>数据健康</th><th>状态</th></tr></thead><tbody>{projects.map((item, index) => <tr key={item.code} className="clickable-row" onClick={() => { onProjectChange(item.code); openModule("project"); }}><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.category}</td><td>{item.dau}</td><td>{item.revenue}</td><td>{["$3,118", "$2,791", "$1,436", "$1,210", "$892"][index]}</td><td>{["154.6%", "147.0%", "146.5%", "155.9%", "110.5%"][index]}</td><td>{item.viewer}</td><td>{index === 0 ? "96.8%" : index === 4 ? "91.2%" : "≥99.0%"}</td><td><Badge tone={item.status === "严重" ? "bad" : item.status === "预警" ? "warn" : "good"}>{item.status}</Badge></td></tr>)}</tbody></table></div></div>
        <aside className="surface"><div className="surface-title"><div><h2>今日重点</h2><p>按利润影响和紧急度排序</p></div></div><div className="focus-list"><button onClick={() => openModule("funnel")}><Badge tone="bad">P0</Badge><div><strong>IRAN-VPN-01 覆盖下跌</strong><p>预计影响 $2,807/日</p></div></button><button onClick={() => openModule("reconcile")}><Badge tone="warn">P1</Badge><div><strong>CLEAN-MAX-03 DAU差异</strong><p>Firebase 比中台高 8.7%</p></div></button><button onClick={() => openModule("tracking")}><Badge tone="blue">验收</Badge><div><strong>AIVORA-LAUNCHER 1.4.0</strong><p>P0事件完成 28/31</p></div></button></div></aside>
      </section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>项目收入与利润贡献</h2><p>近7日 · 按项目排序</p></div></div><div className="contribution-bars">{[["IRAN-VPN-01",82,"$33,747","$12,268"],["FAST-VPN-02",70,"$28,721","$9,816"],["CLEAN-MAX-03",48,"$14,728","$4,193"],["AIVORA-LAUNCHER",39,"$13,209","$3,887"]].map(([name,width,revenue,profit]) => <div key={String(name)}><span>{name}</span><div><i style={{width:`${width}%`}} /></div><strong>{revenue}</strong><small>利润 {profit}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>市场分布</h2><p>DAU / 收入占比</p></div></div><div className="market-list">{[["伊朗","38.4%","42.1%"],["埃及","16.7%","14.8%"],["土耳其","12.6%","15.2%"],["巴基斯坦","9.4%","7.8%"],["其他","22.9%","20.1%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><span>{row[1]} DAU</span><span>{row[2]} 收入</span></div>)}</div></aside></section>
    </div>
  );

  if (module === "project") return (
    <div className="page-stack">
      <section className="project-hero surface"><div><div className="eyebrow">{project} · {displayProfile.packageName}</div><h2>{displayProfile.name}</h2><p>{displayProfile.category} · Android · 负责人 {displayProfile.owner} · 当前版本 {displayProfile.version}</p></div><div className="project-health"><span>综合健康度</span><strong>{displayProfile.health}</strong><Badge tone={displayProfile.healthTone}>{displayProfile.healthTone === "good" ? "健康" : displayProfile.healthTone === "bad" ? "严重异常" : "需要关注"}</Badge></div></section>
      <section className="metric-grid six"><Metric label="DAU" value={projectItem.dau} note="模拟项目联动" tone="good" /><Metric label="新增用户" value={displayProfile.newUsers} note="按项目模拟" /><Metric label="广告浏览者比例" value={projectItem.viewer} note="目标 ≥35%" tone={projectItem.status === "正常" ? "good" : "bad"} /><Metric label="收入" value={projectItem.revenue} note={displayProfile.revenueDelta} tone={displayProfile.revenueDelta.startsWith("-") ? "bad" : "good"} /><Metric label="ARPDAU" value={displayProfile.arpDau} note="Revenue / DAU" /><Metric label="D1留存" value={displayProfile.retention} note="Firebase cohort" tone="good" /></section>
      <section className="health-dimensions">{[["用户增长",82,"good"],["产品转化",76,"good"],["广告覆盖",48,"bad"],["广告效率",91,"good"],["收入表现",63,"warn"],["数据质量",94,"good"]].map(([name,score,tone]) => <button key={String(name)} onClick={() => tone === "bad" ? openModule("funnel") : notify(`${name}诊断详情已展开`)}><span>{name}</span><strong className={String(tone)}>{score}</strong><div><i className={String(tone)} style={{width:`${score}%`}} /></div><small>{tone === "bad" ? "存在严重异常" : tone === "warn" ? "低于项目基线" : "处于正常范围"}</small></button>)}</section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>全链路诊断</h2><p>从安装、活跃、产品使用到广告变现</p></div><Badge tone="bad">1 个核心阻塞</Badge></div><div className="diagnostic-chain">{[["安装","31,842","100%","normal"],["活跃","128,430","—","normal"],["连接成功","64,276","50.0%","normal"],["广告机会","36,474","28.4%","bad"],["广告浏览 AV","29,671","23.1%","bad"],["付费回调","29,404","99.1%","normal"]].map(([label,value,rate,status],index) => <div key={String(label)} className={status === "bad" ? "bad" : ""}><span>{index+1}</span><strong>{label}</strong><em>{value}</em><small>{rate}</small></div>)}</div><div className="diagnosis-callout"><Badge tone="bad">核心问题</Badge><strong>请求前广告机会覆盖不足</strong><p>请求后的加载与展示效率正常；无需先调整 AdMob 填充策略。</p><button onClick={() => openModule("funnel")}>进入漏斗分析</button></div></div><aside className="surface"><div className="surface-title"><div><h2>快速检查</h2><p>按问题优先级执行</p></div></div><div className="quick-checks"><button onClick={() => openModule("funnel")}><span>1</span><div><strong>漏斗异常</strong><p>Eligible → Opportunity -12.8pp</p></div><Badge tone="bad">严重</Badge></button><button onClick={() => openModule("firebase")}><span>2</span><div><strong>Firebase质量</strong><p>P0字段完整率 99.1%</p></div><Badge tone="warn">预警</Badge></button><button onClick={() => openModule("admob")}><span>3</span><div><strong>AdMob效率</strong><p>匹配100% · 展示70.2%</p></div><Badge tone="good">正常</Badge></button><button onClick={() => openModule("reconcile")}><span>4</span><div><strong>数据对账</strong><p>展示差异 1.7%</p></div><Badge tone="good">正常</Badge></button></div></aside></section>
    </div>
  );

  if (module === "admob") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="预估收入" value="$4,821" note="较昨日 -8.4%" tone="bad" /><Metric label="广告请求" value="201,944" note="+4.9%" /><Metric label="匹配率" value="100%" note="AdMob已结算" tone="good" /><Metric label="展示率" value="70.2%" note="目标 ≥68%" tone="good" /><Metric label="eCPM" value="$35.03" note="-3.1%" /><Metric label="广告浏览者 AV" value="29,671" note="AV/DAU 23.1%" tone="bad" /></section>
      <section className="admob-split"><div className="surface"><div className="surface-title"><div><h2>用户覆盖</h2><p>回答有多少用户真正看到了广告</p></div><Badge tone="bad">异常</Badge></div><div className="big-ratio"><strong>23.1%</strong><span>广告浏览者比例</span><div><i style={{width:"23.1%"}} /></div></div><div className="ratio-details"><div><span>DAU</span><strong>128,430</strong></div><div><span>Request UV</span><strong>34,921</strong></div><div><span>AV</span><strong>29,671</strong></div><div><span>Impression/AV</span><strong>3.42</strong></div></div><button className="full-link" onClick={() => openModule("funnel")}>定位用户覆盖漏斗 →</button></div><div className="surface"><div className="surface-title"><div><h2>请求后效率</h2><p>回答广告 SDK 链路是否健康</p></div><Badge tone="good">正常</Badge></div><div className="efficiency-chain">{[["Request","201,944","100%"],["Matched","201,944","100%"],["Show","141,760","70.2%"],["Impression","137,628","97.1%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><Badge tone={row[0] === "Show" ? "blue" : "good"}>{row[2]}</Badge></div>)}</div><div className="conclusion-block good"><strong>结论</strong><p>AdMob匹配和请求后展示正常，低AV主要不是填充问题。</p></div></div></section>
      <section className="surface"><div className="surface-title"><div><h2>广告维度明细</h2><p>切换广告格式、广告位和国家，模拟不同问题定位角度</p></div><div className="dimension-tabs"><button className={admobDimension === "format" ? "active" : ""} onClick={() => setAdmobDimension("format")}>广告格式</button><button className={admobDimension === "placement" ? "active" : ""} onClick={() => setAdmobDimension("placement")}>广告位</button><button className={admobDimension === "country" ? "active" : ""} onClick={() => setAdmobDimension("country")}>国家</button></div></div><div className="table-wrap"><table><thead><tr><th>{admobDimension === "format" ? "广告格式" : admobDimension === "placement" ? "广告位" : "国家"}</th><th>请求</th><th>匹配率</th><th>展示率</th><th>Impression</th><th>AV</th><th>Impression/AV</th><th>eCPM</th><th>收入</th><th>状态</th></tr></thead><tbody>{admobRows[admobDimension].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 9 ? <Badge tone={cell === "正常" ? "good" : "warn"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>Mediation Adapter</h2><p>按收入贡献和错误率排序</p></div></div><div className="adapter-list">{[["Google Ads","62.4%","$3,009","0.3%"],["Meta Audience Network","18.7%","$902","1.1%"],["AppLovin","12.8%","$617","0.8%"],["Unity Ads","6.1%","$293","2.4%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><div><i style={{width:row[1]}} /></div><span>{row[2]}</span><small>错误 {row[3]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>收入异常说明</h2><p>自动关联相关指标</p></div></div><div className="conclusion-block warn"><strong>收入下降不是 eCPM 单因子</strong><p>eCPM下降3.1%，但AV下降12.4%；用户覆盖是更大的收入损失来源。</p></div><button className="primary-button full" onClick={() => openModule("project")}>返回单项目诊断</button></aside></section>
    </div>
  );

  if (module === "firebase") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="Firebase DAU" value="128,430" note="实时 · 延迟8分钟" /><Metric label="中台 DAU" value="124,208" note="差异 3.3%" tone="bad" /><Metric label="今日事件量" value="8.42M" note="+5.7%" /><Metric label="P0参数完整率" value="99.1%" note="目标100%" tone="bad" /><Metric label="未知事件率" value="0.18%" note="目标&lt;0.5%" tone="good" /><Metric label="隔离事件" value="2,184" note="缺ID 1,602" tone="bad" /></section>
      <section className="firebase-status"><div><span className="status-dot" /><strong>Firebase Export</strong><p>最近入库 15:31 · 正常</p></div><i /><div><span className="status-dot" /><strong>标准化任务</strong><p>批次 fb_1530 · 正常</p></div><i /><div><span className="status-dot" /><strong>ADB 聚合</strong><p>水位 15:22 · 延迟9分钟</p></div><i /><div><span className="status-dot warn" /><strong>中台接口</strong><p>成功率 96.7% · 预警</p></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>事件健康度</h2><p>按P0覆盖、参数和关联链综合判断</p></div><button className="text-button" onClick={() => openModule("tracking")}>进入打点验收</button></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>今日用户</th><th>事件量</th><th>P0参数</th><th>event_id</th><th>关联链</th><th>版本覆盖</th><th>状态</th></tr></thead><tbody>{[["jk_ad_request","34,921","201,944","100%","100%","99.8%","98.6%","正常"],["jk_ad_impression","29,671","137,628","99.1%","100%","97.8%","异常"],["connect_success","64,276","71,804","100%","99.9%","99.7%","99.2%","正常"],["app_background","82,104","126,908","98.7%","100%","—","96.4%","预警"],["jk_ad_paid_event","29,404","136,392","100%","100%","99.1%","98.6%","正常"]].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></div><aside className="surface"><div className="surface-title"><div><h2>主要质量问题</h2><p>按影响事件量排序</p></div></div><div className="quality-issues"><button onClick={() => openModule("tracking")}><Badge tone="bad">P0</Badge><strong>impression缺opportunity_id</strong><span>1,824 条 · 1.3%</span></button><button onClick={() => openModule("reconcile")}><Badge tone="warn">同步</Badge><strong>中台接口上报失败</strong><span>4,222 用户 · 3.3%</span></button><button><Badge tone="warn">P1</Badge><strong>background_reason 缺失</strong><span>1,649 条 · 1.3%</span></button><button><Badge tone="neutral">隔离</Badge><strong>event_id 为空</strong><span>1,602 条</span></button></div></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>版本与用户覆盖</h2><p>确认新版本是否完整接入全部事件</p></div><Badge tone="blue">Android</Badge></div><div className="version-coverage">{[["1.8.0 (108)","68.4%",68,"99.1%","31/31"],["1.7.4 (104)","21.7%",22,"99.8%","31/31"],["1.7.2 (102)","7.1%",7,"98.9%","29/31"],["其他","2.8%",3,"95.2%","26/31"]].map(row => <div key={String(row[0])}><strong>{row[0]}</strong><span>{row[1]} DAU</span><div><i style={{width:`${row[2]}%`}} /></div><small>参数 {row[3]}</small><Badge tone={row[4] === "31/31" ? "good" : "warn"}>{row[4]} P0</Badge></div>)}</div></section>
    </div>
  );

  if (module === "reconcile") return (
    <div className="page-stack">
      <section className="metric-grid five"><Metric label="对账项目" value="24" note="今日完成 22" /><Metric label="正常项目" value="19" note="差异&lt;3%" tone="good" /><Metric label="预警项目" value="3" note="差异3%–5%" /><Metric label="异常项目" value="2" note="差异&gt;5%" tone="bad" /><Metric label="待结算日期" value="3 天" note="AdMob T+3" /></section>
      <section className="reconcile-flow">{[["Firebase","用户/事件","128,430 DAU"],["AdMob","请求/展示/收入","T+3 已结算"],["OSS Raw","原始事件备份","8.42M"],["ADB","标准化事实表","水位15:22"],["中台报表","统一口径","差异告警"]].map((row,index) => <div key={row[0]}><span>{index+1}</span><strong>{row[0]}</strong><p>{row[1]}</p><small>{row[2]}</small></div>)}</section>
      <section className="surface"><div className="surface-title"><div><h2>核心指标对账</h2><p>今天仅对账 Firebase 与中台；AdMob 使用已结算日期</p></div><Badge tone="warn">2项异常</Badge></div><div className="table-wrap"><table><thead><tr><th>指标</th><th>日期</th><th>Firebase</th><th>AdMob</th><th>中台/ADB</th><th>差异率</th><th>容差</th><th>判定</th><th>建议</th></tr></thead><tbody>{[["DAU","今天","128,430","—","124,208","3.3%","≤2%","预警","检查中台接口"],["广告浏览人数AV","8/8","31,284","30,901","31,022","1.2%","≤3%","正常","—"],["Impression","8/8","142,821","140,432","141,076","1.7%","≤3%","正常","—"],["Paid Revenue","8/8","$5,018","$4,821","$5,001","4.1%","≤3%","异常","检查币种/时区"],["Request","8/8","203,812","201,944","202,405","0.9%","≤3%","正常","—"]].map(row => <tr key={`${row[0]}${row[1]}`}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>近7日差异趋势</h2><p>差异超过阈值自动创建问题</p></div></div><div className="diff-bars">{[["8/5",1.2,"good"],["8/6",1.6,"good"],["8/7",1.1,"good"],["8/8",1.7,"good"],["8/9",2.6,"warn"],["8/10",3.1,"bad"],["今天",3.3,"bad"]].map(row => <div key={row[0]}><span>{row[1]}%</span><i className={row[2]} style={{height:`${Number(row[1])*24}px`}} /><small>{row[0]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>异常归因</h2><p>DAU 差异 4,222 用户</p></div></div><div className="reason-list compact"><button><div className="reason-title"><strong>中台接口失败</strong><span>3,108 · 73.6%</span></div><div className="reason-bar"><span style={{width:"73.6%"}} /></div></button><button><div className="reason-title"><strong>重复去重规则</strong><span>724 · 17.1%</span></div><div className="reason-bar"><span style={{width:"17.1%"}} /></div></button><button><div className="reason-title"><strong>时区/跨日</strong><span>390 · 9.3%</span></div><div className="reason-bar"><span style={{width:"9.3%"}} /></div></button></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>创建同步任务告警</button></aside></section>
    </div>
  );

  if (module === "tracking") return (
    <div className="page-stack">
      <section className="tracking-product-selector surface">
        <div><span className="eyebrow">第一步 · 选择需要验收的产品</span><h2>产品打点测试执行助手</h2><p>系统根据“产品 + 已发布配置快照”生成应测事件和可执行操作，不再按品类总事件数验收。</p></div>
        <label><span>测试产品</span><select value={project} onChange={(event) => changeTrackingProduct(event.target.value)}>{projects.filter((item) => configs.some((config) => config.status === "PUBLISHED" && config.projects.includes(item.code))).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
        <label><span>已发布配置</span><select value={selectedTrackingConfig?.id ?? ""} onChange={(event) => { setTrackingConfigId(event.target.value); setSelectedTestCapability("all"); setTrackingResultFilter("all"); }}>{compatibleTrackingConfigs.map((config) => <option key={config.id} value={config.id}>{config.name} {config.version} · {config.selectedCount}个事件</option>)}</select></label>
        <button className="primary-button" onClick={() => openDialog("tracking-run")}>新建本次验收 Run</button>
      </section>

      {selectedTrackingConfig ? <>
        <section className="acceptance-flow">{[["选择产品与配置",`${project} · ${selectedTrackingConfig.version}`],["冻结应收快照",`${selectedTrackingConfig.snapshotId} · ${selectedTrackingConfig.selectedCount}事件`],["按指引执行操作",`${capabilityTasks.filter((task) => task.status === "已完成").length}/${capabilityTasks.length} 类已完成`],["自动接收与校验",`${resultCounts.passed}/${selectedTrackingConfig.selectedCount} 通过`],["反馈与发布门禁",resultCounts.failed ? "BLOCKED" : "PASSED"]].map((row,index) => <div key={row[0]} className={index < 2 ? "done" : index === 2 ? "current" : ""}><span>{index<2?"✓":index+1}</span><strong>{row[0]}</strong><small>{row[1]}</small></div>)}</section>
        <section className="run-config-strip surface"><div><span>当前产品</span><strong>{project} · {displayProfile.name}</strong><small>{displayProfile.packageName} · {displayProfile.version}</small></div><div><span>应收配置</span><strong>{selectedTrackingConfig.name} {selectedTrackingConfig.version}</strong><small>{selectedTrackingConfig.id} · {selectedTrackingConfig.snapshotId}</small></div><div><span>必须验证</span><strong>{selectedTrackingConfig.selectedCount} 个事件 · {capabilityTasks.length} 类操作</strong><small>P0 {selectedTrackingConfig.p0Count} · P1 {selectedTrackingConfig.p1Count} · P2 {selectedTrackingConfig.p2Count}</small></div><div><span>当前结果</span><strong>{resultCounts.passed}成功 · {resultCounts.failed}失败 · {resultCounts.pending}未执行</strong><small>未执行不算漏打；执行后未收到才算失败</small></div></section>
        <section className="metric-grid six"><Metric label="需要验证" value={String(selectedTrackingConfig.selectedCount)} note={`来自 ${selectedTrackingConfig.snapshotId}`} /><Metric label="成功" value={String(resultCounts.passed)} note="事件、参数、链路均通过" tone="good" /><Metric label="失败" value={String(resultCounts.failed)} note="需按操作指引复测" tone="bad" /><Metric label="未执行" value={String(resultCounts.pending)} note="先完成对应产品操作" /><Metric label="事件通过率" value={`${((resultCounts.passed / Math.max(selectedTrackingConfig.selectedCount, 1)) * 100).toFixed(1)}%`} note="P0要求100%" tone={resultCounts.failed ? "bad" : "good"} /><Metric label="发布门禁" value={resultCounts.failed ? "BLOCKED" : "PASSED"} note={resultCounts.failed ? "存在失败事件" : "可以发布"} tone={resultCounts.failed ? "bad" : "good"} /></section>

        <section className="surface"><div className="surface-title"><div><h2>操作任务</h2><p>按事件分类汇总为测试人员能执行的页面任务；完成操作后系统自动检测关联事件。</p></div><Badge tone="blue">{capabilityTasks.length} 个操作分类</Badge></div><div className="test-task-list">{capabilityTasks.map((task) => <article key={task.capability} className={`test-task-card ${task.status === "异常" ? "failed" : task.status === "待操作" ? "pending" : "passed"}`}><header><div><Badge tone={task.status === "异常" ? "bad" : task.status === "待操作" ? "warn" : "good"}>{task.status}</Badge><strong>{task.capability}测试</strong></div><span>{task.passed}/{task.events.length} 通过</span></header><dl><div><dt>操作页面</dt><dd>{task.guide?.page}</dd></div><div><dt>需要做什么</dt><dd>{task.guide?.operation}</dd></div><div><dt>建议点击</dt><dd>{task.guide?.clickTarget}</dd></div><div><dt>预期结果</dt><dd>{task.guide?.expectedResult}</dd></div></dl><footer><button className="secondary-button" onClick={() => { setSelectedTestCapability(task.capability); setTrackingResultFilter("all"); }}>查看 {task.events.length} 个事件</button><button className="primary-button" onClick={() => notify(`${task.capability}操作已标记执行，正在等待Firebase事件`)}>{task.status === "待操作" ? "开始并标记已执行" : "重新检测"}</button></footer></article>)}</div></section>

        <section className="surface"><div className="surface-title"><div><h2>事件接收结果</h2><p>逐项对照所选配置中的事件；可按分类和结论筛选。</p></div><select className="compact-select" value={selectedTestCapability} onChange={(event) => setSelectedTestCapability(event.target.value)}><option value="all">全部分类</option>{capabilityTasks.map((task) => <option key={task.capability}>{task.capability}</option>)}</select></div><div className="event-result-tabs">{[["all",`全部 ${expectedResults.length}`],["passed",`成功 ${resultCounts.passed}`],["failed",`失败 ${resultCounts.failed}`],["pending",`未执行 ${resultCounts.pending}`]].map(([key,label]) => <button key={key} className={trackingResultFilter === key ? "active" : ""} onClick={() => setTrackingResultFilter(key as TrackingResultFilter)}>{label}</button>)}</div><div className="table-wrap event-result-table"><table><thead><tr><th>事件</th><th>分类 / 页面</th><th>优先级</th><th>接收</th><th>参数</th><th>关联链</th><th>结论</th><th>操作</th></tr></thead><tbody>{visibleExpectedResults.map(({ event, conclusion }) => <tr key={event.id} className={conclusion === "PASSED" ? "" : "row-warn"}><td><strong>{event.name}</strong><small>{event.id}</small></td><td><strong>{event.capability}</strong><small>{event.page}</small></td><td><Badge tone={event.priority === "P0" ? "bad" : event.priority === "P1" ? "warn" : "neutral"}>{event.priority}</Badge></td><td>{conclusion === "NOT_RECEIVED" ? "0/1" : conclusion === "SCENE_NOT_EXECUTED" ? "待操作" : "1/1"}</td><td>{conclusion === "PARAM_INVALID" ? "错误" : conclusion === "SCENE_NOT_EXECUTED" || conclusion === "NOT_RECEIVED" ? "—" : "通过"}</td><td>{conclusion === "CHAIN_INVALID" ? "错误" : conclusion === "SCENE_NOT_EXECUTED" || conclusion === "NOT_RECEIVED" ? "—" : "通过"}</td><td><Badge tone={conclusion === "PASSED" ? "good" : conclusion === "SCENE_NOT_EXECUTED" ? "neutral" : "bad"}>{conclusion}</Badge></td><td><button className="text-button" onClick={() => { setSelectedTestCapability(event.capability); setTrackingResultFilter(conclusion === "PASSED" ? "passed" : conclusion === "SCENE_NOT_EXECUTED" ? "pending" : "failed"); }}>查看指引</button></td></tr>)}</tbody></table></div></section>

        {(resultCounts.failed > 0 || resultCounts.pending > 0) && <section className="surface"><div className="surface-title"><div><h2>失败与未执行操作指引</h2><p>失败项告诉测试人员“在哪里操作、点哪里、应该收到什么”；未执行项不计作漏打。</p></div><button className="primary-button" onClick={() => openDialog("retest-run")}>发起失败项重测</button></div><div className="failure-guidance">{expectedResults.filter((item) => item.conclusion !== "PASSED").map(({ event, conclusion }) => <article key={event.id}><div className="failure-title"><Badge tone={conclusion === "SCENE_NOT_EXECUTED" ? "warn" : "bad"}>{conclusion}</Badge><strong>{event.name}</strong><span>{event.capability} · {event.priority}</span></div><div className="failure-reason"><strong>{conclusion === "SCENE_NOT_EXECUTED" ? "尚未执行产品操作" : conclusion === "NOT_RECEIVED" ? "已执行操作，但Firebase未收到事件" : conclusion === "PARAM_INVALID" ? "事件已收到，但必填参数不合规" : "事件已收到，但Context关联链不完整"}</strong><p>{conclusion === "SCENE_NOT_EXECUTED" ? "先按下方路径操作，再开始等待事件；当前不计入漏打。" : "按下方路径重新操作并检测；仍失败时交给对应客户端模块负责人。"}</p></div><dl><div><dt>在哪里操作</dt><dd>{event.page}</dd></div><div><dt>执行什么</dt><dd>{event.operation}</dd></div><div><dt>建议点击哪里</dt><dd>{event.clickTarget}</dd></div><div><dt>完成后应收到</dt><dd><code>{event.name}</code> · {event.expectedResult}</dd></div></dl><footer><button onClick={() => notify(`${event.name} 已标记场景执行，等待事件上报`)}>标记操作已执行</button><button onClick={() => notify(`${event.name} 已重新检测，最近30秒暂无新事件`)}>重新检测</button></footer></article>)}</div></section>}
      </> : <section className="surface empty-table-state"><strong>当前产品没有已发布的打点配置</strong><span>请先在“规范与项目配置”中关联项目、选择事件并发布配置快照。</span><button className="primary-button" onClick={() => openModule("config")}>去配置</button></section>}
    </div>
  );

  if (module === "config") return (
    <div className="page-stack">
      <section className="config-head surface"><div><div className="eyebrow">事件主库 → 分类勾选/单点剔除 → 配置 → 发布快照 → 验收Run</div><h2>打点配置管理</h2><p>按 V1.7 事件总表的全部标准事件组装配置；可整模块选择，也可取消任一单事件。</p></div><div><Badge tone="blue">44 个事件 · 209 条字段</Badge><button className="primary-button" onClick={() => openConfigEditor(null)}>＋ 新建打点配置</button></div></section>
      <section className="surface"><div className="surface-title"><div><h2>配置版本</h2><p>草稿可原地编辑；发布后生成不可变 snapshot_id，修改已发布配置时会复制为新版本。</p></div><Badge tone="neutral">共 {configs.length} 个版本</Badge></div><div className="table-wrap"><table><thead><tr><th>配置名称 / ID</th><th>版本</th><th>品类</th><th>关联项目</th><th>已选 / 全量</th><th>P0 / P1 / P2</th><th>场景</th><th>状态</th><th>快照</th><th>操作</th></tr></thead><tbody>{configs.map((config) => <tr key={config.id} className={`clickable-row ${selectedConfigRecord.id === config.id ? "row-selected" : ""}`} onClick={() => setSelectedConfigId(config.id)}><td><strong>{config.name}</strong><small>{config.id}</small></td><td>{config.version}</td><td>{config.category}</td><td>{config.projects.join("、")}</td><td><strong>{config.selectedCount} / {config.totalCount}</strong><small>配置覆盖 {((config.selectedCount / Math.max(config.totalCount, 1)) * 100).toFixed(1)}%</small></td><td>{config.p0Count} / {config.p1Count} / {config.p2Count}</td><td>{config.sceneCount}</td><td><Badge tone={config.status === "PUBLISHED" ? "good" : config.status === "REVIEWING" ? "blue" : "warn"}>{config.status === "PUBLISHED" ? "已发布" : config.status === "REVIEWING" ? "评审中" : "草稿"}</Badge></td><td>{config.snapshotId ? <strong>{config.snapshotId}</strong> : "—"}</td><td><div className="row-actions"><button onClick={(event) => { event.stopPropagation(); openConfigEditor(config); }}>{config.status === "PUBLISHED" ? "复制为新版本" : "编辑草稿"}</button>{config.status === "DRAFT" && <button onClick={(event) => { event.stopPropagation(); openConfigEditor(config); }}>编辑并发布</button>}<button onClick={(event) => { event.stopPropagation(); notify(`${config.id} 详情已展开`); }}>详情</button></div></td></tr>)}</tbody></table></div></section>
      <section className="selected-config-summary surface"><div><span>当前查看</span><strong>{selectedConfigRecord.name} {selectedConfigRecord.version}</strong><small>{selectedConfigRecord.id}</small></div><div><span>事件范围</span><strong>{selectedConfigRecord.selectedCount}/{selectedConfigRecord.totalCount}</strong><small>仅这 {selectedConfigRecord.selectedCount} 个进入验收分母</small></div><div><span>优先级</span><strong>P0 {selectedConfigRecord.p0Count} · P1 {selectedConfigRecord.p1Count} · P2 {selectedConfigRecord.p2Count}</strong><small>P0必须100%</small></div><div><span>发布引用</span><strong>{selectedConfigRecord.snapshotId ?? "尚未生成"}</strong><small>{selectedConfigRecord.status === "PUBLISHED" ? "可用于新建验收Run" : "发布后才可用于测试"}</small></div></section>
      <section className="config-layout"><div className="surface"><div className="surface-title"><div><h2>项目主品类</h2><p>作为配置筛选模板，不直接决定验收分母</p></div><button className="text-button" onClick={() => openDialog("project-category")}>＋新增</button></div><div className="category-list">{[["套利 VPN","v1.7 · 14项目","连接、权限、服务器、协议、连接广告"],["清理","v1.5 · 8项目","扫描、清理、结果、大小、清理广告"],["Launcher","v1.3 · 6项目","引导、默认桌面、主题、桌面交互"]].map((row)=><button key={row[0]} className={selectedCategory===row[0]?"selected":""} onClick={()=>setSelectedCategory(row[0])}><strong>{row[0]}</strong><span>{row[1]}</span><small>{row[2]}</small></button>)}</div></div><div className="surface"><div className="surface-title"><div><h2>{selectedConfigRecord.name} · 范围组成</h2><p>配置最终范围来自人工选择，并保留能力包来源</p></div><Badge tone="blue">{selectedConfigRecord.selectedCount}事件</Badge></div><div className="resolution-list"><div><span>标准事件总表</span><strong>V1.7 全量可选事件</strong><em>{selectedConfigRecord.totalCount}</em></div><div><span>当前已选</span><strong>{selectedConfigRecord.category} 当前版本</strong><em>{selectedConfigRecord.selectedCount}</em></div><div><span>当前未选</span><strong>本版本不适用事件</strong><em>{selectedConfigRecord.totalCount - selectedConfigRecord.selectedCount}</em></div><div><span>事件字段</span><strong>随所选事件自动纳入</strong><em>{trackingEventCatalog.filter((event) => selectedConfigRecord.selectedEventIds?.includes(event.id)).reduce((sum, event) => sum + event.parameterCount, 0)}</em></div></div><div className="conclusion-block good"><strong>最终选择 {selectedConfigRecord.selectedCount}/{selectedConfigRecord.totalCount}</strong><p>品类只提供推荐；最终以配置中逐项勾选并发布的事件快照为准。</p></div></div><aside className="surface"><div className="surface-title"><div><h2>发布检查</h2><p>规则完整性</p></div></div><div className="publish-checks"><div><span>✓</span><p>已选择{selectedConfigRecord.selectedCount}个事件并完成优先级</p></div><div><span>✓</span><p>{selectedConfigRecord.sceneCount}个场景均绑定应测事件</p></div><div><span>✓</span><p>P0参数和关联链已配置</p></div><div><span>{selectedConfigRecord.status === "PUBLISHED" ? "✓" : "!"}</span><p>{selectedConfigRecord.status === "PUBLISHED" ? `已生成快照 ${selectedConfigRecord.snapshotId}` : "尚未发布，不能创建验收Run"}</p></div></div><button className="primary-button full" onClick={() => selectedConfigRecord.status === "PUBLISHED" ? notify(`${selectedConfigRecord.snapshotId} 为只读快照`) : openConfigEditor(selectedConfigRecord)}>{selectedConfigRecord.status === "PUBLISHED" ? "查看发布快照" : "继续编辑并发布"}</button></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>事件与字段包</h2><p>切换查看事件、字段、枚举和Provider，不再使用静态页签</p></div><div className="dimension-tabs">{[["events","事件"],["fields","公共字段"],["enums","枚举"],["providers","Provider"]].map(([key,label])=><button key={key} className={configPackageTab===key?"active":""} onClick={()=>setConfigPackageTab(key as ConfigPackageTab)}>{label}</button>)}</div></div><div className="table-wrap"><table><thead><tr>{configTables[configPackageTab].headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{configTables[configPackageTab].rows.map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{(cell==="P0"||cell==="条件P0")?<Badge tone="bad">{cell}</Badge>:(["已发布","正常"].includes(cell))?<Badge tone="good">{cell}</Badge>:cell==="预警"?<Badge tone="warn">{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></section>
      <FirebaseConfiguration openDialog={openDialog} />
    </div>
  );

  return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="今日任务" value="186" note="成功 179" /><Metric label="运行中" value="4" note="最长 8分钟" /><Metric label="失败任务" value="3" note="需立即处理" tone="bad" /><Metric label="数据延迟" value="9分钟" note="SLA ≤15分钟" tone="good" /><Metric label="活动告警" value="7" note="P0 2 · P1 5" tone="bad" /><Metric label="今日恢复" value="12" note="自动恢复 9" tone="good" /></section>
      <section className="surface"><div className="surface-title"><div><h2>数据流水线任务</h2><p>Firebase → OSS → ADB → 聚合 → 对账</p></div><div className="dimension-tabs"><button className={taskFilter==="all"?"active":""} onClick={()=>setTaskFilter("all")}>全部</button><button className={taskFilter==="failed"?"active":""} onClick={()=>setTaskFilter("failed")}>失败</button><button className={taskFilter==="running"?"active":""} onClick={()=>setTaskFilter("running")}>运行中</button></div></div><div className="table-wrap"><table><thead><tr><th>任务</th><th>项目</th><th>批次/水位</th><th>开始时间</th><th>耗时</th><th>处理量</th><th>SLA</th><th>状态</th><th>操作</th></tr></thead><tbody>{taskRows.map(row => <tr key={`${row.name}${row.project}`}><td>{row.name}</td><td>{row.project}</td><td>{row.batch}</td><td>{row.start}</td><td>{row.duration}</td><td>{row.volume}</td><td>{row.sla}</td><td><Badge tone={row.status==="成功"?"good":row.status==="运行中"?"blue":"bad"}>{row.status}</Badge></td><td><button className="table-link" onClick={()=>notify(row.status==="失败"?`${row.name} 已创建重试批次`:`${row.name} 日志已打开`)}>{row.status==="失败"?"重试":"日志"}</button></td></tr>)}</tbody></table></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>活动告警</h2><p>指标告警与数据任务告警统一管理</p></div><button className="text-button" onClick={() => openDialog("alert-rule")}>告警规则</button></div><div className="alert-list">{[["P0","IRAN-VPN-01 广告浏览者比例低于25%","持续3小时 · 影响$2,807/日","产品/广告/客户端"],["P0","CLEAN-MAX-03 中台DAU差异8.7%","持续42分钟 · 接口失败率9.1%","数据平台"],["P1","ADB标准化任务延迟接近SLA","已运行8分钟 · 阈值15分钟","数据平台"],["P1","jk_ad_impression 关联链完整率97.8%","缺opportunity_id 1,824条","客户端增长组"]].map(row => <button key={row[1]} onClick={() => row[1].includes("浏览者") ? openModule("funnel") : row[1].includes("DAU") ? openModule("reconcile") : notify("告警详情已展开")}><Badge tone={row[0]==="P0"?"bad":"warn"}>{row[0]}</Badge><div><strong>{row[1]}</strong><p>{row[2]}</p><small>负责人：{row[3]}</small></div><span>→</span></button>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>告警通知</h2><p>当前值班策略</p></div></div><div className="notification-rules"><div><span>P0</span><strong>立即通知</strong><p>飞书群＋负责人＋值班人</p></div><div><span>P1</span><strong>持续15分钟</strong><p>飞书群＋负责人</p></div><div><span>P2</span><strong>每日汇总</strong><p>数据质量日报</p></div></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>＋ 新建告警规则</button></aside></section>
    </div>
  );
}

function LegacyActionDialog({ dialog, project, onClose, onSubmit }: { dialog: Exclude<DialogKey, "firebase-connection" | "firebase-binding">; project: string; onClose: () => void; onSubmit: (message: string) => void }) {
  const meta: Record<Exclude<DialogKey, "firebase-connection" | "firebase-binding">, { title: string; description: string; submit: string }> = {
    "project-report": { title: "导出项目日报", description: "选择范围、指标和接收方式", submit: "创建导出任务" },
    diagnosis: { title: "新建诊断任务", description: "将异常指标、范围和负责人写入诊断闭环", submit: "创建诊断任务" },
    "admob-report": { title: "导出 AdMob 报表", description: "按结算日期和广告维度生成报表", submit: "创建导出任务" },
    "version-diff-report": { title: "导出版本差异", description: "选择对比版本和导出范围", submit: "创建导出任务" },
    "event-dictionary": { title: "Firebase 事件字典", description: "查看已发布事件、优先级和参数数量", submit: "关闭" },
    "reconcile-run": { title: "发起重新对账", description: "重新计算指定日期和指标的数据差异", submit: "开始重新对账" },
    "tracking-run": { title: "新建验收 Run", description: "冻结项目、品类、版本和设备测试快照", submit: "创建并开始验收" },
    "retest-run": { title: "发起失败项重测", description: "继承原快照，只重新验证失败事件和关联链", submit: "创建重测 Run" },
    "config-version": { title: "新建配置版本", description: "基于当前 V1.7 创建可编辑草稿", submit: "创建版本草稿" },
    "project-category": { title: "新增项目主品类", description: "定义品类范围、能力包和默认漏斗", submit: "创建主品类" },
    "publish-approval": { title: "提交发布审批", description: "确认版本范围、审批人和发布计划", submit: "提交审批" },
    "alert-rule": { title: "新建告警规则", description: "配置指标、阈值、持续时间和通知范围", submit: "创建告警规则" },
  };
  const current = meta[dialog];
  const isDictionary = dialog === "event-dictionary";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isDictionary) return onClose();
    onSubmit(`${current.title}已提交`);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title">
        <header><div><h2 id="action-dialog-title">{current.title}</h2><p>{current.description}</p></div><button type="button" aria-label="关闭弹窗" onClick={onClose}>×</button></header>
        <form onSubmit={submit}>
          <div className="modal-body">
            {dialog === "diagnosis" && <div className="modal-form-grid"><label>项目<select defaultValue={project}><option>{project}</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></label><label>优先级<select><option>P0</option><option>P1</option><option>P2</option></select></label><label className="span-2">任务名称<input defaultValue="Opportunity 覆盖率异常诊断" /></label><label>异常指标<select><option>Opportunity覆盖率</option><option>广告浏览者比例</option><option>收入</option></select></label><label>负责人<select><option>Oliver / 客户端增长组</option><option>数据平台</option><option>广告变现组</option></select></label><label className="span-2">诊断范围<input defaultValue="伊朗 · Android 1.8.0 · Eligible → Opportunity" /></label><label className="span-2">问题说明<textarea defaultValue="广告浏览者比例下降，但AdMob匹配率与展示率正常，优先排查请求前用户覆盖。" /></label></div>}
            {(dialog === "project-report" || dialog === "admob-report") && <div className="modal-form-grid"><label>项目范围<select><option>全部项目</option><option>{project}</option><option>VPN增长组</option></select></label><label>日期范围<select><option>昨天</option><option>近7天</option><option>近30天</option><option>自定义</option></select></label><label>报表粒度<select><option>项目 × 日期</option><option>项目 × 国家</option><option>项目 × 广告位</option></select></label><label>文件格式<select><option>Excel (.xlsx)</option><option>CSV</option></select></label><label className="span-2">包含指标<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> DAU/AV</span><span><input type="checkbox" defaultChecked /> 请求/展示</span><span><input type="checkbox" defaultChecked /> 收入/eCPM</span><span><input type="checkbox" defaultChecked /> ROAS/利润</span></div></label><label className="span-2">接收方式<select><option>完成后在任务中心下载</option><option>同时发送飞书通知</option></select></label></div>}
            {dialog === "version-diff-report" && <div className="modal-form-grid"><label>基准版本<select><option>V1.6</option><option>V1.5</option></select></label><label>目标版本<select><option>V1.7（当前执行权威）</option></select></label><label className="span-2">导出内容<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 新增事件/字段</span><span><input type="checkbox" defaultChecked /> 规则调整</span><span><input type="checkbox" defaultChecked /> 删除与废弃</span><span><input type="checkbox" defaultChecked /> 影响项目</span></div></label><label>文件格式<select><option>Excel (.xlsx)</option><option>PDF</option></select></label><label>完成通知<select><option>任务中心＋飞书通知</option><option>仅任务中心</option></select></label></div>}
            {dialog === "event-dictionary" && <div className="dictionary-dialog"><div className="dictionary-search"><input placeholder="搜索事件名、业务阶段或参数" /><select><option>全部优先级</option><option>P0</option><option>P1</option><option>P2</option></select></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>阶段</th><th>优先级</th><th>参数数</th><th>版本</th></tr></thead><tbody>{[["jk_ad_request","广告请求","P0","13","V1.7"],["jk_ad_impression","广告展示","P0","11","V1.7"],["connect_success","VPN连接","P0","10","V1.7"],["app_background","生命周期","P1","8","V1.6"],["jk_ad_paid_event","收入回调","条件P0","9","V1.7"]].map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{index===2?<Badge tone={cell.includes("P0")?"bad":"warn"}>{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></div>}
            {dialog === "reconcile-run" && <div className="modal-form-grid"><label>项目<select><option>{project}</option><option>全部异常项目</option><option>全部项目</option></select></label><label>对账日期<select><option>2026-08-08（AdMob已结算）</option><option>2026-08-07</option><option>今天（仅Firebase/中台）</option></select></label><label className="span-2">指标<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> DAU</span><span><input type="checkbox" defaultChecked /> AV</span><span><input type="checkbox" defaultChecked /> Impression</span><span><input type="checkbox" defaultChecked /> Revenue</span></div></label><label>覆盖旧结果<select><option>保留历史并生成新批次</option><option>覆盖当前结果</option></select></label><label>完成通知<select><option>飞书通知负责人</option><option>仅任务中心</option></select></label><div className="modal-warning span-2"><strong>预计影响</strong><p>将重新读取 Firebase、AdMob 与 ADB 事实表，预计耗时 8–15 分钟。</p></div></div>}
            {(dialog === "tracking-run" || dialog === "retest-run") && <div className="modal-form-grid"><label>项目<select><option>{project}</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></label><label>项目品类<select><option>套利 VPN</option><option>清理</option><option>Launcher</option></select></label><label>App版本<input defaultValue="1.8.1 (109)" /></label><label>平台<select><option>Android</option><option>iOS</option></select></label><label>测试设备<select><option>Pixel 8 · Android 15</option><option>Samsung S23 · Android 14</option></select></label><label>环境<select><option>Production Test</option><option>Staging</option></select></label><label className="span-2">测试范围<select><option>{dialog === "retest-run" ? "继承 RUN-20260811-IRAN-001 的 3 个失败项" : "公共基础包＋VPN＋广告＋订阅（46事件）"}</option></select></label><div className="snapshot-preview span-2"><span>即将冻结快照</span><strong>规范 V1.7 · P0事件31个 · P0参数100%门禁</strong></div></div>}
            {dialog === "config-version" && <div className="modal-form-grid"><label>基础版本<select><option>V1.7（当前执行权威）</option><option>V1.6</option></select></label><label>新版本号<input defaultValue="V1.8" /></label><label className="span-2">版本名称<input defaultValue="跨团队埋点规范 V1.8" /></label><label>负责人<select><option>数据产品 / Oliver</option><option>客户端架构组</option></select></label><label>计划发布时间<input type="date" defaultValue="2026-08-18" /></label><label className="span-2">变更目标<textarea placeholder="说明本版本准备解决的问题" /></label><div className="modal-warning span-2"><strong>创建规则</strong><p>新版本默认为草稿，不影响当前已发布 V1.7；发布时仍需产品与数据负责人审批。</p></div></div>}
            {dialog === "project-category" && <div className="modal-form-grid"><label className="span-2">品类名称<input placeholder="例如：文件管理" required /></label><label>品类代号<input placeholder="file_manager" required /></label><label>负责人<select><option>产品平台组</option><option>VPN增长组</option><option>清理产品组</option></select></label><label className="span-2">默认能力包<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 公共基础</span><span><input type="checkbox" defaultChecked /> 广告</span><span><input type="checkbox" /> 订阅</span><span><input type="checkbox" /> 归因</span></div></label><label className="span-2">品类说明<textarea placeholder="描述核心业务阶段和适用项目" /></label></div>}
            {dialog === "publish-approval" && <div className="modal-form-grid"><label>发布版本<select><option>V1.8 草稿</option><option>V1.7 当前版本</option></select></label><label>计划发布时间<input type="datetime-local" defaultValue="2026-08-18T10:00" /></label><label>产品审批人<select><option>Oliver / 数据产品</option><option>产品平台负责人</option></select></label><label>技术审批人<select><option>客户端架构组</option><option>数据平台负责人</option></select></label><label className="span-2">发布说明<textarea defaultValue="完成事件、参数、Provider 与验收门禁检查后发布。" /></label><div className="modal-warning span-2"><strong>发布前仍有 1 项提醒</strong><p>订阅 Provider 有 1 个 P1 未配置。可提交审批，但审批人需明确接受该风险。</p></div></div>}
            {dialog === "alert-rule" && <div className="modal-form-grid"><label className="span-2">规则名称<input defaultValue="广告浏览者比例低于目标" required /></label><label>监控项目<select><option>{project}</option><option>全部VPN项目</option><option>全部项目</option></select></label><label>监控指标<select><option>广告浏览者比例</option><option>Opportunity覆盖率</option><option>DAU对账差异</option><option>任务延迟</option></select></label><label>判断条件<select><option>低于</option><option>高于</option><option>环比下降超过</option></select></label><label>阈值<input defaultValue="25%" /></label><label>持续时间<select><option>15分钟</option><option>30分钟</option><option>1小时</option></select></label><label>告警等级<select><option>P0</option><option>P1</option><option>P2</option></select></label><label className="span-2">通知范围<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 飞书项目群</span><span><input type="checkbox" defaultChecked /> 项目负责人</span><span><input type="checkbox" /> 数据值班人</span><span><input type="checkbox" /> 邮件</span></div></label></div>}
          </div>
          <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{current.submit}</button></footer>
        </form>
      </section>
    </div>
  );
}

export default function Home() {
  const [module, setModule] = useState<ModuleKey>("funnel");
  const [page, setPage] = useState<PageKey>("overview");
  const [embedded, setEmbedded] = useState(false);
  const [project, setProject] = useState("IRAN-VPN-01");
  const [range, setRange] = useState("今天");
  const [platform, setPlatform] = useState("Android");
  const [country, setCountry] = useState("全部国家");
  const [appVersion, setAppVersion] = useState("1.8.0 (108)");
  const [funnelMode, setFunnelMode] = useState<FunnelMode>("monetization");
  const [unitMode, setUnitMode] = useState<UnitMode>("users");
  const [dimension, setDimension] = useState("国家");
  const [selectedEvent, setSelectedEvent] = useState(7);
  const [evidenceMode, setEvidenceMode] = useState("ad");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [issueStatus, setIssueStatus] = useState("修复中");
  const [notice, setNotice] = useState("");
  const [baseline, setBaseline] = useState("近7日均值");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("viewer");
  const [transition, setTransition] = useState<TransitionSelection>({ from: "Eligible", to: "Opportunity", rate: "43.9%", scope: "users" });
  const [filtersApplied, setFiltersApplied] = useState(0);
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [configRecords, setConfigRecords] = useState<TrackingConfigRecord[]>(trackingConfigs);
  const [editingConfig, setEditingConfig] = useState<TrackingConfigRecord | null>(null);
  const [configWorkspaceOpen, setConfigWorkspaceOpen] = useState(false);

  useEffect(() => {
    if (!dialog) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setDialog(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialog]);

  useEffect(() => {
    const initialAnalysisView = readInitialAnalysisView();
    setModule(initialAnalysisView.module);
    setPage(initialAnalysisView.page);
    setEmbedded(initialAnalysisView.embedded);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("module", module);
    if (module === "funnel") {
      url.searchParams.set("page", page);
    } else {
      url.searchParams.delete("page");
    }
    if (embedded) url.searchParams.set("embedded", "1");
    window.history.replaceState({}, "", url);
  }, [embedded, module, page]);

  const activeProfile = projectFunnelProfiles[project] ?? projectFunnelProfiles["IRAN-VPN-01"];
  const stages = useMemo(() => {
    if (funnelMode === "product") return productStages;
    return unitMode === "users" ? activeProfile.userStages : monetizationEventStages;
  }, [funnelMode, unitMode, activeProfile]);

  const currentPage = pages.find((item) => item.key === page)!;
  const currentModule = moduleCopy[module];
  const visibleEvents = eventRows
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !onlyErrors || event.result !== "有效");
  const issuePhase = issueStatus === "重测中" ? 3 : 2;
  const trendValues = trendMetric === "viewer" ? activeProfile.viewerTrend : activeProfile.opportunityTrend;
  const trendLabel = trendMetric === "viewer" ? "广告浏览者比例" : "Opportunity机会覆盖率";
  const isFulfillmentDiagnosis = transition.from === "Opportunity" && transition.to === "Show Attempt";
  const diagnosisReasons = isFulfillmentDiagnosis ? fulfillmentReasons : reasons;
  const transitionStages = funnelMode === "product" ? productStages : transition.scope === "events" ? monetizationEventStages : activeProfile.userStages;
  const fromStage = transitionStages.find((stage) => stage.label === transition.from);
  const toStage = transitionStages.find((stage) => stage.label === transition.to);
  const transitionLoss = fromStage && toStage
    ? Math.max(0, Number(fromStage.value.replaceAll(",", "")) - Number(toStage.value.replaceAll(",", ""))).toLocaleString()
    : "—";
  const sourceStatus: Record<ModuleKey, { title: string; detail: string; note: string }> = {
    global: { title: "混合时效", detail: "Firebase T+0 · AdMob T+3 · 刷新", note: "DAU和用户行为使用Firebase实时预估；收入、消耗和ROAS使用最近已结算日期，卡片必须标注数据日。" },
    project: { title: "项目诊断", detail: "Firebase延迟约8分钟 · AdMob T+3", note: "用户与产品指标可看当天；收入和AdMob效率使用已结算日期，不参与当天实时结论。" },
    funnel: { title: "实时预估", detail: "Firebase · 延迟约8分钟", note: "用户漏斗与事件漏斗来自Firebase实时数据；收入影响为模型估算，最终以AdMob结算为准。" },
    admob: { title: "结算数据", detail: "AdMob已结算至8月8日", note: "本页默认只展示AdMob已结算日期；Firebase AV仅作为覆盖诊断对照，并明确标记来源。" },
    firebase: { title: "实时数据", detail: "BigQuery intraday · 延迟约8分钟", note: "本页展示Firebase实时预估、事件质量与同步水位；中台数字仅用于差异诊断。" },
    reconcile: { title: "分源对账", detail: "今日双源 · T+3全量", note: "当天只比较Firebase与中台；含AdMob的最终对账仅在结算日期执行，避免跨时效误报。" },
    tracking: { title: "实时采集", detail: "当前Run · 按已发布配置快照验收", note: "仅按Run引用的已发布配置快照判定；未执行场景不计为未收到，P0事件、参数与关联链必须达到100%。" },
    config: { title: "配置数据", detail: `${trackingEventCatalog.length}个标准事件 · 209条字段明细`, note: "品类与能力包只负责推荐候选事件；最终验收范围以配置逐项选择并发布的不可变快照为准。" },
    tasks: { title: "任务实时态", detail: "最近水位15:35 · SLA监控", note: "本页按任务状态和项目过滤，数据日期表示任务处理批次，不等同于经营报表日期。" },
  };

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function go(next: PageKey) {
    setModule("funnel");
    setPage(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModule(next: ModuleKey) {
    setConfigWorkspaceOpen(false);
    setEditingConfig(null);
    setModule(next);
    if (next === "funnel") setPage("overview");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openConfigEditor(config: TrackingConfigRecord | null) {
    setEditingConfig(config);
    setConfigWorkspaceOpen(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveTrackingConfig(submission: TrackingConfigSubmission, action: "draft" | "publish") {
    const selectedEvents = trackingEventCatalog.filter((event) => submission.selectedEventIds.includes(event.id));
    const editingDraft = editingConfig?.status === "DRAFT";
    const categoryCode = submission.category === "清理" ? "CLEAN" : submission.category === "Launcher" ? "LAUNCHER" : "VPN";
    const sequence = String(configRecords.length + 1).padStart(3, "0");
    const id = editingDraft ? editingConfig.id : `CFG-${categoryCode}-${submission.version.replace(/^V/, "")}-${sequence}`;
    const snapshotId = action === "publish" ? `SNP-${categoryCode}-${submission.version.replace(/\D/g, "")}-${sequence}` : undefined;
    const record: TrackingConfigRecord = {
      id,
      name: submission.name,
      version: submission.version,
      category: submission.category,
      projects: submission.projects,
      platform: submission.platform,
      selectedCount: selectedEvents.length,
      totalCount: trackingEventCatalog.length,
      p0Count: selectedEvents.filter((event) => event.priority === "P0").length,
      p1Count: selectedEvents.filter((event) => event.priority === "P1").length,
      p2Count: selectedEvents.filter((event) => event.priority === "P2").length,
      sceneCount: new Set(selectedEvents.map((event) => event.scene)).size,
      selectedEventIds: submission.selectedEventIds,
      status: action === "publish" ? "PUBLISHED" : "DRAFT",
      snapshotId,
      updatedBy: "Oliver",
      updatedAt: "刚刚",
    };
    setConfigRecords((records) => editingDraft ? records.map((item) => item.id === editingConfig.id ? record : item) : [record, ...records]);
    setConfigWorkspaceOpen(false);
    setEditingConfig(null);
    notify(action === "publish" ? `配置已发布并生成快照 ${snapshotId}` : `草稿 ${id} 已保存`);
  }

  function resetFilters() {
    setProject("IRAN-VPN-01");
    setRange("今天");
    setPlatform("Android");
    setCountry("全部国家");
    setAppVersion("1.8.0 (108)");
    setFiltersApplied((value) => value + 1);
    notify("筛选条件已恢复默认");
  }

  function openTransition(from: FunnelStage, to: FunnelStage) {
    setTransition({ from: from.label, to: to.label, rate: to.rate, scope: unitMode });
    go("diagnosis");
  }

  return (
    <div className={`app-shell ${embedded ? "embedded" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">JK</span><span><strong>变现与埋点</strong><small>质量分析中心 · V12</small></span></div>
        <div className="nav-group-label">经营分析</div>
        {moduleMenus.filter((item) => item.group === "经营分析").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="nav-group-label">质量治理</div>
        {moduleMenus.filter((item) => item.group === "质量治理").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="sidebar-foot"><span className="status-dot" />Firebase 实时数据正常<small>AdMob 已结算至 8月8日</small></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">{moduleMenus.find((item) => item.key === module)?.group} / {currentModule.title}{configWorkspaceOpen ? <> / <strong>{editingConfig ? "编辑打点配置" : "新建打点配置"}</strong></> : module === "funnel" && <> / <strong>{currentPage.label}</strong></>}</div>
          <div className="topbar-actions"><div className="global-search">搜索项目、事件、问题单</div><button className="icon-button" aria-label="通知">3</button><div className="avatar">OL</div></div>
        </header>

        <main className="main-content">
          {configWorkspaceOpen ? <TrackingConfigWorkspace editingConfig={editingConfig} onCancel={() => { setConfigWorkspaceOpen(false); setEditingConfig(null); }} onSave={saveTrackingConfig} /> : <>
          <section className="page-heading">
            <div><h1>{currentModule.title}</h1><p>{currentModule.description}</p></div>
            <div className="heading-actions"><button className="secondary-button" onClick={() => module === "funnel" ? go("snapshot") : notify("数据已刷新至最新水位")}>{module === "funnel" ? "查看口径 V1.7" : "刷新数据"}</button><button className="primary-button" onClick={() => module === "config" ? openConfigEditor(null) : setDialog(moduleDialog[module])}>{["project", "funnel", "tracking", "config", "tasks"].includes(module) ? "＋ " : ""}{currentModule.action}</button></div>
          </section>

          {module === "funnel" && <section className="workflow-strip" aria-label="漏斗诊断流程">
            {[
              ["发现", "多项目总览"], ["定位", "单项目漏斗"], ["拆解", "步骤与分群"], ["取证", "路径与事件"], ["闭环", "修复与验证"],
            ].map(([name, hint], index) => {
              const pageIndex = pages.findIndex((item) => item.key === page);
              const phase = pageIndex === 0 ? 0 : pageIndex === 1 ? 1 : pageIndex <= 3 ? 2 : pageIndex <= 5 ? 3 : 4;
              return <div key={name} className={`workflow-step ${phase === index ? "current" : ""} ${phase > index ? "done" : ""}`}><span>{phase > index ? "✓" : index + 1}</span><div><strong>{name}</strong><small>{hint}</small></div></div>;
            })}
          </section>}

          {module === "funnel" && <nav className="page-nav" aria-label="漏斗分析页面">
            {pages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => go(item.key)}><span>{item.label}</span><small>{item.hint}</small></button>)}
          </nav>}

          <section className="filter-bar">
            <label>项目<select value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
            <label>日期<select value={range} onChange={(event) => setRange(event.target.value)}><option>今天</option><option>昨天</option><option>近7天</option><option>近30天</option></select></label>
            <label>平台<select value={platform} onChange={(event)=>setPlatform(event.target.value)}><option>Android</option><option>iOS</option><option>全部</option></select></label>
            <label>国家<select value={country} onChange={(event)=>setCountry(event.target.value)}><option>全部国家</option><option>伊朗</option><option>埃及</option><option>土耳其</option></select></label>
            <label>App版本<select value={appVersion} onChange={(event)=>setAppVersion(event.target.value)}><option>1.8.0 (108)</option><option>1.7.4 (104)</option><option>全部版本</option></select></label>
            <div className="filter-actions"><button onClick={resetFilters}>重置</button><button onClick={() => { setFiltersApplied((value) => value + 1); notify(`${project} · ${range} 筛选已应用`); }}>应用筛选</button></div>
            <div className="data-state"><span className="status-dot" /><strong>{sourceStatus[module].title}</strong><small>{sourceStatus[module].detail} · 刷新#{filtersApplied}</small></div>
          </section>

          <section className="context-toolbar">
            <div className="context-summary"><Badge tone="blue">{module === "funnel" ? currentPage.hint : currentModule.title}</Badge><span>{project}</span><i /> <span>{range}</span><i /> <span>{platform} · {appVersion}</span><i /> <span>{country}</span><i /> <span>口径 V1.7</span></div>
            <div className="context-actions"><button onClick={() => notify("当前分析视图已保存")}>保存视图</button><button onClick={() => setDialog(module === "admob" ? "admob-report" : "project-report")}>导出报表</button></div>
          </section>
          <section className="freshness-note"><div><strong>数据使用提示：</strong>{sourceStatus[module].note}</div><button onClick={() => module === "funnel" ? go("snapshot") : notify(`${currentModule.title}数据口径说明已展开`)}>查看数据口径</button></section>

          {module !== "funnel" && <ModulePage module={module as Exclude<ModuleKey, "funnel">} project={project} configs={configRecords} onProjectChange={setProject} openModule={openModule} openDialog={setDialog} openConfigEditor={openConfigEditor} notify={notify} />}

          {module === "funnel" && page === "overview" && (
            <div className="page-stack">
              <section className="metric-grid six">
                <Metric label="全项目 DAU" value="397,380" note="较昨日 +3.2%" />
                <Metric label="广告浏览人数 AV" value="116,842" note="较昨日 -4.7%" tone="bad" />
                <Metric label="广告浏览者比例" value="29.4%" note="目标 ≥ 35%" tone="bad" />
                <Metric label="Opportunity 覆盖率" value="34.8%" note="较基线 -6.1pp" tone="bad" />
                <Metric label="人均展示次数" value="3.42" note="Impression / AV" />
                <Metric label="预估收入" value="$13,901" note="ARPDAU $0.035" tone="good" />
              </section>

              <section className="signal-strip">
                <div className="signal-item bad"><span>用户覆盖异常</span><strong>AV / DAU 29.4%</strong><p>主要问题在广告请求之前，优先看 Eligible 与 Opportunity 覆盖。</p></div>
                <div className="signal-item good"><span>机会履约分支</span><strong>Show Attempt / Opportunity 89.7%</strong><p>缓存命中与实时请求合并判断，预加载请求不进入主漏斗。</p></div>
                <div className="signal-item warn"><span>展示集中</span><strong>Impression / AV 3.42</strong><p>少数用户承担较多展示，需同时控制频次与扩大覆盖。</p></div>
                <button onClick={() => go("workbench")}>查看完整判断依据 →</button>
              </section>

              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>项目漏斗健康度</h2><p>同时关注用户覆盖和请求后的事件转化</p></div><div className="legend"><span className="dot bad" />严重 <span className="dot warn" />预警 <span className="dot good" />正常</div></div>
                  <div className="table-wrap"><table><thead><tr><th>项目</th><th>品类</th><th>DAU</th><th>产品完成率</th><th>广告浏览者比例</th><th>Opportunity覆盖率</th><th>收入</th><th>异常步骤</th><th>状态</th></tr></thead><tbody>
                    {projects.map((item) => <tr key={item.code} onClick={() => { setProject(item.code); go("workbench"); }} className="clickable-row"><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.category}</td><td>{item.dau}</td><td>{item.completion}</td><td>{item.viewer}</td><td>{item.opportunity}</td><td>{item.revenue}</td><td>{item.issue}</td><td><Badge tone={item.status === "严重" ? "bad" : item.status === "预警" ? "warn" : "good"}>{item.status}</Badge></td></tr>)}
                  </tbody></table></div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>优先处理</h2><p>按影响用户与收入排序</p></div></div>
                  <div className="issue-list">
                    <button onClick={() => { setProject("IRAN-VPN-01"); setTransition({from:"Eligible",to:"Opportunity",rate:"43.9%",scope:"users"}); go("diagnosis"); }}><span className="rank bad">1</span><div><strong>IRAN-VPN-01</strong><p>Eligible→Opportunity 下降 12.8pp</p><small>影响 46,632 用户 · 约 $2,807/日</small></div></button>
                    <button onClick={() => { setProject("TURBO-CLEAN-05"); setTransition({from:"Opportunity",to:"Show Attempt",rate:"87.4%",scope:"users"}); go("diagnosis"); }}><span className="rank bad">2</span><div><strong>TURBO-CLEAN-05</strong><p>机会未履约率升至 12.6%</p><small>优先排查缓存命中与实时加载分支</small></div></button>
                    <button onClick={() => { setProject("CLEAN-MAX-03"); setTransition({from:"Opportunity",to:"Show Attempt",rate:"90.5%",scope:"users"}); go("diagnosis"); }}><span className="rank warn">3</span><div><strong>CLEAN-MAX-03</strong><p>Opportunity→Show Attempt 下降 5.1pp</p><small>影响 2,043 用户 · 约 $218/日</small></div></button>
                  </div>
                  <button className="full-link" onClick={() => go("diagnosis")}>进入异常诊断 →</button>
                </aside>
              </section>

              <section className="surface">
                <div className="surface-title"><div><h2>全项目变现链路</h2><p>用户覆盖漏斗与事件效率必须分开判断</p></div><Badge tone="blue">Firebase T+0</Badge></div>
                <div className="dual-funnel">
                  <div><h3>用户覆盖主漏斗</h3><div className="mini-funnel">{["DAU 397,380", "Eligibility Check 319,220", "Eligible 263,941", "Opportunity 138,283", "Show Attempt 124,106", "AV 116,842"].map((item, index) => <div key={item} style={{ width: `${100 - index * 8}%` }}>{item}<small>{index === 0 ? "100%" : ["80.3%", "82.7%", "52.4%", "89.7%", "94.1%"][index - 1]}</small></div>)}</div></div>
                  <div><h3>机会履约事件漏斗</h3><div className="mini-funnel blue">{["Opportunity 828,492", "履约入口 801,904", "Show Attempt 566,201", "Impression 537,891", "Paid Event 532,512"].map((item, index) => <div key={item} style={{ width: `${100 - index * 8}%` }}>{item}<small>{index === 0 ? "100%" : ["96.8%", "70.6%", "95.0%", "99.0%"][index - 1]}</small></div>)}</div></div>
                </div>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>机会履约方式</h2><p>缓存命中与实时请求是并列分支，不计作线性流失</p></div><Badge tone="good">履约率 89.7%</Badge></div><div className="overview-fulfillment"><div><span>Cache Hit</span><strong>551,801</strong><small>66.6%机会</small></div><div><span>Cache Miss</span><strong>276,691</strong><small>33.4%机会</small></div><div><span>Realtime Request</span><strong>259,406</strong><small>仅缓存未命中后</small></div><div><span>未履约机会</span><strong>85,977</strong><small>10.3%需诊断</small></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>预加载库存健康</h2><p>与用户机会漏斗独立统计</p></div><Badge tone="warn">浪费率 20.1%</Badge></div><div className="inventory-mini"><div><span>预加载成功率</span><strong>93.0%</strong></div><div><span>缓存命中率</span><strong>66.6%</strong></div><div><span>过期＋淘汰</span><strong>20.1%</strong></div></div></aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "workbench" && (
            <div className="page-stack">
              <section className="analysis-head surface">
                <div><div className="eyebrow">{project} · Android 1.8.0</div><h2>{funnelMode === "product" ? "VPN 产品主漏斗" : "广告变现主漏斗"}</h2><p>当前周期：{range} 00:00–当前 · 对比昨日同期</p></div>
                <div className="mode-controls">
                  <Segmented label="漏斗类型" active={funnelMode} onChange={(key) => { setFunnelMode(key as FunnelMode); if (key === "product") setUnitMode("users"); }} items={[{ key: "product", label: "产品漏斗" }, { key: "monetization", label: "变现漏斗" }]} />
                  {funnelMode === "monetization" && <Segmented label="统计单位" active={unitMode} onChange={(key) => setUnitMode(key as UnitMode)} items={[{ key: "users", label: "用户数" }, { key: "events", label: "事件数" }]} />}
                </div>
              </section>

              <section className="surface funnel-surface">
                <div className="surface-title"><div><h2>{funnelMode === "product" ? "产品用户到达漏斗" : unitMode === "users" ? "用户覆盖主漏斗" : "事件覆盖与展示漏斗"}</h2><p>{funnelMode === "monetization" ? "Request/Load仅存在于履约分支；点击箭头诊断当前步骤" : "点击转化箭头进入步骤诊断"}</p></div><div className="legend"><span className="dot blue" />当前 <span className="dot neutral" />昨日同期</div></div>
                <div className={`funnel-stages ${stages.length > 6 ? "dense" : ""}`}>
                  {stages.map((stage, index) => <div className="stage-group" key={stage.label}><button className={`funnel-stage ${stage.delta.startsWith("-") && Math.abs(parseFloat(stage.delta)) > 5 ? "stage-alert" : ""}`} onClick={() => index > 0 && openTransition(stages[index - 1], stage)}><span>{stage.label}</span><strong>{stage.value}</strong><small>{stage.event}</small></button>{index < stages.length - 1 && <button className={`conversion-arrow ${stages[index + 1].delta.startsWith("-") ? "down" : ""}`} onClick={() => openTransition(stage, stages[index + 1])}><strong>{stages[index + 1].rate}</strong><span>→</span><small>{stages[index + 1].delta}</small></button>}</div>)}
                </div>
                <div className="funnel-summary"><div><span>首尾转化率</span><strong>{funnelMode === "product" ? "42.6%" : unitMode === "users" ? activeProfile.userStages.at(-1)?.rate : "38.3%"}</strong></div><div><span>最大流失步骤</span><strong>{funnelMode === "product" ? "首页 → 点击连接" : unitMode === "users" ? "Eligible → Opportunity" : "Opportunity → Show Attempt"}</strong></div><div><span>{unitMode === "events" ? "流失事件" : "流失用户"}</span><strong>{funnelMode === "product" ? "35,443" : unitMode === "users" ? "46,632" : "69,435"}</strong></div><div><span>预计收入影响</span><strong className="negative">$2,807 / 日</strong></div></div>
                {funnelMode === "monetization" && unitMode === "users" && <div className="denominator-audit"><div><span>广告浏览者比例</span><strong>AV / DAU = {activeProfile.viewerTrend.at(-1)}%</strong><small>衡量覆盖用户</small></div><div><span>机会覆盖率</span><strong>Opportunity UV / DAU = {activeProfile.opportunityTrend.at(-1)}%</strong><small>定位请求前问题</small></div><div><span>机会履约率</span><strong>Show Attempt UV / Opportunity UV = {activeProfile.fulfillmentRate}</strong><small>覆盖缓存与实时两条路径</small></div><div><span>人均展示</span><strong>Impression / AV = 3.42</strong><small>衡量展示集中度</small></div></div>}
                {funnelMode === "monetization" && unitMode === "events" && <div className="denominator-audit"><div><span>资格通过率</span><strong>Eligible / Check = 79.4%</strong><small>按检查事件</small></div><div><span>机会生成率</span><strong>Opportunity / Eligible = 75.7%</strong><small>按事件次数</small></div><div><span>机会履约率</span><strong>Show Attempt / Opportunity = 67.6%</strong><small>不以Request为分母</small></div><div><span>展示成功率</span><strong>Impression / Show Attempt = 95.0%</strong><small>衡量SDK展示效率</small></div></div>}
              </section>

              {funnelMode === "monetization" && <section className="fulfillment-layout">
                <div className="surface"><div className="surface-title"><div><h2>机会履约分支</h2><p>同一个Opportunity只能进入缓存命中或缓存未命中分支</p></div><Badge tone="blue">按 opportunity_id 去重</Badge></div><div className="fulfillment-flow"><div className="flow-origin"><span>Opportunity</span><strong>{opportunityFulfillment.opportunity.toLocaleString()}</strong><small>100%</small></div><div className="flow-split"><span>分流</span></div><div className="flow-branch good"><span>Cache Hit</span><strong>{opportunityFulfillment.cacheHit.toLocaleString()}</strong><small>68.5% · 无新请求</small></div><div className="flow-branch warn"><span>Cache Miss</span><strong>{opportunityFulfillment.cacheMiss.toLocaleString()}</strong><small>31.5%</small></div><div className="flow-request"><span>Realtime Request</span><strong>{opportunityFulfillment.realtimeRequest.toLocaleString()}</strong><small>is_preload=0</small></div><div className="flow-request"><span>Realtime Load</span><strong>{opportunityFulfillment.realtimeLoad.toLocaleString()}</strong><small>98.0%</small></div><div className="flow-merge"><span>Show Attempt</span><strong>{opportunityFulfillment.showAttempt.toLocaleString()}</strong><small>{activeProfile.fulfillmentRate}机会履约</small></div></div><div className="fulfillment-metrics"><div><span>缓存命中率</span><strong>{activeProfile.cacheHitRate}</strong></div><div><span>Miss后请求率</span><strong>93.6%</strong></div><div><span>实时加载成功率</span><strong>98.0%</strong></div><div><span>机会未履约</span><strong className="negative">{opportunityFulfillment.unfulfilled.toLocaleString()}</strong></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>预加载与缓存库存</h2><p>发生在真实业务场景之前，不进入主漏斗</p></div><Badge tone="warn">独立口径</Badge></div><div className="preload-chain">{[["Preload Trigger",preloadInventory.trigger,"100%"],["Preload Request",preloadInventory.request,"94.1%"],["Load Success",preloadInventory.loadSuccess,activeProfile.preloadSuccess],["Cache Store",preloadInventory.cacheStore,"98.0%"]].map(([label,value,rate],index)=><div key={String(label)}><span>{index+1}</span><p><strong>{label}</strong><small>{Number(value).toLocaleString()} · {rate}</small></p></div>)}</div><div className="inventory-outcomes"><div><span>Cache Hit</span><strong>{preloadInventory.cacheHit.toLocaleString()}</strong></div><div><span>Expired</span><strong>{preloadInventory.expired.toLocaleString()}</strong></div><div><span>Evicted</span><strong>{preloadInventory.evicted.toLocaleString()}</strong></div><div><span>未消费库存</span><strong>{preloadInventory.unusedReady.toLocaleString()}</strong></div></div><div className="conclusion-block warn"><strong>缓存浪费率 20.1%</strong><p>(Expired + Evicted) / Cache Store。建议按广告位、TTL和网络类型继续拆解。</p></div></aside>
              </section>}

              <section className="two-column">
                <div className="surface">
                  <div className="surface-title"><div><h2>关键指标趋势</h2><p>{trendMetric === "viewer" ? "广告浏览用户持续减少，当前低于35%目标" : "请求前机会覆盖持续下降，当前低于40%基线"}</p></div><Segmented label="趋势指标" active={trendMetric} onChange={(key) => setTrendMetric(key as TrendMetric)} items={[{ key: "viewer", label: "浏览者比例" }, { key: "opportunity", label: "机会覆盖" }]} /></div>
                  <div className="trend-current"><span>{trendLabel}</span><strong>{trendValues.at(-1)}%</strong><small>{trendMetric === "viewer" ? "目标 ≥ 35%" : "目标 ≥ 40%"}</small></div>
                  <div className="bar-chart" aria-label={`近七日${trendLabel}趋势`}>{trendValues.map((value, index) => <div key={`${trendMetric}-${index}`}><span style={{ height: `${value * 2}px` }} className={index > 3 ? "alert" : ""}><em>{value}%</em></span><small>{["8/5", "8/6", "8/7", "8/8", "8/9", "8/10", "今天"][index]}</small></div>)}</div>
                </div>
                <aside className="surface diagnostic-card">
                  <div className="surface-title"><div><h2>智能诊断</h2><p>基于漏斗与数据质量规则</p></div><Badge tone="bad">严重</Badge></div>
                  <h3>{project === "IRAN-VPN-01" ? "主要问题在真实机会生成之前" : "当前项目按分支判断履约健康"}</h3>
                  <p>{project === "IRAN-VPN-01" ? "Opportunity覆盖从41.2%降至28.4%；预加载请求独立统计，缓存命中与实时请求按履约分支判断。" : `${project} 当前机会履约率 ${activeProfile.fulfillmentRate}，缓存命中率 ${activeProfile.cacheHitRate}。`}</p>
                  <ul><li>预加载请求已从主漏斗剔除</li><li>缓存命中不再要求产生新Request</li><li>实时请求仅以Cache Miss为前置条件</li></ul>
                  <button className="primary-button full" onClick={() => { setTransition({from:"Eligible",to:"Opportunity",rate:activeProfile.userStages[3].rate,scope:"users"}); go("diagnosis"); }}>诊断 Eligible → Opportunity</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "diagnosis" && (
            <div className="page-stack">
              <section className="transition-banner">
                <div><span>上一步</span><strong>{transition.from} {transition.scope === "events" ? "事件" : "用户"}</strong><em>{fromStage?.value ?? "—"}</em></div><span className="transition-arrow">→<small>{transition.rate}</small></span><div><span>下一步</span><strong>{transition.to} {transition.scope === "events" ? "事件" : "用户"}</strong><em>{toStage?.value ?? "—"}</em></div><div className="transition-loss"><span>{transition.scope === "events" ? "流失事件" : "流失用户"}</span><strong>{transitionLoss}</strong><small>按所选步骤与口径重新计算</small></div>
              </section>
              <section className="metric-grid five">
                <Metric label="当前转化率" value={transition.rate} note={`步骤 ${transition.from} → ${transition.to}`} tone="bad" />
                <Metric label="下降幅度" value="-12.8pp" note="连续下降 3 天" tone="bad" />
                <Metric label={transition.scope === "events" ? "异常流失事件" : "异常流失用户"} value={isFulfillmentDiagnosis ? "21,806" : transition.scope === "events" ? "21,806" : "10,641"} note="排除正常业务流失" />
                <Metric label="预计损失展示" value="40,436" note="按历史 3.8 次/AV" />
                <Metric label="预计收入影响" value="$2,807" note="每天" tone="bad" />
              </section>
              <section className="diagnosis-quality">
                <div><span>原因分类覆盖率</span><strong>98.0%</strong><div><i style={{ width: "98%" }} /></div></div>
                <div><span>事件链可关联率</span><strong>95.8%</strong><div><i style={{ width: "95.8%" }} /></div></div>
                <div><span>Unknown率</span><strong>2.0%</strong><div><i className="warn" style={{ width: "20%" }} /></div></div>
                <p><strong>可信度：高。</strong>异常主要由可行动原因构成；Unknown 未超过 5% 告警线。</p>
              </section>
              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>流失原因拆解</h2><p>按服务端规则与事件链自动分类</p></div><button className="text-button" onClick={() => go("snapshot")}>查看判定规则</button></div>
                  <div className="reason-list">{diagnosisReasons.map((reason) => <button key={reason.code} onClick={() => go("evidence")}><div className="reason-title"><strong>{reason.code}</strong><span>{reason.users} {transition.scope === "events" ? "事件" : "用户"} · {reason.share}%</span></div><p>{reason.label}</p><div className="reason-bar"><span style={{ width: `${reason.share}%` }} /></div><div className="reason-meta"><span>影响 {reason.impact}/日</span><Badge tone={reason.code === "UNKNOWN" ? "neutral" : reason.share > 20 ? "bad" : "warn"}>{reason.owner}</Badge></div></button>)}</div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>诊断结论</h2><p>优先验证可行动原因</p></div></div>
                  <div className="conclusion-block bad"><strong>主要原因</strong><p>{isFulfillmentDiagnosis ? "机会已经生成，但缓存实例 Context 丢失或缓存未命中后的实时加载失败，导致没有执行 Show Attempt。" : "1.8.0 版本把 Opportunity 生成放在页面动画完成后；伊朗弱网用户在动画结束前离开或进入后台。"}</p></div>
                  <div className="conclusion-block warn"><strong>数据风险</strong><p>4.2% 流失用户存在事件未收到，需要结合 Firebase DebugView 与本地 outbox 继续确认。</p></div>
                  <div className="action-stack"><button className="primary-button" onClick={() => go("cohort")}>进入分群对比</button><button className="secondary-button" onClick={() => go("evidence")}>查看事件证据</button><button className="secondary-button" onClick={() => setDialog("diagnosis")}>创建问题任务</button></div>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "cohort" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title cohort-header"><div><h2>{transition.from} → {transition.to} 分群对比</h2><p>按当前选择的{transition.scope === "events" ? "事件" : "用户"}步骤，找出贡献最大的问题人群</p></div><div className="dimension-tabs">{["国家", "App版本", "广告位", "网络类型", "新老用户", "VPN状态"].map((item) => <button key={item} className={dimension === item ? "active" : ""} onClick={() => setDimension(item)}>{item}</button>)}</div></div>
                <div className="comparison-controls"><label>基准<select value={baseline} onChange={(event) => setBaseline(event.target.value)}><option>近7日均值</option><option>昨日同期</option><option>上周同期</option><option>版本1.7.4</option></select></label><label>排序<select><option>异常流失贡献</option><option>转化下降幅度</option><option>收入影响</option><option>用户规模</option></select></label><label>最小样本<select><option>≥ 1,000 用户</option><option>≥ 500 用户</option><option>不限</option></select></label><span>当前与 <strong>{baseline}</strong> 比较</span></div>
                <div className="cohort-summary"><div><span>当前维度</span><strong>{dimension}</strong></div><div><span>最大异常分群</span><strong>{dimension === "国家" ? "伊朗" : dimension === "App版本" ? "1.8.0 (108)" : "vpn_connect_success"}</strong></div><div><span>贡献异常流失</span><strong>92.4%</strong></div><div><span>建议优先级</span><Badge tone="bad">P0</Badge></div></div>
                <div className="table-wrap"><table><thead><tr><th>{dimension}</th><th>{transition.from}{transition.scope === "events" ? "事件" : "用户"}</th><th>历史基线</th><th>当前转化率</th><th>变化</th><th>异常流失{transition.scope === "events" ? "事件" : "用户"}</th><th>收入影响/日</th><th>证据</th></tr></thead><tbody>{cohortRows.map((row) => <tr key={row.value} className={row.level === "bad" ? "row-bad" : ""}><td><strong>{dimension === "国家" ? row.value : dimension === "App版本" ? ["1.8.0 (108)", "1.7.4 (104)", "1.7.2 (102)", "1.6.9 (98)", "其他"][cohortRows.indexOf(row)] : dimension === "广告位" ? ["vpn_connect_success", "vpn_home_banner", "server_select", "vpn_disconnect", "home_resume"][cohortRows.indexOf(row)] : row.value}</strong></td><td>{row.volume}</td><td>{row.base}</td><td><span className={`heat-cell ${row.level}`}>{row.current}</span></td><td className={row.change.startsWith("-") ? "negative" : "positive"}>{row.change}</td><td>{row.lost}</td><td>{row.impact}</td><td><button className="table-link" onClick={() => go("evidence")}>查看</button></td></tr>)}</tbody></table></div>
              </section>
              <section className="two-column">
                <div className="surface">
                  <div className="surface-title"><div><h2>异常流失贡献度</h2><p>流失用户数 × 历史人均展示 × 单次展示收入</p></div></div>
                  <div className="horizontal-bars">{[["伊朗 · 1.8.0", 82, "$2,301"], ["伊朗 · 1.7.4", 21, "$286"], ["埃及 · 1.8.0", 16, "$141"], ["其他", 8, "$79"]].map(([label, width, value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><strong>{value}</strong></div>)}</div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>交叉分析建议</h2><p>继续缩小问题范围</p></div></div>
                  <div className="recommend-list"><button onClick={() => setDimension("App版本")}><strong>伊朗 × App版本</strong><small>验证是否集中在 1.8.0</small></button><button onClick={() => setDimension("网络类型")}><strong>伊朗 × 网络类型</strong><small>检查弱网与代理环境</small></button><button onClick={() => setDimension("广告位")}><strong>1.8.0 × 广告位</strong><small>确认具体触发场景</small></button></div>
                  <button className="primary-button full" onClick={() => go("path")}>分析该分群用户路径</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "path" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title"><div><h2>伊朗 · 1.8.0 · {transition.from} → {transition.to} 流失路径</h2><p>{isFulfillmentDiagnosis ? "拆开缓存命中与实时加载两条履约路径，定位机会为何没有进入 Show Attempt" : "观察没有进入 Opportunity 前后的真实行为，不把“页面离开”和“App 后台”混为一谈"}</p></div><Badge tone="blue">{transitionLoss} {transition.scope === "events" ? "事件" : "用户"}</Badge></div>
                <div className="path-canvas">
                  <div className="path-column"><h3>流失前事件</h3><div className="path-node"><strong>{isFulfillmentDiagnosis ? "jk_ad_opportunity" : "connect_success"}</strong><span>38,204 · 81.9%</span></div><div className="path-node muted"><strong>{isFulfillmentDiagnosis ? "jk_ad_cache_hit / miss" : "vpn_home_view"}</strong><span>5,887 · 12.6%</span></div><div className="path-node muted"><strong>{isFulfillmentDiagnosis ? "jk_ad_load_success" : "app_foreground"}</strong><span>2,541 · 5.5%</span></div></div>
                  <div className="path-connectors"><span>81.9%</span><i /><span>12.6%</span><i /><span>5.5%</span></div>
                  <div className="path-column center"><h3>当前流失点</h3><div className="path-node alert"><strong>{isFulfillmentDiagnosis ? "NO_SHOW_ATTEMPT" : "NO_OPPORTUNITY"}</strong><span>{transitionLoss} {transition.scope === "events" ? "事件" : "用户"}</span><small>{isFulfillmentDiagnosis ? "Opportunity 后未走完缓存或实时履约分支" : "Eligible 后 30 秒内未生成机会"}</small></div></div>
                  <div className="path-connectors right"><span>52.8%</span><i /><span>20.1%</span><i /><span>8.4%</span></div>
                  <div className="path-column"><h3>流失后事件</h3><div className="path-node"><strong>{isFulfillmentDiagnosis ? "cache_context_lost" : "app_background"}</strong><span>24,613 · 52.8%</span></div><div className="path-node muted"><strong>{isFulfillmentDiagnosis ? "realtime_load_failed" : "vpn_disconnect"}</strong><span>9,384 · 20.1%</span></div><div className="path-node muted"><strong>{isFulfillmentDiagnosis ? "app_background" : "screen_view"}</strong><span>3,921 · 8.4%</span></div></div>
                </div>
              </section>
              <section className="path-classification">
                <div><Badge tone="bad">52.8%</Badge><strong>{isFulfillmentDiagnosis ? "缓存上下文异常" : "App进入后台"}</strong><p>{isFulfillmentDiagnosis ? "广告实例存在，但未关联当前 opportunity_id，无法确认履约链。" : "收到 app_background，进程仍存活；不能记为用户离开页面。"}</p></div>
                <div><Badge tone="warn">20.1%</Badge><strong>{isFulfillmentDiagnosis ? "实时加载失败" : "页面离开"}</strong><p>{isFulfillmentDiagnosis ? "仅统计 Cache Miss 后真实发起的 realtime request。" : "收到 screen_leave，但 App 仍在前台；属于产品路径流失。"}</p></div>
                <div><Badge tone="neutral">8.4%</Badge><strong>进程终止/无后续</strong><p>窗口内无后续事件，只能标记 unknown_exit，不强行推断。</p></div>
                <div><Badge tone="blue">18.7%</Badge><strong>业务阻止</strong><p>频控、订阅或展示条件明确阻止，不算埋点缺失。</p></div>
              </section>
              <section className="three-column">
                <div className="surface"><div className="surface-title"><div><h2>终止原因</h2><p>服务端推断分类</p></div></div><div className="donut-row"><div className="donut"><span>52.8%</span></div><div className="donut-legend"><span><i className="c1" />App进入后台 52.8%</span><span><i className="c2" />离开页面 20.1%</span><span><i className="c3" />频控阻止 12.5%</span><span><i className="c4" />其他 14.6%</span></div></div></div>
                <div className="surface"><div className="surface-title"><div><h2>关键时间间隔</h2><p>P50 / P90</p></div></div><div className="timing-list"><div><span>连接成功 → 后台</span><strong>1.8s / 5.6s</strong></div><div><span>Eligible → 页面离开</span><strong>2.3s / 8.1s</strong></div><div><span>页面动画时长</span><strong>2.0s / 3.2s</strong></div><div><span>机会等待窗口</span><strong>30s</strong></div></div></div>
                <aside className="surface diagnostic-card"><div className="surface-title"><div><h2>路径结论</h2><p>产品行为与打点证据一致</p></div></div><h3>{isFulfillmentDiagnosis ? "缓存 Context 丢失是主要履约阻塞" : "动画完成后才创建机会过晚"}</h3><p>{isFulfillmentDiagnosis ? "优先检查缓存对象是否保存 instanceContext，并在取出时绑定当前 opportunity_id；实时加载失败单独按 error_code 拆解。" : "52.8% 流失用户在动画完成前进入后台，建议将 Opportunity 提前到连接成功页可见时。"}</p><button className="primary-button full" onClick={() => go("evidence")}>抽查事件时间线</button></aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "evidence" && (
            <div className="page-stack">
              <section className="evidence-head surface"><div><div className="eyebrow">样本 user_pseudo_id · u_8f1a***92</div><h2>{transition.from} → {transition.to} 事件证据</h2><p>{project} · Android 1.8.0 · Iran · session=s_728c</p></div><Segmented label="证据模式" active={evidenceMode} onChange={setEvidenceMode} items={[{ key: "user", label: "用户事件链" }, { key: "ad", label: "广告关联链" }]} /></section>
              <section className="two-column wide-left evidence-layout">
                <div className="surface">
                  <div className="surface-title"><div><h2>{evidenceMode === "ad" ? "预加载库存 → 当前机会 → Paid 关联链" : "用户会话完整时间线"}</h2><p>event_id 去重 · event_time 排序 · 预加载不要求 opportunity_id</p></div><div><Badge tone="bad">1 个链路异常</Badge> <Badge tone="warn">1 个P1缺失</Badge></div></div>
                  <div className="evidence-controls"><label>事件/ID<input placeholder="搜索 event_name 或 request_id" /></label><label>来源<select><option>全部来源</option><option>Firebase</option><option>质量引擎</option></select></label><button className={onlyErrors ? "active" : ""} onClick={() => setOnlyErrors(!onlyErrors)}>{onlyErrors ? "显示全部事件" : "仅看异常 3"}</button></div>
                  <div className="event-timeline">{visibleEvents.map(({ event, index }) => <button key={`${event.time}-${event.name}`} className={`${selectedEvent === index ? "selected" : ""} ${event.result === "缺失" || event.result === "链路异常" ? "event-bad" : ""}`} onClick={() => setSelectedEvent(index)}><span className="event-time">{event.time}</span><span className="event-dot" /><div><strong>{event.name}</strong><p>{event.detail}</p><small>{event.id} · {event.source}</small></div><Badge tone={event.result === "有效" ? "good" : event.result === "P1缺失" ? "warn" : "bad"}>{event.result}</Badge></button>)}</div>
                </div>
                <aside className="surface event-detail">
                  <div className="surface-title"><div><h2>事件详情</h2><p>{eventRows[selectedEvent].name}</p></div></div>
                  <div className="validation-summary"><Badge tone={eventRows[selectedEvent].result === "有效" ? "good" : "bad"}>{eventRows[selectedEvent].result}</Badge><strong>{eventRows[selectedEvent].time}</strong></div>
                  <dl><div><dt>event_id</dt><dd>{eventRows[selectedEvent].id}</dd></div><div><dt>opportunity_id</dt><dd className={eventRows[selectedEvent].name === "jk_ad_impression" ? "negative" : ""}>{eventRows[selectedEvent].name === "jk_ad_impression" ? "缺失" : selectedEvent < 3 ? "—（预加载不传）" : "opp_82c"}</dd></div><div><dt>request_id</dt><dd>{selectedEvent < 3 ? "req_pre_91a" : "—（缓存命中无新请求）"}</dd></div><div><dt>request_type</dt><dd>{eventRows[selectedEvent].requestType}</dd></div><div><dt>is_preload</dt><dd>{eventRows[selectedEvent].requestType === "preload" ? "1" : "0 / 不适用"}</dd></div><div><dt>cache_status</dt><dd>{eventRows[selectedEvent].cacheStatus}</dd></div><div><dt>ad_instance_id</dt><dd>{selectedEvent > 0 ? "ins_671" : "—"}</dd></div><div><dt>placement</dt><dd>vpn_connect_success</dd></div><div><dt>数据来源</dt><dd>{eventRows[selectedEvent].source}</dd></div></dl>
                  {eventRows[selectedEvent].name === "jk_ad_impression" && <div className="conclusion-block bad"><strong>CHAIN_INVALID</strong><p>缓存广告对象取出时没有绑定当前 opportunity_id；预加载 request_id 和 ad_instance_id 正常。</p></div>}
                  <div className="detail-actions"><button onClick={() => { setRawOpen(!rawOpen); }}>{rawOpen ? "收起原始参数" : "查看原始参数"}</button><button onClick={() => notify("事件证据链接已复制")}>复制证据链接</button></div>
                  {rawOpen && <pre className="raw-payload">{`{\n  "event_name": "${eventRows[selectedEvent].name}",\n  "event_id": "${eventRows[selectedEvent].id}",\n  "request_type": "${eventRows[selectedEvent].requestType}",\n  "is_preload": ${eventRows[selectedEvent].requestType === "preload" ? 1 : 0},\n  "cache_status": "${eventRows[selectedEvent].cacheStatus}",\n  "request_id": ${selectedEvent < 3 ? "\"req_pre_91a\"" : "null"},\n  "opportunity_id": ${eventRows[selectedEvent].name === "jk_ad_impression" ? "null" : selectedEvent < 3 ? "null" : "\"opp_82c\""},\n  "schema_version": "1.7"\n}`}</pre>}
                  <button className="primary-button full" onClick={() => { go("issues"); notify("事件证据已加入问题单"); }}>将证据加入问题单</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "issues" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title"><div><h2>ISSUE-20260811-024 · {transition.from} → {transition.to} 异常</h2><p>{project} · P0 · 负责人：客户端增长组 / Oliver · SLA 剩余 18 小时</p></div><Badge tone={issueStatus === "重测中" ? "blue" : "warn"}>{issueStatus}</Badge></div>
                <div className="issue-workflow">{[["已发现", "8/11 10:32"], ["已定位", "8/11 11:08"], ["修复中", "预计 8/12"], ["打点重测", issueStatus === "重测中" ? "采集中" : "待开始"], ["灰度验证", "待开始"], ["关闭", "指标恢复"]].map(([label, time], index) => <div key={label} className={`${index < issuePhase ? "done" : index === issuePhase ? "current" : ""}`}><span>{index < issuePhase ? "✓" : index + 1}</span><strong>{label}</strong><small>{time}</small></div>)}</div>
              </section>
              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>问题定义与修复计划</h2><p>所有结论必须关联漏斗版本和事件证据</p></div><button className="secondary-button" onClick={() => go("evidence")}>查看证据</button></div>
                  <div className="issue-form-grid"><div><label>异常步骤</label><strong>{transition.from} → {transition.to}</strong></div><div><label>影响范围</label><strong>伊朗 · Android 1.8.0</strong></div><div><label>异常开始</label><strong>2026-08-09 14:20</strong></div><div><label>预计收入影响</label><strong className="negative">$2,807 / 日</strong></div><div className="span-2"><label>根因</label><strong>{isFulfillmentDiagnosis ? "缓存对象没有完整保存 instanceContext，取出后未绑定当前 opportunity_id；部分 Cache Miss 的 realtime load 超时。" : "连接成功页动画完成后才生成 Opportunity，弱网用户提前进入后台。"}</strong></div><div className="span-2"><label>修复方案</label><strong>{isFulfillmentDiagnosis ? "广告对象与 instanceContext 一起缓存；命中时绑定当前 opportunity_id；实时加载按 error_code 与耗时分层告警。" : "页面可见立即创建 Opportunity；补充 background_reason，并验证场景到达窗口。"}</strong></div><div><label>修复版本</label><strong>1.8.1 (109)</strong></div><div><label>关联测试 Run</label><strong>待生成</strong></div></div>
                  <div className="action-bar"><button className="secondary-button" onClick={() => notify("修复说明已保存")}>保存修复说明</button><button className="primary-button" onClick={() => setDialog("retest-run")}>发起打点重测</button></div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>发布门禁</h2><p>修复版本必须全部通过</p></div></div>
                  <div className="gate-list"><div><span>P0事件完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>P0参数完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>关联链完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>Unknown率</span><strong>目标 &lt; 1%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div></div>
                  <div className="conclusion-block warn"><strong>{issueStatus === "重测中" ? "重测进行中" : "当前不可发布"}</strong><p>{issueStatus === "重测中" ? "系统正在按原 snapshot 采集失败项，完成后自动刷新门禁结果。" : "完成打点重测且 P0 指标达到 100% 后，才允许进入灰度。"}</p></div>
                </aside>
              </section>
              <section className="surface">
                <div className="surface-title"><div><h2>修复前后效果验证</h2><p>灰度后自动比较同国家、同版本范围的转化率与收入</p></div><Badge tone="neutral">等待灰度数据</Badge></div>
                <div className="before-after"><div><span>修复前 7 天</span><strong>Opportunity覆盖率 28.4%</strong><div className="comparison-bar"><i style={{ width: "28.4%" }} /></div><small>广告浏览者比例 23.1% · $4,821/日</small></div><div className="comparison-arrow">→</div><div><span>关闭目标</span><strong>Opportunity覆盖率 ≥ 40%</strong><div className="comparison-bar target"><i style={{ width: "40%" }} /></div><small>广告浏览者比例 ≥ 33% · 收入恢复 ≥ 90%</small></div></div>
              </section>
              <section className="surface activity-log"><div className="surface-title"><div><h2>任务动态与审计记录</h2><p>记录状态、负责人、证据和验收操作</p></div><button className="text-button" onClick={() => notify("已加载全部任务动态")}>查看全部</button></div><div><span>11:08</span><strong>Oliver</strong><p>确认根因并关联 7 条事件证据。</p><Badge tone="good">已定位</Badge></div><div><span>11:26</span><strong>客户端增长组</strong><p>提交修复方案：Opportunity 前移并修复缓存 Context。</p><Badge tone="warn">修复中</Badge></div>{issueStatus === "重测中" && <div><span>刚刚</span><strong>系统</strong><p>已创建失败项重测 Run，等待设备开始执行。</p><Badge tone="blue">重测中</Badge></div>}</section>
            </div>
          )}

          {module === "funnel" && page === "snapshot" && (
            <div className="page-stack">
              <section className="snapshot-head surface"><div><div className="eyebrow">只读执行快照</div><h2>IRAN-VPN-01 · 漏斗口径 V1.7</h2><p>生效于 2026-08-01 · 套利 VPN v1.7 ＋ 广告 v1.7 ＋ VPN v1.7</p></div><div><Badge tone="good">已发布</Badge> <button className="secondary-button" onClick={() => notify("已定位到项目类型设置中的 V1.7 配置")}>前往项目类型设置</button></div></section>
              <section className="metric-grid five"><Metric label="产品漏斗" value="6 步" note="严格顺序" /><Metric label="变现用户主漏斗" value="7 步" note="UV 去重" /><Metric label="变现事件主漏斗" value="6 步" note="event_id 去重" /><Metric label="履约与库存" value="2 条分支" note="独立于主漏斗" /><Metric label="规范版本" value="V1.7" note="schema_version 1.7" /></section>
              <section className="surface">
                <div className="surface-title"><div><h2>变现用户漏斗定义</h2><p>Firebase 实时口径；AdMob 数据仅用于结算对账</p></div><Badge tone="blue">User Funnel</Badge></div>
                <div className="table-wrap"><table><thead><tr><th>步骤</th><th>事件</th><th>用户判定</th><th>条件/窗口</th><th>关键关联字段</th><th>优先级</th><th>数据源</th></tr></thead><tbody>{[
                  ["DAU", "app_active", "当日活跃去重用户", "自然日", "user_pseudo_id", "P0", "Firebase"],
                  ["Eligibility Check", "jk_ad_eligibility_check", "执行过资格检查的去重用户", "活跃后", "session_id / placement", "P0", "Firebase"],
                  ["Eligible", "jk_ad_eligibility_check", "eligible=1 的去重用户", "检查后", "session_id / eligible", "P0", "Firebase"],
                  ["Opportunity", "jk_ad_opportunity", "生成真实展示机会", "Eligible后30分钟", "opportunity_id", "P0", "Firebase"],
                  ["Show Attempt", "jk_ad_show_attempt", "缓存或实时分支履约后调用show", "Opportunity后", "opportunity_id / ad_instance_id", "P0", "Firebase"],
                  ["AV", "jk_ad_impression", "至少1次Impression用户", "Show Attempt后", "opportunity_id / ad_instance_id", "P0", "Firebase"],
                  ["Paid", "jk_ad_paid_event", "收到Paid回调用户", "Impression后", "ad_instance_id", "条件P0", "Firebase"],
                ].map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{index === 5 ? <Badge tone="bad">{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div>
              </section>
              <section className="two-column snapshot-branches">
                <div className="surface"><div className="surface-title"><div><h2>机会履约分支定义</h2><p>同一 opportunity_id 只能先进入缓存命中或缓存未命中分支</p></div><Badge tone="blue">Fulfillment</Badge></div><div className="definition-list"><div><strong>Cache Hit</strong><p>命中时不产生新 request_id；必须把当前 opportunity_id 绑定到缓存广告的 ad_instance_id。</p></div><div><strong>Cache Miss</strong><p>未命中后才允许 Realtime Request；request_type=realtime、is_preload=0，并携带 opportunity_id。</p></div><div><strong>Realtime Load</strong><p>以 request_id 关联加载结果；失败和超时必须有 error_code/error_domain。</p></div><div><strong>Show Attempt</strong><p>缓存或实时分支在这里汇合；按 opportunity_id 去重计算机会履约率。</p></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>预加载库存定义</h2><p>发生在业务场景之前，只评估库存效率</p></div><Badge tone="warn">Inventory</Badge></div><div className="definition-list"><div><strong>Preload Trigger → Request</strong><p>request_type=preload、is_preload=1，禁止传 opportunity_id。</p></div><div><strong>Load Success → Cache Store</strong><p>生成并保存 ad_instance_id；广告对象必须与 instanceContext 一起进入缓存。</p></div><div><strong>Hit / Expired / Evicted</strong><p>分别计算消费、过期和淘汰；不能将预加载 Request 放进用户主漏斗。</p></div></div></aside>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>统一计算规则</h2><p>避免不同页面出现不同答案</p></div></div><div className="rule-grid"><div><span>用户去重</span><strong>project_code + user_pseudo_id</strong></div><div><span>事件去重</span><strong>event_id</strong></div><div><span>顺序模式</span><strong>严格按 event_time</strong></div><div><span>同一步重复</span><strong>仅取首次到达</strong></div><div><span>缺失事件</span><strong>进入质量隔离区，不补算</strong></div><div><span>未知 jk_ 事件</span><strong>allowlist 外进入隔离表</strong></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>数据时效</h2><p>页面必须明确显示数据状态</p></div></div><div className="source-list"><div><Badge tone="blue">T+0</Badge><strong>Firebase 实时预估</strong><small>用户与事件漏斗，延迟约 5–15 分钟</small></div><div><Badge tone="good">T+3</Badge><strong>AdMob 已结算</strong><small>收入、匹配率、展示率与广告浏览者</small></div><div><Badge tone="neutral">对账</Badge><strong>Firebase × AdMob</strong><small>只在已结算日期输出最终差异</small></div></div></aside>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>核心指标公式</h2><p>页面、导出和告警统一引用；总Request不可作为机会主漏斗分母</p></div></div><div className="formula-list"><div><strong>广告浏览者比例</strong><code>COUNT_DISTINCT(impression_user) / DAU</code><p>回答有多少活跃用户真正看到了广告。</p></div><div><strong>Opportunity覆盖率</strong><code>COUNT_DISTINCT(opportunity_user) / DAU</code><p>定位真实广告机会覆盖问题。</p></div><div><strong>机会履约率</strong><code>COUNT_DISTINCT(opportunity_id with cache_hit or realtime_request) / COUNT_DISTINCT(opportunity_id)</code><p>缓存与实时两条路径合并判断。</p></div><div><strong>缓存命中率</strong><code>cache_hit / (cache_hit + cache_miss)</code><p>判断现有库存能否满足真实机会。</p></div><div><strong>预加载成功率</strong><code>preload_load_success / preload_request</code><p>仅评估预加载库存生产效率。</p></div><div><strong>缓存浪费率</strong><code>(cache_expired + cache_evicted) / cache_store</code><p>定位TTL、缓存容量和触发策略问题。</p></div><div><strong>展示尝试成功率</strong><code>impression_count / show_attempt_count</code><p>定位真实调用 Show 后的展示失败。</p></div><div><strong>人均展示次数</strong><code>impression_count / AV</code><p>判断展示是否集中在少数用户。</p></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>版本变更</h2><p>当前口径相对 V1.6</p></div><Badge tone="blue">V1.7</Badge></div><div className="version-diff"><div><span>新增</span><p>ip_before_connect / ip_after_connect 诊断字段</p></div><div><span>调整</span><p>ip_after_connect 在广告拉取事件中传输派生信息</p></div><div><span>明确</span><p>完整 IP 不进入 Firebase，且不作为漏斗步骤</p></div><button onClick={() => setDialog("version-diff-report")}>导出版本差异</button></div></aside>
              </section>
            </div>
          )}
          </>}
        </main>
      </div>
      {dialog && <ActionDialog dialog={dialog} project={project} configs={configRecords} editingConfig={dialog === "config-version" ? editingConfig : null} onClose={() => { setDialog(null); setEditingConfig(null); }} onSubmit={(result: DialogResult) => {
        if (dialog === "retest-run" || dialog === "tracking-run") setIssueStatus("重测中");
        if (dialog === "config-version") {
          const projectCodes = Array.isArray(result.payload.project_codes) ? result.payload.project_codes : [String(result.payload.project_codes ?? project)];
          const categoryCode = String(result.payload.category_code ?? "vpn");
          const version = String(result.payload.config_version ?? "V1.8");
          const publish = result.payload.save_action !== "draft";
          const existingConfigId = String(result.payload.existing_config_id ?? "");
          const snapshotId = publish ? `SNP-${categoryCode.toUpperCase()}-${version.replace(/\D/g, "")}-${String(configRecords.length + 1).padStart(3, "0")}` : undefined;
          const platformCode = String(result.payload.platform_scope ?? "android_ios");
          const createdConfig: TrackingConfigRecord = {
            id: existingConfigId || result.id,
            name: String(result.payload.config_name ?? "新建打点配置"),
            version,
            category: categoryCode === "clean" ? "清理" : categoryCode === "launcher" ? "Launcher" : "套利 VPN",
            projects: projectCodes,
            platform: platformCode === "android" ? "Android" : platformCode === "ios" ? "iOS" : "Android+iOS",
            selectedCount: Number(result.payload.selected_event_count ?? 0),
            totalCount: trackingEventCatalog.length,
            p0Count: Number(result.payload.p0_event_count ?? 0),
            p1Count: Number(result.payload.p1_event_count ?? 0),
            p2Count: Number(result.payload.p2_event_count ?? 0),
            sceneCount: new Set(trackingEventCatalog.filter((event) => (result.payload.event_ids as string[] | undefined)?.includes(event.id)).map((event) => event.scene)).size,
            selectedEventIds: Array.isArray(result.payload.event_ids) ? result.payload.event_ids : [],
            status: publish ? "PUBLISHED" : "DRAFT",
            snapshotId,
            updatedBy: "Oliver",
            updatedAt: "刚刚",
          };
          setConfigRecords((records) => existingConfigId ? records.map((record) => record.id === existingConfigId ? createdConfig : record) : [createdConfig, ...records]);
        }
        notify(`${result.message} · ${result.id}`);
      }} />}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
    </div>
  );
}
