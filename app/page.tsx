"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionDialog, type DialogKey, type DialogResult } from "./action-dialog";
import { FirebaseConfiguration } from "./firebase-configuration";
import { trackingConfigs, trackingEventCatalog, trackingConfigDataSource, type TrackingConfigRecord } from "./tracking-config-data";
import { trackingDatabaseFieldRows } from "./tracking-config-repository";
import { TrackingConfigWorkspace, type TrackingConfigSubmission } from "./tracking-config-workspace";
import { TrackingAcceptanceCenter } from "./tracking-acceptance-center";
import { firebaseTaskLogsApi, type FirebaseCheckLog, type FirebaseSyncRunLog } from "./firebase-task-logs-api";

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
type FunnelStage = {
  label: string;
  event: string;
  value: string;
  rate: string;
  delta: string;
  note?: string;
  nonLinear?: boolean;
};
type TransitionSelection = { from: string; to: string; rate: string; scope: "users" | "events" };
type ModuleKey = "global" | "project" | "funnel" | "admob" | "firebase" | "reconcile" | "tracking" | "config" | "firebaseSetup" | "tasks";
const moduleKeys = new Set<ModuleKey>(["global", "project", "funnel", "admob", "firebase", "reconcile", "tracking", "config", "firebaseSetup", "tasks"]);
const pageKeys = new Set<PageKey>(["overview", "workbench", "diagnosis", "cohort", "path", "evidence", "issues", "snapshot"]);
const legacyWorkbenchPages = new Set<PageKey>(["diagnosis", "cohort", "path", "snapshot"]);

const funnelStageDisplayNames: Record<string, string> = {
  DAU: "日活跃用户（DAU）",
  "Eligibility Check": "广告资格检查（Eligibility Check）",
  Eligible: "符合广告资格（Eligible）",
  Opportunity: "广告机会（Opportunity）",
  Request: "广告请求用户（Request UV）",
  "Request Accepted": "SDK 请求受理用户（Request Accepted UV）",
  "Ad Request": "广告请求（Ad Request）",
  "Load Success": "广告加载成功（Load Success）",
  "Ad Ready": "广告就绪（Ad Ready）",
  "Show Attempt": "广告展示尝试（Show Attempt）",
  AV: "广告展示独立用户（AV）",
  Impression: "广告展示（Impression）",
  Paid: "产生收益用户（Paid）",
  "Paid Event": "广告收益回调（Paid Event）",
};

const funnelEventDisplayNames: Record<string, string> = {
  app_active: "app_active（日活事件）",
  jk_ad_eligibility_check: "jk_ad_eligibility_check（广告资格检查事件）",
  "eligible=1": "eligible=1（符合广告资格）",
  "jk_ad_eligibility_check · eligible=1": "jk_ad_eligibility_check · eligible=1（符合广告资格）",
  jk_ad_opportunity: "jk_ad_opportunity（广告机会事件）",
  jk_ad_request: "jk_ad_request（广告请求事件）",
  request_accepted_derived: "客户端派生（SDK 调用成功且无同步异常）",
  jk_ad_load_success: "jk_ad_load_success（广告加载成功事件）",
  jk_ad_ready: "jk_ad_ready（广告就绪事件）",
  jk_ad_show_attempt: "jk_ad_show_attempt（广告展示尝试事件）",
  jk_ad_impression: "jk_ad_impression（按用户去重计算 AV）",
  jk_ad_paid_event: "jk_ad_paid_event（广告收益事件）",
};

function displayFunnelStage(label: string) {
  return funnelStageDisplayNames[label] ?? label;
}

function displayFunnelEvent(event: string) {
  return funnelEventDisplayNames[event] ?? event;
}

function readInitialAnalysisView(): { module: ModuleKey; page: PageKey; embedded: boolean } {
  if (typeof window === "undefined") {
    return { module: "funnel", page: "overview", embedded: false };
  }

  const params = new URLSearchParams(window.location.search);
  const requestedModule = params.get("module");
  const requestedPage = params.get("page");
  const normalizedModule: ModuleKey = requestedModule === "global" || requestedModule === "project"
    ? "funnel"
    : requestedModule === "firebaseSetup"
      ? "firebase"
      : moduleKeys.has(requestedModule as ModuleKey) ? requestedModule as ModuleKey : "funnel";
  const normalizedPage: PageKey = requestedModule === "project"
    ? "workbench"
    : pageKeys.has(requestedPage as PageKey)
      ? legacyWorkbenchPages.has(requestedPage as PageKey) ? "workbench" : requestedPage as PageKey
      : "overview";
  return {
    module: normalizedModule,
    page: normalizedPage,
    embedded: params.get("embedded") === "1",
  };
}

const moduleMenus: Array<{ key: ModuleKey; index: string; label: string; group: "经营分析" | "质量治理" }> = [
  { key: "funnel", index: "01", label: "项目与漏斗分析", group: "经营分析" },
  { key: "admob", index: "02", label: "AdMob 分析", group: "经营分析" },
  { key: "firebase", index: "03", label: "Firebase 数据", group: "经营分析" },
  { key: "reconcile", index: "04", label: "数据对账", group: "经营分析" },
  { key: "tracking", index: "05", label: "打点验收", group: "质量治理" },
  { key: "config", index: "06", label: "规范与配置", group: "质量治理" },
  { key: "tasks", index: "07", label: "任务与告警", group: "质量治理" },
];

const moduleCopy: Record<ModuleKey, { title: string; description: string; action: string }> = {
  global: { title: "全局项目总览", description: "统一查看所有项目的用户、投放、收入、利润和数据健康度", action: "导出项目日报" },
  project: { title: "单项目诊断", description: "围绕单个项目串联用户增长、产品漏斗、广告变现和数据质量", action: "创建诊断任务" },
  funnel: { title: "项目与漏斗分析", description: "一个入口完成多项目发现、单项目漏斗、页面路径、事件证据和修复验证", action: "新建诊断任务" },
  admob: { title: "AdMob 分析", description: "分析请求、匹配、展示、广告浏览用户、eCPM和收入变化", action: "导出 AdMob 报表" },
  firebase: { title: "Firebase 数据", description: "统一查看活跃、事件质量、版本覆盖、数据源连接和同步健康", action: "查看事件字典" },
  reconcile: { title: "数据对账", description: "对比 Firebase、AdMob、中台与 ADB 的用户、展示和收入口径", action: "发起重新对账" },
  tracking: { title: "打点验收中心", description: "按项目品类和测试快照验证应收事件、必填参数与完整关联链", action: "新建验收 Run" },
  config: { title: "规范与项目配置", description: "从事件主库组装项目打点配置，发布不可变快照并供验收Run引用", action: "新建打点配置" },
  firebaseSetup: { title: "Firebase 对接中心", description: "独立管理多Firebase连接、Project、App、内部项目绑定、同步水位与接口健康", action: "新建 Firebase 连接" },
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
  firebaseSetup: "firebase-connection",
  tasks: "alert-rule",
};

const pages: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: "overview", label: "多项目漏斗总览", hint: "发现异常项目" },
  { key: "workbench", label: "单项目分析工作台", hint: "漏斗·页面·流失原因" },
  { key: "evidence", label: "证据与事件明细", hint: "事件链与原始参数" },
  { key: "issues", label: "问题修复闭环", hint: "任务·重测·效果" },
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

const productStages: FunnelStage[] = [
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
  { label: "Ad Request", event: "jk_ad_request", value: "201,944", rate: "94.2%", delta: "+0.8%" },
  { label: "Request Accepted", event: "request_accepted_derived", value: "198,511", rate: "98.3%", delta: "-0.3%", note: "客户端派生检查点，不等于 AdMob Match" },
  { label: "Load Success", event: "jk_ad_load_success", value: "191,842", rate: "95.0%", delta: "-0.5%" },
  { label: "Ad Ready", event: "jk_ad_ready", value: "187,604", rate: "97.8%", delta: "-0.2%" },
  { label: "Show Attempt", event: "jk_ad_show_attempt", value: "144,871", rate: "77.2%", delta: "-2.6%" },
  { label: "Impression", event: "jk_ad_impression", value: "137,628", rate: "95.0%", delta: "-0.4%" },
  { label: "Paid Event", event: "jk_ad_paid_event", value: "136,392", rate: "99.1%", delta: "+0.1%" },
];

