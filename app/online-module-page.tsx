"use client";

import { useEffect, useMemo, useState } from "react";
import { queryFunnel } from "./funnel-analysis-api";
import type { OnlineProject } from "./project-options-api";
import type { DialogKey } from "./action-dialog";

type ModuleKey = "global" | "project" | "vpn" | "admob" | "firebase" | "reconcile";
type AnyRow = Record<string, any>;
type FormulaRow = {
  metric: string;
  formula: string;
  source: string;
  fields: string;
  purpose: string;
  abnormal: string;
};
type LensRow = {
  lens: string;
  dimensions: string;
  answer: string;
  owner: string;
};

type Props = {
  module: ModuleKey;
  project: string;
  projectMeta?: OnlineProject;
  range: string;
  platform: string;
  country: string;
  appVersion: string;
  refreshKey: number;
  onOpenModule: (module: "funnel" | "tracking" | "config" | "tasks" | "firebase") => void;
  onOpenDialog: (dialog: DialogKey) => void;
};

const number = (value: unknown) => value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${number(value)}%`;
const money = (value: unknown) => value === null || value === undefined ? "—" : `$${number(value)}`;
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const rowCount = (row: AnyRow) => Number(row?.count ?? row?.value ?? row?.users ?? row?.sessions ?? 0);
const rowName = (row: AnyRow) => text(row?.name ?? row?.stepName ?? row?.label);
const rowEvent = (row: AnyRow) => text(row?.eventName ?? row?.event);
const rowKey = (row: AnyRow) => `${row?.stepCode ?? row?.code ?? ""} ${rowName(row)} ${rowEvent(row)}`.toLowerCase();

function firstText(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return "";
}

function rowCondition(row: AnyRow) {
  const explicit = firstText(row, ["returnValue", "returnedValue", "resultValue", "eventValue", "filterValue", "filter", "condition", "where", "eventFilter", "paramFilter", "parameterCondition"]);
  if (explicit) return explicit;
  const event = rowEvent(row);
  const key = rowKey(row);
  if (event === "vpn_connection_start") return "每次真实底层 connect 调用；生成 connection_id";
  if (event === "vpn_connection_result") {
    if (key.includes("成功") || key.includes("success")) return "返回值：vpn_status = success";
    if (key.includes("失败") || key.includes("failed")) return "返回值：vpn_status IN (failed, prohibited)";
    if (key.includes("尝试") || key.includes("attempt") || key.includes("start")) return "口径异常：连接尝试标准事件应为 vpn_connection_start";
    return "返回字段：vpn_status，取值 success / failed / prohibited";
  }
  if (event === "vpn_permission_result") return "返回值：permission_status = granted / denied / not_required / error";
  if (event === "vpn_connection_phase") return "返回字段：phase_name + phase_status / duration_ms";
  if (event === "vpn_connectivity_check") return "返回值：connectivity_status = ok / failed；校验 ip_after_connect";
  if (event === "ad_opportunity") return "条件：vpn_session_id 非空；连接成功后生成机会";
  if (event === "ad_impression") return "条件：vpn_session_id 非空；连接成功后真实展示";
  return firstText(row, ["resultField", "returnField", "fieldName"]) || "无额外返回值条件";
}

function rowEventDetail(row: AnyRow) {
  return `${rowEvent(row)}｜${rowCondition(row)}`;
}

function statusLabel(value: unknown) {
  const raw = text(value);
  if (raw === "—") return raw;
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    unrated: "未评级",
    unavailable: "暂无数据",
    available: "可计算",
    calculable: "可计算",
    ok: "正常",
    good: "正常",
    success: "成功",
    successful: "成功",
    passed: "通过",
    pass: "通过",
    done: "已完成",
    completed: "已完成",
    warning: "预警",
    warn: "预警",
    critical: "严重异常",
    bad: "异常",
    error: "错误",
    failed: "失败",
    fail: "失败",
    running: "运行中",
    loading: "查询中",
    retrying: "自动重试中",
    pending: "待处理",
    unknown: "未知",
  };
  return labels[normalized] ?? raw;
}

function normalizeRate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function transitionMeta(fromValue: number, toValue: number) {
  const loss = Math.max(0, fromValue - toValue);
  const lossRate = fromValue > 0 ? loss / fromValue * 100 : null;
  const passRate = fromValue > 0 ? toValue / fromValue * 100 : null;
  return { loss, lossRate, passRate };
}

function dateRange(range: string) {
  const end = new Date();
  const start = new Date(end);
  if (range === "昨天") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (range === "近7天") start.setDate(start.getDate() - 6);
  if (range === "近30天") start.setDate(start.getDate() - 29);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { dateFrom: iso(start), dateTo: iso(end) };
}

function State({ kind, message, retry }: { kind: "loading" | "empty" | "error"; message: string; retry?: () => void }) {
  return <section className={`surface operational-state ${kind}`}><span>{kind === "loading" ? "同步" : kind === "empty" ? "空" : "!"}</span><div><h2>{kind === "loading" ? "正在读取线上数据" : kind === "empty" ? "当前筛选范围暂无数据" : "数据读取失败"}</h2><p>{message}</p>{retry && <button onClick={retry}>重新加载</button>}</div></section>;
}

function Card({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return <article className={`operational-metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong><small>{note || "当前筛选口径"}</small></article>;
}

function MetricCards({ data, module }: { data: AnyRow; module: ModuleKey }) {
  const summary = data.summary ?? {};
  const ad = data.adMobRevenue ?? {};
  const quality = data.quality ?? {};
  if (module === "vpn") {
    return <section className="operational-metric-grid">
      <Card label="VPN 用户" value={number(summary.connectAttemptUsers ?? summary.vpnUsers)} />
      <Card label="连接成功" value={number(summary.connectSuccessUsers ?? summary.connectSuccessCount)} />
      <Card label="连接尝试成功率" value={percent(metricValue(data, "vpn_connect_success"))} tone={metricTone(data, "vpn_connect_success")} />
      <Card label="会话最终成功率" value={percent(metricValue(data, "vpn_session_success"))} tone={metricTone(data, "vpn_session_success")} />
      <Card label="IP 变化率" value={percent(metricValue(data, "vpn_ip_change"))} />
      <Card label="连接后 AV 覆盖" value={percent(metricValue(data, "vpn_post_connect_av"))} tone={metricTone(data, "vpn_post_connect_av")} />
    </section>;
  }
  if (module === "firebase" || module === "reconcile") {
    return <section className="operational-metric-grid">
      <Card label="观测事件" value={number(quality.observedEvents)} />
      <Card label="Accepted 事件" value={number(quality.acceptedEvents)} />
      <Card label="Firebase 事件" value={number(quality.firebaseEvents)} />
      <Card label="质量预警率" value={percent(metricValue(data, "quality_warning_rate"))} tone={metricTone(data, "quality_warning_rate")} />
      <Card label="P0 参数完整率" value={percent(metricValue(data, "quality_p0_completeness"))} tone={metricTone(data, "quality_p0_completeness")} />
      <Card label="关联链完整率" value={percent(metricValue(data, "quality_association_integrity"))} tone={metricTone(data, "quality_association_integrity")} />
    </section>;
  }
  if (module === "admob") {
    return <section className="operational-metric-grid">
      <Card label="AdMob 收入" value={money(ad.revenue)} />
      <Card label="AdMob 请求" value={number(ad.adRequests)} />
      <Card label="匹配率" value={percent(ad.matchRate)} tone={ad.matchRate === null ? "warn" : "good"} />
      <Card label="展示率" value={percent(ad.showRate)} />
      <Card label="eCPM" value={money(ad.ecpm)} />
      <Card label="广告浏览者比例" value={percent(metricValue(data, "ad_viewer_rate"))} tone={metricTone(data, "ad_viewer_rate")} />
    </section>;
  }
  return <section className="operational-metric-grid">
    <Card label="DAU" value={number(summary.dauUsers)} />
    <Card label="广告机会用户" value={number(summary.opportunityUsers)} />
    <Card label="广告请求用户" value={number(summary.requestUsers)} />
    <Card label="AV" value={number(summary.impressionUsers)} />
    <Card label="广告浏览者比例" value={percent(summary.adViewerRate)} tone={summary.adViewerRateStatus} />
    <Card label="广告收入" value={money(ad.revenue ?? summary.revenue)} />
  </section>;
}

function metricValue(data: AnyRow, key: string) {
  return (data.metrics ?? []).find((item: AnyRow) => item.metricKey === key)?.value ?? null;
}

function metricTone(data: AnyRow, key: string) {
  const status = (data.metrics ?? []).find((item: AnyRow) => item.metricKey === key)?.status;
  return status === "critical" ? "bad" : status === "warning" ? "warn" : status === "good" ? "good" : "";
}

