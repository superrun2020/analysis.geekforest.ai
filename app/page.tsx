"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionDialog, type DialogKey, type DialogResult } from "./action-dialog";
import { FirebaseConfiguration } from "./firebase-configuration";
import { trackingConfigs, trackingEventCatalog, trackingConfigDataSource, type TrackingConfigRecord } from "./tracking-config-data";
import { trackingDatabaseFieldRows } from "./tracking-config-repository";
import { TrackingConfigWorkspace, type TrackingConfigSubmission } from "./tracking-config-workspace";
import { TrackingAcceptanceCenter } from "./tracking-acceptance-center";
import { firebaseTaskLogsApi, type FirebaseCheckLog, type FirebaseSyncRunLog } from "./firebase-task-logs-api";
import {
  MetricDictionaryDrawer,
  MetricInspectContext,
  MetricLabel,
} from "./metric-dictionary";
import { fetchDateSessionSummary, fetchFunnelFilterOptions, fetchOnlineProjects, type DateSessionSummary, type FunnelFilterOptions, type OnlineProject } from "./project-options-api";
import { CompanyLogin, getCompanyAuthToken, useCompanyAuth } from "./company-auth";
import { OperationalFunnel, type OperationalReportSnapshot } from "./operational-funnel";
import { OnlineModulePage } from "./online-module-page";
import SharedReportPage from "./shared-report/page";
import ProjectReportSharePage from "./project-report-share-page";
import { ShareAlertsPage } from "./share-alerts-page";
import { trackingApiBaseUrl } from "./api-base-url";
import { createCodexQueryLinks } from "./codex-query-links-api";

const APP_VERSION = "V118";
const VERSION_MANIFEST_PATH = "/version.json";

type PageKey =
  | "overview"
  | "workbench"
  | "diagnosis"
  | "cohort"
  | "path"
  | "evidence"
  | "issues"
  | "snapshot"
  | "network_failure_matrix";

type FunnelMode = "product" | "monetization";
type UnitMode = "users" | "events";
type DiagnosticDomain = "ads" | "vpn" | "quality";
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
type ModuleKey = "global" | "project" | "funnel" | "vpn" | "admob" | "firebase" | "reconcile" | "tracking" | "config" | "firebaseSetup" | "tasks" | "shareAlerts";
const moduleKeys = new Set<ModuleKey>(["global", "project", "funnel", "vpn", "admob", "firebase", "reconcile", "tracking", "config", "firebaseSetup", "tasks", "shareAlerts"]);
const pageKeys = new Set<PageKey>(["overview", "workbench", "diagnosis", "cohort", "path", "evidence", "issues", "snapshot", "network_failure_matrix"]);
const legacyWorkbenchPages = new Set<PageKey>(["diagnosis", "cohort", "path", "snapshot"]);
const emptyFilterOptions: FunnelFilterOptions = { projects: [], platforms: [], countries: [], appVersions: [], buildNumbers: [], versions: [] };

function uniqueOptionValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function displayPlatform(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "android") return "Android";
  if (normalized === "ios") return "iOS";
  return value.trim();
}

function pickDefaultPlatform(options: string[]) {
  if (options.includes("Android")) return "Android";
  return options.find((item) => item !== "全部") ?? "全部";
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function queryDateRange(range: string) {
  const exactDate = range.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (exactDate) return { dateFrom: exactDate, dateTo: exactDate };
  if (range === "今天") return { dateFrom: isoDate(0), dateTo: isoDate(0) };
  if (range === "昨天") return { dateFrom: isoDate(-1), dateTo: isoDate(-1) };
  if (range === "近7天") return { dateFrom: isoDate(-7), dateTo: isoDate(-1) };
  if (range === "近30天") return { dateFrom: isoDate(-30), dateTo: isoDate(-1) };
  return { dateFrom: isoDate(-1), dateTo: isoDate(-1) };
}

function shortCount(value: number | undefined | null) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count)) return "0";
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  return count.toLocaleString("zh-CN");
}

function sumSessionCount(rows: DateSessionSummary["rows"], dateFrom: string, dateTo: string) {
  return rows
    .filter((row) => row.date >= dateFrom && row.date <= dateTo)
    .reduce((total, row) => total + Number(row.sessionCount || 0), 0);
}

function rangeOptionLabel(label: string, count?: number | null) {
  return count === undefined || count === null ? label : `${label} · ${shortCount(count)} sessions`;
}

function weekdayLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

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
    : requestedModule === "config"
      ? "tracking"
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

function readInitialProjectCode() {
  if (typeof window === "undefined") return "IRAN-VPN-01";
  return new URLSearchParams(window.location.search).get("project") || "IRAN-VPN-01";
}

function normalizeOnlineProjectCode(projectCode: string, projects: OnlineProject[]) {
  const raw = projectCode.trim();
  if (!raw) return raw;
  if (projects.some((item) => item.projectCode === raw)) return raw;
  const upper = raw.toUpperCase();
  const exact = projects.find((item) => item.projectCode.toUpperCase() === upper);
  if (exact) return exact.projectCode;
  const prefixed = projects.find((item) => item.projectCode.toUpperCase() === `A${upper}`);
  if (prefixed) return prefixed.projectCode;
  const unprefixed = upper.startsWith("A") ? upper.slice(1) : upper;
  const byUnprefixed = projects.find((item) => item.projectCode.toUpperCase().replace(/^A/, "") === unprefixed);
  return byUnprefixed?.projectCode ?? raw;
}

function versionNumber(value: string) {
  const matched = value.match(/V(\d+)/i);
  return matched ? Number(matched[1]) : 0;
}

function buildRenderedPageSnapshot() {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const shell = document.querySelector(".app-shell");
  if (!shell) return null;

  const clonedShell = shell.cloneNode(true) as HTMLElement;
  clonedShell.querySelectorAll("script, iframe, noscript").forEach((node) => node.remove());
  clonedShell.querySelectorAll("button, input, select, textarea, a").forEach((node) => {
    const element = node as HTMLElement;
    element.setAttribute("tabindex", "-1");
    if (element.tagName !== "A") element.setAttribute("disabled", "true");
  });

  const styleLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((link) => {
      const href = new URL(link.getAttribute("href") || "", window.location.origin).toString();
      return `<link rel="stylesheet" href="${href}">`;
    })
    .join("\n");
  const inlineStyles = Array.from(document.querySelectorAll<HTMLStyleElement>("style"))
    .map((style) => `<style>${style.textContent ?? ""}</style>`)
    .join("\n");
  const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth);
  const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; font-src https: data:; style-src https: 'unsafe-inline';">