const opportunityFulfillment = {
  opportunity: 214306,
  cacheHit: 146812,
  cacheMiss: 67494,
  realtimeRequest: 63204,
  requestAccepted: 62130,
  realtimeLoad: 61940,
  adReady: 60682,
  requestFailed: 1074,
  loadFailed: 190,
  readyLost: 1258,
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

const projectFunnelProfiles: Record<string, {
  userStages: FunnelStage[];
  viewerTrend: number[];
  opportunityTrend: number[];
  fulfillmentRate: string;
  preloadSuccess: string;
  cacheHitRate: string;
  impressionsPerViewer: string;
  requestCount: string;
  realtimeRequestUv: string;
  preloadRequestUv: string;
  requestsPerUser: string;
}> = {
  "IRAN-VPN-01": {
    userStages: [
      { label: "DAU", event: "app_active", value: "128,430", rate: "100%", delta: "+2.8%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "101,284", rate: "78.9%", delta: "-0.8%" },
      { label: "Eligible", event: "eligible=1", value: "83,106", rate: "82.1%", delta: "-1.3%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "36,474", rate: "43.9%", delta: "-12.8%" },
      { label: "Request", event: "jk_ad_request", value: "34,921", rate: "95.7%", delta: "-1.8%", note: "全量 Request UV，含预加载与实时请求；缓存命中可跳过", nonLinear: true },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "31,682", rate: "86.9%", delta: "-0.7%", note: "相对 Opportunity UV；缓存与实时请求两路合并", nonLinear: true },
      { label: "AV", event: "jk_ad_impression", value: "29,671", rate: "93.7%", delta: "-0.7%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "29,404", rate: "99.1%", delta: "+0.1%" },
    ],
    viewerTrend: [34.9, 35.4, 34.6, 35.1, 31.8, 26.7, 23.1], opportunityTrend: [41.2, 41.6, 40.8, 40.9, 37.6, 32.9, 28.4], fulfillmentRate: "86.9%", preloadSuccess: "93.0%", cacheHitRate: "68.5%", impressionsPerViewer: "3.42", requestCount: "201,944", realtimeRequestUv: "10,755", preloadRequestUv: "27,840", requestsPerUser: "5.78",
  },
  "FAST-VPN-02": {
    userStages: [
      { label: "DAU", event: "app_active", value: "96,510", rate: "100%", delta: "+1.6%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "79,426", rate: "82.3%", delta: "+0.4%" },
      { label: "Eligible", event: "eligible=1", value: "69,153", rate: "87.1%", delta: "+0.2%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "40,631", rate: "58.8%", delta: "+0.8%" },
      { label: "Request", event: "jk_ad_request", value: "38,447", rate: "94.6%", delta: "+0.3%", note: "全量 Request UV，含预加载与实时请求；缓存命中可跳过", nonLinear: true },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "36,973", rate: "91.0%", delta: "+0.4%", note: "相对 Opportunity UV；缓存与实时请求两路合并", nonLinear: true },
      { label: "AV", event: "jk_ad_impression", value: "34,551", rate: "93.5%", delta: "+0.5%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "34,274", rate: "99.2%", delta: "+0.1%" },
    ],
    viewerTrend: [34.8, 35.1, 35.3, 35.0, 35.5, 35.6, 35.8], opportunityTrend: [41.4, 41.7, 41.8, 41.6, 41.9, 42.0, 42.1], fulfillmentRate: "91.0%", preloadSuccess: "94.6%", cacheHitRate: "72.4%", impressionsPerViewer: "3.18", requestCount: "218,402", realtimeRequestUv: "10,472", preloadRequestUv: "30,194", requestsPerUser: "5.68",
  },
  "CLEAN-MAX-03": {
    userStages: [
      { label: "DAU", event: "app_active", value: "76,210", rate: "100%", delta: "+0.9%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "63,402", rate: "83.2%", delta: "+0.1%" },
      { label: "Eligible", event: "eligible=1", value: "55,924", rate: "88.2%", delta: "-0.3%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "34,371", rate: "61.5%", delta: "-0.7%" },
      { label: "Request", event: "jk_ad_request", value: "32,810", rate: "95.5%", delta: "-5.1%", note: "全量 Request UV，含预加载与实时请求；缓存命中可跳过", nonLinear: true },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "31,107", rate: "90.5%", delta: "-1.1%", note: "相对 Opportunity UV；缓存与实时请求两路合并", nonLinear: true },
      { label: "AV", event: "jk_ad_impression", value: "29,493", rate: "94.8%", delta: "-0.8%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "29,198", rate: "99.0%", delta: "0.0%" },
    ],
    viewerTrend: [39.4, 39.0, 39.2, 38.9, 38.6, 38.9, 38.7], opportunityTrend: [46.2, 46.0, 45.8, 45.5, 45.2, 45.3, 45.1], fulfillmentRate: "90.5%", preloadSuccess: "88.2%", cacheHitRate: "61.6%", impressionsPerViewer: "4.06", requestCount: "164,050", realtimeRequestUv: "12,349", preloadRequestUv: "25,844", requestsPerUser: "5.00",
  },
  "AIVORA-LAUNCHER": {
    userStages: [
      { label: "DAU", event: "app_active", value: "54,870", rate: "100%", delta: "+4.1%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "43,106", rate: "78.6%", delta: "+0.6%" },
      { label: "Eligible", event: "eligible=1", value: "38,950", rate: "90.4%", delta: "+0.2%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "20,632", rate: "53.0%", delta: "-0.5%" },
      { label: "Request", event: "jk_ad_request", value: "19,601", rate: "95.0%", delta: "-0.4%", note: "全量 Request UV，含预加载与实时请求；缓存命中可跳过", nonLinear: true },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "18,610", rate: "90.2%", delta: "+0.2%", note: "相对 Opportunity UV；缓存与实时请求两路合并", nonLinear: true },
      { label: "AV", event: "jk_ad_impression", value: "17,229", rate: "92.6%", delta: "+0.3%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "17,108", rate: "99.3%", delta: "+0.1%" },
    ],
    viewerTrend: [30.5, 30.8, 31.0, 30.9, 31.2, 31.1, 31.4], opportunityTrend: [36.9, 37.1, 37.0, 37.4, 37.2, 37.5, 37.6], fulfillmentRate: "90.2%", preloadSuccess: "92.1%", cacheHitRate: "70.8%", impressionsPerViewer: "2.87", requestCount: "91,355", realtimeRequestUv: "5,642", preloadRequestUv: "15,826", requestsPerUser: "4.66",
  },
  "TURBO-CLEAN-05": {
    userStages: [
      { label: "DAU", event: "app_active", value: "41,360", rate: "100%", delta: "-0.4%" },
      { label: "Eligibility Check", event: "jk_ad_eligibility_check", value: "32,111", rate: "77.6%", delta: "-1.2%" },
      { label: "Eligible", event: "eligible=1", value: "27,840", rate: "86.7%", delta: "-0.9%" },
      { label: "Opportunity", event: "jk_ad_opportunity", value: "10,133", rate: "36.4%", delta: "-8.1%" },
      { label: "Request", event: "jk_ad_request", value: "9,446", rate: "93.2%", delta: "-3.4%", note: "全量 Request UV，含预加载与实时请求；缓存命中可跳过", nonLinear: true },
      { label: "Show Attempt", event: "jk_ad_show_attempt", value: "8,856", rate: "87.4%", delta: "-2.3%", note: "相对 Opportunity UV；缓存与实时请求两路合并", nonLinear: true },
      { label: "AV", event: "jk_ad_impression", value: "8,189", rate: "92.5%", delta: "-1.0%" },
      { label: "Paid", event: "jk_ad_paid_event", value: "8,098", rate: "98.9%", delta: "-0.2%" },
    ],
    viewerTrend: [28.1, 27.4, 25.8, 24.0, 22.7, 20.9, 19.8], opportunityTrend: [33.9, 32.8, 30.6, 29.3, 27.6, 25.6, 24.5], fulfillmentRate: "87.4%", preloadSuccess: "84.8%", cacheHitRate: "49.7%", impressionsPerViewer: "3.76", requestCount: "48,990", realtimeRequestUv: "4,726", preloadRequestUv: "7,301", requestsPerUser: "5.19",
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

const requestReasons = [
  { code: "PRELOAD_NOT_AVAILABLE", label: "预加载未成功，窗口内没有可关联的请求记录", users: "618", share: 39.8, impact: "$37", owner: "客户端 / 广告" },
  { code: "REQUEST_CONTEXT_MISSING", label: "请求已触发但 request_id 或用户上下文缺失", users: "373", share: 24.0, impact: "$22", owner: "客户端 / 数据" },
  { code: "REALTIME_REQUEST_NOT_SENT", label: "缓存未命中后未发起实时请求", users: "280", share: 18.0, impact: "$17", owner: "广告 SDK" },
  { code: "APP_BACKGROUND", label: "请求完成前 App 进入后台", users: "171", share: 11.0, impact: "$10", owner: "客户端" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端已请求但 Firebase 未收到请求事件", users: "78", share: 5.0, impact: "$5", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "31", share: 2.0, impact: "$2", owner: "数据" },
];

const impressionReasons = [
  { code: "SHOW_FAILED", label: "SDK 返回展示失败或 Activity 状态无效", users: "2,611", share: 36.1, impact: "$158", owner: "客户端 / 广告 SDK" },
  { code: "IMPRESSION_TIMEOUT", label: "Show Attempt 后窗口内未收到 Impression 回调", users: "1,947", share: 26.9, impact: "$118", owner: "广告 SDK" },
  { code: "PAGE_LEFT", label: "展示完成前离开当前页面", users: "1,318", share: 18.2, impact: "$80", owner: "产品 / 客户端" },
  { code: "APP_BACKGROUND", label: "展示完成前 App 进入后台", users: "866", share: 12.0, impact: "$52", owner: "客户端" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端已展示但 Firebase 未收到 Impression", users: "348", share: 4.8, impact: "$21", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "145", share: 2.0, impact: "$9", owner: "数据" },
];

const paidReasons = [
  { code: "PAID_CALLBACK_MISSING", label: "Impression 后未收到 Paid Event 回调", users: "792", share: 64.1, impact: "$48", owner: "广告 SDK" },
  { code: "INVALID_VALUE", label: "value_micros、currency_code 或精度不合法", users: "198", share: 16.0, impact: "$12", owner: "客户端 / 数据" },
  { code: "DUPLICATE_CALLBACK", label: "同一 ad_instance_id 收到重复 Paid 回调", users: "124", share: 10.0, impact: "$7", owner: "客户端 / 数据" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端有回调但 Firebase 未收到事件", users: "98", share: 7.9, impact: "$6", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "24", share: 2.0, impact: "$1", owner: "数据" },
];

const cohortRows = [
  { value: "伊朗", volume: "48,420", base: "52.1%", current: "31.8%", change: "-20.3pp", lost: "9,829", impact: "$592", level: "bad" },
  { value: "埃及", volume: "18,304", base: "49.6%", current: "42.7%", change: "-6.9pp", lost: "1,263", impact: "$76", level: "warn" },
  { value: "土耳其", volume: "15,887", base: "47.2%", current: "45.4%", change: "-1.8pp", lost: "286", impact: "$17", level: "ok" },
  { value: "巴基斯坦", volume: "12,641", base: "44.8%", current: "46.1%", change: "+1.3pp", lost: "—", impact: "+$10", level: "good" },
  { value: "印度尼西亚", volume: "9,218", base: "41.3%", current: "40.7%", change: "-0.6pp", lost: "55", impact: "$3", level: "ok" },
];

const productPageProfiles = {
  "连接成功页": {
    pageUv: "117,804", arrival: "91.7%", exposure: "88.3%", click: "79.1%", success: "78.0%", exit: "11.8%",
    renderP50: "420ms", renderP95: "1.8s", apiLatency: "680ms", errorRate: "0.7%", whiteScreen: "0.12%",
    opportunity: "36,474", av: "29,671", impression: "101,505", revenue: "$2,147",
    chain: [
      ["进入页面", "117,804", "vpn_connect_result_view"], ["渲染完成", "116,980", "99.3%"], ["核心元素曝光", "104,122", "89.0%"],
      ["主按钮点击", "82,361", "79.1%"], ["业务成功", "64,276", "78.0%"], ["广告机会", "36,474", "56.7%"], ["广告展示用户 AV", "29,671", "81.4%"],
    ],
  },
  "VPN 首页": {
    pageUv: "128,430", arrival: "100%", exposure: "94.8%", click: "64.1%", success: "50.0%", exit: "18.6%",
    renderP50: "360ms", renderP95: "1.4s", apiLatency: "540ms", errorRate: "0.4%", whiteScreen: "0.08%",
    opportunity: "31,208", av: "25,940", impression: "78,328", revenue: "$1,689",
    chain: [
      ["进入页面", "128,430", "vpn_home_view"], ["渲染完成", "127,602", "99.4%"], ["核心元素曝光", "121,744", "95.4%"],
      ["主按钮点击", "82,361", "67.7%"], ["业务成功", "64,276", "78.0%"], ["广告机会", "31,208", "48.6%"], ["广告展示用户 AV", "25,940", "83.1%"],
    ],
  },
  "服务器选择页": {
    pageUv: "46,820", arrival: "36.5%", exposure: "92.1%", click: "53.8%", success: "81.4%", exit: "23.7%",
    renderP50: "510ms", renderP95: "2.3s", apiLatency: "910ms", errorRate: "1.2%", whiteScreen: "0.19%",
    opportunity: "12,682", av: "9,844", impression: "28,843", revenue: "$634",
    chain: [
      ["进入页面", "46,820", "server_select_view"], ["渲染完成", "45,982", "98.2%"], ["核心元素曝光", "42,351", "92.1%"],
      ["主按钮点击", "22,786", "53.8%"], ["业务成功", "18,548", "81.4%"], ["广告机会", "12,682", "68.4%"], ["广告展示用户 AV", "9,844", "77.6%"],
    ],
  },
} as const;

const pageHealthRows = [
  ["连接成功页", "117,804", "91.7%", "88.3%", "79.1%", "78.0%", "11.8%", "36,474", "29,671", "$2,147", "预警"],
  ["VPN 首页", "128,430", "100%", "94.8%", "64.1%", "50.0%", "18.6%", "31,208", "25,940", "$1,689", "正常"],
  ["服务器选择页", "46,820", "36.5%", "92.1%", "53.8%", "81.4%", "23.7%", "12,682", "9,844", "$634", "预警"],
  ["断开连接页", "38,604", "30.1%", "90.6%", "42.8%", "96.2%", "28.4%", "8,931", "7,504", "$406", "正常"],
];

const pageElementRows = [
  ["连接按钮", "connect_primary", "104,122", "82,361", "79.1%", "64,276", "主要转化入口"],
  ["换节点按钮", "change_server", "76,884", "18,402", "23.9%", "15,731", "弱网用户点击更高"],
  ["加速动画", "success_animation", "116,980", "—", "—", "64,276", "P95 1.8s，可能延迟机会"],
  ["订阅入口", "premium_entry", "92,315", "4,608", "5.0%", "1,246", "与广告资格互斥"],
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

const formatLogTime = (value?: string | null) => value ? value.replace("T", " ").slice(0, 19) : "—";
const formatLogRows = (value?: number) => typeof value === "number" ? value.toLocaleString("zh-CN") : "—";
const formatLogDuration = (value?: number | null) => {
  if (!value) return "—";
  if (value < 1000) return `${value}ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60000)}m${Math.round((value % 60000) / 1000)}s`;
};
const statusTone = (status?: string): "neutral" | "good" | "warn" | "bad" | "blue" => {
  const value = (status ?? "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "FINISHED", "PASS", "ACTIVE"].includes(value)) return "good";
  if (["RUNNING", "PROCESSING", "VERIFYING", "QUEUED"].includes(value)) return "blue";
  if (["NO_DATA", "SKIPPED", "DEGRADED"].includes(value)) return "warn";
  if (["FAILED", "FAIL", "ERROR", "MISMATCH"].includes(value)) return "bad";
  return "neutral";
};
const isFailedStatus = (status?: string) => ["FAILED", "FAIL", "ERROR", "MISMATCH"].includes((status ?? "").toUpperCase());
const isRunningStatus = (status?: string) => ["RUNNING", "PROCESSING", "VERIFYING", "QUEUED"].includes((status ?? "").toUpperCase());
const logProjectLabel = (item: FirebaseSyncRunLog | FirebaseCheckLog) => item.projectCode || item.projectName || "连接级日志";

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
  const [taskKeyword, setTaskKeyword] = useState("");
  const [syncRuns, setSyncRuns] = useState<FirebaseSyncRunLog[]>([]);
  const [checkLogs, setCheckLogs] = useState<FirebaseCheckLog[]>([]);
  const [taskLogLoading, setTaskLogLoading] = useState(false);
  const [taskLogError, setTaskLogError] = useState("");
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

  const loadFirebaseTaskLogs = useMemo(() => {
    return async () => {
      if (module !== "tasks") return;
      setTaskLogLoading(true);
      setTaskLogError("");
      try {
        const query = {
          keyword: taskKeyword || undefined,
          status: taskFilter === "failed" ? "FAILED" : taskFilter === "running" ? "RUNNING" : undefined,
          page: 1,
          pageSize: 50,
        };
        const [runs, logs] = await Promise.all([
          firebaseTaskLogsApi.syncRuns(query),
          firebaseTaskLogsApi.checkLogs({
            keyword: taskKeyword || undefined,
            status: taskFilter === "failed" ? "FAIL" : undefined,
            page: 1,
            pageSize: 50,
          }),
        ]);
        setSyncRuns(runs.items ?? []);
        setCheckLogs(logs.items ?? []);
      } catch (error) {
        setSyncRuns([]);
        setCheckLogs([]);
        setTaskLogError(error instanceof Error ? error.message : "Firebase 数据任务日志加载失败");
      } finally {
        setTaskLogLoading(false);
      }
    };
  }, [module, taskFilter, taskKeyword]);

  useEffect(() => {
    void loadFirebaseTaskLogs();
  }, [loadFirebaseTaskLogs]);
  const admobRows: Record<AdMobDimension, string[][]> = {
    format: [["插屏","128,420","100%","72.4%","90,216","21,904","4.12","$38.42","$3,466","正常"],["激励视频","31,842","99.8%","81.6%","25,912","12,404","2.09","$42.18","$1,093","正常"],["Banner","41,682","100%","51.4%","21,500","18,621","1.15","$12.19","$262","预警"]],
    placement: [["vpn_connect_success","86,204","100%","74.8%","62,104","18,406","3.37","$41.20","$2,558","正常"],["vpn_home_banner","41,682","100%","51.4%","21,500","18,621","1.15","$12.19","$262","预警"],["server_select","38,214","99.7%","67.2%","24,908","9,682","2.57","$36.44","$908","正常"],["vpn_disconnect","35,844","100%","76.5%","29,116","8,204","3.55","$37.54","$1,093","正常"]],
    country: [["伊朗","122,804","100%","68.1%","81,620","17,904","4.56","$32.84","$2,680","预警"],["埃及","31,442","99.9%","73.8%","22,942","6,802","3.37","$38.21","$877","正常"],["土耳其","24,606","100%","75.4%","18,406","4,106","4.48","$42.19","$776","正常"],["其他","23,092","99.8%","72.3%","14,660","4,018","3.65","$33.29","$488","正常"]],
  };
  const configTables: Record<ConfigPackageTab, { headers: string[]; rows: string[][] }> = {
    events: {
      headers: ["事件","业务阶段","优先级","触发时机","参数数","适用端","来源别名","状态"],
      rows: trackingEventCatalog.map((event) => [event.name, event.stage, event.priority, event.triggerTiming, String(event.parameterCount), event.platform, event.sourceAlias, "已加载"]),
    },
    fields: {
      headers: ["字段","类型","入库方式","适用事件","字段说明","字段顺序","来源版本","状态"],
      rows: trackingDatabaseFieldRows.map((field) => {
        const event = trackingEventCatalog.find((item) => item.id === field.eventId);
        return [field.fieldName, field.dataType, field.reportingMode, event?.name ?? field.eventId, field.description, String(field.fieldOrder), trackingConfigDataSource.schemaVersion, "已加载"];
      }),
    },
    enums: {
      headers: ["枚举组","枚举值/说明","适用字段","来源版本","状态"],
      rows: [["字段描述中的枚举", "当前按数据库字段说明展示；数据库枚举表待接入", "tracking_event_fields.description", trackingConfigDataSource.schemaVersion, "待接数据库枚举表"]],
    },
    providers: {
      headers: ["Provider","负责模块","输出字段","适用端","来源版本","状态"],
      rows: Array.from(new Map(trackingEventCatalog.map((event) => [event.provider, event])).values()).map((event) => [event.provider, event.stage, `${event.name} 等事件`, event.platform, trackingConfigDataSource.schemaVersion, "按事件表读取"]),
    },
  };
  const visibleSyncRuns = syncRuns.filter((row) => taskFilter === "all" || (taskFilter === "failed" && isFailedStatus(row.status)) || (taskFilter === "running" && isRunningStatus(row.status)));
  const visibleCheckLogs = checkLogs.filter((row) => taskFilter !== "failed" || isFailedStatus(row.status));
  const failedSyncRuns = syncRuns.filter((row) => isFailedStatus(row.status)).length;
  const runningSyncRuns = syncRuns.filter((row) => isRunningStatus(row.status)).length;
  const failedCheckLogs = checkLogs.filter((row) => isFailedStatus(row.status)).length;
  const latestRunTime = syncRuns[0]?.startedAt || syncRuns[0]?.createdAt;
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
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>全链路诊断</h2><p>从安装、活跃、产品使用到广告变现</p></div><Badge tone="bad">1 个核心阻塞</Badge></div><div className="diagnostic-chain">{[["安装","31,842","100%","normal"],["活跃","128,430","—","normal"],["连接成功","64,276","50.0%","normal"],["广告机会","36,474","28.4%","bad"],["广告展示独立用户 AV","29,671","23.1%","bad"],["付费回调","29,404","99.1%","normal"]].map(([label,value,rate,status],index) => <div key={String(label)} className={status === "bad" ? "bad" : ""}><span>{index+1}</span><strong>{label}</strong><em>{value}</em><small>{rate}</small></div>)}</div><div className="diagnosis-callout"><Badge tone="bad">核心问题</Badge><strong>请求前广告机会覆盖不足</strong><p>请求后的加载与展示效率正常；无需先调整 AdMob 填充策略。</p><button onClick={() => openModule("funnel")}>进入漏斗分析</button></div></div><aside className="surface"><div className="surface-title"><div><h2>快速检查</h2><p>按问题优先级执行</p></div></div><div className="quick-checks"><button onClick={() => openModule("funnel")}><span>1</span><div><strong>漏斗异常</strong><p>Eligible → Opportunity -12.8pp</p></div><Badge tone="bad">严重</Badge></button><button onClick={() => openModule("firebase")}><span>2</span><div><strong>Firebase质量</strong><p>P0字段完整率 99.1%</p></div><Badge tone="warn">预警</Badge></button><button onClick={() => openModule("admob")}><span>3</span><div><strong>AdMob效率</strong><p>匹配100% · 展示70.2%</p></div><Badge tone="good">正常</Badge></button><button onClick={() => openModule("reconcile")}><span>4</span><div><strong>数据对账</strong><p>展示差异 1.7%</p></div><Badge tone="good">正常</Badge></button></div></aside></section>
    </div>
  );

  if (module === "admob") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="预估收入" value="$4,821" note="较昨日 -8.4%" tone="bad" /><Metric label="广告请求" value="201,944" note="+4.9%" /><Metric label="匹配率" value="100%" note="AdMob已结算" tone="good" /><Metric label="展示率" value="70.2%" note="目标 ≥68%" tone="good" /><Metric label="eCPM" value="$35.03" note="-3.1%" /><Metric label="广告展示独立用户 AV" value="29,671" note="人均展示 3.42 次" tone="bad" /></section>
      <section className="admob-split"><div className="surface"><div className="surface-title"><div><h2>用户覆盖</h2><p>回答有多少独立用户真正看到了广告</p></div><Badge tone="bad">异常</Badge></div><div className="big-ratio"><strong>23.1%</strong><span>广告展示独立用户比例（AV / DAU）</span><div><i style={{width:"23.1%"}} /></div></div><div className="ratio-details"><div><span>日活跃用户（DAU）</span><strong>128,430</strong></div><div><span>广告请求用户（Request UV）</span><strong>34,921</strong></div><div><span>广告展示独立用户（AV）</span><strong>29,671</strong></div><div><span>人均展示次数（Impression / AV）</span><strong>3.42</strong></div></div><button className="full-link" onClick={() => openModule("funnel")}>定位用户覆盖漏斗 →</button></div><div className="surface"><div className="surface-title"><div><h2>请求后效率</h2><p>回答广告 SDK 链路是否健康</p></div><Badge tone="good">正常</Badge></div><div className="efficiency-chain">{[["Request","201,944","100%"],["Matched","201,944","100%"],["Show","141,760","70.2%"],["Impression","137,628","97.1%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><Badge tone={row[0] === "Show" ? "blue" : "good"}>{row[2]}</Badge></div>)}</div><div className="conclusion-block good"><strong>结论</strong><p>AdMob匹配和请求后展示正常，低 AV 主要不是填充问题。</p></div></div></section>
      <section className="surface"><div className="surface-title"><div><h2>广告维度明细</h2><p>切换广告格式、广告位和国家，模拟不同问题定位角度</p></div><div className="dimension-tabs"><button className={admobDimension === "format" ? "active" : ""} onClick={() => setAdmobDimension("format")}>广告格式</button><button className={admobDimension === "placement" ? "active" : ""} onClick={() => setAdmobDimension("placement")}>广告位</button><button className={admobDimension === "country" ? "active" : ""} onClick={() => setAdmobDimension("country")}>国家</button></div></div><div className="table-wrap"><table><thead><tr><th>{admobDimension === "format" ? "广告格式" : admobDimension === "placement" ? "广告位" : "国家"}</th><th>请求</th><th>匹配率</th><th>展示率</th><th>展示总次数（Impression）</th><th>展示独立用户（AV）</th><th>人均展示次数</th><th>eCPM</th><th>收入</th><th>状态</th></tr></thead><tbody>{admobRows[admobDimension].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 9 ? <Badge tone={cell === "正常" ? "good" : "warn"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>Mediation Adapter</h2><p>按收入贡献和错误率排序</p></div></div><div className="adapter-list">{[["Google Ads","62.4%","$3,009","0.3%"],["Meta Audience Network","18.7%","$902","1.1%"],["AppLovin","12.8%","$617","0.8%"],["Unity Ads","6.1%","$293","2.4%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><div><i style={{width:row[1]}} /></div><span>{row[2]}</span><small>错误 {row[3]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>收入异常说明</h2><p>自动关联相关指标</p></div></div><div className="conclusion-block warn"><strong>收入下降不是 eCPM 单因子</strong><p>eCPM下降3.1%，但AV下降12.4%；用户覆盖是更大的收入损失来源。</p></div><button className="primary-button full" onClick={() => openModule("project")}>返回单项目诊断</button></aside></section>
    </div>
  );

  if (module === "firebase") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="Firebase DAU" value="128,430" note="实时 · 延迟8分钟" /><Metric label="中台 DAU" value="124,208" note="差异 3.3%" tone="bad" /><Metric label="今日事件量" value="8.42M" note="+5.7%" /><Metric label="P0参数完整率" value="99.1%" note="目标100%" tone="bad" /><Metric label="未知事件率" value="0.18%" note="目标&lt;0.5%" tone="good" /><Metric label="隔离事件" value="2,184" note="缺ID 1,602" tone="bad" /></section>
      <section className="firebase-status"><div><span className="status-dot" /><strong>Firebase Export</strong><p>最近入库 15:31 · 正常</p></div><i /><div><span className="status-dot" /><strong>标准化任务</strong><p>批次 fb_1530 · 正常</p></div><i /><div><span className="status-dot" /><strong>ADB 聚合</strong><p>水位 15:22 · 延迟9分钟</p></div><i /><div><span className="status-dot warn" /><strong>中台接口</strong><p>成功率 96.7% · 预警</p></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>事件健康度</h2><p>按P0覆盖、参数和关联链综合判断</p></div><button className="text-button" onClick={() => openModule("tracking")}>进入打点验收</button></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>今日用户</th><th>事件量</th><th>P0参数</th><th>event_id</th><th>关联链</th><th>版本覆盖</th><th>状态</th></tr></thead><tbody>{[["jk_ad_request","34,921","201,944","100%","100%","99.8%","98.6%","正常"],["jk_ad_impression","29,671","137,628","99.1%","100%","97.8%","异常"],["connect_success","64,276","71,804","100%","99.9%","99.7%","99.2%","正常"],["app_background","82,104","126,908","98.7%","100%","—","96.4%","预警"],["jk_ad_paid_event","29,404","136,392","100%","100%","99.1%","98.6%","正常"]].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></div><aside className="surface"><div className="surface-title"><div><h2>主要质量问题</h2><p>按影响事件量排序</p></div></div><div className="quality-issues"><button onClick={() => openModule("tracking")}><Badge tone="bad">P0</Badge><strong>impression缺opportunity_id</strong><span>1,824 条 · 1.3%</span></button><button onClick={() => openModule("reconcile")}><Badge tone="warn">同步</Badge><strong>中台接口上报失败</strong><span>4,222 用户 · 3.3%</span></button><button><Badge tone="warn">P1</Badge><strong>background_reason 缺失</strong><span>1,649 条 · 1.3%</span></button><button><Badge tone="neutral">隔离</Badge><strong>event_id 为空</strong><span>1,602 条</span></button></div></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>版本与用户覆盖</h2><p>确认新版本是否完整接入全部事件</p></div><Badge tone="blue">Android</Badge></div><div className="version-coverage">{[["1.8.0 (108)","68.4%",68,"99.1%","31/31"],["1.7.4 (104)","21.7%",22,"99.8%","31/31"],["1.7.2 (102)","7.1%",7,"98.9%","29/31"],["其他","2.8%",3,"95.2%","26/31"]].map(row => <div key={String(row[0])}><strong>{row[0]}</strong><span>{row[1]} DAU</span><div><i style={{width:`${row[2]}%`}} /></div><small>参数 {row[3]}</small><Badge tone={row[4] === "31/31" ? "good" : "warn"}>{row[4]} P0</Badge></div>)}</div></section>
      <details className="firebase-inline-settings"><summary><div><strong>Firebase 数据源设置</strong><span>连接、资源、同步、最新数据、接口健康与接口说明</span></div><Badge tone="good">2 个连接 · 正常</Badge><em>展开设置</em></summary><FirebaseConfiguration openDialog={openDialog} notify={notify} /></details>
    </div>
  );

  if (module === "firebaseSetup") return <FirebaseConfiguration openDialog={openDialog} notify={notify} />;

  if (module === "reconcile") return (
    <div className="page-stack">
      <section className="metric-grid five"><Metric label="对账项目" value="24" note="今日完成 22" /><Metric label="正常项目" value="19" note="差异&lt;3%" tone="good" /><Metric label="预警项目" value="3" note="差异3%–5%" /><Metric label="异常项目" value="2" note="差异&gt;5%" tone="bad" /><Metric label="待结算日期" value="3 天" note="AdMob T+3" /></section>
      <section className="reconcile-flow">{[["Firebase","用户/事件","128,430 DAU"],["AdMob","请求/展示/收入","T+3 已结算"],["OSS Raw","原始事件备份","8.42M"],["ADB","标准化事实表","水位15:22"],["中台报表","统一口径","差异告警"]].map((row,index) => <div key={row[0]}><span>{index+1}</span><strong>{row[0]}</strong><p>{row[1]}</p><small>{row[2]}</small></div>)}</section>
      <section className="surface"><div className="surface-title"><div><h2>核心指标对账</h2><p>今天仅对账 Firebase 与中台；AdMob 使用已结算日期</p></div><Badge tone="warn">2项异常</Badge></div><div className="table-wrap"><table><thead><tr><th>指标</th><th>日期</th><th>Firebase</th><th>AdMob</th><th>中台/ADB</th><th>差异率</th><th>容差</th><th>判定</th><th>建议</th></tr></thead><tbody>{[["DAU","今天","128,430","—","124,208","3.3%","≤2%","预警","检查中台接口"],["广告展示独立用户（AV）","8/8","31,284","30,901","31,022","1.2%","≤3%","正常","—"],["展示总次数（Impression）","8/8","142,821","140,432","141,076","1.7%","≤3%","正常","—"],["Paid Revenue","8/8","$5,018","$4,821","$5,001","4.1%","≤3%","异常","检查币种/时区"],["Request","8/8","203,812","201,944","202,405","0.9%","≤3%","正常","—"]].map(row => <tr key={`${row[0]}${row[1]}`}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>近7日差异趋势</h2><p>差异超过阈值自动创建问题</p></div></div><div className="diff-bars">{[["8/5",1.2,"good"],["8/6",1.6,"good"],["8/7",1.1,"good"],["8/8",1.7,"good"],["8/9",2.6,"warn"],["8/10",3.1,"bad"],["今天",3.3,"bad"]].map(row => <div key={row[0]}><span>{row[1]}%</span><i className={row[2]} style={{height:`${Number(row[1])*24}px`}} /><small>{row[0]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>异常归因</h2><p>DAU 差异 4,222 用户</p></div></div><div className="reason-list compact"><button><div className="reason-title"><strong>中台接口失败</strong><span>3,108 · 73.6%</span></div><div className="reason-bar"><span style={{width:"73.6%"}} /></div></button><button><div className="reason-title"><strong>重复去重规则</strong><span>724 · 17.1%</span></div><div className="reason-bar"><span style={{width:"17.1%"}} /></div></button><button><div className="reason-title"><strong>时区/跨日</strong><span>390 · 9.3%</span></div><div className="reason-bar"><span style={{width:"9.3%"}} /></div></button></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>创建同步任务告警</button></aside></section>
    </div>
  );

  if (module === "tracking") return <TrackingAcceptanceCenter project={project} projects={projects} configs={configs} onProjectChange={changeTrackingProduct} openConfig={() => openModule("config")} notify={notify} />;
  /* legacy acceptance prototype retained below for reference */
  if (false) return (
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
      <section className="config-head surface"><div><div className="eyebrow">事件主库 → 分类勾选/单点剔除 → 配置 → 发布快照 → 验收Run</div><h2>打点配置管理</h2><p>按当前数据源的事件主表和字段表组装配置；可整模块选择，也可取消任一单事件。</p></div><div><Badge tone="blue">{trackingConfigDataSource.eventCount} 个事件 · {trackingConfigDataSource.fieldCount} 条字段</Badge><button className="primary-button" onClick={() => openConfigEditor(null)}>＋ 新建打点配置</button></div></section>
      <section className="config-data-source surface"><div className="surface-title"><div><h2>数据源状态</h2><p>页面字段统一从 repository 数据模型读取；提供数据库后只替换数据加载层，配置页面结构不变。</p></div><Badge tone={trackingConfigDataSource.sourceType === "database" ? "good" : "warn"}>{trackingConfigDataSource.sourceType === "database" ? "数据库已连接" : "本地镜像预览"}</Badge></div><div className="config-source-grid"><div><span>当前数据源</span><strong>{trackingConfigDataSource.sourceLabel}</strong><small>{trackingConfigDataSource.sourceType === "database" ? "线上数据库读取" : "暂未连接数据库"}</small></div><div><span>Schema 版本</span><strong>{trackingConfigDataSource.schemaVersion}</strong><small>事件 {trackingConfigDataSource.eventCount} 条 · 字段 {trackingConfigDataSource.fieldCount} 条</small></div><div><span>事件主表</span><strong>{trackingConfigDataSource.eventTable}</strong><small>事件主键用于关联字段明细</small></div><div><span>字段明细表</span><strong>{trackingConfigDataSource.fieldTable}</strong><small>按 field_order 保持展示顺序</small></div><div><span>最近读取</span><strong>{trackingConfigDataSource.fetchedAt}</strong><small>接库后改为数据库读取时间</small></div><div><span>接入位置</span><strong>tracking-config-repository.ts</strong><small>数据库信息待提供后替换 provider</small></div></div><div className={`config-source-note ${trackingConfigDataSource.sourceType === "database" ? "connected" : "pending"}`}><strong>{trackingConfigDataSource.sourceType === "database" ? "当前页面已使用数据库字段" : "当前仅用于页面预览"}</strong><span>{trackingConfigDataSource.sourceType === "database" ? "事件、字段、Provider 和配置统计均来自数据库快照。" : "V1.7 本地镜像只用于确认页面结构和交互，不代表已经连接线上数据库，也不会写入线上数据。"}</span></div></section>
      <section className="surface"><div className="surface-title"><div><h2>配置版本</h2><p>草稿可原地编辑；发布后生成不可变 snapshot_id，修改已发布配置时会复制为新版本。</p></div><Badge tone="neutral">共 {configs.length} 个版本</Badge></div><div className="table-wrap"><table><thead><tr><th>配置名称 / ID</th><th>版本</th><th>品类</th><th>关联项目</th><th>已选 / 全量</th><th>P0 / P1 / P2</th><th>场景</th><th>状态</th><th>快照</th><th>操作</th></tr></thead><tbody>{configs.map((config) => <tr key={config.id} className={`clickable-row ${selectedConfigRecord.id === config.id ? "row-selected" : ""}`} onClick={() => setSelectedConfigId(config.id)}><td><strong>{config.name}</strong><small>{config.id}</small></td><td>{config.version}</td><td>{config.category}</td><td>{config.projects.join("、")}</td><td><strong>{config.selectedCount} / {config.totalCount}</strong><small>配置覆盖 {((config.selectedCount / Math.max(config.totalCount, 1)) * 100).toFixed(1)}%</small></td><td>{config.p0Count} / {config.p1Count} / {config.p2Count}</td><td>{config.sceneCount}</td><td><Badge tone={config.status === "PUBLISHED" ? "good" : config.status === "REVIEWING" ? "blue" : "warn"}>{config.status === "PUBLISHED" ? "已发布" : config.status === "REVIEWING" ? "评审中" : "草稿"}</Badge></td><td>{config.snapshotId ? <strong>{config.snapshotId}</strong> : "—"}</td><td><div className="row-actions"><button onClick={(event) => { event.stopPropagation(); openConfigEditor(config); }}>{config.status === "PUBLISHED" ? "复制为新版本" : "编辑草稿"}</button>{config.status === "DRAFT" && <button onClick={(event) => { event.stopPropagation(); openConfigEditor(config); }}>编辑并发布</button>}<button onClick={(event) => { event.stopPropagation(); notify(`${config.id} 详情已展开`); }}>详情</button></div></td></tr>)}</tbody></table></div></section>
      <section className="selected-config-summary surface"><div><span>当前查看</span><strong>{selectedConfigRecord.name} {selectedConfigRecord.version}</strong><small>{selectedConfigRecord.id}</small></div><div><span>事件范围</span><strong>{selectedConfigRecord.selectedCount}/{selectedConfigRecord.totalCount}</strong><small>仅这 {selectedConfigRecord.selectedCount} 个进入验收分母</small></div><div><span>优先级</span><strong>P0 {selectedConfigRecord.p0Count} · P1 {selectedConfigRecord.p1Count} · P2 {selectedConfigRecord.p2Count}</strong><small>P0必须100%</small></div><div><span>发布引用</span><strong>{selectedConfigRecord.snapshotId ?? "尚未生成"}</strong><small>{selectedConfigRecord.status === "PUBLISHED" ? "可用于新建验收Run" : "发布后才可用于测试"}</small></div></section>
      <section className="config-layout"><div className="surface"><div className="surface-title"><div><h2>项目主品类</h2><p>作为配置筛选模板，不直接决定验收分母</p></div><button className="text-button" onClick={() => openDialog("project-category")}>＋新增</button></div><div className="category-list">{[["套利 VPN","v1.7 · 14项目","连接、权限、服务器、协议、连接广告"],["清理","v1.5 · 8项目","扫描、清理、结果、大小、清理广告"],["Launcher","v1.3 · 6项目","引导、默认桌面、主题、桌面交互"]].map((row)=><button key={row[0]} className={selectedCategory===row[0]?"selected":""} onClick={()=>setSelectedCategory(row[0])}><strong>{row[0]}</strong><span>{row[1]}</span><small>{row[2]}</small></button>)}</div></div><div className="surface"><div className="surface-title"><div><h2>{selectedConfigRecord.name} · 范围组成</h2><p>配置最终范围来自人工选择，并保留能力包来源</p></div><Badge tone="blue">{selectedConfigRecord.selectedCount}事件</Badge></div><div className="resolution-list"><div><span>标准事件总表</span><strong>V1.7 全量可选事件</strong><em>{selectedConfigRecord.totalCount}</em></div><div><span>当前已选</span><strong>{selectedConfigRecord.category} 当前版本</strong><em>{selectedConfigRecord.selectedCount}</em></div><div><span>当前未选</span><strong>本版本不适用事件</strong><em>{selectedConfigRecord.totalCount - selectedConfigRecord.selectedCount}</em></div><div><span>事件字段</span><strong>随所选事件自动纳入</strong><em>{trackingEventCatalog.filter((event) => selectedConfigRecord.selectedEventIds?.includes(event.id)).reduce((sum, event) => sum + event.parameterCount, 0)}</em></div></div><div className="conclusion-block good"><strong>最终选择 {selectedConfigRecord.selectedCount}/{selectedConfigRecord.totalCount}</strong><p>品类只提供推荐；最终以配置中逐项勾选并发布的事件快照为准。</p></div></div><aside className="surface"><div className="surface-title"><div><h2>发布检查</h2><p>规则完整性</p></div></div><div className="publish-checks"><div><span>✓</span><p>已选择{selectedConfigRecord.selectedCount}个事件并完成优先级</p></div><div><span>✓</span><p>{selectedConfigRecord.sceneCount}个场景均绑定应测事件</p></div><div><span>✓</span><p>P0参数和关联链已配置</p></div><div><span>{selectedConfigRecord.status === "PUBLISHED" ? "✓" : "!"}</span><p>{selectedConfigRecord.status === "PUBLISHED" ? `已生成快照 ${selectedConfigRecord.snapshotId}` : "尚未发布，不能创建验收Run"}</p></div></div><button className="primary-button full" onClick={() => selectedConfigRecord.status === "PUBLISHED" ? notify(`${selectedConfigRecord.snapshotId} 为只读快照`) : openConfigEditor(selectedConfigRecord)}>{selectedConfigRecord.status === "PUBLISHED" ? "查看发布快照" : "继续编辑并发布"}</button></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>事件与字段包</h2><p>切换查看事件、字段、枚举和Provider，不再使用静态页签</p></div><div className="dimension-tabs">{[["events","事件"],["fields","公共字段"],["enums","枚举"],["providers","Provider"]].map(([key,label])=><button key={key} className={configPackageTab===key?"active":""} onClick={()=>setConfigPackageTab(key as ConfigPackageTab)}>{label}</button>)}</div></div><div className="table-wrap"><table><thead><tr>{configTables[configPackageTab].headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{configTables[configPackageTab].rows.map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{(cell==="P0"||cell==="条件P0")?<Badge tone="bad">{cell}</Badge>:(["已发布","正常"].includes(cell))?<Badge tone="good">{cell}</Badge>:cell==="预警"?<Badge tone="warn">{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></section>
    </div>
  );

  return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="运行日志" value={String(syncRuns.length)} note={taskLogLoading ? "正在读取" : "Firebase同步任务"} /><Metric label="运行中" value={String(runningSyncRuns)} note="QUEUED/RUNNING/VERIFYING" tone={runningSyncRuns ? "good" : undefined} /><Metric label="失败运行" value={String(failedSyncRuns)} note="需排查或重试" tone={failedSyncRuns ? "bad" : undefined} /><Metric label="错误日志" value={String(failedCheckLogs)} note="Firebase预检失败" tone={failedCheckLogs ? "bad" : "good"} /><Metric label="检查记录" value={String(checkLogs.length)} note="服务账号/Firebase/BigQuery" /><Metric label="最近运行" value={formatLogTime(latestRunTime).slice(11) || "—"} note={latestRunTime ? formatLogTime(latestRunTime).slice(0, 10) : "等待同步"} /></section>
      <section className="surface firebase-task-console"><div className="surface-title"><div><h2>Firebase 数据任务日志</h2><p>统一展示 Firebase 资源检查、同步运行和错误日志，数据来自 ADB 控制表。</p></div><div className="dimension-tabs"><button className={taskFilter==="all"?"active":""} onClick={()=>setTaskFilter("all")}>全部</button><button className={taskFilter==="failed"?"active":""} onClick={()=>setTaskFilter("failed")}>失败</button><button className={taskFilter==="running"?"active":""} onClick={()=>setTaskFilter("running")}>运行中</button></div></div><div className="firebase-task-toolbar"><input value={taskKeyword} onChange={(event)=>setTaskKeyword(event.target.value)} onKeyDown={(event)=>{ if (event.key === "Enter") void loadFirebaseTaskLogs(); }} placeholder="搜索项目、包名、Firebase Project/App、错误信息" /><button className="secondary-button" onClick={() => { setTaskKeyword(""); setTaskFilter("all"); }}>重置</button><button className="primary-button" onClick={() => void loadFirebaseTaskLogs()}>{taskLogLoading ? "刷新中..." : "刷新日志"}</button></div>{taskLogError && <div className="firebase-log-state warn"><strong>日志接口待接入</strong><p>{taskLogError}。请在 Sites 环境变量配置 NEXT_PUBLIC_TRACKING_API_BASE_URL 和 NEXT_PUBLIC_TRACKING_API_SECURE_PATH，并确认后端已合并日志接口。</p></div>}</section>
      <section className="surface"><div className="surface-title"><div><h2>运行日志</h2><p>对应 ADB 表 <code>firebase_sync_runs</code>，用于查看 Firebase 绑定同步任务的水位、处理量和失败原因。</p></div><Badge tone={failedSyncRuns ? "bad" : "blue"}>{visibleSyncRuns.length} 条</Badge></div><div className="table-wrap"><table><thead><tr><th>任务 / 运行ID</th><th>项目</th><th>Firebase资源</th><th>时间范围</th><th>开始 / 结束</th><th>处理量</th><th>耗时</th><th>状态</th><th>错误</th></tr></thead><tbody>{visibleSyncRuns.length ? visibleSyncRuns.map((row) => <tr key={row.runId} className={isFailedStatus(row.status) ? "row-warn" : ""}><td><strong>{row.runType || "SYNC"}</strong><small>Run #{row.runId}{row.externalJobId ? ` · ${row.externalJobId}` : ""}</small></td><td><strong>{logProjectLabel(row)}</strong><small>{row.projectName || row.packageName || row.connectionName || "—"}</small></td><td><strong>{row.firebaseProjectId || "—"}</strong><small>{row.firebaseAppId || row.firebaseAppIdentifier || "—"}</small></td><td><strong>{formatLogTime(row.rangeStart)}</strong><small>{formatLogTime(row.rangeEnd)}</small></td><td><strong>{formatLogTime(row.startedAt)}</strong><small>{formatLogTime(row.finishedAt)}</small></td><td><strong>{formatLogRows(row.adbRows)} ADB</strong><small>{formatLogRows(row.sourceRows)} source</small></td><td>{formatLogDuration(row.durationMs)}</td><td><Badge tone={statusTone(row.status)}>{row.status || "UNKNOWN"}</Badge></td><td>{row.errorMessage || "—"}</td></tr>) : <tr><td colSpan={9}><div className="empty-table-state"><strong>{taskLogLoading ? "正在读取运行日志" : "暂无运行日志"}</strong><span>{taskLogError ? "后端接入后会显示真实 Firebase 同步运行记录。" : "当前筛选条件下没有记录。"}</span></div></td></tr>}</tbody></table></div></section>
      <section className="surface"><div className="surface-title"><div><h2>错误日志 / 接口检查</h2><p>对应 ADB 表 <code>firebase_api_check_logs</code>，覆盖服务账号、Firebase Project/App、BigQuery Dataset 和 events 表检查。</p></div><Badge tone={failedCheckLogs ? "bad" : "good"}>{failedCheckLogs} 个失败</Badge></div><div className="table-wrap"><table><thead><tr><th>检查项 / 日志ID</th><th>项目</th><th>Firebase资源</th><th>检查时间</th><th>耗时</th><th>结果</th><th>错误码</th><th>详情</th></tr></thead><tbody>{visibleCheckLogs.length ? visibleCheckLogs.map((row) => <tr key={row.logId} className={isFailedStatus(row.status) ? "row-warn" : ""}><td><strong>{row.checkType || "CHECK"}</strong><small>Log #{row.logId}</small></td><td><strong>{logProjectLabel(row)}</strong><small>{row.projectName || row.packageName || row.connectionName || "—"}</small></td><td><strong>{row.firebaseProjectId || "—"}</strong><small>{row.firebaseAppId || row.firebaseAppIdentifier || "—"}</small></td><td>{formatLogTime(row.checkedAt || row.createdAt)}</td><td>{formatLogDuration(row.durationMs)}</td><td><Badge tone={statusTone(row.status)}>{row.status || "UNKNOWN"}</Badge></td><td>{row.errorCode || "—"}</td><td>{row.message || "—"}</td></tr>) : <tr><td colSpan={8}><div className="empty-table-state"><strong>{taskLogLoading ? "正在读取错误日志" : "暂无错误日志"}</strong><span>{taskLogError ? "后端接入后会显示 Firebase 绑定预检错误和检查详情。" : "当前筛选条件下没有失败或检查记录。"}</span></div></td></tr>}</tbody></table></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>处理建议</h2><p>根据 Firebase 数据任务日志快速定位负责人和下一步动作。</p></div><button className="text-button" onClick={() => openModule("firebase")}>去 Firebase 数据源</button></div><div className="alert-list">{[["P0","SERVICE_ACCOUNT / OAuth 失败","检查 secret:// 引用、服务账号邮箱和 JSON 文件权限","数据平台"],["P0","BIGQUERY_DATASET 或 EVENTS_TABLES 失败","确认 Firebase BigQuery Export 已开启且 Dataset 区域一致","数据平台"],["P1","FIREBASE_APP 包名不一致","回到 Firebase 数据源设置核对 App ID 与 project_projects.package_name","产品/客户端"],["P1","同步运行失败或处理量为 0","查看 run error_message，修复后由任务系统重试","数据平台"]].map(row => <button key={row[1]} onClick={() => notify(`${row[1]}：${row[2]}`)}><Badge tone={row[0]==="P0"?"bad":"warn"}>{row[0]}</Badge><div><strong>{row[1]}</strong><p>{row[2]}</p><small>负责人：{row[3]}</small></div><span>→</span></button>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>告警通知</h2><p>当前值班策略</p></div></div><div className="notification-rules"><div><span>P0</span><strong>资源校验失败</strong><p>服务账号、Firebase App、BigQuery 不可读立即通知</p></div><div><span>P1</span><strong>同步任务失败</strong><p>连续失败或超过 SLA 通知数据平台</p></div><div><span>P2</span><strong>NO_DATA</strong><p>每日汇总未发现 events 表或数据水位为空</p></div></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>＋ 新建告警规则</button></aside></section>
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
  const [selectedProductPage, setSelectedProductPage] = useState<keyof typeof productPageProfiles>("连接成功页");
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
  const profileStageCount = (label: string) => Number(activeProfile.userStages.find((stage) => stage.label === label)?.value.replaceAll(",", "") ?? 0);
  const requestUvCoverage = profileStageCount("DAU") > 0 ? `${(profileStageCount("Request") / profileStageCount("DAU") * 100).toFixed(1)}%` : "—";
  const stages = useMemo(() => {
    if (funnelMode === "product") return productStages;
    return unitMode === "users" ? activeProfile.userStages : monetizationEventStages;
  }, [funnelMode, unitMode, activeProfile]);
  const firstStageCount = Number(stages.at(0)?.value.replaceAll(",", "") ?? 0);
  const lastStageCount = Number(stages.at(-1)?.value.replaceAll(",", "") ?? 0);
  const firstToLastRate = firstStageCount > 0 ? `${(lastStageCount / firstStageCount * 100).toFixed(1)}%` : "—";

  const currentPage = pages.find((item) => item.key === page) ?? pages[1];
  const currentModule = moduleCopy[module];
  const visibleEvents = eventRows
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !onlyErrors || event.result !== "有效");
  const issuePhase = issueStatus === "重测中" ? 3 : 2;
  const trendValues = trendMetric === "viewer" ? activeProfile.viewerTrend : activeProfile.opportunityTrend;
  const trendLabel = trendMetric === "viewer" ? "广告浏览者比例" : "Opportunity机会覆盖率";
  const isFulfillmentDiagnosis = transition.from === "Opportunity" && transition.to === "Show Attempt";
  const isRequestDiagnosis = transition.from === "Opportunity" && transition.to === "Request";
  const isImpressionDiagnosis = transition.from === "Show Attempt" && ["AV", "Impression"].includes(transition.to);
  const isPaidDiagnosis = ["AV", "Impression"].includes(transition.from) && ["Paid", "Paid Event"].includes(transition.to);
  const diagnosisReasons = isRequestDiagnosis ? requestReasons : isFulfillmentDiagnosis ? fulfillmentReasons : isImpressionDiagnosis ? impressionReasons : isPaidDiagnosis ? paidReasons : reasons;
  const transitionStages = funnelMode === "product" ? productStages : transition.scope === "events" ? monetizationEventStages : activeProfile.userStages;
  const fromStage = transitionStages.find((stage) => stage.label === transition.from);
  const toStage = transitionStages.find((stage) => stage.label === transition.to);
  const transitionFromValue = Number(fromStage?.value.replaceAll(",", "") ?? 0);
  const transitionToValue = Number(toStage?.value.replaceAll(",", "") ?? 0);
  const transitionLossValue = Math.max(0, transitionFromValue - transitionToValue);
  const transitionLoss = fromStage && toStage ? transitionLossValue.toLocaleString() : "—";
  const transitionConversion = transitionFromValue > 0 ? `${(transitionToValue / transitionFromValue * 100).toFixed(1)}%` : "—";
  const estimatedRevenueImpact = `$${Math.round(transitionLossValue * 0.0602).toLocaleString()}`;
  const transitionFromIndex = transitionStages.findIndex((stage) => stage.label === transition.from);
  const diagnosisToOptions = transitionStages.slice(Math.max(transitionFromIndex + 1, 1));
  const transitionToIndex = transitionStages.findIndex((stage) => stage.label === transition.to);
  const diagnosisHasNonLinearStage = transitionStages.slice(Math.max(transitionFromIndex, 0), transitionToIndex + 1).some((stage) => stage.nonLinear);
  const selectedPageProfile = productPageProfiles[selectedProductPage];
  const sourceStatus: Record<ModuleKey, { title: string; detail: string; note: string }> = {
    global: { title: "混合时效", detail: "Firebase T+0 · AdMob T+3 · 刷新", note: "DAU和用户行为使用Firebase实时预估；收入、消耗和ROAS使用最近已结算日期，卡片必须标注数据日。" },
    project: { title: "项目诊断", detail: "Firebase延迟约8分钟 · AdMob T+3", note: "用户与产品指标可看当天；收入和AdMob效率使用已结算日期，不参与当天实时结论。" },
    funnel: { title: "实时预估", detail: "Firebase · 延迟约8分钟", note: "用户漏斗与事件漏斗来自Firebase实时数据；收入影响为模型估算，最终以AdMob结算为准。" },
    admob: { title: "结算数据", detail: "AdMob已结算至8月8日", note: "本页默认只展示AdMob已结算日期；Firebase AV仅作为覆盖诊断对照，并明确标记来源。" },
    firebase: { title: "实时数据", detail: "BigQuery intraday · 延迟约8分钟", note: "本页展示Firebase实时预估、事件质量与同步水位；中台数字仅用于差异诊断。" },
    reconcile: { title: "分源对账", detail: "今日双源 · T+3全量", note: "当天只比较Firebase与中台；含AdMob的最终对账仅在结算日期执行，避免跨时效误报。" },
    tracking: { title: "实时采集", detail: "当前Run · 按已发布配置快照验收", note: "仅按Run引用的已发布配置快照判定；未执行场景不计为未收到，P0事件、参数与关联链必须达到100%。" },
    config: { title: "配置数据", detail: `${trackingConfigDataSource.eventCount}个标准事件 · ${trackingConfigDataSource.fieldCount}条字段明细`, note: "品类与能力包只负责推荐候选事件；最终验收范围以配置逐项选择并发布的不可变快照为准。" },
    firebaseSetup: { title: "对接控制面", detail: "2个连接 · 3个Project · 4个App", note: "本页管理连接、project_projects绑定、同步水位和接口健康；项目打点配置不保存Firebase凭证、Project、App或Dataset。" },
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
    if (next === "global" || next === "project" || next === "funnel") {
      setModule("funnel");
      setPage(next === "project" ? "workbench" : "overview");
    } else if (next === "firebaseSetup") {
      setModule("firebase");
    } else {
      setModule(next);
    }
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

  function focusWorkbenchSection(sectionId: "funnel-workbench" | "step-diagnosis" | "page-product-analysis" | "workbench-rules") {
    setModule("funnel");
    setPage("workbench");
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function openDiagnosisSelection(selection: TransitionSelection) {
    setTransition(selection);
    setUnitMode(selection.scope);
    focusWorkbenchSection("step-diagnosis");
  }

  function changeDiagnosisScope(scope: UnitMode) {
    const options = funnelMode === "product" ? productStages : scope === "events" ? monetizationEventStages : activeProfile.userStages;
    const from = options[Math.min(2, options.length - 2)];
    const to = options[Math.min(3, options.length - 1)];
    setUnitMode(scope);
    setTransition({ from: from.label, to: to.label, rate: to.rate, scope });
  }

  function changeDiagnosisBoundary(boundary: "from" | "to", label: string) {
    const options = funnelMode === "product" ? productStages : transition.scope === "events" ? monetizationEventStages : activeProfile.userStages;
    const currentFromIndex = options.findIndex((stage) => stage.label === transition.from);
    const currentToIndex = options.findIndex((stage) => stage.label === transition.to);
    if (boundary === "from") {
      const nextFromIndex = options.findIndex((stage) => stage.label === label);
      const nextTo = currentToIndex > nextFromIndex ? options[currentToIndex] : options[Math.min(nextFromIndex + 1, options.length - 1)];
      setTransition({ from: label, to: nextTo.label, rate: nextTo.rate, scope: transition.scope });
      return;
    }
    const nextTo = options.find((stage) => stage.label === label) ?? options[Math.min(currentFromIndex + 1, options.length - 1)];
    setTransition({ ...transition, to: nextTo.label, rate: nextTo.rate });
  }

  function openTransition(from: FunnelStage, to: FunnelStage) {
    openDiagnosisSelection({ from: from.label, to: to.label, rate: to.rate, scope: unitMode });
  }

  return (
    <div className={`app-shell ${embedded ? "embedded" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">JK</span><span><strong>变现与埋点</strong><small>质量分析中心 · V23</small></span></div>
        <div className="nav-group-label">经营分析</div>
        {moduleMenus.filter((item) => item.group === "经营分析").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="nav-group-label">质量治理</div>
        {moduleMenus.filter((item) => item.group === "质量治理").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="sidebar-foot"><span className="status-dot warn" />Firebase 待正式接入<small>当前页面使用演示数据</small></div>
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
            <div className="heading-actions"><button className="secondary-button" onClick={() => module === "funnel" ? focusWorkbenchSection("workbench-rules") : notify("数据已刷新至最新水位")}>{module === "funnel" ? "查看口径 V1.7" : "刷新数据"}</button><button className="primary-button" onClick={() => module === "config" ? openConfigEditor(null) : setDialog(moduleDialog[module])}>{["project", "funnel", "tracking", "config", "firebaseSetup", "tasks"].includes(module) ? "＋ " : ""}{currentModule.action}</button></div>
          </section>

          {module === "funnel" && <section className="workflow-strip" aria-label="漏斗诊断流程">
            {[
              ["发现", "多项目总览"], ["分析", "单项目工作台"], ["取证", "事件与原始参数"], ["闭环", "修复与效果验证"],
            ].map(([name, hint], index) => {
              const phase = page === "overview" ? 0 : page === "workbench" ? 1 : page === "evidence" ? 2 : 3;
              return <div key={name} className={`workflow-step ${phase === index ? "current" : ""} ${phase > index ? "done" : ""}`}><span>{phase > index ? "✓" : index + 1}</span><div><strong>{name}</strong><small>{hint}</small></div></div>;
            })}
          </section>}

          {module === "funnel" && <nav className="page-nav" aria-label="漏斗分析页面">
            {pages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => go(item.key)}><span>{item.label}</span><small>{item.hint}</small></button>)}
          </nav>}

          {module !== "firebaseSetup" && <section className="filter-bar">
            <label>项目<select value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
            <label>日期<select value={range} onChange={(event) => setRange(event.target.value)}><option>今天</option><option>昨天</option><option>近7天</option><option>近30天</option></select></label>
            <label>平台<select value={platform} onChange={(event)=>setPlatform(event.target.value)}><option>Android</option><option>iOS</option><option>全部</option></select></label>
            <label>国家<select value={country} onChange={(event)=>setCountry(event.target.value)}><option>全部国家</option><option>伊朗</option><option>埃及</option><option>土耳其</option></select></label>
            <label>App版本<select value={appVersion} onChange={(event)=>setAppVersion(event.target.value)}><option>1.8.0 (108)</option><option>1.7.4 (104)</option><option>全部版本</option></select></label>
            <div className="filter-actions"><button onClick={resetFilters}>重置</button><button onClick={() => { setFiltersApplied((value) => value + 1); notify(`${project} · ${range} 筛选已应用`); }}>应用筛选</button></div>
            <div className="data-state"><span className="status-dot" /><strong>{sourceStatus[module].title}</strong><small>{sourceStatus[module].detail} · 刷新#{filtersApplied}</small></div>
          </section>}

          {module !== "firebaseSetup" && <section className="context-toolbar">
            <div className="context-summary"><Badge tone="blue">{module === "funnel" ? currentPage.hint : currentModule.title}</Badge><span>{project}</span><i /> <span>{range}</span><i /> <span>{platform} · {appVersion}</span><i /> <span>{country}</span><i /> <span>口径 V1.7</span></div>
            <div className="context-actions"><button onClick={() => notify("当前分析视图已保存")}>保存视图</button><button onClick={() => setDialog(module === "admob" ? "admob-report" : "project-report")}>导出报表</button></div>
          </section>}
          <section className="freshness-note"><div><strong>数据使用提示：</strong>{sourceStatus[module].note}</div><button onClick={() => module === "funnel" ? focusWorkbenchSection("workbench-rules") : notify(`${currentModule.title}数据口径说明已展开`)}>查看数据口径</button></section>

          {module !== "funnel" && <ModulePage module={module as Exclude<ModuleKey, "funnel">} project={project} configs={configRecords} onProjectChange={setProject} openModule={openModule} openDialog={setDialog} openConfigEditor={openConfigEditor} notify={notify} />}

          {module === "funnel" && page === "overview" && (
            <div className="page-stack">
              <section className="metric-grid six">
                <Metric label="全项目 DAU" value="397,380" note="较昨日 +3.2%" />
                <Metric label="广告展示独立用户 AV" value="116,842" note="按 impression 用户去重" tone="bad" />
                <Metric label="广告浏览者比例" value="29.4%" note="目标 ≥ 35%" tone="bad" />
                <Metric label="Opportunity 覆盖率" value="34.8%" note="较基线 -6.1pp" tone="bad" />
                <Metric label="人均展示次数" value="3.42" note="展示总次数 / AV" />
                <Metric label="预估收入" value="$13,901" note="ARPDAU $0.035" tone="good" />
              </section>

              <section className="signal-strip">
                <div className="signal-item bad"><span>用户覆盖异常</span><strong>AV / DAU 29.4%</strong><p>主要问题在广告请求之前，优先看 Eligible 与 Opportunity 覆盖。</p></div>
                <div className="signal-item good"><span>机会履约分支</span><strong>展示尝试（Show Attempt）/ 广告机会（Opportunity）89.7%</strong><p>缓存命中与实时请求合并判断，用户主漏斗单独统计请求用户覆盖。</p></div>
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
                    <button onClick={() => { setProject("IRAN-VPN-01"); openDiagnosisSelection({from:"Eligible",to:"Opportunity",rate:"43.9%",scope:"users"}); }}><span className="rank bad">1</span><div><strong>IRAN-VPN-01</strong><p>Eligible→Opportunity 下降 12.8pp</p><small>影响 46,632 用户 · 约 $2,807/日</small></div></button>
                    <button onClick={() => { setProject("TURBO-CLEAN-05"); openDiagnosisSelection({from:"Opportunity",to:"Request",rate:"93.2%",scope:"users"}); }}><span className="rank bad">2</span><div><strong>TURBO-CLEAN-05</strong><p>广告机会 → 请求用户覆盖下降</p><small>优先排查预加载覆盖与实时请求分支</small></div></button>
                    <button onClick={() => { setProject("CLEAN-MAX-03"); openDiagnosisSelection({from:"Opportunity",to:"Request",rate:"95.5%",scope:"users"}); }}><span className="rank warn">3</span><div><strong>CLEAN-MAX-03</strong><p>广告机会 → 请求用户（Opportunity → Request UV）下降</p><small>检查请求事件覆盖及 request_id 关联</small></div></button>
                  </div>
                  <button className="full-link" onClick={() => focusWorkbenchSection("step-diagnosis")}>进入单项目诊断工作台 →</button>
                </aside>
              </section>

              <section className="surface">
                <div className="surface-title"><div><h2>全项目变现链路</h2><p>用户覆盖漏斗与事件效率必须分开判断</p></div><Badge tone="blue">Firebase T+0</Badge></div>
                <div className="dual-funnel">
                  <div><h3>用户覆盖主漏斗</h3><div className="mini-funnel">{["日活跃用户（DAU）397,380", "广告资格检查（Eligibility Check）319,220", "符合广告资格（Eligible）263,941", "广告机会（Opportunity）138,283", "广告请求用户（Request UV）129,740", "展示尝试用户（Show Attempt UV）124,900", "广告展示独立用户（AV）116,842"].map((item, index) => <div key={item} style={{ width: `${100 - index * 7}%` }}>{item}<small>{["100%", "80.3%", "82.7%", "52.4%", "32.6% DAU", "90.3% Opp", "93.5%"][index]}</small></div>)}</div><p className="mini-funnel-note">Request UV 含预加载与实时请求，仅作覆盖观察 · AV 按 Impression 用户去重 · 人均展示次数 3.42</p></div>
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
                  <Segmented label="漏斗类型" active={funnelMode} onChange={(key) => {
                    const nextMode = key as FunnelMode;
                    setFunnelMode(nextMode);
                    if (nextMode === "product") {
                      setUnitMode("users");
                      setTransition({ from: productStages[0].label, to: productStages[1].label, rate: productStages[1].rate, scope: "users" });
                    } else if (productStages.some((stage) => stage.label === transition.from)) {
                      setTransition({ from: "Eligible", to: "Opportunity", rate: activeProfile.userStages[3].rate, scope: "users" });
                    }
                  }} items={[{ key: "product", label: "产品漏斗" }, { key: "monetization", label: "变现漏斗" }]} />
                  {funnelMode === "monetization" && <Segmented label="统计单位" active={unitMode} onChange={(key) => setUnitMode(key as UnitMode)} items={[{ key: "users", label: "用户数" }, { key: "events", label: "事件数" }]} />}
                </div>
              </section>

              <nav className="workbench-jumpbar" aria-label="单项目工作台区块导航">
                <button onClick={() => focusWorkbenchSection("funnel-workbench")}><span>01</span>变现与产品漏斗</button>
                <button onClick={() => focusWorkbenchSection("step-diagnosis")}><span>02</span>区间流失诊断</button>
                <button onClick={() => focusWorkbenchSection("page-product-analysis")}><span>03</span>页面与产品路径</button>
                <button onClick={() => focusWorkbenchSection("workbench-rules")}><span>04</span>口径与技术建议</button>
              </nav>

              <section className="surface funnel-surface" id="funnel-workbench">
                <div className="surface-title"><div><h2>{funnelMode === "product" ? "产品用户到达漏斗" : unitMode === "users" ? "用户覆盖主漏斗" : "事件覆盖与展示漏斗"}</h2><p>{funnelMode === "monetization" ? unitMode === "users" ? "全部节点按用户去重；Request UV 含预加载与实时请求，仅作覆盖观察，缓存命中用户可跳过 Request / Load，不能把 Opportunity → Request 当成严格流失率" : "事件漏斗展示请求、加载、Ready、Show、Impression 与 Paid 回调；点击箭头诊断当前步骤" : "点击转化箭头进入步骤诊断"}</p></div><div className="funnel-title-tools"><div className="legend"><span className="dot blue" />当前 <span className="dot neutral" />昨日同期</div><span className="funnel-scroll-hint">⇆ 横向滚动查看全部 {stages.length} 个节点</span></div></div>
                <div className={`funnel-stages ${stages.length > 6 ? "dense" : ""}`} tabIndex={0} aria-label={`漏斗共 ${stages.length} 个节点，可横向滚动查看完整信息`}>
                  {stages.map((stage, index) => <div className="stage-group" key={stage.label}>
                    <button className={`funnel-stage ${stage.nonLinear ? "stage-context" : ""} ${stage.delta.startsWith("-") && Math.abs(parseFloat(stage.delta)) > 5 ? "stage-alert" : ""}`} onClick={() => index > 0 && openTransition(stages[index - 1], stage)}>
                      <span>{displayFunnelStage(stage.label)}</span><strong>{stage.value}</strong><small>{displayFunnelEvent(stage.event)}</small>
                      {stage.note && <small className="stage-note">{stage.note}</small>}
                      {stage.label === "Request" && <em className="stage-derived">全量请求去重用户</em>}
                      {stage.label === "AV" && <em className="stage-derived">人均展示次数 {activeProfile.impressionsPerViewer} 次</em>}
                    </button>
                    {index < stages.length - 1 && <button className={`conversion-arrow ${stages[index + 1].delta.startsWith("-") ? "down" : ""} ${stages[index + 1].nonLinear ? "non-linear" : ""}`} onClick={() => openTransition(stage, stages[index + 1])}><strong>{stages[index + 1].rate}</strong><span>→</span><small>{stages[index + 1].nonLinear ? `覆盖比 · ${stages[index + 1].delta}` : stages[index + 1].delta}</small>{stages[index + 1].nonLinear && <em>非严格漏斗</em>}</button>}
                  </div>)}
                </div>
                {funnelMode === "monetization" && unitMode === "users" && <div className="request-scope-strip">
                  <div><span>全量请求用户（Request UV）</span><strong>{activeProfile.userStages[4].value}</strong><small>预加载与实时请求用户并集去重</small></div>
                  <div><span>业务机会实时请求用户</span><strong>{activeProfile.realtimeRequestUv}</strong><small>仅 Cache Miss 后携带 opportunity_id</small></div>
                  <div><span>预加载请求用户</span><strong>{activeProfile.preloadRequestUv}</strong><small>业务场景前生产库存；与实时请求 UV 可重叠</small></div>
                  <div><span>广告请求总次数</span><strong>{activeProfile.requestCount}</strong><small>事件次数，不能替代 Request UV</small></div>
                  <div><span>人均请求次数</span><strong>{activeProfile.requestsPerUser} 次</strong><small>Request Count / Request UV</small></div>
                </div>}
                <div className="funnel-summary"><div><span>首尾转化率</span><strong>{firstToLastRate}</strong></div><div><span>最大流失步骤</span><strong>{funnelMode === "product" ? "首页 → 点击连接" : unitMode === "users" ? "符合广告资格 → 广告机会（Eligible → Opportunity）" : "广告机会 → 广告展示尝试（Opportunity → Show Attempt）"}</strong></div><div><span>{unitMode === "events" ? "流失事件" : "流失用户"}</span><strong>{funnelMode === "product" ? "35,443" : unitMode === "users" ? "46,632" : "69,435"}</strong></div><div><span>预计收入影响</span><strong className="negative">$2,807 / 日</strong></div></div>
                {funnelMode === "monetization" && unitMode === "users" && <div className="denominator-audit five"><div><span>广告展示独立用户比例</span><strong>广告展示独立用户（AV）/ 日活跃用户（DAU）= {activeProfile.viewerTrend.at(-1)}%</strong><small>AV 按 impression 用户去重</small></div><div><span>机会覆盖率</span><strong>广告机会用户（Opportunity UV）/ 日活跃用户（DAU）= {activeProfile.opportunityTrend.at(-1)}%</strong><small>定位请求前问题</small></div><div><span>请求用户覆盖率</span><strong>全量 Request UV / DAU = {requestUvCoverage}</strong><small>仅衡量请求触达；不与 Opportunity 做严格转化</small></div><div><span>机会履约率</span><strong>Show Attempt UV / Opportunity UV = {activeProfile.fulfillmentRate}</strong><small>缓存与实时请求分支汇合后的结果</small></div><div><span>人均展示次数</span><strong>Impression Count / AV = {activeProfile.impressionsPerViewer} 次</strong><small>衡量展示是否集中在少数用户</small></div></div>}
                {funnelMode === "monetization" && unitMode === "events" && <div className="denominator-audit"><div><span>资格通过率</span><strong>符合资格（Eligible）/ 资格检查（Check）= 79.4%</strong><small>按检查事件</small></div><div><span>机会生成率</span><strong>广告机会（Opportunity）/ 符合资格（Eligible）= 75.7%</strong><small>按事件次数</small></div><div><span>机会履约率</span><strong>展示尝试（Show Attempt）/ 广告机会（Opportunity）= 67.6%</strong><small>不以广告请求（Request）为分母</small></div><div><span>展示成功率</span><strong>广告展示（Impression）/ 展示尝试（Show Attempt）= 95.0%</strong><small>衡量广告 SDK 展示效率</small></div></div>}
              </section>

              {funnelMode === "monetization" && <section className="fulfillment-layout">
                <div className="surface">
                  <div className="surface-title"><div><h2>机会履约与请求加载明细</h2><p>缓存命中直接进入 Ready / Show；只有缓存未命中才进入实时请求链路</p></div><Badge tone="blue">按 opportunity_id / request_id / ad_instance_id 关联</Badge></div>
                  <div className="request-prechecks">
                    {[['SDK 初始化','99.8%','sdk_ready'],['隐私同意可投放','96.8%','consent_status'],['非订阅用户','88.4%','subscription_status'],['频控通过','82.1%','blocked_reason'],['网络可用','98.9%','network_type'],['广告位配置有效','100%','ad_unit_id']].map(([label,value,field]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{field}</small></div>)}
                  </div>
                  <div className="fulfillment-flow detailed">
                    <div className="flow-origin"><span>广告机会（Opportunity）</span><strong>{opportunityFulfillment.opportunity.toLocaleString()}</strong><small>真实业务机会 · 100%</small></div>
                    <div className="flow-split"><span>查缓存</span></div>
                    <div className="flow-branch good"><span>缓存命中（Cache Hit）</span><strong>{opportunityFulfillment.cacheHit.toLocaleString()}</strong><small>68.5% · 沿用已有 ad_instance_id，不新建 request_id</small></div>
                    <div className="flow-branch warn"><span>缓存未命中（Cache Miss）</span><strong>{opportunityFulfillment.cacheMiss.toLocaleString()}</strong><small>31.5% · 当前 opportunity 进入实时请求</small></div>
                    <div className="flow-request"><span>广告请求（Ad Request）</span><strong>{opportunityFulfillment.realtimeRequest.toLocaleString()}</strong><small>93.6% · jk_ad_request · 创建 request_id</small></div>
                    <div className="flow-request"><span>SDK 请求受理（Request Accepted）</span><strong>{opportunityFulfillment.requestAccepted.toLocaleString()}</strong><small>98.3% · 客户端派生；无同步异常，不代表 AdMob 已匹配</small></div>
                    <div className="flow-request"><span>加载成功（Load Success）</span><strong>{opportunityFulfillment.realtimeLoad.toLocaleString()}</strong><small>99.7% · 保存 response_id / ad_source / adapter</small></div>
                    <div className="flow-request"><span>广告就绪（Ad Ready）</span><strong>{opportunityFulfillment.adReady.toLocaleString()}</strong><small>98.0% · ad_instance_id 与 instanceContext 已绑定且 TTL 有效</small></div>
                    <div className="flow-merge"><span>展示尝试（Show Attempt）</span><strong>{opportunityFulfillment.showAttempt.toLocaleString()}</strong><small>缓存与实时分支汇合 · {activeProfile.fulfillmentRate}</small></div>
                  </div>
                  <div className="request-loss-strip"><div><span>Miss 后未请求</span><strong>{(opportunityFulfillment.cacheMiss-opportunityFulfillment.realtimeRequest).toLocaleString()}</strong><small>网络不可用/页面离开/配置阻止/进入后台</small></div><div><span>请求未受理</span><strong>{opportunityFulfillment.requestFailed.toLocaleString()}</strong><small>SDK 未初始化/广告位非法/同步异常</small></div><div><span>加载失败</span><strong>{opportunityFulfillment.loadFailed.toLocaleString()}</strong><small>no_fill/timeout/network/adapter/internal</small></div><div><span>成功但未 Ready</span><strong>{opportunityFulfillment.readyLost.toLocaleString()}</strong><small>Context 丢失/对象失效/TTL 过期/被驱逐</small></div></div>
                  <div className="post-show-panel">
                    <div className="post-show-head"><div><strong>展示与收益回调链</strong><span>请求成功不等于展示成功，Impression 才计展示；AV 对 Impression 用户去重</span></div><Badge tone="good">主链回调完整</Badge></div>
                    <div className="post-show-main"><div><span>Show Attempt</span><strong>144,871</strong><small>jk_ad_show_attempt</small></div><i><b>95.0%</b>→</i><div><span>Impression</span><strong>137,628</strong><small>展示总次数；AV 另做用户去重</small></div><i><b>99.1%</b>→</i><div><span>Paid Event</span><strong>136,392</strong><small>value_micros / currency_code</small></div></div>
                    <div className="post-show-outcomes"><div><span>Show Failed</span><strong>2,611</strong><small>show_error_code / show_error_domain</small></div><div><span>已尝试但无 Impression</span><strong>4,632</strong><small>回调超时/页面切换/对象失效</small></div><div><span>Impression 无 Paid</span><strong>1,236</strong><small>Paid 回调延迟或丢失</small></div><div><span>广告点击（可选）</span><strong>6,224</strong><small>自定义事件不得使用保留名 ad_click</small></div><div><span>关闭/返回（按格式适用）</span><strong>131,203</strong><small>插屏/激励广告终态</small></div><div><span>重复 Paid 回调</span><strong>84</strong><small>按 event_id / ad_instance_id 去重</small></div></div>
                  </div>
                  <div className="fulfillment-metrics"><div><span>缓存命中率</span><strong>{activeProfile.cacheHitRate}</strong></div><div><span>Miss 后请求率</span><strong>93.6%</strong></div><div><span>请求受理率</span><strong>98.3%</strong></div><div><span>加载成功率</span><strong>99.7%</strong></div><div><span>Ready 转化率</span><strong>98.0%</strong></div><div><span>机会未履约</span><strong className="negative">{opportunityFulfillment.unfulfilled.toLocaleString()}</strong></div></div>
                  <div className="funnel-rule-note"><strong>口径提醒</strong><span>Request Accepted 只是客户端确认 SDK 调用已发出，不等于 AdMob Match；AdMob 匹配率、展示率和收入使用 T+3 结算数据对照。用户主漏斗使用 UV，事件效率链使用 Count，预加载与当前机会实时请求必须分开统计。</span></div>
                </div>
                <aside className="surface"><div className="surface-title"><div><h2>预加载与缓存库存</h2><p>发生在真实业务场景之前，按事件次数独立统计，不绑定 opportunity_id</p></div><Badge tone="warn">独立口径</Badge></div><div className="preload-chain">{[["Preload Trigger",preloadInventory.trigger,"100%"],["Preload Request",preloadInventory.request,"94.1%"],["Request Accepted",238984,"98.3%"],["Load Success",preloadInventory.loadSuccess,activeProfile.preloadSuccess],["Cache Store",preloadInventory.cacheStore,"98.0%"],["Cache Ready",216630,"97.8%"]].map(([label,value,rate],index)=><div key={String(label)}><span>{index+1}</span><p><strong>{label}</strong><small>{Number(value).toLocaleString()} · {rate}</small></p></div>)}</div><div className="inventory-outcomes"><div><span>Cache Hit / 被业务消费</span><strong>{preloadInventory.cacheHit.toLocaleString()}</strong></div><div><span>Expired / TTL过期</span><strong>{preloadInventory.expired.toLocaleString()}</strong></div><div><span>Evicted / 被驱逐</span><strong>{preloadInventory.evicted.toLocaleString()}</strong></div><div><span>未消费库存</span><strong>{preloadInventory.unusedReady.toLocaleString()}</strong></div></div><div className="conclusion-block warn"><strong>缓存浪费率 20.1%</strong><p>(Expired + Evicted) / Cache Store。建议继续按广告位、格式、TTL、网络类型和 App 前后台状态拆解。</p></div><div className="funnel-rule-note compact"><strong>Context</strong><span>广告对象入缓存时必须连同 requestContext / instanceContext 保存；取出时再绑定当前 opportunity_id，直到 paid / dismiss / failed 终态。</span></div></aside>
              </section>}

              <section className="surface diagnosis-workspace" id="step-diagnosis">
                <div className="surface-title"><div><h2>区间流失诊断</h2><p>选择任意上游与下游指标，立即重算转化、流失、原因、分群和收入影响</p></div><Badge tone={diagnosisHasNonLinearStage ? "warn" : "blue"}>{funnelMode === "product" ? "产品用户口径" : transition.scope === "events" ? "事件次数口径" : "用户 UV 口径"}</Badge></div>
                <div className="diagnosis-selector-bar">
                  <div className="diagnosis-scope"><span>统计口径</span>{funnelMode === "product" ? <strong>用户 UV</strong> : <Segmented label="诊断统计口径" active={transition.scope} onChange={(key) => changeDiagnosisScope(key as UnitMode)} items={[{ key: "users", label: "用户 UV" }, { key: "events", label: "事件次数" }]} />}</div>
                  <label>起点指标<select value={fromStage?.label ?? transitionStages[0].label} onChange={(event) => changeDiagnosisBoundary("from", event.target.value)}>{transitionStages.slice(0, -1).map((stage) => <option key={stage.label} value={stage.label}>{displayFunnelStage(stage.label)}</option>)}</select></label>
                  <span className="diagnosis-arrow">→</span>
                  <label>终点指标<select value={toStage?.label ?? diagnosisToOptions[0]?.label} onChange={(event) => changeDiagnosisBoundary("to", event.target.value)}>{diagnosisToOptions.map((stage) => <option key={stage.label} value={stage.label}>{displayFunnelStage(stage.label)}</option>)}</select></label>
                  <div className="diagnosis-result"><span>区间转化</span><strong>{transitionConversion}</strong><small>流失 {transitionLoss} {transition.scope === "events" ? "次事件" : "用户"}</small></div>
                  <div className="diagnosis-result impact"><span>预估收入影响</span><strong>{estimatedRevenueImpact}/日</strong><small>模型估算 · AdMob T+3校准</small></div>
                </div>
                {diagnosisHasNonLinearStage && <div className="nonlinear-warning"><strong>含非严格观察节点：</strong>Request UV 合并预加载与实时请求用户；缓存命中可跳过新请求，因此本区间只表示覆盖关系，不能直接认定为线性技术流失。</div>}
                <div className="diagnosis-quality compact">
                  <div><span>原因分类覆盖率</span><strong>98.0%</strong><div><i className="warn" style={{ width: "98%" }} /></div></div>
                  <div><span>事件链可关联率</span><strong>95.8%</strong><div><i style={{ width: "95.8%" }} /></div></div>
                  <div><span>Unknown率</span><strong>2.0%</strong><div><i className="warn" style={{ width: "20%" }} /></div></div>
                  <p><strong>诊断可信度：中高。</strong>目标为原因覆盖 ≥99%、Unknown &lt;1%；当前仍需补齐 2.0% 未知原因。</p>
                </div>
                <div className="diagnosis-main-grid">
                  <div className="diagnosis-reasons-panel">
                    <div className="subsection-head"><div><h3>流失原因</h3><p>点击原因进入事件证据，并保留当前区间和筛选条件</p></div><span>覆盖 {diagnosisReasons.reduce((sum, reason) => sum + reason.share, 0).toFixed(1)}%</span></div>
                    <div className="reason-list compact">{diagnosisReasons.map((reason) => <button key={reason.code} onClick={() => go("evidence")}><div className="reason-title"><strong>{reason.code}</strong><span>{reason.users} {transition.scope === "events" ? "事件" : "用户"} · {reason.share}%</span></div><p>{reason.label}</p><div className="reason-bar"><span style={{ width: `${reason.share}%` }} /></div><div className="reason-meta"><span>影响 {reason.impact}/日</span><Badge tone={reason.code === "UNKNOWN" ? "neutral" : reason.share > 20 ? "bad" : "warn"}>{reason.owner}</Badge></div></button>)}</div>
                  </div>
                  <aside className="diagnosis-action-panel">
                    <div className="conclusion-block bad"><strong>优先技术结论</strong><p>{isRequestDiagnosis ? "先查预加载 requestContext 保存、request_id 关联与 Cache Miss 后的实时请求发送。" : isFulfillmentDiagnosis ? "先查缓存 instanceContext、对象 TTL 和 Cache Miss 后实时加载错误。" : isImpressionDiagnosis ? "先查 show_failed、页面切换、Activity 状态和 Impression 回调超时。" : isPaidDiagnosis ? "先查 Paid 回调注册、value_micros 类型、币种和重复回调去重。" : funnelMode === "product" ? "先定位页面到达、元素曝光、按钮点击和业务成功之间的具体断点。" : "主要流失集中在机会生成前，先检查触发场景、频控、前后台切换和 Opportunity 创建时机。"}</p></div>
                    <div className="tech-checklist"><button onClick={() => go("evidence")}><strong>1. 抽查事件链</strong><span>核对关键 ID 与时间顺序</span></button><button onClick={() => setDimension("App版本")}><strong>2. 对比版本</strong><span>确认是否集中在最新版本</span></button><button onClick={() => focusWorkbenchSection("page-product-analysis")}><strong>3. 检查页面</strong><span>定位页面和元素级断点</span></button><button onClick={() => setDialog("diagnosis")}><strong>4. 创建任务</strong><span>带入区间、证据与负责人</span></button></div>
                  </aside>
                </div>
                <div className="diagnosis-dimension-block">
                  <div className="subsection-head cohort-header"><div><h3>问题集中在哪一群</h3><p>将当前区间按维度与 {baseline} 对比</p></div><div className="dimension-tabs">{["国家", "App版本", "广告位", "网络类型", "新老用户", "VPN状态"].map((item) => <button key={item} className={dimension === item ? "active" : ""} onClick={() => setDimension(item)}>{item}</button>)}</div></div>
                  <div className="comparison-controls compact"><label>基准<select value={baseline} onChange={(event) => setBaseline(event.target.value)}><option>近7日均值</option><option>昨日同期</option><option>上周同期</option><option>版本1.7.4</option></select></label><label>排序<select><option>异常流失贡献</option><option>转化下降幅度</option><option>收入影响</option></select></label><span>最大异常：<strong>{dimension === "国家" ? "伊朗" : dimension === "App版本" ? "1.8.0 (108)" : "vpn_connect_success"}</strong></span></div>
                  <div className="table-wrap"><table><thead><tr><th>{dimension}</th><th>{displayFunnelStage(transition.from)}</th><th>历史基线</th><th>当前转化</th><th>变化</th><th>异常流失</th><th>收入影响/日</th><th>证据</th></tr></thead><tbody>{cohortRows.map((row, index) => <tr key={`${dimension}-${row.value}`} className={row.level === "bad" ? "row-bad" : ""}><td><strong>{dimension === "国家" ? row.value : dimension === "App版本" ? ["1.8.0 (108)", "1.7.4 (104)", "1.7.2 (102)", "1.6.9 (98)", "其他"][index] : dimension === "广告位" ? ["vpn_connect_success", "vpn_home_banner", "server_select", "vpn_disconnect", "home_resume"][index] : row.value}</strong></td><td>{row.volume}</td><td>{row.base}</td><td><span className={`heat-cell ${row.level}`}>{row.current}</span></td><td className={row.change.startsWith("-") ? "negative" : "positive"}>{row.change}</td><td>{row.lost}</td><td>{row.impact}</td><td><button className="table-link" onClick={() => go("evidence")}>查看</button></td></tr>)}</tbody></table></div>
                </div>
              </section>

              <section className="surface page-product-workspace" id="page-product-analysis">
                <div className="surface-title"><div><h2>页面与产品路径分析</h2><p>把页面健康、单页转化、元素行为、性能和变现贡献放在同一区域</p></div><label className="inline-page-selector">当前页面<select value={selectedProductPage} onChange={(event) => setSelectedProductPage(event.target.value as keyof typeof productPageProfiles)}>{Object.keys(productPageProfiles).map((item) => <option key={item}>{item}</option>)}</select></label></div>
                <div className="page-health-strip">
                  <div><span>页面 UV</span><strong>{selectedPageProfile.pageUv}</strong><small>进入页面用户</small></div><div><span>到达率</span><strong>{selectedPageProfile.arrival}</strong><small>Page UV / DAU</small></div><div><span>核心曝光率</span><strong>{selectedPageProfile.exposure}</strong><small>元素曝光 / 渲染</small></div><div><span>主按钮 CTR</span><strong>{selectedPageProfile.click}</strong><small>点击 UV / 曝光 UV</small></div><div><span>业务成功率</span><strong>{selectedPageProfile.success}</strong><small>成功 UV / 点击 UV</small></div><div><span>页面退出率</span><strong>{selectedPageProfile.exit}</strong><small>离开且无目标动作</small></div>
                </div>
                <div className="subsection-head page-chain-head"><div><h3>{selectedProductPage}单页转化链</h3><p>进入 → 渲染 → 曝光 → 点击 → 业务成功 → Opportunity → AV</p></div><Badge tone="warn">最大断点：业务成功 → Opportunity</Badge></div>
                <div className="page-conversion-chain">{selectedPageProfile.chain.map(([label, value, rate], index) => <div className="page-chain-group" key={label}><button onClick={() => notify(`${selectedProductPage} · ${label}明细已筛选`)}><span>{label}</span><strong>{value}</strong><small>{rate}</small></button>{index < selectedPageProfile.chain.length - 1 && <i>→</i>}</div>)}</div>
                <div className="page-analysis-grid">
                  <div className="page-analysis-block page-overview-table"><div className="subsection-head"><div><h3>页面健康总览</h3><p>点击页面行切换上方完整分析</p></div><span>4 个核心页面</span></div><div className="table-wrap"><table><thead><tr><th>页面</th><th>Page UV</th><th>到达</th><th>曝光</th><th>点击</th><th>成功</th><th>退出</th><th>Opportunity</th><th>AV</th><th>收入</th><th>状态</th></tr></thead><tbody>{pageHealthRows.map((row) => <tr key={row[0]} className={`clickable-row ${selectedProductPage === row[0] ? "row-selected" : ""}`} onClick={() => row[0] in productPageProfiles && setSelectedProductPage(row[0] as keyof typeof productPageProfiles)}>{row.map((cell, index) => <td key={index}>{index === 0 ? <strong>{cell}</strong> : index === 10 ? <Badge tone={cell === "正常" ? "good" : "warn"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></div>
                  <div className="page-analysis-block"><div className="subsection-head"><div><h3>元素曝光与点击</h3><p>每个按钮的曝光 UV、点击 UV、CTR 和后续成功</p></div></div><div className="table-wrap"><table><thead><tr><th>元素</th><th>element_id</th><th>曝光UV</th><th>点击UV</th><th>CTR</th><th>后续成功</th><th>诊断</th></tr></thead><tbody>{pageElementRows.map((row) => <tr key={row[1]}>{row.map((cell, index) => <td key={index}>{index === 1 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div></div>
                </div>
                <div className="page-insight-grid">
                  <article><header><div><h3>页面路径</h3><p>来源、去向、退出与后台分开</p></div><Badge tone="warn">退出 11.8%</Badge></header><div className="path-mini-list"><div><span>来源页</span><strong>VPN 首页 72.4%</strong></div><div><span>去向页</span><strong>连接详情 48.1%</strong></div><div><span>页面离开</span><strong>8.7%</strong></div><div><span>App 后台</span><strong>3.1%</strong></div></div><button onClick={() => notify("页面路径事件样本已展开")}>查看路径样本</button></article>
                  <article><header><div><h3>页面性能</h3><p>性能异常与转化同屏判断</p></div><Badge tone={selectedPageProfile.errorRate === "1.2%" ? "bad" : "good"}>P95 {selectedPageProfile.renderP95}</Badge></header><div className="page-performance-grid"><div><span>渲染 P50</span><strong>{selectedPageProfile.renderP50}</strong></div><div><span>渲染 P95</span><strong>{selectedPageProfile.renderP95}</strong></div><div><span>接口耗时</span><strong>{selectedPageProfile.apiLatency}</strong></div><div><span>错误率</span><strong>{selectedPageProfile.errorRate}</strong></div><div><span>白屏率</span><strong>{selectedPageProfile.whiteScreen}</strong></div></div></article>
                  <article><header><div><h3>页面变现贡献</h3><p>用户覆盖与展示次数分开</p></div><Badge tone="blue">收入 {selectedPageProfile.revenue}</Badge></header><div className="page-performance-grid"><div><span>Opportunity UV</span><strong>{selectedPageProfile.opportunity}</strong></div><div><span>AV</span><strong>{selectedPageProfile.av}</strong></div><div><span>Impression</span><strong>{selectedPageProfile.impression}</strong></div><div><span>收入占比</span><strong>44.5%</strong></div></div></article>
                  <article><header><div><h3>版本与 A/B</h3><p>上线前后及实验组收益对比</p></div><Badge tone="bad">V1.8.0 下降</Badge></header><div className="version-ab-list"><div><span>V1.7.4</span><strong>机会 41.2% · AV 34.8%</strong><small>基准版本</small></div><div><span>V1.8.0</span><strong>机会 28.4% · AV 23.1%</strong><small>-12.8pp / -11.7pp</small></div><div><span>实验 B</span><strong>提前创建 Opportunity</strong><small>预计收入 +9.6%</small></div></div><button onClick={() => notify("A/B 实验配置已打开")}>新建页面实验</button></article>
                </div>
              </section>

              <section className="two-column workbench-rules-section" id="workbench-rules">
                <div className="surface">
                  <div className="surface-title"><div><h2>趋势与统一口径</h2><p>趋势用于发现，动态区间诊断用于定位</p></div><Segmented label="趋势指标" active={trendMetric} onChange={(key) => setTrendMetric(key as TrendMetric)} items={[{ key: "viewer", label: "浏览者比例" }, { key: "opportunity", label: "机会覆盖" }]} /></div>
                  <div className="trend-current"><span>{trendLabel}</span><strong>{trendValues.at(-1)}%</strong><small>{trendMetric === "viewer" ? "目标 ≥ 35%" : "目标 ≥ 40%"}</small></div>
                  <div className="bar-chart compact" aria-label={`近七日${trendLabel}趋势`}>{trendValues.map((value, index) => <div key={`${trendMetric}-${index}`}><span style={{ height: `${value * 1.35}px` }} className={index > 3 ? "alert" : ""}><em>{value}%</em></span><small>{["8/5", "8/6", "8/7", "8/8", "8/9", "8/10", "今天"][index]}</small></div>)}</div>
                  <div className="formula-list compact"><div><strong>广告浏览者比例</strong><code>AV / DAU</code><p>AV 为 Impression 独立用户，不是展示次数。</p></div><div><strong>人均展示次数</strong><code>Impression / AV</code><p>衡量展示是否集中在少数用户。</p></div><div><strong>原因分类质量</strong><code>coverage ≥99% · unknown &lt;1%</code><p>未达标时不能直接给出高可信根因。</p></div><div><strong>Request UV</strong><code>preload UV ∪ realtime UV</code><p>非严格观察节点，不替代机会履约率。</p></div></div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>技术落地检查</h2><p>研发可直接按证据字段定位</p></div><Badge tone="blue">V1.7</Badge></div>
                  <div className="id-chain-list"><div><code>decision_id</code><span>资格检查与阻止原因</span><strong>P0</strong></div><div><code>opportunity_id</code><span>一次真实业务广告机会</span><strong>P0</strong></div><div><code>request_id</code><span>每次真实 load；重试必须新建</span><strong>P0</strong></div><div><code>ad_instance_id</code><span>加载成功后绑定缓存对象到终态</span><strong>P0</strong></div></div>
                  <div className="technical-actions"><button onClick={() => go("evidence")}><strong>上下文关联</strong><span>检查缓存对象是否保存 instanceContext</span></button><button onClick={() => openModule("tracking")}><strong>打点完整性</strong><span>P0 事件、参数与关联链必须 100%</span></button><button onClick={() => openModule("reconcile")}><strong>分源对账</strong><span>Firebase T+0 与 AdMob T+3 分开判断</span></button><button onClick={() => setDialog("diagnosis")}><strong>修复闭环</strong><span>带证据创建任务并回归验证</span></button></div>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "diagnosis" && (
            <div className="page-stack">
              <section className="transition-banner">
                <div><span>上一步</span><strong>{displayFunnelStage(transition.from)} {transition.scope === "events" ? "事件" : "用户"}</strong><em>{fromStage?.value ?? "—"}</em></div><span className="transition-arrow">→<small>{transition.rate}</small></span><div><span>下一步</span><strong>{displayFunnelStage(transition.to)} {transition.scope === "events" ? "事件" : "用户"}</strong><em>{toStage?.value ?? "—"}</em></div><div className="transition-loss"><span>{transition.scope === "events" ? "流失事件" : "流失用户"}</span><strong>{transitionLoss}</strong><small>按所选步骤与口径重新计算</small></div>
              </section>
              <section className="metric-grid five">
                <Metric label="当前转化率" value={transition.rate} note={`步骤 ${transition.from} → ${transition.to}`} tone="bad" />
                <Metric label="下降幅度" value="-12.8pp" note="连续下降 3 天" tone="bad" />
                <Metric label={transition.scope === "events" ? "异常流失事件" : "异常流失用户"} value={isRequestDiagnosis ? transitionLoss : isFulfillmentDiagnosis ? "21,806" : transition.scope === "events" ? "21,806" : "10,641"} note={isRequestDiagnosis ? "广告机会用户未关联到请求记录" : "排除正常业务流失"} />
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
                  <div className="conclusion-block bad"><strong>主要原因</strong><p>{isRequestDiagnosis ? "广告机会已经生成，但部分用户没有可关联的预加载或实时请求记录；优先检查 request_id 上下文、预加载覆盖和 Cache Miss 后的实时请求。" : isFulfillmentDiagnosis ? "机会已经生成，但缓存实例 Context 丢失或缓存未命中后的实时加载失败，导致没有执行 Show Attempt。" : "1.8.0 版本把 Opportunity 生成放在页面动画完成后；伊朗弱网用户在动画结束前离开或进入后台。"}</p></div>
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
                <div className="surface-title"><div><h2>伊朗 · 1.8.0 · {displayFunnelStage(transition.from)} → {displayFunnelStage(transition.to)} 流失路径</h2><p>{isRequestDiagnosis ? "拆开预加载覆盖与缓存未命中后的实时请求，定位广告机会用户为什么没有请求记录" : isFulfillmentDiagnosis ? "拆开缓存命中与实时加载两条履约路径，定位机会为何没有进入 Show Attempt" : "观察没有进入 Opportunity 前后的真实行为，不把“页面离开”和“App 后台”混为一谈"}</p></div><Badge tone="blue">{transitionLoss} {transition.scope === "events" ? "事件" : "用户"}</Badge></div>
                <div className="path-canvas">
                  <div className="path-column"><h3>流失前事件</h3><div className="path-node"><strong>{isRequestDiagnosis || isFulfillmentDiagnosis ? "jk_ad_opportunity" : "connect_success"}</strong><span>38,204 · 81.9%</span></div><div className="path-node muted"><strong>{isRequestDiagnosis ? "jk_ad_preload_trigger" : isFulfillmentDiagnosis ? "jk_ad_cache_hit / miss" : "vpn_home_view"}</strong><span>5,887 · 12.6%</span></div><div className="path-node muted"><strong>{isRequestDiagnosis ? "jk_ad_cache_miss" : isFulfillmentDiagnosis ? "jk_ad_load_success" : "app_foreground"}</strong><span>2,541 · 5.5%</span></div></div>
                  <div className="path-connectors"><span>81.9%</span><i /><span>12.6%</span><i /><span>5.5%</span></div>
                  <div className="path-column center"><h3>当前流失点</h3><div className="path-node alert"><strong>{isRequestDiagnosis ? "NO_REQUEST" : isFulfillmentDiagnosis ? "NO_SHOW_ATTEMPT" : "NO_OPPORTUNITY"}</strong><span>{transitionLoss} {transition.scope === "events" ? "事件" : "用户"}</span><small>{isRequestDiagnosis ? "Opportunity 用户在窗口内没有可关联请求" : isFulfillmentDiagnosis ? "Opportunity 后未走完缓存或实时履约分支" : "Eligible 后 30 秒内未生成机会"}</small></div></div>
                  <div className="path-connectors right"><span>52.8%</span><i /><span>20.1%</span><i /><span>8.4%</span></div>
                  <div className="path-column"><h3>流失后事件</h3><div className="path-node"><strong>{isRequestDiagnosis ? "preload_not_available" : isFulfillmentDiagnosis ? "cache_context_lost" : "app_background"}</strong><span>24,613 · 52.8%</span></div><div className="path-node muted"><strong>{isRequestDiagnosis ? "realtime_request_not_sent" : isFulfillmentDiagnosis ? "realtime_load_failed" : "vpn_disconnect"}</strong><span>9,384 · 20.1%</span></div><div className="path-node muted"><strong>{isRequestDiagnosis || isFulfillmentDiagnosis ? "app_background" : "screen_view"}</strong><span>3,921 · 8.4%</span></div></div>
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
                <aside className="surface diagnostic-card"><div className="surface-title"><div><h2>路径结论</h2><p>产品行为与打点证据一致</p></div></div><h3>{isRequestDiagnosis ? "请求上下文缺失是主要覆盖阻塞" : isFulfillmentDiagnosis ? "缓存 Context 丢失是主要履约阻塞" : "动画完成后才创建机会过晚"}</h3><p>{isRequestDiagnosis ? "优先检查预加载请求是否保存 requestContext；Cache Miss 后是否真实发送 realtime request，并按 request_id 关联结果。" : isFulfillmentDiagnosis ? "优先检查缓存对象是否保存 instanceContext，并在取出时绑定当前 opportunity_id；实时加载失败单独按 error_code 拆解。" : "52.8% 流失用户在动画完成前进入后台，建议将 Opportunity 提前到连接成功页可见时。"}</p><button className="primary-button full" onClick={() => go("evidence")}>抽查事件时间线</button></aside>
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
                  <div className="issue-form-grid"><div><label>异常步骤</label><strong>{displayFunnelStage(transition.from)} → {displayFunnelStage(transition.to)}</strong></div><div><label>影响范围</label><strong>伊朗 · Android 1.8.0</strong></div><div><label>异常开始</label><strong>2026-08-09 14:20</strong></div><div><label>预计收入影响</label><strong className="negative">$2,807 / 日</strong></div><div className="span-2"><label>根因</label><strong>{isRequestDiagnosis ? "请求 Context 未完整保存，部分预加载请求无法关联用户；Cache Miss 后的实时请求也存在漏发。" : isFulfillmentDiagnosis ? "缓存对象没有完整保存 instanceContext，取出后未绑定当前 opportunity_id；部分 Cache Miss 的 realtime load 超时。" : "连接成功页动画完成后才生成 Opportunity，弱网用户提前进入后台。"}</strong></div><div className="span-2"><label>修复方案</label><strong>{isRequestDiagnosis ? "统一保存 requestContext；预加载与实时请求均上报 request_id；Cache Miss 后未请求需记录 blocked_reason。" : isFulfillmentDiagnosis ? "广告对象与 instanceContext 一起缓存；命中时绑定当前 opportunity_id；实时加载按 error_code 与耗时分层告警。" : "页面可见立即创建 Opportunity；补充 background_reason，并验证场景到达窗口。"}</strong></div><div><label>修复版本</label><strong>1.8.1 (109)</strong></div><div><label>关联测试 Run</label><strong>待生成</strong></div></div>
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
              <section className="metric-grid five"><Metric label="产品漏斗" value="6 步" note="严格顺序" /><Metric label="变现用户观察链" value="8 节点" note="Request UV 为非严格观察节点" /><Metric label="变现事件效率链" value="10 步" note="含 Request Accepted 派生检查点" /><Metric label="履约与库存" value="3 条路径" note="缓存/实时请求/预加载" /><Metric label="规范版本" value="V1.7" note="schema_version 1.7" /></section>
              <section className="surface">
                <div className="surface-title"><div><h2>变现用户漏斗定义</h2><p>Firebase 实时口径；AdMob 数据仅用于结算对账</p></div><Badge tone="blue">User Funnel</Badge></div>
                <div className="table-wrap"><table><thead><tr><th>步骤</th><th>事件</th><th>用户判定</th><th>条件/窗口</th><th>关键关联字段</th><th>优先级</th><th>数据源</th></tr></thead><tbody>{[
                  ["DAU", "app_active", "当日活跃去重用户", "自然日", "user_pseudo_id", "P0", "Firebase"],
                  ["Eligibility Check", "jk_ad_eligibility_check", "执行过资格检查的去重用户", "活跃后", "session_id / placement", "P0", "Firebase"],
                  ["Eligible", "jk_ad_eligibility_check", "eligible=1 的去重用户", "检查后", "session_id / eligible", "P0", "Firebase"],
                  ["Opportunity", "jk_ad_opportunity", "生成真实展示机会", "Eligible后30分钟", "opportunity_id", "P0", "Firebase"],
                  ["Request UV（观察节点）", "jk_ad_request", "至少1次广告请求的去重用户", "统计窗口内；含预加载/实时请求；不作为 Opportunity 的严格下一步", "request_id / user_pseudo_id / request_type", "P0", "Firebase"],
                  ["Show Attempt UV", "jk_ad_show_attempt", "至少1次展示尝试的去重用户", "缓存命中与实时请求分支汇合后", "opportunity_id / ad_instance_id", "P0", "Firebase"],
                  ["广告展示独立用户（AV）", "jk_ad_impression", "至少1次 Impression 的去重用户", "Opportunity后；缓存命中可不产生新请求", "user_pseudo_id / opportunity_id / ad_instance_id", "P0", "Firebase"],
                  ["Paid", "jk_ad_paid_event", "收到Paid回调用户", "Impression后", "ad_instance_id", "条件P0", "Firebase"],
                ].map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{index === 5 ? <Badge tone="bad">{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div>
              </section>
              <section className="two-column snapshot-branches">
                <div className="surface"><div className="surface-title"><div><h2>机会履约分支定义</h2><p>同一 opportunity_id 先进入缓存命中或缓存未命中分支，再在 Show Attempt 汇合</p></div><Badge tone="blue">Fulfillment</Badge></div><div className="definition-list"><div><strong>Cache Hit</strong><p>命中时不产生新 request_id；必须把当前 opportunity_id 绑定到缓存广告的 ad_instance_id。</p></div><div><strong>Cache Miss → Ad Request</strong><p>未命中后才允许 Realtime Request；request_type=realtime、is_preload=0，并携带 opportunity_id。</p></div><div><strong>Request Accepted</strong><p>只表示客户端已调用 SDK 且没有同步异常，是派生检查点，不等于 AdMob 已 Match。</p></div><div><strong>Load Success / Failed</strong><p>以 request_id 关联加载结果；成功保存 response_id、ad_source、adapter，失败保存 error_code/error_domain。</p></div><div><strong>Ad Ready</strong><p>广告对象、ad_instance_id 与 instanceContext 已绑定，且对象未过 TTL、未被驱逐。</p></div><div><strong>Show Attempt → Impression → Paid</strong><p>Show Attempt 汇合两条履约路径；Impression 证明真实展示，Paid Event 记录收入回调。</p></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>预加载库存定义</h2><p>发生在业务场景之前，只评估库存生产、保存与消费效率</p></div><Badge tone="warn">Inventory</Badge></div><div className="definition-list"><div><strong>Preload Trigger → Request</strong><p>request_type=preload、is_preload=1，创建 request_id，禁止传 opportunity_id。</p></div><div><strong>Request Accepted → Load Result</strong><p>受理只表示 SDK 调用成功；Load Success / Failed 必须继续回传，并以 request_id 关联。</p></div><div><strong>Load Success → Cache Store / Ready</strong><p>生成并保存 ad_instance_id；广告对象必须与 instanceContext 一起进入缓存，并记录 TTL。</p></div><div><strong>Hit / Expired / Evicted / Unused</strong><p>分别计算消费、过期、淘汰和未消费库存；不能将预加载请求次数放进 Opportunity 实时履约链。</p></div></div></aside>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>统一计算规则</h2><p>避免不同页面出现不同答案</p></div></div><div className="rule-grid"><div><span>用户去重</span><strong>project_code + user_pseudo_id</strong></div><div><span>事件去重</span><strong>event_id</strong></div><div><span>顺序模式</span><strong>严格按 event_time</strong></div><div><span>同一步重复</span><strong>仅取首次到达</strong></div><div><span>缺失事件</span><strong>进入质量隔离区，不补算</strong></div><div><span>未知 jk_ 事件</span><strong>allowlist 外进入隔离表</strong></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>数据时效</h2><p>页面必须明确显示数据状态</p></div></div><div className="source-list"><div><Badge tone="blue">T+0</Badge><strong>Firebase 实时预估</strong><small>用户与事件漏斗，延迟约 5–15 分钟</small></div><div><Badge tone="good">T+3</Badge><strong>AdMob 已结算</strong><small>收入、匹配率、展示率与广告浏览者</small></div><div><Badge tone="neutral">对账</Badge><strong>Firebase × AdMob</strong><small>只在已结算日期输出最终差异</small></div></div></aside>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>核心指标公式</h2><p>页面、导出和告警统一引用；总 Request 不可作为机会主漏斗分母</p></div></div><div className="formula-list"><div><strong>广告展示独立用户（AV）</strong><code>COUNT_DISTINCT(user_pseudo_id WHERE event_name='jk_ad_impression')</code><p>至少产生过一次广告展示事件的独立用户数，不是展示总次数。</p></div><div><strong>广告展示独立用户比例</strong><code>AV / DAU</code><p>回答有多少活跃用户真正看到了广告。</p></div><div><strong>请求用户覆盖率</strong><code>Request UV / DAU</code><p>Request UV 合并预加载与实时请求用户，仅衡量请求覆盖，不作为 Opportunity 的严格下一步。</p></div><div><strong>人均请求次数</strong><code>request_count / Request UV</code><p>识别重复请求、过度预加载或重试异常。</p></div><div><strong>Opportunity覆盖率</strong><code>COUNT_DISTINCT(opportunity_user) / DAU</code><p>定位真实广告机会覆盖问题。</p></div><div><strong>机会履约率</strong><code>COUNT_DISTINCT(opportunity_id with show_attempt) / COUNT_DISTINCT(opportunity_id)</code><p>缓存与实时请求两条路径在 Show Attempt 汇合后判断。</p></div><div><strong>Miss 后实时请求率</strong><code>realtime_request_opportunity / cache_miss_opportunity</code><p>定位缓存未命中后没有真正发起请求的问题。</p></div><div><strong>加载成功率</strong><code>load_success / accepted_request</code><p>按 request_type、error_code、adapter 和国家拆解。</p></div><div><strong>缓存命中率</strong><code>cache_hit / (cache_hit + cache_miss)</code><p>判断现有库存能否满足真实机会。</p></div><div><strong>预加载成功率</strong><code>preload_load_success / preload_request</code><p>仅评估预加载库存生产效率。</p></div><div><strong>缓存浪费率</strong><code>(cache_expired + cache_evicted) / cache_store</code><p>定位 TTL、缓存容量和触发策略问题。</p></div><div><strong>展示尝试成功率</strong><code>impression_count / show_attempt_count</code><p>定位真实调用 Show 后的展示失败。</p></div><div><strong>Paid 回调完整率</strong><code>paid_event_count / impression_count</code><p>定位 Paid 回调延迟、丢失或重复。</p></div><div><strong>人均展示次数</strong><code>COUNT(jk_ad_impression) / AV</code><p>展示总次数除以广告展示独立用户数，判断展示是否集中。</p></div></div></div>
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