function firstArray(data: AnyRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function dataMetric(data: AnyRow, keys: string[]) {
  for (const key of keys) {
    const metric = (data.metrics ?? []).find((item: AnyRow) => item.metricKey === key || item.key === key || item.name === key);
    if (metric) return metric;
    const direct = data[key] ?? data.summary?.[key] ?? data.quality?.[key];
    if (direct !== null && direct !== undefined && direct !== "") return { value: direct, status: "available" };
  }
  return null;
}

function displayMetricValue(row: AnyRow | null, unit: "count" | "ratio" | "ms" = "ratio") {
  if (!row) return "待后端返回";
  if (row.displayValue) return text(row.displayValue);
  const value = row.value ?? row.count ?? row.users ?? row.sessions;
  if (value === null || value === undefined || value === "") return "待后端返回";
  if (unit === "count") return number(value);
  if (unit === "ms") return `${number(value)}ms`;
  return percent(normalizeRate(value));
}

function metricStatusTone(row: AnyRow | null) {
  if (!row) return "warn";
  const status = `${row.status ?? row.statusReason ?? ""}`.toLowerCase();
  if (status.includes("critical") || status.includes("bad") || status.includes("fail") || status.includes("异常")) return "bad";
  if (status.includes("warning") || status.includes("warn") || status.includes("预警")) return "warn";
  if (status.includes("good") || status.includes("ok") || status.includes("正常")) return "good";
  return "";
}

function FunnelTable({ rows = [], showCondition = false }: { rows?: AnyRow[]; showCondition?: boolean }) {
  const colSpan = showCondition ? 6 : 5;
  return <div className="table-wrap"><table className={showCondition ? "condition-funnel-table" : undefined}><thead><tr><th>步骤</th><th>事件</th>{showCondition && <th>返回值 / 过滤条件</th>}<th>对象数</th><th>转化率</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.stepCode ?? row.code ?? index} className={rowCondition(row).includes("口径异常") ? "row-warn" : ""}><td><strong>{index + 1}. {text(row.name ?? row.stepName ?? row.label)}</strong></td><td><code>{text(row.eventName ?? row.event)}</code></td>{showCondition && <td><code>{rowCondition(row)}</code></td>}<td>{row.available === false ? "暂无数据" : number(row.count ?? row.value)}</td><td>{row.available === false ? "—" : percent(row.conversionRate)}</td><td>{row.available === false ? statusLabel(row.unavailableReason) : statusLabel(row.status ?? "可计算")}</td></tr>) : <tr><td colSpan={colSpan}><div className="empty-table-state"><strong>暂无漏斗步骤</strong><span>当前筛选范围没有可计算的标准事件。</span></div></td></tr>}</tbody></table></div>;
}

function ProjectTable({ rows = [] }: { rows?: AnyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>项目</th><th>DAU</th><th>AV</th><th>浏览者比例</th><th>机会覆盖</th><th>收入</th><th>数据状态</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.projectCode}><td><strong>{text(row.projectCode)}</strong><small>{text(row.appName || row.appIdentifier)}</small></td><td>{number(row.dauUsers)}</td><td>{number(row.impressionUsers)}</td><td>{percent(row.adViewerRate)}</td><td>{percent(row.opportunityCoverage)}</td><td>{money(row.revenue)}</td><td>{statusLabel(row.statusReason || row.status)}</td></tr>) : <tr><td colSpan={7}><div className="empty-table-state"><strong>暂无项目汇总</strong><span>请检查 Firebase 配置、DWS ETL 或日期范围。</span></div></td></tr>}</tbody></table></div>;
}

function MetricsTable({ rows = [] }: { rows?: AnyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>指标</th><th>值</th><th>公式</th><th>来源</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.metricKey ?? row.name}><td><strong>{text(row.name)}</strong><small>{text(row.metricKey)}</small></td><td>{row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))}</td><td>{text(row.formula)}</td><td>{text(row.source)}</td><td>{statusLabel(row.statusReason ?? row.status)}</td></tr>) : <tr><td colSpan={5}><div className="empty-table-state"><strong>暂无指标</strong><span>接口正常，但当前维度没有可计算指标。</span></div></td></tr>}</tbody></table></div>;
}

function vpnNodeAdvice(from: AnyRow, to: AnyRow) {
  const raw = `${rowName(from)} ${rowEvent(from)} ${rowCondition(from)} ${rowName(to)} ${rowEvent(to)} ${rowCondition(to)}`.toLowerCase();
  if (rowCondition(from).includes("口径异常") || rowCondition(to).includes("口径异常")) return "先修 ETL 口径：连接尝试必须用 vpn_connection_start；连接成功用 vpn_connection_result 且 vpn_status=success";
  if (raw.includes("permission")) return "查 VPN 权限弹窗、系统授权回调、用户拒绝原因";
  if (raw.includes("config")) return "查配置拉取接口、缓存兜底、国家/版本配置是否下发";
  if (raw.includes("node") || raw.includes("server")) return "查节点列表页、节点探测、server_id、node_region、选择策略";
  if (raw.includes("phase") || raw.includes("dns") || raw.includes("socket") || raw.includes("handshake")) return "查 connection_id 的首个失败阶段、error_code、protocol、transport、ASN";
  if (raw.includes("connectivity") || raw.includes("ip_after") || raw.includes("ip")) return "查连接后 IP、出口可用性、DNS 解析和质量采样";
  if (raw.includes("ad") || raw.includes("impression")) return "查连接成功页是否生成广告机会，以及广告请求是否携带 vpn_session_id";
  return "先按 vpn_session_id 串会话，再按 connection_id 看一次真实连接尝试";
}

function VpnNodeDropoffBoard({ data, onOpenModule }: { data: AnyRow; onOpenModule: Props["onOpenModule"] }) {
  const funnelRows: AnyRow[] = data.funnel ?? [];
  const transitions = funnelRows.slice(1).map((to, index) => {
    const from = funnelRows[index];
    const fromValue = rowCount(from);
    const toValue = rowCount(to);
    const meta = transitionMeta(fromValue, toValue);
    return { from, to, fromValue, toValue, ...meta, advice: vpnNodeAdvice(from, to) };
  }).sort((left, right) => {
    const leftBad = rowCondition(left.from).includes("口径异常") || rowCondition(left.to).includes("口径异常") ? 1 : 0;
    const rightBad = rowCondition(right.from).includes("口径异常") || rowCondition(right.to).includes("口径异常") ? 1 : 0;
    return rightBad - leftBad || right.loss - left.loss;
  });
  const worst = transitions.find((row) => row.loss > 0);
  return <section className="surface vpn-dropoff-board">
    <div className="surface-title"><div><h2>VPN 节点流失怎么看</h2><p>先看哪两个相邻节点之间掉得最多；同一个事件必须看返回值/过滤条件，避免把 result 事件误当成 start 事件。</p></div><span>{worst ? `最大流失：${rowName(worst.from)} → ${rowName(worst.to)}` : "暂无明显流失"}</span></div>
    {transitions.length ? <div className="table-wrap"><table><thead><tr><th>流失节点</th><th>起点</th><th>到达</th><th>流失</th><th>流失率</th><th>通过率</th><th>事件口径 / 应该查什么</th></tr></thead><tbody>{transitions.map((row) => {
      const hasBadContract = rowCondition(row.from).includes("口径异常") || rowCondition(row.to).includes("口径异常");
      return <tr key={`${rowName(row.from)}-${rowName(row.to)}`} className={hasBadContract ? "row-warn" : row.lossRate !== null && row.lossRate > 30 ? "row-bad" : row.lossRate !== null && row.lossRate > 10 ? "row-warn" : ""}><td><strong>{rowName(row.from)} → {rowName(row.to)}</strong><small>{rowEventDetail(row.from)} → {rowEventDetail(row.to)}</small></td><td>{number(row.fromValue)}</td><td>{number(row.toValue)}</td><td>{number(row.loss)}</td><td>{row.lossRate === null ? "—" : percent(row.lossRate)}</td><td>{row.passRate === null ? "—" : percent(row.passRate)}</td><td>{row.advice}</td></tr>;
    })}</tbody></table></div> : <div className="inline-empty">当前接口没有返回 VPN 漏斗步骤，无法判断节点流失。</div>}
    <div className="vpn-dropoff-guide"><div><strong>如果是功能节点流失</strong><span>看上表：权限、配置、节点选择、连接结果、出口可用性哪个掉得最多。</span></div><div><strong>如果是技术阶段失败</strong><span>看下方连接阶段：DNS、Socket、TLS、协议握手、ready 哪个阶段成功率低 / P95 高。</span></div><button onClick={() => onOpenModule("funnel")}>去单项目工作台看完整流失诊断</button></div>
  </section>;
}

function stageLoss(row: AnyRow) {
  const total = Number(row.totalCount ?? row.count ?? 0);
  const successRate = normalizeRate(row.successRate ?? row.rate);
  if (!total || successRate === null) return null;
  return Math.max(0, total * (100 - successRate) / 100);
}

function VpnStageDropoffBoard({ stages = [] }: { stages?: AnyRow[] }) {
  const rows = stages.map((row) => ({ ...row, estimatedLoss: stageLoss(row), successRateValue: normalizeRate(row.successRate ?? row.rate) })).sort((left, right) => Number(right.estimatedLoss ?? -1) - Number(left.estimatedLoss ?? -1));
  if (!rows.length) return null;
  return <section className="surface vpn-stage-dropoff-board">
    <div className="surface-title"><div><h2>连接阶段流失 / 慢在哪</h2><p>这是技术阶段，不等于页面。用 connection_id 找一次真实连接尝试卡在 DNS、Socket、TLS、协议握手还是出口可用。</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>估算失败</th><th>P95</th><th>优先排查</th></tr></thead><tbody>{rows.map((row: AnyRow) => <tr key={row.stageKey ?? row.stageName} className={row.successRateValue !== null && row.successRateValue < 90 ? "row-bad" : row.successRateValue !== null && row.successRateValue < 96 ? "row-warn" : ""}><td><strong>{text(row.stageName)}</strong><small>{text(row.stageKey)}</small></td><td>{number(row.totalCount)}</td><td>{row.successRateValue === null ? "—" : percent(row.successRateValue)}</td><td>{row.estimatedLoss === null ? "—" : number(row.estimatedLoss)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{statusLabel(row.statusReason ?? row.status ?? "按国家/ASN/协议/节点下钻")}</td></tr>)}</tbody></table></div>
  </section>;
}

function pageMetric(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return Number(value);
  }
  return null;
}