<base href="${window.location.origin}/">
${styleLinks}
${inlineStyles}
<style>
html,body{margin:0;min-height:100%;background:#f4f6fb;overflow:auto}
button,input,select,textarea,a{pointer-events:none!important}
.notice,.metric-drawer,.modal-backdrop{display:none!important}
</style>
</head>
<body>${clonedShell.outerHTML}</body>
</html>`;
  return {
    html,
    capturedFromUrl: window.location.href,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: width,
    documentHeight: height,
    capturedAt: new Date().toISOString(),
    mode: "dom_snapshot_v1",
  };
}

async function createProjectReportShare(snapshot: OperationalReportSnapshot, module: ModuleKey, page: PageKey) {
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");
  const title = `${snapshot.projectCode || "全部项目"} · ${snapshot.domain === "vpn" ? "VPN功能漏斗" : "广告漏斗"}项目报告`;
  const response = await fetch(`${trackingApiBaseUrl()}/api/v3/jkcl-funnel/project-report-shares`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      module,
      page,
      projectCode: snapshot.projectCode === "全部项目" ? undefined : snapshot.projectCode,
      snapshot: {
        ...snapshot,
        renderedPageSnapshot: buildRenderedPageSnapshot(),
      },
      frontendBaseUrl: typeof window !== "undefined" ? window.location.origin : undefined,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { code?: number; msg?: string; error?: string; data?: { shareUrl: string; copyText?: string } };
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) throw new Error(payload.msg || payload.error || `分享接口返回 HTTP ${response.status}`);
  if (!payload.data?.shareUrl) throw new Error("分享接口未返回链接");
  return payload.data;
}

const moduleMenus: Array<{ key: ModuleKey; index: string; label: string; group: "经营分析" | "质量治理" }> = [
  { key: "funnel", index: "01", label: "广告漏斗分析中心", group: "经营分析" },
  { key: "vpn", index: "02", label: "VPN功能漏斗分析", group: "经营分析" },
  { key: "admob", index: "03", label: "AdMob 分析", group: "经营分析" },
  { key: "firebase", index: "04", label: "Firebase 数据", group: "经营分析" },
  { key: "reconcile", index: "05", label: "数据对账", group: "经营分析" },
  { key: "tracking", index: "06", label: "打点测试配置", group: "质量治理" },
  { key: "tasks", index: "07", label: "任务与告警", group: "质量治理" },
  { key: "shareAlerts", index: "08", label: "异常报警", group: "质量治理" },
];

const moduleCopy: Record<ModuleKey, { title: string; description: string; action: string }> = {
  global: { title: "全局项目总览", description: "统一查看所有项目的用户、投放、收入、利润和数据健康度", action: "导出项目日报" },
  project: { title: "单项目诊断", description: "围绕单个项目串联用户增长、产品漏斗、广告变现和数据质量", action: "创建诊断任务" },
  funnel: { title: "广告漏斗分析中心", description: "聚焦广告变现链路：DAU、资格检查、广告机会、请求、加载、展示、AV、收入和流失诊断", action: "新建广告诊断" },
  vpn: { title: "VPN功能漏斗分析", description: "基于 V1.8 弱网专项分析 VPN 点击、权限、节点、连接阶段、协议回退、可用性、IP 与会话质量", action: "新建 VPN 诊断" },
  admob: { title: "AdMob 分析", description: "分析请求、匹配、展示、广告浏览用户、eCPM和收入变化", action: "导出 AdMob 报表" },
  firebase: { title: "Firebase 数据", description: "统一查看活跃、事件质量、版本覆盖、数据源连接和同步健康", action: "查看事件字典" },
  reconcile: { title: "数据对账", description: "对比 Firebase、AdMob、中台与 ADB 的用户、展示和收入口径", action: "发起重新对账" },
  tracking: { title: "打点测试配置", description: "选择线上项目、应测配置和日期，直接检查配置内事件是否已进入 Firebase/ADB，并给出漏打修复建议", action: "新建打点配置" },
  config: { title: "规范与项目配置", description: "从事件主库组装项目打点配置，发布不可变快照并供打点测试引用", action: "新建打点配置" },
  firebaseSetup: { title: "Firebase 对接中心", description: "独立管理多Firebase连接、Project、App、内部项目绑定、同步水位与接口健康", action: "新建 Firebase 连接" },
  tasks: { title: "数据任务与告警", description: "监控采集、同步、聚合与对账任务，并闭环处理数据异常", action: "新建告警规则" },
  shareAlerts: { title: "异常报警", description: "监控项目报告分享链接的异常访问、可能泄漏、邮件提醒和链接终止", action: "刷新告警" },
};

const moduleDialog: Record<ModuleKey, DialogKey> = {
  global: "project-report",
  project: "diagnosis",
  funnel: "diagnosis",
  vpn: "diagnosis",
  admob: "admob-report",
  firebase: "event-dictionary",
  reconcile: "reconcile-run",
  tracking: "tracking-run",
  config: "config-version",
  firebaseSetup: "firebase-connection",
  tasks: "alert-rule",
  shareAlerts: "alert-rule",
};

const pages: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: "overview", label: "多项目漏斗预览", hint: "只看问题项目" },
  { key: "workbench", label: "单项目分析工作台", hint: "漏斗·页面·流失原因" },
  { key: "evidence", label: "证据与事件明细", hint: "事件链与原始参数" },
  { key: "issues", label: "问题修复闭环", hint: "任务·重测·效果" },
];
const vpnPages: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: "workbench", label: "单项目分析工作台", hint: "连接·回退·网络诊断" },
  { key: "network_failure_matrix", label: "广告网络失败横向报表", hint: "国家×ASN×节点×协议" },
];
const pageGuideCopy: Record<PageKey, { purpose: string; source: string; next: string }> = {
  overview: { purpose: "每天 05:00 横向发现所有项目的问题，只展示异常项目，不在这里做项目筛选。", source: "优先读 DWS 全项目快照；只在点击项目下钻时查询单项目明细。", next: "点击问题项目进入单项目分析工作台。" },
  workbench: { purpose: "单项目内看核心漏斗、断点、页面路径和流失原因。", source: "一次加载核心、诊断、路径、证据、闭环数据包，切 Tab 不重复查。", next: "点击漏斗相邻步骤，看页面 × 断点流失。" },
  evidence: { purpose: "查看原始事件证据、返回值、关联 ID 和异常原因。", source: "来自 DWD 明细与隔离表，保留 event_id / session_id / request_id 等证据。", next: "把可证明异常带入问题修复闭环。" },
    issues: { purpose: "跟踪问题从发现、修复、复测到指标恢复。", source: "来自问题单/任务表；没有问题单时给出建单字段要求。", next: "修复后回打点测试或漏斗页复测验证。" },
  diagnosis: { purpose: "按原因规则解释流失对象，避免把 unknown 当成正常。", source: "来自诊断规则和 DWD 证据聚合。", next: "回核心漏斗选择更准确断点。" },
  cohort: { purpose: "按国家、版本、页面、渠道等维度找异常集中人群。", source: "来自 DWS/DWM 切片聚合。", next: "选择最差切片进入证据明细。" },
  path: { purpose: "按页面看访问、退出和链路到达，定位页面承接流失。", source: "来自 screen_view/screen_exit 和 page × step 聚合。", next: "点击核心漏斗断点查看页面级流失。" },
  snapshot: { purpose: "查看当前执行漏斗口径和步骤定义。", source: "来自已发布漏斗配置快照。", next: "发现口径不对时进入打点测试配置修订。" },
  network_failure_matrix: { purpose: "按国家 × ASN × 节点 × 协议横向看广告请求、加载失败、展示失败和展示拦截。", source: "来自 V1.8 明细事件携带的网络上下文，独立查询、按需加载。", next: "定位到具体网络出口后回 VPN 工作台看连接与协议回退。" },
};

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

const diagnosticMetricGroups = {
  ads: [
    ["广告资格通过率", "79.4%", "283,006 / 356,410", "-1.1pp", "warn", "eligible_count / eligibility_check_count"],
    ["资格后机会完整率", "75.7%", "214,306 / 283,006", "-6.4pp", "bad", "eligible_with_opportunity / eligible"],
    ["缓存命中率", "68.5%", "146,812 / 214,306", "+2.2pp", "good", "cache_hit / opportunity"],
    ["实时请求启动率", "93.6%", "63,204 / 67,494", "-0.8pp", "good", "realtime_request / cache_miss"],
    ["请求加载成功率", "98.0%", "61,940 / 63,204", "+0.3pp", "good", "load_success / realtime_request"],
    ["请求终态完整率", "99.6%", "62,951 / 63,204", "-0.2pp", "good", "unique terminal request_id / request_id"],
    ["加载成功未展示率", "14.7%", "28,206 / 191,842", "+4.9pp", "bad", "load_success without impression / load_success"],
    ["广告浏览者比例", "23.1%", "29,671 AV / 128,430 DAU", "-11.7pp", "bad", "AV / DAU"],
    ["人均广告展示次数", "4.64", "137,628 / 29,671", "+0.21", "good", "impression_count / AV"],
    ["请求→展示 P95", "4.82s", "P50 1.36s", "+1.14s", "warn", "impression_time - request_time"],
    ["加载→展示 P95", "3.27s", "P50 0.71s", "+0.92s", "warn", "impression_time - load_success_time"],
  ],
  vpn: [
    ["连接尝试成功率", "78.0%", "64,276 / 82,361", "-5.9pp", "bad", "connect_success / connect_attempt"],
    ["会话最终成功率", "74.6%", "61,423 / 82,361", "-4.1pp", "bad", "session_final_success / connect_session"],
    ["权限阶段成功率", "92.8%", "76,409 / 82,361", "-0.6pp", "good", "permission_granted / permission_requested"],
    ["节点选择有效率", "89.6%", "68,463 / 76,409", "-2.3pp", "warn", "node_connect_started / node_selected"],
    ["隧道建立成功率", "91.7%", "62,781 / 68,463", "-3.4pp", "warn", "tunnel_success / tunnel_start"],
    ["协议回退恢复率", "68.2%", "3,184 / 4,668", "+6.7pp", "warn", "fallback_success / fallback_attempt"],
    ["切网断连率", "12.4%", "2,806 / 22,629", "+3.1pp", "bad", "network_change_disconnect / active_at_change"],
    ["自动重连成功率", "83.6%", "2,037 / 2,436", "+2.8pp", "good", "reconnect_success / reconnect_attempt"],
    ["连接前后 IP 变化率", "96.8%", "59,458 / 61,423", "-0.7pp", "good", "ip_before_connect != ip_after_connect"],
  ],
  quality: [
    ["事件缺失率", "1.8%", "18,402 / 1,022,340", "+0.6pp", "warn", "expected_not_received / expected"],
    ["孤儿 ID 率", "2.6%", "8,741 / 336,205", "+1.4pp", "bad", "unmatched context events / relevant events"],
    ["重复终态率", "0.31%", "196 / 63,147", "+0.08pp", "warn", "ids_with_multiple_terminal / terminal_ids"],
    ["接口补传成功率", "94.7%", "12,884 / 13,603", "+3.9pp", "good", "retry_ack_success / retry_attempt"],
    ["P0 字段完整率", "99.2%", "缺失 8,178 条", "-0.5pp", "warn", "complete_p0_events / received_events"],
    ["事件链可关联率", "95.8%", "322,083 / 336,205", "-1.9pp", "warn", "fully_linked_chains / relevant_chains"],
  ],
} as const;

const vpnStageHealth = [
  ["连接开始", "vpn_connection_start", "82,361", "100%", "—", "0ms", "good"],
  ["权限通过", "vpn_permission_result", "76,409", "92.8%", "-0.6pp", "480ms", "good"],
  ["节点选择", "vpn_node_selected", "76,409", "100%", "+0.1pp", "126ms", "good"],
  ["DNS解析", "vpn_connection_phase · dns_resolve", "72,884", "95.4%", "-2.3pp", "920ms", "warn"],
  ["Socket连接", "vpn_connection_phase · socket_connect", "68,463", "93.9%", "-3.4pp", "4.82s", "warn"],
  ["协议握手", "vpn_connection_phase · protocol_handshake", "62,781", "91.7%", "-2.8pp", "3.31s", "warn"],
  ["出口可用性", "vpn_connectivity_check", "61,423", "97.8%", "-0.7pp", "2.08s", "good"],
] as const;

const qualityIssues = [
  ["opportunity_id 孤儿", "jk_ad_show_attempt", "4,826", "Cache Hit 后未绑定当前机会", "广告位 × App版本"],
  ["request_id 缺少终态", "jk_ad_request", "253", "超时后 load_failed 未上报", "SDK版本 × adapter"],
  ["ad_instance_id 重复终态", "jk_ad_paid_event", "196", "Paid 回调重入且未去重", "广告格式 × response_id"],
  ["vpn_session_id 断链", "jk_vpn_ip_verify", "1,104", "重连时创建了新会话上下文", "协议 × 网络类型"],
  ["补传仍失败", "outbox_ack", "719", "ACK 超时或重试次数耗尽", "接口状态 × App版本"],
] as const;

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

const operationDiagnosisProfiles = {
  opportunity_coverage: {
    label: "广告机会覆盖率",
    value: "28.4%",
    delta: "-12.8pp",
    conclusion: "1.8.0 连接成功页把广告机会创建推迟到动画完成后，弱网和短会话用户在机会生成前离开或进入后台。",
    evidence: ["伊朗 × 1.8.0 贡献 61.2% 流失", "screen_exit=animation_not_finished 占 31.6%", "app_background 且 pending_ad_count>0 占 21.2%"],
    actions: ["将 opportunity_id 创建前移到连接成功页真正可见时", "保留动画，但不再以动画完成作为广告机会前置条件", "补充 Opportunity 前后 30 秒 screen_exit / app_background 关联验证"],
    fields: "screen_name · exit_action · app_state · background_reason · app_version · network_type · opportunity_id",
  },
  viewer_ratio: {
    label: "广告浏览者比例",
    value: "23.1%",
    delta: "-11.7pp",
    conclusion: "机会覆盖下降是主因，次因是缓存命中后 instanceContext 关联不完整，部分 Show Attempt 未形成 Impression。",
    evidence: ["Opportunity UV/DAU 下降 12.8pp", "AV/Opportunity 仍有 6.3pp 可优化空间", "opportunity_id 关联缺失集中在缓存命中分支"],
    actions: ["先修机会创建时机，再处理缓存实例关联", "广告对象与 instanceContext 一起缓存至终态", "展示前校验 opportunity_id、ad_instance_id、Activity 状态"],
    fields: "my_user_id · opportunity_id · request_id · ad_instance_id · cache_age_ms · activity_state · app_state",
  },
  page_ctr: {
    label: "主按钮点击率（CTR）",
    value: "53.8%",
    delta: "-9.4pp",
    conclusion: "服务器选择页在 1.8.0 的 UI 样式 B 上点击下降，并集中于首屏渲染较慢的低端设备。",
    evidence: ["ui_style=B 点击 UV/Page UV 低 13.2pp", "Android 10 以下设备贡献 47.8% 下滑", "screen_duration_ms<3s 的退出用户显著增加"],
    actions: ["下沉主按钮位置并取消首屏二次动画阻塞", "按 device_model/os_version 降级重动画", "V1.7 只能算 Click UV/Page UV；正式 CTR 需新增 element_exposure"],
    fields: "screen_name · element_name · action_name · ui_style · device_model · os_version · screen_duration_ms",
  },
  vpn_connection_rate: {
    label: "VPN 连接成功率",
    value: "78.0%",
    delta: "-5.6pp",
    conclusion: "失败集中在伊朗蜂窝网络和 eu-west 节点，connect_timeout 与 dns_failed 同时升高。",
    evidence: ["network_type=cellular 下降 8.1pp", "node_region=eu-west 贡献 54.6% 失败", "ip_after_status=timeout 与 error_code=connect_timeout 同向"],
    actions: ["对伊朗蜂窝网络切换备用 DNS 与协议", "降低 eu-west 节点权重并启用健康熔断", "把 ip_after_capture_rate 纳入版本灰度门禁"],
    fields: "connection_id · vpn_status · node_region · network_type · duration_ms · error_code · ip_after_status",
  },
  arpdau: {
    label: "每活跃用户收入（ARPDAU）",
    value: "$0.035",
    delta: "-18.4%",
    conclusion: "收入下降主要由广告覆盖变差造成，而非 eCPM；展示集中在少数用户掩盖了未变现用户扩大。",
    evidence: ["AV/DAU 下降 11.7pp", "Impression/AV 保持 3.42", "AdMob eCPM 结算口径仅下降 1.6%"],
    actions: ["优先恢复 Opportunity 与 AV 覆盖，不先加频次", "按 0/1/2~3/4~5/6~10/10+ 展示分桶观察", "用 AdMob T+3 结算收入验证 Firebase T+0 方向"],
    fields: "my_user_id · event_id · value_micros · currency_code · ad_source · placement · app_version",
  },
} as const;

const v17DiagnosisDimensions = [
  ["页面与路径", "screen_name · previous_screen · next_screen · screen_index · exit_action · screen_duration_ms", "V1.7可用"],
  ["用户生命周期", "install_source · is_reinstall · open_times · session_index · user_lifecycle_day · is_first_day", "V1.7可用"],
  ["地域与本地化", "country_code · city · attribution_country · locale_country · locale_language · timezone", "V1.7可用"],
  ["网络与VPN", "network_type · vpn_active · node_region · duration_ms · error_code · disconnect_reason", "V1.7可用"],
  ["连接前后IP", "ip_before_status · ip_after_status · ip_change · country_change · firebase_ip_join", "中台关联"],
  ["设备与版本", "platform · app_version · app_build · os_version · device_model", "V1.7可用"],
  ["配置与实验", "remote_config_applied · abtest_id · abtest_group · ui_style", "V1.7可用"],
  ["用户权益", "is_subscriber · subscription_status · consent_status · personalized_allowed", "V1.7可用"],
  ["广告履约", "placement · ad_format · ad_unit_id · is_preload · retry_index · cache_age_ms · blocked_reason", "V1.7可用"],
  ["广告源与错误", "ad_source · mediation_adapter · error_category · error_code · load_duration_ms", "V1.7可用"],
  ["上报质量", "batch_id · queue_size · oldest_event_age_ms · accepted_count · rejected_count", "中台直传"],
  ["元素曝光/渲染", "element_exposure · screen_render_complete · visibility_reason", "需扩展"],
] as const;

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
      <div className="metric-label"><MetricLabel metric={label}>{label}</MetricLabel></div>
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
const statusLabel = (status?: string | null) => {
  const raw = String(status || "").trim();
  if (!raw) return "未知";
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  const value = raw.toUpperCase();
  const labels: Record<string, string> = {
    SUCCESS: "成功",
    SUCCEEDED: "成功",
    FINISHED: "已完成",
    PASS: "通过",
    PASSED: "通过",
    ACTIVE: "正常",
    RUNNING: "运行中",
    PROCESSING: "处理中",
    VERIFYING: "校验中",
    QUEUED: "排队中",
    NO_DATA: "无数据",
    SKIPPED: "已跳过",
    DEGRADED: "降级",
    FAILED: "失败",
    FAIL: "失败",
    ERROR: "错误",
    MISMATCH: "不一致",
    UNKNOWN: "未知",
  };
  return labels[value] ?? raw;
};
const isFailedStatus = (status?: string) => ["FAILED", "FAIL", "ERROR", "MISMATCH"].includes((status ?? "").toUpperCase());
const isRunningStatus = (status?: string) => ["RUNNING", "PROCESSING", "VERIFYING", "QUEUED"].includes((status ?? "").toUpperCase());
const logProjectLabel = (item: FirebaseSyncRunLog | FirebaseCheckLog) => item.projectCode || item.projectName || "连接级日志";

function Segmented({ items, active, onChange, label }: { items: Array<{ key: string; label: string }>; active: string; onChange: (key: string) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button type="button" role="tab" aria-selected={active === item.key} key={item.key} className={active === item.key ? "selected" : ""} onClick={() => onChange(item.key)}>{item.label}</button>
      ))}
    </div>
  );
}

function ModulePage({ module, project, projectMeta, onlineProjects, range, platform, country, appVersion, refreshKey, configs, onProjectChange, openModule, openDialog, openConfigEditor, notify }: { module: Exclude<ModuleKey, "funnel">; project: string; projectMeta?: OnlineProject; onlineProjects: OnlineProject[]; range: string; platform: string; country: string; appVersion: string; refreshKey: number; configs: TrackingConfigRecord[]; onProjectChange: (project: string) => void; openModule: (next: ModuleKey) => void; openDialog: (dialog: DialogKey) => void; openConfigEditor: (config: TrackingConfigRecord | null) => void; notify: (message: string) => void }) {
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
  if (module === "vpn") return <OperationalFunnel
    enabled={Boolean(project) && onlineProjects.length > 0}
    page="workbench"
    projectCode={project}
    appIdentifier={projectMeta?.appIdentifier}
    range={range}
    platform={platform}
    country={country}
    appVersion={appVersion}
    refreshKey={refreshKey}
    onPageChange={() => openModule("vpn")}
    onProjectSelect={onProjectChange}
    initialDomain="vpn"
    lockDomain
    softFailure
  />;
  if (["global", "project", "vpn", "admob", "firebase", "reconcile"].includes(module)) return <OnlineModulePage module={module as "global" | "project" | "vpn" | "admob" | "firebase" | "reconcile"} project={project} projectMeta={projectMeta} range={range} platform={platform} country={country} appVersion={appVersion} refreshKey={refreshKey} onOpenModule={openModule} onOpenDialog={openDialog} />;
  if (module === "tracking" || module === "config") return (
    <div className="page-stack">
      <section className="config-head surface"><div><h2>打点测试配置</h2><p>只保留测试验收需要的操作：选择产品、选择应测配置、查询线上收到/未收到事件、定位修复建议。</p></div><div><button className="primary-button" onClick={() => openConfigEditor(null)}>＋ 新建打点配置</button></div></section>
      <TrackingAcceptanceCenter project={project} projects={onlineProjects.map((item) => ({ code: item.projectCode, name: item.appName, category: "线上项目", appIdentifier: item.appIdentifier }))} configs={configs} platform={platform} appVersion={appVersion} onProjectChange={changeTrackingProduct} openConfig={() => openConfigEditor(null)} notify={notify} />
    </div>
  );

  return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="运行日志" value={String(syncRuns.length)} note={taskLogLoading ? "正在读取" : "Firebase同步任务"} /><Metric label="运行中" value={String(runningSyncRuns)} note="QUEUED/RUNNING/VERIFYING" tone={runningSyncRuns ? "good" : undefined} /><Metric label="失败运行" value={String(failedSyncRuns)} note="需排查或重试" tone={failedSyncRuns ? "bad" : undefined} /><Metric label="错误日志" value={String(failedCheckLogs)} note="Firebase预检失败" tone={failedCheckLogs ? "bad" : "good"} /><Metric label="检查记录" value={String(checkLogs.length)} note="服务账号/Firebase/BigQuery" /><Metric label="最近运行" value={formatLogTime(latestRunTime).slice(11) || "—"} note={latestRunTime ? formatLogTime(latestRunTime).slice(0, 10) : "等待同步"} /></section>
      <section className="surface firebase-task-console"><div className="surface-title"><div><h2>Firebase 数据任务日志</h2><p>统一展示 Firebase 资源检查、同步运行和错误日志，数据来自 ADB 控制表。</p></div><div className="dimension-tabs"><button className={taskFilter==="all"?"active":""} onClick={()=>setTaskFilter("all")}>全部</button><button className={taskFilter==="failed"?"active":""} onClick={()=>setTaskFilter("failed")}>失败</button><button className={taskFilter==="running"?"active":""} onClick={()=>setTaskFilter("running")}>运行中</button></div></div><div className="firebase-task-toolbar"><input value={taskKeyword} onChange={(event)=>setTaskKeyword(event.target.value)} onKeyDown={(event)=>{ if (event.key === "Enter") void loadFirebaseTaskLogs(); }} placeholder="搜索项目、包名、Firebase Project/App、错误信息" /><button className="secondary-button" onClick={() => { setTaskKeyword(""); setTaskFilter("all"); }}>重置</button><button className="primary-button" onClick={() => void loadFirebaseTaskLogs()}>{taskLogLoading ? "刷新中..." : "刷新日志"}</button></div>{taskLogError && <div className="firebase-log-state warn"><strong>日志接口待接入</strong><p>{taskLogError}。请在部署环境变量配置 NEXT_PUBLIC_TRACKING_API_BASE_URL 和 NEXT_PUBLIC_TRACKING_API_SECURE_PATH，并确认后端已合并日志接口。</p></div>}</section>
      <section className="surface task-interface-map"><div className="surface-title"><div><h2>任务页接入边界</h2><p>没有真实接口时不展示模拟任务；只展示接口状态、应接表和排查入口。</p></div><Badge tone={taskLogError ? "warn" : "good"}>{taskLogError ? "待配置" : "已连接"}</Badge></div><div>{[["同步运行","/firebase-integration/sync-runs","firebase_sync_runs","看BigQuery读取、OSS归档、ADB写入水位"],["资源检查","/firebase-integration/check-logs","firebase_api_check_logs","看服务账号、Firebase App、Dataset、events表权限"],["打点测试","/jkcl-funnel/tracking-event-coverage","dws_app_event_quality_daily + dwd_app_tracking_event_v18","看配置快照里应测事件是否收到、字段是否完整"],["告警规则","/alert-rules","metric_alert_rules","看阈值、冷却、通知和恢复状态"]].map((row)=><article key={row[0]}><span>{row[0]}</span><code>{row[1]}</code><strong>{row[2]}</strong><small>{row[3]}</small></article>)}</div></section>
      <section className="surface"><div className="surface-title"><div><h2>运行日志</h2><p>对应 ADB 表 <code>firebase_sync_runs</code>，用于查看 Firebase 绑定同步任务的水位、处理量和失败原因。</p></div><Badge tone={failedSyncRuns ? "bad" : "blue"}>{visibleSyncRuns.length} 条</Badge></div><div className="table-wrap"><table><thead><tr><th>任务 / 运行ID</th><th>项目</th><th>Firebase资源</th><th>时间范围</th><th>开始 / 结束</th><th>处理量</th><th>耗时</th><th>状态</th><th>错误</th></tr></thead><tbody>{visibleSyncRuns.length ? visibleSyncRuns.map((row) => <tr key={row.runId} className={isFailedStatus(row.status) ? "row-warn" : ""}><td><strong>{row.runType || "SYNC"}</strong><small>Run #{row.runId}{row.externalJobId ? ` · ${row.externalJobId}` : ""}</small></td><td><strong>{logProjectLabel(row)}</strong><small>{row.projectName || row.packageName || row.connectionName || "—"}</small></td><td><strong>{row.firebaseProjectId || "—"}</strong><small>{row.firebaseAppId || row.firebaseAppIdentifier || "—"}</small></td><td><strong>{formatLogTime(row.rangeStart)}</strong><small>{formatLogTime(row.rangeEnd)}</small></td><td><strong>{formatLogTime(row.startedAt)}</strong><small>{formatLogTime(row.finishedAt)}</small></td><td><strong>{formatLogRows(row.adbRows)} ADB</strong><small>{formatLogRows(row.sourceRows)} source</small></td><td>{formatLogDuration(row.durationMs)}</td><td><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td><td>{row.errorMessage || "—"}</td></tr>) : <tr><td colSpan={9}><div className="empty-table-state"><strong>{taskLogLoading ? "正在读取运行日志" : "暂无运行日志"}</strong><span>{taskLogError ? "后端接入后会显示真实 Firebase 同步运行记录。" : "当前筛选条件下没有记录。"}</span></div></td></tr>}</tbody></table></div></section>
      <section className="surface"><div className="surface-title"><div><h2>错误日志 / 接口检查</h2><p>对应 ADB 表 <code>firebase_api_check_logs</code>，覆盖服务账号、Firebase Project/App、BigQuery Dataset 和 events 表检查。</p></div><Badge tone={failedCheckLogs ? "bad" : "good"}>{failedCheckLogs} 个失败</Badge></div><div className="table-wrap"><table><thead><tr><th>检查项 / 日志ID</th><th>项目</th><th>Firebase资源</th><th>检查时间</th><th>耗时</th><th>结果</th><th>错误码</th><th>详情</th></tr></thead><tbody>{visibleCheckLogs.length ? visibleCheckLogs.map((row) => <tr key={row.logId} className={isFailedStatus(row.status) ? "row-warn" : ""}><td><strong>{row.checkType || "CHECK"}</strong><small>Log #{row.logId}</small></td><td><strong>{logProjectLabel(row)}</strong><small>{row.projectName || row.packageName || row.connectionName || "—"}</small></td><td><strong>{row.firebaseProjectId || "—"}</strong><small>{row.firebaseAppId || row.firebaseAppIdentifier || "—"}</small></td><td>{formatLogTime(row.checkedAt || row.createdAt)}</td><td>{formatLogDuration(row.durationMs)}</td><td><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td><td>{row.errorCode || "—"}</td><td>{row.message || "—"}</td></tr>) : <tr><td colSpan={8}><div className="empty-table-state"><strong>{taskLogLoading ? "正在读取错误日志" : "暂无错误日志"}</strong><span>{taskLogError ? "后端接入后会显示 Firebase 绑定预检错误和检查详情。" : "当前筛选条件下没有失败或检查记录。"}</span></div></td></tr>}</tbody></table></div></section>
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
  const companyAuth = useCompanyAuth();
  const isSharedReportMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sharedReport") === "1";
  const isProjectReportShareMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("projectReportShare") === "1";
  const initialProjectCode = readInitialProjectCode();
  const [module, setModule] = useState<ModuleKey>("funnel");
  const [page, setPage] = useState<PageKey>("overview");
  const [embedded, setEmbedded] = useState(false);
  const [project, setProject] = useState(initialProjectCode);
  const [onlineProjects, setOnlineProjects] = useState<OnlineProject[]>([]);
  const [filterOptions, setFilterOptions] = useState<FunnelFilterOptions>(emptyFilterOptions);
  const [dateSessionSummary, setDateSessionSummary] = useState<DateSessionSummary | null>(null);
  const [dateSessionLoading, setDateSessionLoading] = useState(false);
  const [dateSessionError, setDateSessionError] = useState("");
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectLoadError, setProjectLoadError] = useState("");
  const [range, setRange] = useState("昨天");
  const [platform, setPlatform] = useState("Android");
  const [country, setCountry] = useState("全部国家");
  const [appVersion, setAppVersion] = useState("全部版本");
  const [draftProject, setDraftProject] = useState(initialProjectCode);
  const [draftRange, setDraftRange] = useState("昨天");
  const [draftPlatform, setDraftPlatform] = useState("Android");
  const [draftCountry, setDraftCountry] = useState("全部国家");
  const [draftAppVersion, setDraftAppVersion] = useState("全部版本");
  const [funnelMode, setFunnelMode] = useState<FunnelMode>("monetization");
  const [unitMode, setUnitMode] = useState<UnitMode>("users");
  const [dimension, setDimension] = useState("国家");
  const [selectedEvent, setSelectedEvent] = useState(7);
  const [evidenceMode, setEvidenceMode] = useState("ad");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [evidenceKeyword, setEvidenceKeyword] = useState("");
  const [evidenceSource, setEvidenceSource] = useState("全部来源");
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
  const [metricDictionaryOpen, setMetricDictionaryOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState("dau");
  const [operationMetric, setOperationMetric] = useState<keyof typeof operationDiagnosisProfiles>("opportunity_coverage");
  const [aiDiagnosisReady, setAiDiagnosisReady] = useState(false);
  const [checkingLatestVersion, setCheckingLatestVersion] = useState(false);
  const [diagnosticDomain, setDiagnosticDomain] = useState<DiagnosticDomain>("ads");
  const [diagnosticAsn, setDiagnosticAsn] = useState("全部 ASN");
  const [diagnosticNetwork, setDiagnosticNetwork] = useState("全部网络");
  const [diagnosticAdPlacement, setDiagnosticAdPlacement] = useState("全部广告位");
  const [diagnosticAdFormat, setDiagnosticAdFormat] = useState("全部格式");
  const [diagnosticAdSource, setDiagnosticAdSource] = useState("全部广告源");
  const [diagnosticProtocol, setDiagnosticProtocol] = useState("全部协议");
  const [diagnosticNode, setDiagnosticNode] = useState("全部节点");
  const [diagnosticQualitySource, setDiagnosticQualitySource] = useState("全部数据源");
  const [diagnosticQualityStatus, setDiagnosticQualityStatus] = useState("全部状态");
  const [workbenchSection, setWorkbenchSection] = useState("diagnosis-overview");
  const [reportSnapshot, setReportSnapshot] = useState<OperationalReportSnapshot | null>(null);
  const [sharingReport, setSharingReport] = useState(false);
  const [sharedReportResult, setSharedReportResult] = useState<{ shareUrl: string; copyText?: string } | null>(null);
  const [creatingCodexLinks, setCreatingCodexLinks] = useState(false);
  const diagnosticSliceValues = diagnosticDomain === "ads"
    ? [country, diagnosticAdPlacement, diagnosticAdFormat, diagnosticAdSource, appVersion]
    : diagnosticDomain === "vpn"
      ? [country, diagnosticAsn, diagnosticNetwork, diagnosticProtocol, diagnosticNode, appVersion]
      : [diagnosticQualitySource, diagnosticQualityStatus, platform, appVersion];
  const diagnosticSlice = diagnosticSliceValues.filter((value) => !value.startsWith("全部")).join(" · ") || "全部维度";
  const platformOptions = useMemo(() => {
    const onlineValues = uniqueOptionValues(filterOptions.platforms.map(displayPlatform));
    const orderedValues = [
      ...["Android", "iOS"].filter((item) => onlineValues.includes(item)),
      ...onlineValues.filter((item) => !["Android", "iOS"].includes(item)),
    ];
    return ["全部", ...orderedValues];
  }, [filterOptions.platforms]);
  const countryOptions = useMemo(() => ["全部国家", ...uniqueOptionValues(filterOptions.countries)], [filterOptions.countries]);
  const appVersionOptions = useMemo(() => {
    const versionLabels = filterOptions.versions.length > 0
      ? filterOptions.versions.map((item) => item.buildNumber ? `${item.appVersion} (${item.buildNumber})` : item.appVersion)
      : filterOptions.appVersions;
    return ["全部版本", ...uniqueOptionValues(versionLabels)];
  }, [filterOptions.appVersions, filterOptions.versions]);
  const onlineDateRange = filterOptions.dateRange?.min && filterOptions.dateRange?.max
    ? `${filterOptions.dateRange.min} 至 ${filterOptions.dateRange.max}`
    : "";
  const draftProjectMeta = useMemo(() => onlineProjects.find((item) => item.projectCode === draftProject), [draftProject, onlineProjects]);
  const dateSessionDomain = module === "vpn" ? "vpn" : "ads";
  const dateSessionScopeMatches = Boolean(
    dateSessionSummary
      && (dateSessionSummary.projectCode ?? "") === draftProject
      && dateSessionSummary.domain === dateSessionDomain
  );
  const dateRows = dateSessionScopeMatches ? dateSessionSummary?.rows ?? [] : [];
  const todaySessionCount = dateRows.find((row) => row.date === isoDate(0))?.sessionCount ?? null;
  const yesterdaySessionCount = dateRows.find((row) => row.date === isoDate(-1))?.sessionCount ?? null;
  const sevenDaySessionCount = sumSessionCount(dateRows, isoDate(-6), isoDate(0));
  const thirtyDaySessionCount = sumSessionCount(dateRows, isoDate(-29), isoDate(0));
  const bestDateRow = dateRows.reduce<DateSessionSummary["rows"][number] | null>((best, row) => {
    if (!best) return row;
    if (Number(row.sessionCount || 0) > Number(best.sessionCount || 0)) return row;
    return best;
  }, null);
  const exactDateOptions = dateRows.slice(0, 30);
  const selectedDateRow = /^\d{4}-\d{2}-\d{2}$/.test(draftRange) ? dateRows.find((row) => row.date === draftRange) : null;
  const dateInputValue = /^\d{4}-\d{2}-\d{2}$/.test(draftRange)
    ? draftRange
    : draftRange === "今天"
      ? isoDate(0)
      : draftRange === "昨天"
        ? isoDate(-1)
        : "";
  const recentSevenDateRows = Array.from({ length: 7 }, (_, index) => {
    const date = isoDate(index - 6);
    const row = dateRows.find((item) => item.date === date);
    return {
      date,
      weekday: weekdayLabel(date),
      sessionCount: Number(row?.sessionCount ?? 0),
      userCount: Number(row?.userCount ?? 0),
      eventCount: Number(row?.eventCount ?? 0),
      isBest: bestDateRow?.date === date,
      isSelected: dateInputValue === date,
    };
  }).reverse();
  const selectedSessionLabel = dateInputValue
    ? `${dateInputValue}：${shortCount(selectedDateRow?.sessionCount ?? 0)} sessions`
    : `${draftRange}：${shortCount(draftRange === "近7天" ? sevenDaySessionCount : draftRange === "近30天" ? thirtyDaySessionCount : 0)} sessions`;
  const dateSessionHint = dateSessionLoading
    ? `正在读取 ${draftProject || "当前项目"} 最近30天 session 数据量…`
    : dateSessionError
      ? dateSessionError
      : !dateSessionScopeMatches && dateSessionSummary
        ? `正在切换到 ${draftProject || "当前项目"} 的数据，请稍等…`
      : bestDateRow && bestDateRow.sessionCount > 0
        ? `已自动读取 · 当前 ${selectedSessionLabel} · 推荐 ${bestDateRow.date}：${shortCount(bestDateRow.sessionCount)} sessions${dateSessionSummary?.queriedAt ? ` · 拉取 ${dateSessionSummary.queriedAt}` : ""}`
        : onlineDateRange
          ? `已自动读取 · 当前 ${selectedSessionLabel} · 线上：${onlineDateRange}`
          : `已自动读取 · 当前 ${selectedSessionLabel}`;

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
    if (companyAuth.checking || !companyAuth.user) {
      setProjectLoading(companyAuth.checking);
      return;
    }
    const projectController = new AbortController();
    const optionController = new AbortController();
    setProjectLoading(true);
    setProjectLoadError("");

    const applyProjectList = (projects: OnlineProject[]) => {
      setOnlineProjects(projects);
      setProjectLoadError(projects.length === 0 ? "Firebase 配置表暂无可用项目，请检查 firebase_connections / firebase_project_bindings 是否已迁移并有 ACTIVE 绑定。" : "");
      const normalizedProject = normalizeOnlineProjectCode(project, projects);
      if (projects.length > 0 && normalizedProject !== project && projects.some((item) => item.projectCode === normalizedProject)) {
        setProject(normalizedProject);
        setDraftProject(normalizedProject);
        setFiltersApplied((value) => value + 1);
        notify(`${project} 已自动匹配为线上项目 ${normalizedProject}，正在重新查询`);
      } else if (projects.length > 0 && !projects.some((item) => item.projectCode === project)) {
        setProject(projects[0].projectCode);
        setDraftProject(projects[0].projectCode);
      }
    };

    fetchOnlineProjects(projectController.signal)
      .then(applyProjectList)
      .catch((error: unknown) => {
        if (projectController.signal.aborted) return;
        setOnlineProjects([]);
        setProjectLoadError(error instanceof Error ? error.message : "线上项目列表读取失败");
      })
      .finally(() => {
        if (!projectController.signal.aborted) setProjectLoading(false);
      });

    fetchFunnelFilterOptions(optionController.signal)
      .then((options) => {
        setFilterOptions(options);
        if (options.projects.length > 0) applyProjectList(options.projects);
        const nextPlatformOptions = [
          "全部",
          ...uniqueOptionValues(options.platforms.map(displayPlatform)),
        ];
        const nextDefaultPlatform = pickDefaultPlatform(nextPlatformOptions);
        const nextCountries = ["全部国家", ...uniqueOptionValues(options.countries)];
        const nextVersions = options.versions.length > 0
          ? options.versions.map((item) => item.buildNumber ? `${item.appVersion} (${item.buildNumber})` : item.appVersion)
          : options.appVersions;
        const nextAppVersions = ["全部版本", ...uniqueOptionValues(nextVersions)];

        if (!nextPlatformOptions.includes(platform)) {
          setPlatform(nextDefaultPlatform);
          setDraftPlatform(nextDefaultPlatform);
        }
        if (!nextCountries.includes(country)) {
          setCountry("全部国家");
          setDraftCountry("全部国家");
        }
        if (!nextAppVersions.includes(appVersion)) {
          setAppVersion("全部版本");
          setDraftAppVersion("全部版本");
        }
      })
      .catch((error: unknown) => {
        if (optionController.signal.aborted) return;
        setFilterOptions(emptyFilterOptions);
        setProjectLoadError((current) => current || (error instanceof Error ? `筛选项读取失败：${error.message}` : "线上筛选项读取失败"));
      });
    return () => {
      projectController.abort();
      optionController.abort();
    };
  }, [companyAuth.checking, companyAuth.user]);

  useEffect(() => {
    if (companyAuth.checking || !companyAuth.user || projectLoading || !draftProject) return;
    if (["firebaseSetup", "shareAlerts"].includes(module)) return;
    const controller = new AbortController();
    setDateSessionLoading(true);
    setDateSessionError("");
    setDateSessionSummary(null);
    fetchDateSessionSummary({
      dateFrom: isoDate(-29),
      dateTo: isoDate(0),
      projectCode: draftProject,
      appIdentifier: draftProjectMeta?.appIdentifier,
      platform: draftPlatform === "全部" ? undefined : draftPlatform.toLowerCase() as "android" | "ios",
      country: draftCountry === "全部国家" ? undefined : draftCountry,
      appVersion: draftAppVersion === "全部版本" ? undefined : draftAppVersion.split(" ")[0],
      domain: dateSessionDomain,
    }, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted) return;
        if ((summary.projectCode ?? "") !== draftProject || summary.domain !== dateSessionDomain) return;
        setDateSessionSummary(summary);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDateSessionSummary(null);
        setDateSessionError(error instanceof Error ? error.message : "每日 session 数据量读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDateSessionLoading(false);
      });

    return () => controller.abort();
  }, [companyAuth.checking, companyAuth.user, projectLoading, draftProject, draftProjectMeta?.appIdentifier, draftPlatform, draftCountry, draftAppVersion, dateSessionDomain, module]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("module", module);
    if (module === "funnel") {
      url.searchParams.set("page", page);
      url.searchParams.set("project", project);
    } else {
      url.searchParams.delete("page");
    }
    if (embedded) url.searchParams.set("embedded", "1");
    window.history.replaceState({}, "", url);
  }, [embedded, module, page, project]);

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
    .filter(({ event }) => !onlyErrors || event.result !== "有效")
    .filter(({ event }) => evidenceSource === "全部来源" || event.source === evidenceSource)
    .filter(({ event }) => {
      const keyword = evidenceKeyword.trim().toLowerCase();
      return !keyword || [event.name, event.id, event.detail, event.requestType, event.cacheStatus]
        .some((value) => value.toLowerCase().includes(keyword));
    });
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
  const operationDiagnosis = operationDiagnosisProfiles[operationMetric];
  const isFunnelOverview = module === "funnel" && page === "overview";
  const sourceStatus: Record<ModuleKey, { title: string; detail: string; note: string }> = {
    global: { title: "混合时效", detail: "Firebase T+0 · AdMob T+3 · 刷新", note: "DAU和用户行为使用Firebase实时预估；收入、消耗和ROAS使用最近已结算日期，卡片必须标注数据日。" },
    project: { title: "项目诊断", detail: "Firebase延迟约8分钟 · AdMob T+3", note: "用户与产品指标可看当天；收入和AdMob效率使用已结算日期，不参与当天实时结论。" },
    funnel: { title: "每日问题快照", detail: isFunnelOverview ? "每日08:00 · 09:30补数 · 全项目问题预览" : "默认昨日DWS汇总 · 今天实时补查", note: isFunnelOverview ? "多项目漏斗预览只展示全项目问题榜，不做项目筛选；需要筛选、页面路径、流失原因、版本差异和证据时，点击项目进入单项目分析。" : "漏斗默认读取前一天已完成汇总；只有筛选包含今天时才补查实时数据。不可计算指标显示暂无数据，收入最终以AdMob结算为准。" },
    vpn: { title: "V1.8 弱网专项", detail: "Firebase T+0 · 会话/连接/阶段关联", note: "本页以 vpn_session_id 串联用户会话，以 connection_id 区分每次真实连接尝试；俄罗斯/伊朗须按 ASN、网络、协议、端口和限制信号联合判断。" },
    admob: { title: "AdMob+Firebase", detail: "AdMob T+3结算 · Firebase T+0 AV", note: "本页默认按AdMob结算口径展示收入、请求、匹配和展示；当天广告浏览人数AV可用Firebase jk_ad_impression先看趋势。" },
    firebase: { title: "实时数据", detail: "BigQuery intraday · 延迟约8分钟", note: "本页展示Firebase实时预估、事件质量与同步水位；中台数字仅用于差异诊断。" },
    reconcile: { title: "分源对账", detail: "今日双源 · T+3全量", note: "当天只比较Firebase与中台；含AdMob的最终对账仅在结算日期执行，避免跨时效误报。" },
    tracking: { title: "线上打点测试", detail: "项目来自线上 · 直接查 DWS/DWD", note: "打点测试只使用线上项目列表和已发布配置快照；按项目、包名、日期查询 Firebase/ADB 入库结果，未收到或字段异常会直接给修复建议。" },
    config: { title: "配置数据", detail: `${trackingConfigDataSource.eventCount}个标准事件 · ${trackingConfigDataSource.fieldCount}条字段明细`, note: "品类与能力包只负责推荐候选事件；最终验收范围以配置逐项选择并发布的不可变快照为准。" },
    firebaseSetup: { title: "对接控制面", detail: "Firebase连接 / Project / App / Dataset", note: "Firebase对接已合并到Firebase数据和任务日志里展示；项目打点配置不保存Firebase凭证、Project、App或Dataset。" },
    tasks: { title: "任务实时态", detail: "同步日志 · 预检日志 · SLA告警", note: "本页按任务状态和项目过滤，数据日期表示任务处理批次，不等同于经营报表日期；接口未配置时显示待接入，不展示模拟日志。" },
    shareAlerts: { title: "分享风控", detail: "项目报告链接 · 访问审计 · 邮件提醒", note: "公开报告链接不需要系统登录，但必须输入公司邮箱；系统记录访问邮箱、IP、设备/浏览器、网络和查看时间，异常时提醒终止链接。" },
  };
  const filtersDirty = draftProject !== project || draftRange !== range || draftPlatform !== platform || draftCountry !== country || draftAppVersion !== appVersion;
  const appliedProjectMeta = onlineProjects.find((item) => item.projectCode === project);
  const projectSourceWarning = "";

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function copyShareLink(value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        if (!document.execCommand("copy")) throw new Error("copy_failed");
        input.remove();
      }
      notify("分享链接已复制，可以直接发送给同事");
    } catch {
      notify("浏览器未允许自动复制，请选中链接后手动复制");
    }
  }

  async function shareCurrentProjectReport() {
    if (sharingReport) return;
    if (!reportSnapshot) {
      notify("当前页面数据还没加载完，请等查询完成后再分享");
      return;
    }
    setSharingReport(true);
    try {
      const result = await createProjectReportShare(reportSnapshot, module, page);
      setSharedReportResult(result);
      await copyShareLink(result.shareUrl);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "项目报告分享失败");
    } finally {
      setSharingReport(false);
    }
  }

  async function copyCodexQueryLinks() {
    if (creatingCodexLinks) return;
    if (!["funnel", "vpn"].includes(module)) {
      notify("请先进入广告漏斗或 VPN 功能漏斗页面");
      return;
    }
    if (!project || project === "全部项目") {
      notify("请先选择一个线上项目");
      return;
    }
    setCreatingCodexLinks(true);
    try {
      const dates = queryDateRange(range);
      const result = await createCodexQueryLinks({
        projectCode: project,
        appIdentifier: appliedProjectMeta?.appIdentifier || undefined,
        dateFrom: dates.dateFrom,
        dateTo: dates.dateTo,
        platform: platform === "Android" ? "android" : platform === "iOS" ? "ios" : undefined,
        country: country === "全部国家" ? undefined : country,
        appVersion: appVersion === "全部版本" ? undefined : appVersion.split(" ")[0],
      });
      await navigator.clipboard?.writeText(result.copyText);
      notify(`Codex 广告/VPN查询链接已复制，有效期至 ${result.expiresAt}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Codex 查询链接生成失败");
    } finally {
      setCreatingCodexLinks(false);
    }
  }

  async function checkLatestVersion() {
    if (checkingLatestVersion) return;
    setCheckingLatestVersion(true);
    try {
      const checkUrl = new URL(VERSION_MANIFEST_PATH, window.location.origin);
      checkUrl.searchParams.set("_t", String(Date.now()));
      const manifest = await fetch(checkUrl.toString(), {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }).then((response) => {
        if (!response.ok) throw new Error(`版本文件 HTTP ${response.status}`);
        return response.json();
      }) as { appVersion?: string; version?: string };
      const latestVersion = manifest.appVersion || manifest.version || "";
      if (latestVersion && versionNumber(latestVersion) > versionNumber(APP_VERSION)) {
        notify(`发现新版本 ${latestVersion}，正在打开最新版`);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("_app_version", latestVersion);
        nextUrl.searchParams.set("_v", String(Date.now()));
        window.location.replace(nextUrl.toString());
        return;
      }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("_app_version", APP_VERSION);
      nextUrl.searchParams.set("_v", String(Date.now()));
      notify(latestVersion ? `当前已是最新版本 ${APP_VERSION}` : "已重新打开线上最新资源");
      window.setTimeout(() => window.location.replace(nextUrl.toString()), 450);
    } catch {
      notify("版本检测失败，正在尝试刷新当前页面");
      window.setTimeout(() => window.location.reload(), 450);
    } finally {
      window.setTimeout(() => setCheckingLatestVersion(false), 800);
    }
  }

  function selectFunnelMode(nextMode: FunnelMode) {
    setFunnelMode(nextMode);
    if (nextMode === "product") {
      setDiagnosticDomain("vpn");
      setUnitMode("users");
      setTransition({ from: productStages[0].label, to: productStages[1].label, rate: productStages[1].rate, scope: "users" });
      notify("已切换到产品漏斗，并同步显示 VPN 功能指标与下钻维度");
      return;
    }
    setDiagnosticDomain("ads");
    if (productStages.some((stage) => stage.label === transition.from)) {
      setTransition({ from: "Eligible", to: "Opportunity", rate: activeProfile.userStages[3].rate, scope: "users" });
    }
    notify("已切换到广告变现漏斗，并同步显示广告指标与下钻维度");
  }

  function selectDiagnosticDomain(nextDomain: DiagnosticDomain) {
    setDiagnosticDomain(nextDomain);
    if (nextDomain === "ads") setFunnelMode("monetization");
    if (nextDomain === "vpn") {
      setFunnelMode("product");
      setUnitMode("users");
    }
  }

  function selectUnitMode(nextUnit: UnitMode) {
    setUnitMode(nextUnit);
    if (funnelMode === "monetization") changeDiagnosisScope(nextUnit);
    notify(nextUnit === "users" ? "已按用户去重（UV）重算漏斗" : "已按事件次数（Count）重算漏斗");
  }

  function openMetricDefinition(metric: string) {
    setSelectedMetric(metric);
    setMetricDictionaryOpen(true);
  }

  function go(next: PageKey) {
    setModule("funnel");
    setPage(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openProjectAnalysis(nextProject: string) {
    setProject(nextProject);
    setDraftProject(nextProject);
    setModule("funnel");
    setPage("workbench");
    setDiagnosticDomain("ads");
    setFunnelMode("monetization");
    setFiltersApplied((value) => value + 1);
    notify(`已进入 ${nextProject} 单项目分析`);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModule(next: ModuleKey) {
    setReportSnapshot(null);
    setConfigWorkspaceOpen(false);
    setEditingConfig(null);
    if (next === "global" || next === "project" || next === "funnel") {
      setModule("funnel");
      setPage(next === "project" ? "workbench" : "overview");
      if (next === "funnel") {
        setDiagnosticDomain("ads");
        setFunnelMode("monetization");
      }
    } else if (next === "firebaseSetup") {
      setModule("firebase");
    } else {
      setModule(next);
      if (next === "vpn") setPage("workbench");
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
    const defaultProject = onlineProjects[0]?.projectCode ?? "IRAN-VPN-01";
    const defaultPlatform = pickDefaultPlatform(platformOptions);
    setProject(defaultProject);
    setDraftProject(defaultProject);
    setRange("昨天");
    setDraftRange("昨天");
    setPlatform(defaultPlatform);
    setDraftPlatform(defaultPlatform);
    setCountry("全部国家");
    setDraftCountry("全部国家");
    setAppVersion("全部版本");
    setDraftAppVersion("全部版本");
    setFiltersApplied((value) => value + 1);
    notify("筛选条件已恢复默认");
  }

  function applyFilters() {
    setReportSnapshot(null);
    setProject(draftProject);
    setRange(draftRange);
    setPlatform(draftPlatform);
    setCountry(draftCountry);
    setAppVersion(draftAppVersion);
    setFiltersApplied((value) => value + 1);
    notify(`${draftProject} · ${draftRange} 已开始查询`);
  }

  function focusWorkbenchSection(sectionId: "diagnosis-overview" | "funnel-workbench" | "step-diagnosis" | "page-product-analysis" | "workbench-rules") {
    setModule("funnel");
    setPage("workbench");
    setWorkbenchSection(sectionId === "funnel-workbench" ? "diagnosis-overview" : sectionId);
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

  if (isProjectReportShareMode) return <ProjectReportSharePage />;
  if (isSharedReportMode) return <SharedReportPage />;
  if (companyAuth.checking) return <div className="company-auth-loading">正在验证企业登录状态…</div>;
  if (!companyAuth.user) return <CompanyLogin onSignedIn={companyAuth.signIn} />;

  return (
    <MetricInspectContext.Provider value={openMetricDefinition}>
    <div className={`app-shell ${embedded ? "embedded" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">GF</span><span><strong>GeekForest 产品大脑</strong><small className="version-line"><span>质量分析中心 · {APP_VERSION}</span><button type="button" onClick={checkLatestVersion} disabled={checkingLatestVersion} title="检测并打开线上最新版本">{checkingLatestVersion ? "检测中" : "刷新"}</button></small></span></div>
        <div className="nav-group-label">经营分析</div>
        {moduleMenus.filter((item) => item.group === "经营分析").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="nav-group-label">质量治理</div>
        {moduleMenus.filter((item) => item.group === "质量治理").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="sidebar-foot"><span className="status-dot" />线上数据接入<small>经营分析走线上接口；治理菜单按真实接口状态展示</small></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">{moduleMenus.find((item) => item.key === module)?.group} / {currentModule.title}{configWorkspaceOpen ? <> / <strong>{editingConfig ? "编辑打点配置" : "新建打点配置"}</strong></> : module === "funnel" && <> / <strong>{currentPage.label}</strong></>}</div>
          <div className="topbar-actions"><div className="global-search">搜索项目、事件、问题单</div><button className="share-report-button" disabled={!["funnel", "vpn"].includes(module) || !project || creatingCodexLinks} onClick={() => void copyCodexQueryLinks()} title="生成广告打点/VPN打点 JSON 查询链接，发给 Codex 后可直接查线上数据">{creatingCodexLinks ? "生成中…" : "复制Codex查询"}</button><button className="share-report-button" disabled={!["funnel", "vpn"].includes(module) || !reportSnapshot || sharingReport} onClick={() => void shareCurrentProjectReport()} title={reportSnapshot ? "将当前页面已查询出的全部数据固定成分享快照" : "请先等待当前页面查询完成"}>{sharingReport ? "生成中…" : "分享项目报告"}</button><button className="icon-button" aria-label="通知">3</button><button className="account-chip" onClick={() => void companyAuth.signOut()} title="退出登录"><span>{companyAuth.user.employee?.name?.slice(0, 1) || companyAuth.user.email.slice(0, 1).toUpperCase()}</span><small>{companyAuth.user.employee?.name || companyAuth.user.email}</small></button></div>
        </header>

        <main className="main-content">
          {configWorkspaceOpen ? <TrackingConfigWorkspace editingConfig={editingConfig} onlineProjects={onlineProjects} onCancel={() => { setConfigWorkspaceOpen(false); setEditingConfig(null); }} onSave={saveTrackingConfig} /> : <>
          <section className="page-heading">
            <div><h1>{currentModule.title}</h1><p>{currentModule.description}</p></div>
            <div className="heading-actions"><button className="secondary-button" onClick={() => openMetricDefinition("dau")}>指标口径字典</button>{module !== "tracking" && <button className="primary-button" onClick={() => module === "config" ? openConfigEditor(null) : setDialog(moduleDialog[module])}>{["project", "funnel", "config", "firebaseSetup", "tasks"].includes(module) ? "＋ " : ""}{currentModule.action}</button>}</div>
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

          {module === "vpn" && <nav className="page-nav" aria-label="VPN 分析页面">
            {vpnPages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => setPage(item.key)}><span>{item.label}</span><small>{item.hint}</small></button>)}
          </nav>}

          {module === "funnel" && <section className="page-purpose-strip">
            <div><span>当前页能做什么</span><strong>{pageGuideCopy[page].purpose}</strong></div>
            <div><span>数据从哪里来</span><strong>{pageGuideCopy[page].source}</strong></div>
            <div><span>下一步建议</span><strong>{pageGuideCopy[page].next}</strong></div>
          </section>}

          {module !== "firebaseSetup" && <section className={`filter-bar ${isFunnelOverview ? "overview-filter-bar" : ""}`}>
            {isFunnelOverview ? <div className="overview-no-project-filter"><span>项目</span><strong>全部项目问题预览</strong><small>不做项目筛选；每天 08:00 汇总前一天数据，09:30 补充延迟入库数据，点击项目进入单项目分析。</small>{(projectLoadError || projectSourceWarning) && <small className="filter-error">{projectLoadError || projectSourceWarning}</small>}</div> : <label>项目<select value={draftProject} disabled={projectLoading || onlineProjects.length === 0} onChange={(event) => {
              const nextProject = event.target.value;
              setDraftProject(nextProject);
              setProject(nextProject);
              setDateSessionSummary(null);
              setDateSessionError("");
              setReportSnapshot(null);
              setFiltersApplied((value) => value + 1);
              notify(`${nextProject} 已切换，正在读取数据量并查询`);
            }}>{projectLoading && <option>正在读取 Firebase 配置项目…</option>}{!projectLoading && onlineProjects.length === 0 && <option>Firebase 配置项目不可用</option>}{onlineProjects.map((item) => <option key={item.projectCode} value={item.projectCode}>{item.projectCode}{item.appName ? ` · ${item.appName}` : ""}{item.projectSource === "firebase_bindings" ? ` · 已接Firebase${item.firebaseBindingCount ? `(${item.firebaseBindingCount})` : ""}` : ""}</option>)}</select>{(projectLoadError || projectSourceWarning) && <small className="filter-error">{projectLoadError || projectSourceWarning}</small>}</label>}
            <label className="date-filter-label">日期
              <div className="date-selector-grid">
                <select value={draftRange} onChange={(event) => {
                  const nextRange = event.target.value;
                  setDraftRange(nextRange);
                  setRange(nextRange);
                  setReportSnapshot(null);
                  setFiltersApplied((value) => value + 1);
                  notify(`${draftProject} · ${nextRange} 已开始查询`);
                }} title={dateSessionHint}>
                  <option value="今天">{rangeOptionLabel("今天", todaySessionCount)}</option>
                  <option value="昨天">{rangeOptionLabel("昨天", yesterdaySessionCount)}</option>
                  <option value="近7天">{rangeOptionLabel("近7天", sevenDaySessionCount)}</option>
                  <option value="近30天">{rangeOptionLabel("近30天", thirtyDaySessionCount)}</option>
                  {bestDateRow && <option value={bestDateRow.date}>推荐 {bestDateRow.date} · {shortCount(bestDateRow.sessionCount)} sessions</option>}
                  <option disabled>──────── 每日 session 数据量 ────────</option>
                  {dateInputValue && !["今天", "昨天"].includes(draftRange) && !exactDateOptions.some((row) => row.date === dateInputValue) && <option value={dateInputValue}>手动选择 {dateInputValue} · {shortCount(selectedDateRow?.sessionCount ?? 0)} sessions</option>}
                  {exactDateOptions.length > 0
                    ? exactDateOptions.map((row) => <option key={row.date} value={row.date}>{row.date} · {shortCount(row.sessionCount)} sessions{row.date === bestDateRow?.date ? " · 推荐" : ""}</option>)
                    : <option disabled>{dateSessionLoading ? "正在读取每日数据量…" : "暂无每日 session 数据，右侧可手动选日期"}</option>}
                </select>
                <input
                  type="date"
                  value={dateInputValue}
                  min={filterOptions.dateRange?.min ?? undefined}
                  max={filterOptions.dateRange?.max ?? isoDate(0)}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setDraftRange(event.target.value);
                    setRange(event.target.value);
                    setReportSnapshot(null);
                    setFiltersApplied((value) => value + 1);
                    notify(`${draftProject} · ${event.target.value} 已开始查询`);
                  }}
                  title="直接选择某一天查询"
                />
              </div>
              <small className={dateSessionError ? "filter-error" : "filter-hint"}>{dateSessionHint}</small>
            </label>
            <div className="date-session-preview" title="项目、平台、国家或版本变化后会自动刷新最近7天的数据量">
              <div className="date-session-preview-head">
                <strong>{draftProject || "当前项目"} · 最近7天 session</strong>
                <span>{dateSessionLoading ? "读取中" : dateSessionError ? "读取失败" : "已自动读取"}</span>
              </div>
              <div className="date-session-days">
                {recentSevenDateRows.map((row) => (
                  <button
                    key={row.date}
                    type="button"
                    className={`${row.isSelected ? "active" : ""} ${row.isBest ? "best" : ""}`.trim()}
                    onClick={() => {
                      setDraftRange(row.date);
                      setRange(row.date);
                      setReportSnapshot(null);
                      setFiltersApplied((value) => value + 1);
                      notify(`${draftProject} · ${row.date} 已开始查询`);
                    }}
                    title={`${row.date} ${row.weekday} · ${row.sessionCount.toLocaleString("zh-CN")} sessions · ${row.userCount.toLocaleString("zh-CN")} users · ${row.eventCount.toLocaleString("zh-CN")} events`}
                  >
                    <span>{row.date.slice(5)}</span>
                    <strong>{shortCount(row.sessionCount)}</strong>
                    <small>{row.isBest ? "推荐" : row.weekday}</small>
                  </button>
                ))}
              </div>
            </div>
            <label>平台<select value={draftPlatform} onChange={(event)=>setDraftPlatform(event.target.value)}>{platformOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label>国家<select value={draftCountry} onChange={(event)=>setDraftCountry(event.target.value)}>{countryOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label>App版本<select value={draftAppVersion} onChange={(event)=>setDraftAppVersion(event.target.value)}>{appVersionOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <div className="filter-actions"><button onClick={resetFilters}>重置</button><button className={filtersDirty ? "primary-button" : ""} disabled={projectLoading || onlineProjects.length === 0} onClick={applyFilters}>{filtersDirty ? "应用并查询" : "刷新数据"}</button></div>
            <div className="data-state"><span className={`status-dot ${filtersDirty ? "warn" : ""}`} /><strong>{sourceStatus[module].title}</strong><small>{filtersDirty ? "筛选已修改，点击应用后查询" : `${sourceStatus[module].detail} · 刷新#${filtersApplied}`}</small></div>
          </section>}

          {module !== "firebaseSetup" && <section className="context-toolbar">
            <div className="context-summary"><Badge tone="blue">{module === "funnel" ? currentPage.hint : currentModule.title}</Badge><span>{isFunnelOverview ? "全部项目" : project}</span><i /> <span>{isFunnelOverview ? "每日08:00汇总 · 09:30补数" : range}</span><i /> <span>{platform} · {appVersion}</span><i /> <span>{country}</span><i /> <span>口径 V1.8</span></div>
            {module !== "tracking" && <div className="context-actions"><button onClick={() => notify("当前分析视图已保存")}>保存视图</button><button onClick={() => setDialog(module === "admob" ? "admob-report" : "project-report")}>导出报表</button></div>}
          </section>}
          {["tracking", "config", "tasks"].includes(module) && <section className="governance-flow-strip">
            {[
              ["config", "打点测试配置", "先选品类、项目和事件，发布不可变快照"],
              ["tracking", "打点测试", "选择产品和配置快照，查询线上事件是否收到"],
              ["tasks", "任务与告警", "看同步任务、验收失败、告警和处理闭环"],
            ].map(([key, title, desc], index) => <button key={key} className={module === key ? "active" : ""} onClick={() => openModule(key as ModuleKey)}><span>{index + 1}</span><strong>{title}</strong><small>{desc}</small></button>)}
          </section>}
          <section className="freshness-note"><div><strong>数据使用提示：</strong>{sourceStatus[module].note}</div><button onClick={() => openMetricDefinition(module === "admob" ? "match_rate" : module === "tracking" ? "event_pass_rate" : "dau")}>查看数据口径</button></section>

          {module === "shareAlerts" && <ShareAlertsPage projectCode={project} notify={notify} />}

          {module !== "funnel" && module !== "vpn" && module !== "shareAlerts" && <ModulePage module={module as Exclude<ModuleKey, "funnel">} project={project} projectMeta={appliedProjectMeta} onlineProjects={onlineProjects} range={range} platform={platform} country={country} appVersion={appVersion} refreshKey={filtersApplied} configs={configRecords} onProjectChange={(nextProject) => { setProject(nextProject); setDraftProject(nextProject); setFiltersApplied((value) => value + 1); }} openModule={openModule} openDialog={setDialog} openConfigEditor={openConfigEditor} notify={notify} />}

          {module === "funnel" && <OperationalFunnel
            key="operational-ads"
            enabled={!projectLoading && onlineProjects.length > 0}
            page={page}
            projectCode={project}
            appIdentifier={appliedProjectMeta?.appIdentifier}
            range={range}
            platform={platform}
            country={country}
            appVersion={appVersion}
            refreshKey={filtersApplied}
            onPageChange={go}
            onProjectSelect={openProjectAnalysis}
            initialDomain="ads"
            lockDomain
            onSnapshotChange={setReportSnapshot}
          />}

          {module === "vpn" && <OperationalFunnel
            key="operational-vpn"
            enabled={!projectLoading && onlineProjects.length > 0}
            page={page === "network_failure_matrix" ? "network_failure_matrix" : "workbench"}
            projectCode={project}
            appIdentifier={appliedProjectMeta?.appIdentifier}
            range={range}
            platform={platform}
            country={country}
            appVersion={appVersion}
            refreshKey={filtersApplied}
            onPageChange={() => undefined}
            onProjectSelect={(nextProject) => { setProject(nextProject); setDraftProject(nextProject); setFiltersApplied((value) => value + 1); }}
            initialDomain="vpn"
            lockDomain
            softFailure
            onSnapshotChange={setReportSnapshot}
          />}

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
      {sharedReportResult && <div className="modal-backdrop share-result-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSharedReportResult(null)}>
        <section className="share-result-dialog" role="dialog" aria-modal="true" aria-labelledby="share-result-title">
          <header><div><span className="share-result-icon">✓</span><div><h2 id="share-result-title">项目报告已生成</h2><p>链接已保存在当前项目的报告记录中，可随时再次复制。</p></div></div><button type="button" aria-label="关闭" onClick={() => setSharedReportResult(null)}>×</button></header>
          <label htmlFor="shared-project-report-url">分享链接</label>
          <div className="share-result-copy-row"><input id="shared-project-report-url" value={sharedReportResult.shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className="primary-button" onClick={() => void copyShareLink(sharedReportResult.shareUrl)}>复制链接</button></div>
          <small>打开链接后需使用公司邮箱验证；报告内容为本次查询的数据快照。</small>
          <footer><button type="button" className="secondary-button" onClick={() => window.open(sharedReportResult.shareUrl, "_blank", "noopener,noreferrer")}>打开预览</button><button type="button" className="primary-button" onClick={() => setSharedReportResult(null)}>完成</button></footer>
        </section>
      </div>}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
    </div>
    <MetricDictionaryDrawer open={metricDictionaryOpen} selectedMetric={selectedMetric} onSelect={setSelectedMetric} onClose={() => setMetricDictionaryOpen(false)} />
    </MetricInspectContext.Provider>
  );
}