function pageText(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return "";
}

function pageTransition(from: number | null, to: number | null) {
  if (from === null || to === null) return { loss: null, lossRate: null, passRate: null };
  const loss = Math.max(0, from - to);
  return {
    loss,
    lossRate: from > 0 ? loss / from * 100 : null,
    passRate: from > 0 ? to / from * 100 : null,
  };
}

function pageIdentityText(row: AnyRow) {
  return [
    row.screenName, row.screen_name, row.label, row.pageName, row.page_name,
    row.currentScreen, row.current_screen, row.placement, row.adPlacement,
    row.entrySource, row.entry_source, row.pathType, row.path_type,
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
}

function isNodePageAdScene(row: AnyRow) {
  const raw = pageIdentityText(row);
  return /node_page|node.*page|node.*select|nodedetail|videonode|节点页|节点选择|节点选择页/.test(raw)
    || /placement.*node|node_page|node_select/.test(raw);
}

function pageAdDiagnosis(row: AnyRow) {
  const pageUsers = Number(row.pageUsers ?? 0);
  const checkUsers = Number(row.eligibilityCheckUsers ?? 0);
  const eligibleUsers = Number(row.eligibleUsers ?? 0);
  const opportunityUsers = Number(row.opportunityUsers ?? 0);
  const requestUsers = Number(row.requestUsers ?? 0);
  const showAttemptUsers = Number(row.showAttemptUsers ?? 0);
  const impressionUsers = Number(row.impressionUsers ?? 0);
  if (pageUsers > 0 && isNodePageAdScene(row) && checkUsers <= 0 && opportunityUsers <= 0 && impressionUsers <= 0) return "节点页已确认有插页广告和底部原生广告：当前是 screen_name/placement/入口打点未归因，不要判断为没有广告";
  if (pageUsers > 0 && checkUsers <= 0) return "页面有访问但没有资格检查：查入口曝光/点击、资格检查调用时机、广告策略开关";
  if (checkUsers > 0 && eligibleUsers <= 0) return "资格检查有触发但没有通过：查 eligible=0 和 blocked_reason";
  if (eligibleUsers > 0 && opportunityUsers <= 0) return "资格通过但没有广告机会：查 opportunity_id 生成时机和页面场景";
  if (opportunityUsers > 0 && requestUsers <= 0) return "有机会但没有请求：查预加载缓存、Cache Miss 后实时请求、request_id";
  if (requestUsers > 0 && showAttemptUsers <= 0) return "有请求但没有展示尝试：查 load_success、ad_ready、缓存对象上下文";
  if (showAttemptUsers > 0 && impressionUsers <= 0) return "有展示尝试但无展示：查 show_failed、SDK回调、页面后台/关闭";
  if (impressionUsers > 0) return "该页面广告链路已到展示，可继续看人均展示、收入和频控";
  return "当前页面样本不足，先确认 screen_name 和 page_users 是否正常聚合";
}

function VpnPageDropoffBoard({ data }: { data: AnyRow }) {
  const pageSource = data.pageData ?? data.pathData ?? {};
  const pages: AnyRow[] = data.adPageFunnel?.pages ?? data.pageFunnel?.pages ?? pageSource.pages ?? data.pages ?? data.screenPaths ?? [];
  const rows = pages.map((page) => {
    const screenName = pageText(page, ["screenName", "screen_name", "label", "pageName"]) || "未知页面";
    const pageUsers = pageMetric(page, ["pageUsers", "page_users", "users", "screenUsers", "screen_users", "viewUsers", "view_users"]) ?? 0;
    const eligibilityCheckUsers = pageMetric(page, ["eligibilityCheckUsers", "eligibility_check_users", "adEligibilityCheckUsers", "ad_eligibility_check_users", "checkUsers", "check_users"]);
    const eligibleUsers = pageMetric(page, ["eligibleUsers", "eligible_users", "adEligibleUsers", "ad_eligible_users", "eligibilityPassUsers", "eligibility_pass_users"]);
    const opportunityUsers = pageMetric(page, ["opportunityUsers", "opportunity_users", "adOpportunityUsers", "ad_opportunity_users"]);
    const requestUsers = pageMetric(page, ["requestUsers", "request_users", "adRequestUsers", "ad_request_users"]);
    const preloadRequestUsers = pageMetric(page, ["preloadRequestUsers", "preload_request_users", "preloadUsers", "preload_users"]);
    const showAttemptUsers = pageMetric(page, ["showAttemptUsers", "show_attempt_users", "adShowAttemptUsers", "ad_show_attempt_users"]);
    const impressionUsers = pageMetric(page, ["impressionUsers", "impression_users", "avUsers", "av_users", "adViewerUsers", "ad_viewer_users"]);
    const vpnStarts = pageMetric(page, ["vpnConnectStartUsers", "vpn_connect_start_users", "connectStartUsers", "connect_start_users", "vpnStartUsers", "vpn_start_users", "connectionStartUsers", "connection_start_users"]);
    const vpnSuccess = pageMetric(page, ["vpnConnectSuccessUsers", "vpn_connect_success_users", "connectSuccessUsers", "connect_success_users", "vpnSuccessUsers", "vpn_success_users", "connectionSuccessUsers", "connection_success_users"]);
    const exitRate = normalizeRate(page.exitRate ?? page.exit_rate);
    const transitions = [
      { label: "页面访问 → 资格检查", ...pageTransition(pageUsers, eligibilityCheckUsers) },
      { label: "资格检查 → 资格通过", ...pageTransition(eligibilityCheckUsers, eligibleUsers) },
      { label: "资格通过 → 广告机会", ...pageTransition(eligibleUsers, opportunityUsers) },
      { label: "广告机会 → 广告请求", ...pageTransition(opportunityUsers, requestUsers) },
      { label: "广告请求 → 展示尝试", ...pageTransition(requestUsers, showAttemptUsers) },
      { label: "展示尝试 → 广告展示", ...pageTransition(showAttemptUsers, impressionUsers) },
    ].filter((item) => item.loss !== null).sort((a, b) => Number(b.loss ?? 0) - Number(a.loss ?? 0));
    const worst = transitions[0];
    const vpnLoss = vpnStarts !== null && vpnSuccess !== null ? Math.max(0, vpnStarts - vpnSuccess) : null;
    const riskScore = Number(worst?.loss ?? 0) + Number(vpnLoss ?? 0) + (exitRate ?? 0) + pageUsers / 10;
    return { ...page, screenName, pageUsers, eligibilityCheckUsers, eligibleUsers, opportunityUsers, requestUsers, preloadRequestUsers, showAttemptUsers, impressionUsers, vpnStarts, vpnSuccess, vpnLoss, exitRate, worst, riskScore };
  }).sort((left, right) => Number(right.riskScore ?? 0) - Number(left.riskScore ?? 0)).slice(0, 10);
  return <section className="surface vpn-page-dropoff-board">
    <div className="surface-title"><div><h2>页面 × 广告漏斗分析</h2><p>数据源优先使用 <code>dws_ad_page_funnel_daily</code>：每个项目、包、日期、页面一行，看页面访问后广告资格、机会、请求、展示分别漏在哪里。</p></div><span>{rows.length ? `${rows.length} 个页面` : "等待页面漏斗汇总"}</span></div>
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>页面</th><th>页面UV</th><th>资格检查</th><th>资格通过</th><th>广告机会</th><th>请求用户</th><th>展示尝试</th><th>AV</th><th>最大流失</th><th>判断</th></tr></thead><tbody>{rows.map((row) => <tr key={row.screenName} className={row.worst?.lossRate !== null && row.worst?.lossRate > 50 ? "row-bad" : row.worst?.lossRate !== null && row.worst?.lossRate > 25 ? "row-warn" : ""}><td><strong>{text(row.screenName)}</strong><small>{text(row.entrySource ?? row.entry_source ?? row.pathType ?? row.path_type)}</small></td><td>{number(row.pageUsers)}</td><td>{number(row.eligibilityCheckUsers)}</td><td>{number(row.eligibleUsers)}</td><td>{number(row.opportunityUsers)}</td><td><strong>{number(row.requestUsers)}</strong><small>预加载 {number(row.preloadRequestUsers)}</small></td><td>{number(row.showAttemptUsers)}</td><td>{number(row.impressionUsers)}</td><td>{row.worst ? <><strong>{text(row.worst.label)}</strong><small>{number(row.worst.loss)} · {percent(row.worst.lossRate)}</small></> : "—"}</td><td>{pageAdDiagnosis(row)}</td></tr>)}</tbody></table></div> : <div className="inline-empty"><strong>页面漏斗汇总接口还没返回数据。</strong><br />后端请从 <code>dws_ad_page_funnel_daily</code> 返回 pages 数组，字段至少包括：screen_name、page_users、eligibility_check_users、eligible_users、opportunity_users、request_users、preload_request_users、show_attempt_users、impression_users。返回后这里会自动显示页面级广告漏斗。</div>}
  </section>;
}

const sourceContracts: Record<ModuleKey, Array<{ label: string; value: string; note: string }>> = {
  global: [
    { label: "主要数据源", value: "DWS 项目日汇总", note: "只展示当前账号有权限的线上项目" },
    { label: "核心问题", value: "发现异常项目", note: "按 DAU、AV、机会覆盖、收入和数据状态排序" },
    { label: "关键口径", value: "AV = impression UV", note: "不是展示总次数；展示总次数另算人均展示" },
    { label: "下一步", value: "进入单项目工作台", note: "选中项目后下钻到漏斗、路径和证据" },
  ],
  project: [
    { label: "主要数据源", value: "Firebase + AdMob + ADB", note: "单项目整合用户、广告、VPN和质量指标" },
    { label: "核心问题", value: "定位指标变差原因", note: "先判断覆盖、履约、SDK效率还是数据质量" },
    { label: "关键字段", value: "user / session / opportunity / request", note: "用关联 ID 串起一次完整变现链路" },
    { label: "下一步", value: "创建诊断任务", note: "把当前筛选、指标和证据冻结进任务" },
  ],
  vpn: [
    { label: "主要数据源", value: "V1.8 VPN 标准事件", note: "vpn_session_id 串联会话，connection_id 区分每次真实尝试" },
    { label: "核心问题", value: "弱网连接质量", note: "俄罗斯/伊朗重点看 ASN、协议、端口、节点、IP 前后状态" },
    { label: "关键字段", value: "connect_stage / result / ip_after_status", note: "失败阶段、出口可用性和连接后广告请求必须能关联" },
    { label: "下一步", value: "连接阶段 → 广告联动", note: "确认连接成功后是否还有机会、请求和展示流失" },
  ],
  admob: [
    { label: "主要数据源", value: "AdMob 收入库 + Firebase AV", note: "AdMob 用结算口径；当天 AV 用 Firebase 事件口径" },
    { label: "核心问题", value: "浏览者比例 / 收入 / eCPM", note: "先分清是用户覆盖低，还是请求后效率低" },
    { label: "关键字段", value: "ad_unit_id / placement / ad_format", note: "按广告位、格式、国家、广告源定位异常" },
    { label: "下一步", value: "Opportunity → Request → Show → AV", note: "匹配率正常但 AV 低时优先看请求前覆盖和展示机会" },
  ],
  firebase: [
    { label: "主要数据源", value: "Firebase BigQuery Export", note: "events_intraday 看当天，events_* 看稳定日表" },
    { label: "核心问题", value: "事件质量与同步水位", note: "P0 参数、event_id、关联链、未知事件、隔离数据" },
    { label: "关键字段", value: "event_id / schema_version / event_time", note: "缺失或非法不静默丢弃，进入质量诊断" },
    { label: "下一步", value: "任务与告警", note: "同步失败、权限错误和无数据都从任务日志确认" },
  ],
  reconcile: [
    { label: "主要数据源", value: "Firebase / AdMob / ADB / 中台", note: "按数据源时效分开判断，不把 T+0 与 T+3 混算" },
    { label: "核心问题", value: "同一指标多源差异", note: "DAU、AV、Impression、Revenue 使用不同容差" },
    { label: "关键字段", value: "business_date / timezone / source", note: "时区、结算日、去重键是对账最常见根因" },
    { label: "下一步", value: "重跑对账任务", note: "异常指标可生成新批次，保留历史审计" },
  ],
};

const playbooks: Record<ModuleKey, Array<{ symptom: string; inspect: string; fields: string; action: string }>> = {
  global: [
    { symptom: "某项目浏览者比例突然下降", inspect: "进入单项目工作台查看最大流失段", fields: "dau_users、impression_users、opportunity_users", action: "下钻项目 + 国家 + 版本" },
    { symptom: "收入下降但 DAU 正常", inspect: "对比 AV、人均展示次数和 eCPM", fields: "revenue、ecpm、impressions_per_viewer", action: "切到 AdMob 分析" },
    { symptom: "项目显示无数据", inspect: "检查 Firebase 绑定和 DWS 水位", fields: "app_identifier、firebase_latest_loaded_at", action: "去任务与告警" },
  ],
  project: [
    { symptom: "广告浏览者比例低", inspect: "拆 Eligible → Opportunity → Request → Show Attempt → AV", fields: "opportunity_id、request_id、ad_instance_id", action: "分析最大流失段" },
    { symptom: "请求多但展示少", inspect: "区分缓存命中、实时请求、加载成功、展示尝试", fields: "request_type、cache_result、show_result", action: "查看事件证据" },
    { symptom: "新版本变差", inspect: "按 app_version / build_number 对比", fields: "app_version、build_number、schema_version", action: "创建版本验证任务" },
  ],
  vpn: [
    { symptom: "连接成功率低", inspect: "按首个失败阶段看 DNS/TCP/TLS/握手/鉴权", fields: "connect_stage、stage_result、error_code", action: "定位协议或节点问题" },
    { symptom: "连接成功但无法用", inspect: "看出口 IP、可用性检查、丢包、延迟", fields: "ip_before_status、ip_after_status、quality_status", action: "按 ASN/节点下钻" },
    { symptom: "连接后广告差", inspect: "只看同一 vpn_session_id 下连接成功后的广告链路", fields: "vpn_session_id、connection_id、placement", action: "切到广告联动漏斗" },
  ],
  admob: [
    { symptom: "AdMob 匹配率正常但 AV 低", inspect: "看广告机会覆盖、请求用户覆盖和展示尝试", fields: "eligible、opportunity_id、request_id、show_attempt", action: "进入漏斗工作台" },
    { symptom: "某广告位收入低", inspect: "按广告位拆请求、展示、AV、人均展示、eCPM", fields: "ad_unit_id、placement、ad_format、country", action: "导出 AdMob 报表" },
    { symptom: "人均展示过高", inspect: "看展示是否集中在少数用户或少数页面", fields: "impression_count、impression_users、screen_name", action: "检查频控和页面入口" },
  ],
  firebase: [
    { symptom: "Firebase 与中台 DAU 不一致", inspect: "看中台上报成功率、去重键、时区边界", fields: "my_user_id、event_date、timezone、source", action: "进入数据对账" },
    { symptom: "P0 完整率不达标", inspect: "按事件查看缺失参数和 Provider 状态", fields: "event_id、schema_version、p0_missing_fields", action: "去打点验收" },
    { symptom: "当天没有数据", inspect: "看 events_intraday、同步任务和服务账号权限", fields: "firebase_project_id、dataset_id、latest_loaded_at", action: "查看任务日志" },
  ],
  reconcile: [
    { symptom: "DAU 差异大", inspect: "先排时区、去重键、接口失败、重复上报", fields: "business_date、user_key、event_source", action: "重跑对账" },
    { symptom: "Revenue 差异大", inspect: "确认 AdMob 结算日、币种、paid event 延迟", fields: "currency_code、value_micros、admob_date", action: "按结算日复算" },
    { symptom: "AV 差异大", inspect: "确认 AV 是 impression 独立用户，不是展示次数", fields: "event_name=jk_ad_impression、user_pseudo_id", action: "查事件明细" },
  ],
};

const formulaRows: Record<ModuleKey, FormulaRow[]> = {
  global: [
    { metric: "项目健康分", formula: "加权汇总：用户覆盖、广告收益、数据质量、任务状态", source: "ADB DWS 项目日汇总", fields: "project_code、business_date、metric_key、status", purpose: "一眼找出需要优先处理的项目", abnormal: "下钻单项目工作台，看是哪一类指标拖累" },
    { metric: "广告展示独立用户比例", formula: "COUNT_DISTINCT(jk_ad_impression用户) / DAU", source: "Firebase 标准事件", fields: "event_name、user_pseudo_id、business_date", purpose: "判断活跃用户里有多少人真正看到了广告", abnormal: "若低，优先进入漏斗工作台拆资格、机会、请求、展示" },
    { metric: "人均展示次数", formula: "Impression 总次数 / AV", source: "Firebase + AdMob 对账", fields: "jk_ad_impression、ad_unit_id、placement", purpose: "判断展示是否集中在少数用户", abnormal: "过高查频控、过低查机会覆盖和展示尝试" },
    { metric: "项目数据可用性", formula: "DWS 有效汇总 + 质量隔离率 + 同步水位", source: "任务日志 + ADB 汇总", fields: "latest_loaded_at、quarantine_count、sync_status", purpose: "避免把数据缺失误判成业务下跌", abnormal: "进入任务与告警，先看同步和接口错误" },
  ],
  project: [
    { metric: "单项目最大流失段", formula: "相邻漏斗节点 UV 转化率最低且影响人数最高", source: "Firebase 标准事件 DWS", fields: "step_code、from_users、to_users、dropoff_users", purpose: "直接定位今天最该修的环节", abnormal: "点进流失诊断，按页面/国家/版本/广告位拆" },
    { metric: "机会覆盖率", formula: "Opportunity UV / DAU", source: "jk_ad_opportunity + app_active", fields: "opportunity_id、placement、screen_name", purpose: "判断真实广告场景是否被覆盖", abnormal: "查场景是否未到达、资格通过后是否未生成机会" },
    { metric: "机会履约率", formula: "有 Show Attempt 的 opportunity_id / opportunity_id", source: "广告事件链", fields: "opportunity_id、ad_instance_id、cache_result", purpose: "判断机会是否最终走到展示尝试", abnormal: "拆缓存命中、缓存未命中、实时请求、后台离开" },
    { metric: "修复效果", formula: "新版本指标 - 修复前基线，并按同国家/同渠道比较", source: "版本对比聚合", fields: "app_version、build_number、release_id", purpose: "判断技术修复是否真的让指标恢复", abnormal: "记录版本并生成二次诊断任务" },
  ],
  vpn: [
    { metric: "连接按钮点击率", formula: "connect_button_click_users / vpn_home_users", source: "screen_view + element_click", fields: "screen_name、element_name、action_name、session_id", purpose: "判断用户是否真的进入连接动作", abnormal: "低时优先改首页主按钮、文案、位置、动效和引导" },
    { metric: "VPN 权限通过率", formula: "permission_status=granted / vpn_permission_result", source: "vpn_permission_result", fields: "vpn_session_id、permission_status、permission_source", purpose: "区分用户拒绝权限和真实连接失败", abnormal: "低时查权限前解释、拒绝后二次引导、系统设置入口" },
    { metric: "VPN 配置可用率", formula: "result_status=success / vpn_config_fetch_result", source: "vpn_config_fetch_result", fields: "request_trace_id、config_source、config_version、error_code", purpose: "判断节点/协议配置是否拿到", abnormal: "低时查配置接口、缓存兜底、国家/版本配置下发" },
    { metric: "节点探测可达率", formula: "probe_result=success / vpn_server_probe_result", source: "vpn_server_probe_result", fields: "probe_id、server_id、protocol、transport、port、latency_ms、packet_loss_pct", purpose: "判断候选节点在俄罗斯/伊朗是否可达", abnormal: "按 ASN、协议、端口、节点地区拆失败率" },
    { metric: "节点选择有效率", formula: "连接成功 connection_id / vpn_node_selected", source: "vpn_node_selected + vpn_connection_result", fields: "server_id、node_region、selection_mode、selection_score_bucket", purpose: "判断自动/推荐节点是否真的有效", abnormal: "节点选了但连接失败，查评分策略和候选池" },
    { metric: "连接尝试成功率", formula: "vpn_status=success / vpn_connection_start", source: "vpn_connection_start + vpn_connection_result", fields: "connection_id、vpn_session_id、vpn_status、duration_ms、error_code", purpose: "判断一次真实连接尝试是否成功", abnormal: "按失败阶段 DNS/TCP/TLS/协议握手拆原因" },
    { metric: "会话最终成功率", formula: "最终成功 vpn_session_id / 发起会话 vpn_session_id", source: "VPN 会话聚合", fields: "vpn_session_id、retry_index、fallback_index、final_result", purpose: "避免多次重试把一次用户会话算乱", abnormal: "查协议回退、重连、节点切换是否恢复" },
    { metric: "阶段成功率与 P95", formula: "phase_result=success / phase_total；P95(duration_ms)", source: "vpn_connection_phase", fields: "phase_name、phase_result、duration_ms、restriction_signal", purpose: "定位 DNS/Socket/TLS/握手/建隧道/路由哪一步卡", abnormal: "低成功率或高 P95 就按国家/ASN/协议/节点下钻" },
    { metric: "协议回退恢复率", formula: "fallback 后成功 connection_id / vpn_protocol_fallback", source: "vpn_protocol_fallback + vpn_connection_result", fields: "fallback_reason、from_protocol、to_protocol、from_transport、to_transport", purpose: "判断回退策略是否救回弱网用户", abnormal: "低时查回退顺序、协议池、端口可达性" },
    { metric: "连接前/后 IP 采集率", formula: "probe_result=success / vpn_ip_probe_result by probe_stage", source: "vpn_ip_probe_result", fields: "probe_stage、probe_result、duration_ms、ip_family、error_code", purpose: "判断 before/after IP 是否可用", abnormal: "低时查 IP 回显服务、DNS、隧道路由和超时" },
    { metric: "连接前后 IP 变化率", formula: "ip_changed=1 / before+after 均成功会话", source: "vpn_ip_probe_result + 中台明文IP", fields: "ip_before_connect、ip_after_connect、ip_changed、asn、isp", purpose: "确认 VPN 是否真正切到出口", abnormal: "长期不变查分流绕行、出口探测没走 VPN、节点故障" },
    { metric: "连接后可用率", formula: "result_status=success / vpn_connectivity_check", source: "vpn_connectivity_check", fields: "check_type、target_id、dns_result、routed_through_vpn、http_status_class", purpose: "区分隧道建立和真正能访问互联网", abnormal: "低时查 DNS、路由、HTTP、出口可达" },
    { metric: "质量健康率", formula: "quality_status=good / vpn_quality_sample", source: "vpn_quality_sample", fields: "latency_ms、jitter_ms、packet_loss_pct、download_kbps、upload_kbps", purpose: "发现连接成功但体验差", abnormal: "按节点、ASN、网络类型、协议看丢包和高延迟" },
    { metric: "异常断开率", formula: "abnormal disconnect / vpn_disconnection", source: "vpn_disconnection", fields: "disconnect_reason、connected_duration_ms、traffic_bytes、network_change_count", purpose: "判断连接稳定性", abnormal: "查切网、锁屏、系统杀进程、节点掉线和自动重连" },
    { metric: "会话摘要完整率", formula: "vpn_session_summary / 成功建立过隧道的 vpn_session_id", source: "vpn_session_summary", fields: "fallback_count、reconnect_count、quality_sample_count、avg_latency_ms、p95_latency_ms", purpose: "保证会话结束后可直接复盘", abnormal: "低时查 App 后台/杀进程导致终态丢失" },
    { metric: "连接后广告覆盖", formula: "连接成功后广告 AV / 连接成功用户", source: "VPN × 广告关联链", fields: "vpn_session_id、connection_id、ad_opportunity、ad_impression", purpose: "看 VPN 体验是否影响广告变现", abnormal: "查连接成功页、after IP 状态、广告请求是否携带 vpn_session_id" },
  ],
  admob: [
    { metric: "广告浏览者比例", formula: "AV / DAU", source: "Firebase T+0；AdMob T+3 对账", fields: "jk_ad_impression、user_pseudo_id、business_date", purpose: "核心变现覆盖指标，回答多少活跃用户看到了广告", abnormal: "匹配率正常但该指标低，优先查请求前机会覆盖" },
    { metric: "请求用户覆盖率", formula: "Request UV / DAU", source: "jk_ad_request", fields: "request_id、request_type、is_preload", purpose: "判断有多少用户触发过广告请求", abnormal: "低则查预加载策略、实时请求分支、请求事件漏发" },
    { metric: "匹配率 / 展示率", formula: "AdMob Matched Requests / Requests；Impressions / Matched Requests", source: "AdMob Report API", fields: "ad_unit_id、date、country、ad_format", purpose: "判断 SDK/AdMob 请求后链路是否健康", abnormal: "若正常而 AV 低，不应先改 AdMob 填充" },
    { metric: "人均展示次数", formula: "Impression Count / AV", source: "Firebase 或 AdMob 展示次数", fields: "ad_unit_id、placement、user_pseudo_id", purpose: "判断展示频次是否集中或过低", abnormal: "过高查频控，过低查 Show Attempt 和页面退出" },
    { metric: "eCPM / ARPDAU", formula: "Revenue / Impression * 1000；Revenue / DAU", source: "AdMob 结算 + Firebase DAU", fields: "value_micros、currency_code、revenue、dau_users", purpose: "判断收入变化来自价格还是覆盖", abnormal: "eCPM 正常但 ARPDAU 低，先修 AV 覆盖" },
  ],
  firebase: [
    { metric: "同步水位", formula: "MAX(event_timestamp) 与当前时间差", source: "Firebase BigQuery Export", fields: "events_intraday_*、events_*、loaded_at", purpose: "判断当天数据是否已经拉到系统", abnormal: "查服务账号、Dataset 权限、同步任务是否失败" },
    { metric: "P0 参数完整率", formula: "P0 参数完整事件数 / 应检查事件数", source: "Firebase 标准化层", fields: "event_id、schema_version、p0_missing_fields", purpose: "判断上报是否达到发布门禁", abnormal: "进入打点验收，按事件和字段 Provider 修" },
    { metric: "事件链关联率", formula: "完整关联链事件 / 应有关联链事件", source: "ADB 事件链表", fields: "session_id、opportunity_id、request_id、ad_instance_id", purpose: "判断能否从请求追到展示和收益", abnormal: "查缓存对象 Context、重试新建ID、回调丢失" },
    { metric: "未知 / 隔离事件率", formula: "allowlist 外或非法事件 / Firebase 收到事件", source: "质量隔离表", fields: "event_name、error_code、quarantine_reason", purpose: "防止非法数据静默进入业务报表", abnormal: "修事件名、类型、event_id、schema_version" },
  ],
  reconcile: [
    { metric: "DAU 差异率", formula: "ABS(Firebase DAU - ADB DAU) / Firebase DAU", source: "Firebase + ADB", fields: "user_pseudo_id、business_date、timezone", purpose: "判断中台/ADB 是否少收或重复去重", abnormal: "先查接口失败、时区、用户ID口径" },
    { metric: "AV 差异率", formula: "ABS(Firebase AV - AdMob AV) / Firebase AV", source: "Firebase T+0 + AdMob T+3", fields: "jk_ad_impression、ad_unit_id、admob_date", purpose: "确认广告浏览用户口径是否一致", abnormal: "确认结算日期，不能拿今天和 T+3 混比" },
    { metric: "展示次数差异率", formula: "ABS(Firebase Impression - AdMob Impression) / AdMob Impression", source: "Firebase + AdMob", fields: "event_id、ad_unit_id、impression_count", purpose: "判断展示回调和 AdMob 后台是否对齐", abnormal: "查重复上报、回调延迟、广告位映射错误" },
    { metric: "收入差异率", formula: "ABS(Paid Event Revenue - AdMob Revenue) / AdMob Revenue", source: "Paid Event + AdMob 结算", fields: "value_micros、currency_code、exchange_rate", purpose: "判断收益回调是否可用于实时估算", abnormal: "查币种、微单位、汇率、结算日" },
  ],
};

const lensRows: Record<ModuleKey, LensRow[]> = {
  global: [
    { lens: "项目", dimensions: "project_code、project_type、owner", answer: "哪个项目最异常、影响最大", owner: "产品负责人" },
    { lens: "市场", dimensions: "country、timezone、channel", answer: "异常是否集中在某个国家或渠道", owner: "投放 / 运营" },
    { lens: "数据源", dimensions: "firebase、admob、adb、oss", answer: "是业务问题还是数据没拉到", owner: "数据平台" },
  ],
  project: [
    { lens: "版本", dimensions: "app_version、build_number、release_id", answer: "是不是新包导致指标变差", owner: "客户端" },
    { lens: "页面", dimensions: "screen_name、entry_source、exit_action", answer: "具体漏在哪个页面/按钮", owner: "产品 / 客户端" },
    { lens: "链路ID", dimensions: "session_id、opportunity_id、request_id、ad_instance_id", answer: "广告链路是否断在某个上下文", owner: "客户端 / 数据" },
  ],
  vpn: [
    { lens: "网络环境", dimensions: "country、asn、network_type、carrier", answer: "俄罗斯/伊朗是否被特定运营商影响", owner: "网络 / 节点" },
    { lens: "协议与端口", dimensions: "protocol、transport、port、fallback_reason", answer: "哪个协议组合在弱网下最容易失败", owner: "VPN 技术" },
    { lens: "节点与出口", dimensions: "server_id、node_region、ip_after_status、quality_status", answer: "节点是否不可用或出口被限制", owner: "节点运维" },
  ],
  admob: [
    { lens: "广告位", dimensions: "placement、ad_unit_id、ad_format", answer: "哪个广告位覆盖/收入异常", owner: "广告变现" },
    { lens: "广告源", dimensions: "ad_source、mediation_adapter、error_code", answer: "是否某个 Adapter 或错误码拖累", owner: "广告 SDK" },
    { lens: "用户频次", dimensions: "impression_bucket、user_lifecycle_day、is_subscriber", answer: "展示是否集中或被订阅/频控阻断", owner: "产品 / 广告策略" },
  ],
  firebase: [
    { lens: "事件", dimensions: "event_name、schema_version、event_id", answer: "哪些事件缺失、非法或未进入 allowlist", owner: "数据产品" },
    { lens: "参数", dimensions: "field_name、priority、provider", answer: "哪些 P0/P1 字段由哪个 Provider 负责", owner: "客户端" },
    { lens: "同步", dimensions: "run_id、dataset_id、loaded_at", answer: "是不是 BigQuery 拉取或 ADB 入库失败", owner: "数据平台" },
  ],
  reconcile: [
    { lens: "时效", dimensions: "T+0、T+1、T+3、business_date", answer: "是不是拿不同成熟度的数据在比", owner: "数据产品" },
    { lens: "去重", dimensions: "user_pseudo_id、event_id、request_id", answer: "差异是否来自重复或少去重", owner: "数据平台" },
    { lens: "映射", dimensions: "app_identifier、ad_unit_id、firebase_app_id", answer: "Firebase App / AdMob广告位是否绑定错", owner: "商业化 / 数据" },
  ],
};

const vpnInvestigationOutline = [
  { title: "1. 入口与点击", event: "screen_view / element_click", check: "VPN首页UV、连接按钮曝光、连接按钮点击", action: "点击低先改首页主CTA、文案、按钮位置、连接价值说明和二次引导。" },
  { title: "2. 权限与配置", event: "vpn_permission_result / vpn_config_fetch_result", check: "权限通过率、配置拉取成功率、配置来源和版本", action: "权限低改授权前解释；配置低查接口、缓存兜底、国家/版本配置。" },
  { title: "3. 节点探测与选择", event: "vpn_server_probe_result / vpn_node_selected", check: "候选可达率、探测P95、最终节点/协议/端口", action: "按国家、ASN、协议、端口、节点地区找最差组合，调整自动选点和候选池。" },
  { title: "4. 连接尝试", event: "vpn_connection_start / vpn_connection_result", check: "connection_id 尝试数、成功数、失败原因、耗时", action: "一次真实连接尝试只看 connection_id；失败必须按 error_code 和阶段拆。" },
  { title: "5. 阶段定位", event: "vpn_connection_phase", check: "DNS、Socket、TLS、协议握手、建隧道、路由、连通性各阶段成功率/P95", action: "哪个阶段掉得最多就定位哪个模块；不要只看最终失败码。" },
  { title: "6. 协议回退", event: "vpn_protocol_fallback", check: "回退触发、from/to 协议、回退后成功率", action: "回退后仍失败说明策略无效；调整协议顺序、传输层和端口池。" },
  { title: "7. IP 与出口", event: "vpn_ip_probe_result / vpn_connectivity_check", check: "before/after IP采集、IP变化、国家/ASN/ISP、是否 routed_through_vpn", action: "IP不变或可用性低，查隧道路由、DNS、出口节点和IP回显服务。" },
  { title: "8. 质量与断开", event: "vpn_quality_sample / vpn_disconnection / vpn_session_summary", check: "延迟、抖动、丢包、吞吐、异常断开、重连、会话摘要", action: "连接成功但体验差时，按节点/ASN/网络类型拆质量；断开高查切网和自动重连。" },
  { title: "9. 连接后广告", event: "ad_eligibility_check / ad_opportunity / ad_request / ad_impression", check: "连接成功后机会覆盖、请求、展示、AV", action: "连接成功后广告差，要查 vpn_session_id 是否贯穿广告请求和展示链路。" },
];

const vpnV18MetricChecklist = [
  { group: "入口", metric: "VPN首页到连接点击", keys: ["vpn_connect_click_rate", "connect_button_click_rate", "vpn_button_click_rate"], formula: "connect_button_click_users / vpn_home_users", event: "screen_view + element_click", fields: "screen_name、element_name、action_name、session_id", action: "低：改首页CTA曝光、文案、按钮位置、连接价值提示。", unit: "ratio" },
  { group: "权限", metric: "权限通过率", keys: ["vpn_permission_grant_rate", "vpn_permission_pass_rate", "permission_granted_rate"], formula: "permission_status=granted / vpn_permission_result", event: "vpn_permission_result", fields: "vpn_session_id、permission_status、permission_source", action: "低：权限前解释、拒绝后二次引导、系统设置入口。", unit: "ratio" },
  { group: "配置", metric: "配置拉取成功率", keys: ["vpn_config_success_rate", "config_fetch_success_rate"], formula: "result_status=success / vpn_config_fetch_result", event: "vpn_config_fetch_result", fields: "request_trace_id、config_source、config_version、error_code", action: "低：查远程配置接口、缓存兜底、国家/版本配置。", unit: "ratio" },
  { group: "节点", metric: "节点探测可达率", keys: ["vpn_probe_success_rate", "node_probe_success_rate"], formula: "probe_result=success / vpn_server_probe_result", event: "vpn_server_probe_result", fields: "probe_id、server_id、protocol、transport、port、latency_ms、packet_loss_pct", action: "低：按ASN/协议/端口/节点地区拆。", unit: "ratio" },
  { group: "节点", metric: "节点选择有效率", keys: ["vpn_node_selection_effective_rate", "node_selection_success_rate"], formula: "连接成功 / vpn_node_selected", event: "vpn_node_selected + vpn_connection_result", fields: "server_id、node_region、selection_mode、selection_score_bucket", action: "低：自动选点策略或候选池有问题。", unit: "ratio" },
  { group: "连接", metric: "连接尝试成功率", keys: ["vpn_connect_success", "vpn_connection_success_rate"], formula: "vpn_status=success / vpn_connection_start", event: "vpn_connection_start + vpn_connection_result", fields: "connection_id、vpn_session_id、vpn_status、duration_ms、error_code", action: "低：看阶段失败、error_code、协议、节点。", unit: "ratio" },
  { group: "连接", metric: "会话最终成功率", keys: ["vpn_session_success", "vpn_session_success_rate"], formula: "最终成功 vpn_session_id / 发起 vpn_session_id", event: "vpn_connection_result / vpn_session_summary", fields: "vpn_session_id、retry_index、fallback_index、final_result", action: "低：回退/重试没有救回用户。", unit: "ratio" },
  { group: "阶段", metric: "阶段最差成功率", keys: ["vpn_worst_phase_success_rate", "vpn_phase_success_rate"], formula: "phase_result=success / phase_total", event: "vpn_connection_phase", fields: "phase_name、phase_result、duration_ms、restriction_signal", action: "低：按最差 phase_name 定位 DNS/TLS/握手/路由。", unit: "ratio" },
  { group: "阶段", metric: "连接阶段P95", keys: ["vpn_phase_p95_ms", "vpn_connection_p95_ms"], formula: "P95(duration_ms)", event: "vpn_connection_phase", fields: "phase_name、duration_ms", action: "高：弱网、节点慢、协议握手慢或DNS慢。", unit: "ms" },
  { group: "回退", metric: "协议回退恢复率", keys: ["vpn_fallback_recovery_rate", "protocol_fallback_recovery_rate"], formula: "fallback 后成功 / vpn_protocol_fallback", event: "vpn_protocol_fallback", fields: "fallback_reason、from_protocol、to_protocol、from_transport、to_transport", action: "低：调整回退顺序、协议池、端口池。", unit: "ratio" },
  { group: "IP", metric: "连接前IP采集率", keys: ["ip_before_capture_rate", "vpn_ip_before_success_rate"], formula: "before_connect success / before_probe", event: "vpn_ip_probe_result", fields: "probe_stage=before_connect、probe_result、duration_ms、error_code", action: "低：查IP回显服务、网络/DNS、超时。", unit: "ratio" },
  { group: "IP", metric: "连接后IP采集率", keys: ["ip_after_capture_rate", "vpn_ip_after_success_rate"], formula: "after_connect success / 连接成功会话", event: "vpn_ip_probe_result", fields: "probe_stage=after_connect、probe_result、ip_after_connect、asn、isp", action: "低：查隧道路由和出口IP回显。", unit: "ratio" },
  { group: "IP", metric: "IP变化率", keys: ["vpn_ip_change", "ip_change_rate"], formula: "ip_changed=1 / before+after均成功", event: "vpn_ip_probe_result", fields: "ip_before_connect、ip_after_connect、ip_changed、country_code、asn", action: "低：可能没走隧道、分流绕行、出口探测错误。", unit: "ratio" },
  { group: "可用性", metric: "连接后可用率", keys: ["vpn_connectivity_success_rate", "connectivity_success_rate"], formula: "result_status=success / vpn_connectivity_check", event: "vpn_connectivity_check", fields: "check_type、dns_result、routed_through_vpn、http_status_class", action: "低：查DNS、路由、HTTP、出口可达。", unit: "ratio" },
  { group: "质量", metric: "质量健康率", keys: ["vpn_quality_good_rate", "quality_good_rate"], formula: "quality_status=good / vpn_quality_sample", event: "vpn_quality_sample", fields: "latency_ms、jitter_ms、packet_loss_pct、download_kbps、upload_kbps", action: "低：按节点/ASN/网络类型拆丢包和延迟。", unit: "ratio" },
  { group: "稳定性", metric: "异常断开率", keys: ["vpn_abnormal_disconnect_rate", "abnormal_disconnect_rate"], formula: "异常 disconnect / vpn_disconnection", event: "vpn_disconnection", fields: "disconnect_reason、connected_duration_ms、network_change_count、reconnect_count", action: "高：查切网、锁屏、系统杀进程、节点掉线。", unit: "ratio" },
  { group: "稳定性", metric: "自动重连成功率", keys: ["vpn_reconnect_success_rate", "auto_reconnect_success_rate"], formula: "自动重连成功 / reconnect_count", event: "vpn_disconnection + vpn_session_summary", fields: "reconnect_count、network_change_count、disconnect_reason", action: "低：查后台保活、网络恢复监听、重连策略。", unit: "ratio" },
  { group: "广告联动", metric: "连接后广告覆盖", keys: ["vpn_post_connect_av", "vpn_post_connect_av_rate", "vpn_viewer_rate"], formula: "连接成功后AV / 连接成功用户", event: "ad_impression + vpn_session_id", fields: "vpn_session_id、connection_id、ad_opportunity、ad_request、ad_impression", action: "低：查连接成功页机会、广告请求是否带vpn_session_id。", unit: "ratio" },
];

const vpnRequiredEvents = ["app_foreground", "screen_view", "element_click", "vpn_permission_result", "vpn_config_fetch_result", "vpn_server_probe_result", "vpn_node_selected", "vpn_connection_start", "vpn_connection_phase", "vpn_protocol_fallback", "vpn_connection_result", "vpn_ip_probe_result", "vpn_connectivity_check", "vpn_network_diagnostic", "vpn_quality_sample", "vpn_disconnection", "vpn_session_summary"];

function VpnInvestigationOutline() {
  return <section className="surface vpn-investigation-outline">
    <div className="surface-title"><div><h2>VPN 功能漏斗排查大纲</h2><p>按 V1.8 最新打点，把“功能没走通”拆成入口、权限、配置、节点、连接、阶段、IP、可用性、质量、断开和广告联动。</p></div><span>先看漏斗，再看阶段</span></div>
    <div className="vpn-outline-grid">{vpnInvestigationOutline.map((item) => <article key={item.title}><span>{item.title}</span><strong>{item.check}</strong><code>{item.event}</code><small>{item.action}</small></article>)}</div>
  </section>;
}

function VpnV18MetricChecklist({ data }: { data: AnyRow }) {
  return <section className="surface vpn-v18-checklist">
    <div className="surface-title"><div><h2>V1.8 可检查指标全表</h2><p>有线上指标就展示真实值；没有返回时不补假数，直接给后端字段和计算公式。</p></div><span>{vpnV18MetricChecklist.length} 个检查项</span></div>
    <div className="table-wrap"><table className="vpn-v18-check-table"><thead><tr><th>模块</th><th>指标</th><th>当前值</th><th>公式</th><th>V1.8事件</th><th>关键字段</th><th>异常怎么改</th></tr></thead><tbody>{vpnV18MetricChecklist.map((item) => {
      const metric = dataMetric(data, item.keys);
      return <tr key={item.metric} className={metricStatusTone(metric)}><td>{item.group}</td><td><strong>{item.metric}</strong></td><td>{displayMetricValue(metric, item.unit as "ratio" | "count" | "ms")}</td><td><code>{item.formula}</code></td><td><code>{item.event}</code></td><td><small>{item.fields}</small></td><td><small>{item.action}</small></td></tr>;
    })}</tbody></table></div>
  </section>;
}

function VpnWeakNetworkMatrix({ data }: { data: AnyRow }) {
  const rows = firstArray(data, ["vpnWeakNetworkBreakdown", "weakNetworkBreakdown", "vpnNetworkBreakdown", "networkBreakdown", "dimensions"]);
  return <section className="surface vpn-weak-network-matrix">
    <div className="surface-title"><div><h2>弱网 / ASN / 协议 / 节点维度</h2><p>俄罗斯、伊朗这类市场不能只看总成功率，必须横向拆国家、ASN、网络类型、协议、传输层、端口和节点。</p></div><span>{rows.length ? `${rows.length} 个切片` : "等待后端切片"}</span></div>
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>维度</th><th>连接尝试</th><th>成功率</th><th>P95</th><th>主要失败阶段</th><th>失败原因</th><th>建议</th></tr></thead><tbody>{rows.slice(0, 30).map((row: AnyRow, index: number) => <tr key={row.key ?? row.label ?? index} className={normalizeRate(row.successRate ?? row.rate) !== null && Number(normalizeRate(row.successRate ?? row.rate)) < 85 ? "row-bad" : ""}><td><strong>{text(row.label ?? row.dimension ?? row.key)}</strong><small>{text(row.country ?? row.asn ?? row.protocol ?? row.nodeRegion)}</small></td><td>{number(row.attempts ?? row.totalCount ?? row.count)}</td><td>{percent(normalizeRate(row.successRate ?? row.rate))}</td><td>{text(row.p95Ms ?? row.displayP95)}</td><td>{text(row.topPhase ?? row.phaseName)}</td><td>{text(row.topReason ?? row.errorCode ?? row.restrictionSignal)}</td><td>{text(row.action ?? "按该切片继续查节点、协议、端口和运营商。")}</td></tr>)}</tbody></table></div> : <div className="vpn-required-slices"><div><strong>后端应返回国家 × ASN</strong><small>country_code、asn、isp、network_type、success_rate、p95_ms、top_error_code</small></div><div><strong>后端应返回协议 × 端口</strong><small>protocol、transport、port、fallback_reason、probe_result、phase_result</small></div><div><strong>后端应返回节点 × 出口</strong><small>server_id、node_region、ip_after_status、routed_through_vpn、quality_status</small></div></div>}
  </section>;
}

function VpnEventCoverageBoard({ data }: { data: AnyRow }) {
  const rows = firstArray(data, ["eventCoverage", "vpnEventCoverage", "trackingCoverage", "eventCompleteness"]);
  return <section className="surface vpn-event-coverage-board">
    <div className="surface-title"><div><h2>V1.8 VPN 事件覆盖与数据质量</h2><p>这些事件是功能漏斗能否分析清楚的最低要求；缺了就要提示“不是业务为0，而是数据不可观测”。</p></div><span>{vpnRequiredEvents.length} 个关键事件</span></div>
    <div className="table-wrap"><table><thead><tr><th>关键事件</th><th>覆盖状态</th><th>收到数量</th><th>必需字段</th><th>缺失影响</th></tr></thead><tbody>{vpnRequiredEvents.map((event) => {
      const found = rows.find((row: AnyRow) => row.eventName === event || row.event_name === event || row.standardEventName === event);
      return <tr key={event} className={!found ? "row-warn" : Number(found.missingRate ?? found.missing_rate ?? 0) > 0 ? "row-warn" : ""}><td><code>{event}</code></td><td>{found ? statusLabel(found.status ?? "已返回") : "待后端返回覆盖统计"}</td><td>{found ? number(found.count ?? found.events ?? found.users) : "—"}</td><td><small>{event.includes("connection") ? "vpn_session_id、connection_id、result/status、duration_ms、error_code" : event.includes("ip") ? "vpn_session_id、probe_stage、probe_result、ip_before/after、asn" : event.includes("permission") ? "vpn_session_id、permission_status" : "event_id、my_user_id、session_id、screen_name"}</small></td><td><small>{found ? text(found.issue ?? found.impact ?? "可用于漏斗分析") : "缺覆盖统计时，无法判断事件是否漏接或只是业务没有发生。"}</small></td></tr>;
    })}</tbody></table></div>
  </section>;
}

function SourceContract({ module, data }: { module: ModuleKey; data: AnyRow }) {
  const availability = data.dataAvailability ?? {};
  return <section className="module-contract-grid">
    {sourceContracts[module].map((item) => <article key={item.label} className="surface module-contract-card"><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></article>)}
    <article className="surface module-contract-card runtime"><span>当前接口状态</span><strong>{text(data.querySource ?? availability.reason ?? "已返回")}</strong><small>{data.dataNotice ?? (availability.dwsFunnelAvailable === false ? "当前筛选暂无标准汇总，请看上方建议" : "按当前筛选口径读取线上数据")}</small></article>
  </section>;
}

function DiagnosticPlaybook({ module, onOpenModule, onOpenDialog }: { module: ModuleKey; onOpenModule: Props["onOpenModule"]; onOpenDialog: Props["onOpenDialog"] }) {
  return <section className="surface module-playbook"><div className="surface-title"><div><h2>异常时怎么继续查</h2><p>这里是给运营/研发排查用的固定路径；指标数值仍以上方线上接口返回为准。</p></div></div><div className="table-wrap"><table><thead><tr><th>看到的问题</th><th>下一步看什么</th><th>关键字段 / 事件</th><th>建议动作</th></tr></thead><tbody>{playbooks[module].map((row) => <tr key={row.symptom}><td><strong>{row.symptom}</strong></td><td>{row.inspect}</td><td><code>{row.fields}</code></td><td>{row.action}</td></tr>)}</tbody></table></div><div className="module-playbook-actions"><button onClick={() => onOpenModule("funnel")}>进入漏斗工作台</button><button onClick={() => onOpenModule("tracking")}>去打点验收</button><button onClick={() => onOpenModule("tasks")}>查任务日志</button><button onClick={() => onOpenDialog(module === "admob" ? "admob-report" : module === "reconcile" ? "reconcile-run" : "diagnosis")}>创建处理任务</button></div></section>;
}

function MetricFormulaBoard({ module }: { module: ModuleKey }) {
  return <section className="surface module-formula-board">
    <div className="surface-title"><div><h2>核心指标口径与来源字段</h2><p>页面里出现的关键指标必须能追到事件、字段和计算公式；研发可以按字段名直接排查。</p></div><span>V1.8 口径</span></div>
    <div className="table-wrap"><table><thead><tr><th>指标</th><th>计算公式</th><th>数据源</th><th>来源字段 / 事件</th><th>用来判断什么</th><th>异常后怎么查</th></tr></thead><tbody>{formulaRows[module].map((row) => <tr key={row.metric}><td><strong>{row.metric}</strong></td><td><code>{row.formula}</code></td><td>{row.source}</td><td><code>{row.fields}</code></td><td>{row.purpose}</td><td>{row.abnormal}</td></tr>)}</tbody></table></div>
  </section>;
}

function DiagnosticLensBoard({ module }: { module: ModuleKey }) {
  return <section className="surface module-lens-board">
    <div className="surface-title"><div><h2>精细化下钻维度</h2><p>当指标变差时，不要只看总数；按这些维度逐层切片，通常能定位到具体技术或页面问题。</p></div></div>
    <div className="module-lens-grid">{lensRows[module].map((row) => <article key={row.lens}><span>{row.lens}</span><strong>{row.answer}</strong><code>{row.dimensions}</code><small>主要负责人：{row.owner}</small></article>)}</div>
  </section>;
}

export function OnlineModulePage(props: Props) {
  const [data, setData] = useState<AnyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const dates = useMemo(() => dateRange(props.range), [props.range]);
  const config = {
    global: { page: "overview", domain: "ads", unit: "users", title: "多项目线上总览", hint: "按线上 DWS 汇总表发现异常项目" },
    project: { page: "workbench", domain: "ads", unit: "users", title: "单项目线上工作台", hint: "广告覆盖、请求履约、数据质量统一查看" },
    vpn: { page: "workbench", domain: "vpn", unit: "sessions", title: "VPN 功能线上分析", hint: "按 vpn_session_id / connection_id 查看连接质量" },
    admob: { page: "workbench", domain: "ads", unit: "events", title: "AdMob 线上分析", hint: "AdMob 收入库 + Firebase AV 口径对照" },
    firebase: { page: "workbench", domain: "quality", unit: "users", title: "Firebase 数据质量", hint: "事件质量、P0参数、关联链与同步水位" },
    reconcile: { page: "workbench", domain: "quality", unit: "users", title: "数据对账线上看板", hint: "Firebase / 中台 / ADB / AdMob 分源判断" },
  }[props.module] as { page: "overview" | "workbench"; domain: "ads" | "vpn" | "quality"; unit: "users" | "sessions" | "events"; title: string; hint: string };

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setError("");
    queryFunnel({
      page: config.page,
      ...dates,
      projectCode: props.module === "global" ? undefined : props.project,
      appIdentifier: props.module === "global" ? undefined : props.projectMeta?.appIdentifier,
      platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios",
      country: props.country === "全部国家" ? undefined : props.country,
      appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0],
      domain: config.domain,
      unit: config.unit,
      pageSize: 100,
    }, controller.signal)
      .then(setData)
      .catch((reason) => setError(controller.signal.aborted ? "读取超时，请缩小筛选范围或稍后重试" : reason instanceof Error ? reason.message : "线上接口读取失败"))
      .finally(() => { window.clearTimeout(timeout); setLoading(false); });
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [config.domain, config.page, config.unit, dates, props.appVersion, props.country, props.module, props.platform, props.project, props.projectMeta?.appIdentifier, props.refreshKey, retryKey]);

  if (loading && props.module === "vpn") {
    return <div className="page-stack online-module-page">
      <State kind="loading" message="正在读取线上 DWS 汇总表；下方先展示 V1.8 VPN 功能漏斗排查框架，数据返回后自动填入真实值。" />
      <VpnInvestigationOutline />
      <VpnV18MetricChecklist data={{ metrics: [] }} />
      <VpnWeakNetworkMatrix data={{}} />
      <VpnEventCoverageBoard data={{}} />
    </div>;
  }
  if (loading) return <State kind="loading" message="正在优先读取线上 DWS 汇总表；只有证据链才读取明细。" />;
  if (error) return <State kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  if (!data) return <State kind="empty" message="当前页面没有返回数据。" />;

  const availability = data.dataAvailability ?? {};
  return <div className="page-stack online-module-page">
    <section className="surface online-module-hero"><div><div className="eyebrow">实时查询 · 线上接口 · {data.querySource ?? "backend"}</div><h2>{config.title}</h2><p>{config.hint}</p></div><div><span>{props.project}</span><strong>{props.range} · {props.platform} · {props.country}</strong><small>{props.appVersion} · 刷新后即时请求</small></div></section>
    {availability.dwsFunnelAvailable === false && <section className="surface operational-warning"><div className="surface-title"><div><h2>当前项目暂无 DWS 标准事件汇总</h2><p>{text(availability.reason)}</p></div><span>{availability.adMobAvailable ? "AdMob 有数据" : "无标准事件"}</span></div><div className="inline-empty">{(availability.suggestions ?? []).join("；") || "请检查 Firebase 同步、DWD 入库和 DWS ETL。"}</div></section>}
    <SourceContract module={props.module} data={data} />
    <MetricCards data={data} module={props.module} />
    {props.module === "vpn" && <VpnInvestigationOutline />}
    {props.module === "vpn" && <VpnV18MetricChecklist data={data} />}
    {props.module === "vpn" && <VpnWeakNetworkMatrix data={data} />}
    {props.module === "vpn" && <VpnEventCoverageBoard data={data} />}
    <MetricFormulaBoard module={props.module} />
    {props.module === "global" ? <section className="surface"><div className="surface-title"><div><h2>线上项目列表</h2><p>来自 Firebase 绑定项目与 DWS 汇总表</p></div></div><ProjectTable rows={data.projects} /></section> : <section className="surface"><div className="surface-title"><div><h2>{props.module === "vpn" ? "VPN 核心漏斗" : props.module === "firebase" || props.module === "reconcile" ? "数据质量指标" : "广告核心漏斗"}</h2><p>{data.dataNotice ?? "按当前筛选口径查询线上数据"}</p></div></div>{props.module === "firebase" || props.module === "reconcile" ? <MetricsTable rows={data.metrics} /> : <FunnelTable rows={data.funnel} showCondition={props.module === "vpn"} />}</section>}
    {props.module === "vpn" && <VpnNodeDropoffBoard data={data} onOpenModule={props.onOpenModule} />}
    {props.module === "vpn" && <VpnStageDropoffBoard stages={data.vpnStageHealth?.stages} />}
    {props.module === "vpn" && <VpnPageDropoffBoard data={data} />}
    <DiagnosticLensBoard module={props.module} />
    <DiagnosticPlaybook module={props.module} onOpenModule={props.onOpenModule} onOpenDialog={props.onOpenDialog} />
    <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>指标明细</h2><p>运营可直接复制指标名给技术排查</p></div></div><MetricsTable rows={data.metrics} /></div><aside className="surface"><div className="surface-title"><div><h2>下一步动作</h2><p>每个按钮都跳到可用页面</p></div></div><div className="technical-actions"><button onClick={() => props.onOpenModule("funnel")}><strong>进入漏斗工作台</strong><span>查看核心漏斗 / 流失诊断 / 页面路径</span></button><button onClick={() => props.onOpenModule("tracking")}><strong>打点验收</strong><span>验证 P0 事件、参数和关联链</span></button><button onClick={() => props.onOpenModule("tasks")}><strong>任务与告警</strong><span>查看同步任务和接口错误</span></button><button onClick={() => props.onOpenDialog(props.module === "admob" ? "admob-report" : "diagnosis")}><strong>创建任务</strong><span>冻结当前筛选和证据范围</span></button></div></aside></section>
  </div>;
}
