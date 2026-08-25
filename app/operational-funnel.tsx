"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { queryFunnel, type FunnelPageKey, type FunnelQuery, type FunnelQueryPackageItem } from "./funnel-analysis-api";

type Props = {
  enabled: boolean;
  page: FunnelPageKey;
  projectCode: string;
  appIdentifier?: string;
  range: string;
  platform: string;
  country: string;
  appVersion: string;
  refreshKey: number;
  onPageChange: (page: FunnelPageKey) => void;
};

type AnyRow = Record<string, any>;
type FunnelUnit = "users" | "sessions" | "events";
type PackageData = Record<string, AnyRow>;
type QueryProgressStatus = "pending" | "loading" | "retrying" | "done" | "error";
type QueryProgressItem = { key: string; label: string; status: QueryProgressStatus; finishedAt?: string; error?: string; attempt?: number; maxAttempts?: number; dataCountLabel?: string; dateLabel?: string };
type DropoffSelection = { fromIndex: number; toIndex: number };
const number = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${number(value)}%`;
const money = (value: unknown) => value === null || value === undefined ? "—" : `$${number(value)}`;
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const rowCount = (row: AnyRow) => Number(row?.count ?? row?.value ?? row?.users ?? 0);
const rowName = (row: AnyRow) => text(row?.name ?? row?.stepName ?? row?.label);
const rowEvent = (row: AnyRow) => text(row?.eventName ?? row?.event);

function dateRange(range: string) {
  const end = new Date();
  const start = new Date(end);
  if (range === "昨天") start.setDate(start.getDate() - 1), end.setDate(end.getDate() - 1);
  if (range === "近7天") start.setDate(start.getDate() - 7), end.setDate(end.getDate() - 1);
  if (range === "近30天") start.setDate(start.getDate() - 30), end.setDate(end.getDate() - 1);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { dateFrom: iso(start), dateTo: iso(end) };
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dataPolicy(range: string, dates: { dateFrom: string; dateTo: string }) {
  const today = todayIso();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;
  const includesToday = dates.dateFrom <= today && dates.dateTo >= today;
  if (includesToday) {
    return {
      tone: "warn" as const,
      label: "含今天实时补查",
      detail: `今日 ${today} 走实时查询；完整离线汇总以 ${yesterday} 为准，今天数据会持续变化。`,
      source: "昨日DWS汇总 + 今日实时补查",
    };
  }
  return {
    tone: "good" as const,
    label: range === "昨天" ? "昨日汇总已完成" : "离线汇总已完成",
    detail: `当前查询 ${dates.dateFrom} 至 ${dates.dateTo}，使用已落库 DWS 汇总表，Tab 切换不再重新查库。`,
    source: "DWS离线汇总",
  };
}

function StatePanel({ kind, message, retry, children }: { kind: "loading" | "empty" | "error"; message: string; retry?: () => void; children?: ReactNode }) {
  return <section className={`surface operational-state ${kind}`}><span>{kind === "loading" ? "同步" : kind === "empty" ? "空" : "!"}</span><div><h2>{kind === "loading" ? "正在读取线上数据" : kind === "empty" ? "当前筛选范围没有数据" : "数据读取失败"}</h2><p>{message}</p>{children}{retry && <button onClick={retry}>重新加载</button>}</div></section>;
}

function PackageStatusBanner({ projectCode, range, dates, loadedAt, partialErrors, progressItems }: { projectCode: string; range: string; dates: { dateFrom: string; dateTo: string }; loadedAt: string; partialErrors: Record<string, string>; progressItems: QueryProgressItem[] }) {
  const policy = dataPolicy(range, dates);
  const errorCount = Object.keys(partialErrors).length;
  const doneCount = progressItems.filter((item) => item.status === "done").length;
  const finishedCount = progressItems.filter((item) => item.status === "done" || item.status === "error").length;
  const totalCount = progressItems.length || 1;
  const complete = finishedCount >= totalCount;
  const title = complete ? `${projectCode || "全部项目"} ${range}数据已加载完毕` : `${projectCode || "全部项目"} ${range}核心数据已可用`;
  return <section className={`package-status-banner ${policy.tone}`}>
    <div className="package-status-main"><span>{complete && policy.tone === "good" ? "✓" : "…"}</span><div><strong>{title}</strong><small>{complete ? policy.detail : "核心页先展示，流失诊断、页面路径、证据明细等数据正在后台补齐。"}</small></div></div>
    <div className="package-status-meta"><div><span>数据来源</span><strong>{policy.source}</strong></div><div><span>查询日期</span><strong>{dates.dateFrom} 至 {dates.dateTo}</strong></div><div><span>拉取进度</span><strong>{doneCount}/{totalCount} 完成</strong></div><div><span>加载时间</span><strong>{loadedAt || "刚刚"}</strong></div>{errorCount > 0 && <div className="warn"><span>部分页失败</span><strong>{errorCount} 个</strong></div>}</div>
  </section>;
}

function packageKey(page: FunnelPageKey, domain: "ads" | "vpn" | "quality", unit: FunnelUnit) {
  return `${page}:${domain}:${unit}`;
}

function buildPackageItems(baseQuery: Omit<FunnelQuery, "page" | "domain" | "unit">, scope: "overview" | "project", domain: "ads" | "vpn" | "quality", unit: FunnelUnit): FunnelQueryPackageItem[] {
  if (scope === "overview") {
    return [{ key: packageKey("overview", "ads", "users"), query: { ...baseQuery, page: "overview", domain: "ads", unit: "users" } }];
  }

  const queryUnit: FunnelUnit = domain === "vpn" ? "sessions" : domain === "ads" ? unit : "users";
  const pages: FunnelPageKey[] = ["workbench", "diagnosis", "path", "evidence", "issues", "snapshot"];
  return pages.map((page) => ({
    key: packageKey(page, domain, queryUnit),
    query: {
      ...baseQuery,
      page,
      domain,
      unit: queryUnit,
      evidenceMode: "ad",
      pageSize: page === "evidence" ? 100 : 50,
    },
  }));
}

function queryItemLabel(item: FunnelQueryPackageItem) {
  const pageNames: Record<FunnelPageKey, string> = {
    overview: "多项目总览",
    workbench: "核心漏斗",
    diagnosis: "流失诊断",
    cohort: "异常切片",
    path: "页面路径",
    evidence: "证据明细",
    issues: "问题闭环",
    snapshot: "口径快照",
  };
  const domainNames: Record<string, string> = { ads: "广告", vpn: "VPN", quality: "质量" };
  const unitNames: Record<string, string> = { users: "用户口径", sessions: "Session口径", events: "事件口径" };
  return `${domainNames[item.query.domain || "ads"] || ""}${pageNames[item.query.page]} · ${unitNames[item.query.unit || "users"] || ""}`;
}

function compactDate(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : raw;
}

function queryDateLabel(query: FunnelQuery) {
  return `查询范围 ${compactDate(query.dateFrom)} 至 ${compactDate(query.dateTo)}`;
}

function collectDateValues(value: unknown, output = new Set<string>(), depth = 0): Set<string> {
  if (depth > 4 || value === null || value === undefined) return output;
  if (typeof value === "string") {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) output.add(match[0]);
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item) => collectDateValues(item, output, depth + 1));
    return output;
  }
  if (typeof value === "object") {
    Object.entries(value as AnyRow).forEach(([key, item]) => {
      if (/date|day|stat/i.test(key) || depth < 2) collectDateValues(item, output, depth + 1);
    });
  }
  return output;
}

function resultDateLabel(result: AnyRow, query: FunnelQuery) {
  const dates = Array.from(collectDateValues(result)).sort();
  if (!dates.length) return `${queryDateLabel(query)} · 接口未返回分日`;
  if (dates.length <= 7) return `数据日期 ${dates.map(compactDate).join("、")}`;
  return `数据日期 ${compactDate(dates[0])} 至 ${compactDate(dates[dates.length - 1])} · ${dates.length} 天`;
}

function countLabel(result: AnyRow, page: FunnelPageKey) {
  if (page === "workbench") return `指标 ${(result.metrics ?? []).length} 个 · 漏斗 ${(result.funnel ?? []).length} 步`;
  if (page === "diagnosis") return `原因 ${(result.reasons ?? []).length} 条`;
  if (page === "path") return `页面 ${(result.pages ?? []).length} 个`;
  if (page === "evidence") return `证据 ${number(result.total ?? (result.items ?? []).length)} 条`;
  if (page === "issues") return `问题 ${(result.items ?? []).length} 个`;
  if (page === "snapshot") return `步骤 ${(result.steps ?? []).length} 个`;
  if (page === "overview") return `项目 ${(result.projects ?? []).length} 个 · 漏斗 ${(result.funnel ?? []).length} 步`;
  return "已返回数据";
}

function QueryProgressPanel({ items, compact = false }: { items: QueryProgressItem[]; compact?: boolean }) {
  if (!items.length) return null;
  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "error").length;
  const loading = items.find((item) => item.status === "loading" || item.status === "retrying");
  return <section className={`query-progress-panel ${compact ? "compact" : ""}`}>
    <div className="query-progress-title"><div><strong>查询进度</strong><small>{loading ? `${loading.status === "retrying" ? "自动重拉" : "正在查询"}：${loading.label}` : doneCount === items.length ? "全部数据查询完成" : "等待后台补齐剩余数据"}</small></div><span>{doneCount}/{items.length} 完成{failedCount ? ` · ${failedCount} 失败` : ""}</span></div>
    <div className="query-progress-list">{items.map((item) => <div key={item.key} className={item.status}><i>{item.status === "done" ? "✓" : item.status === "error" ? "!" : item.status === "loading" || item.status === "retrying" ? "…" : "○"}</i><span>{item.label}</span><small>{item.status === "done" ? `${item.finishedAt || "刚刚"} 完成` : item.status === "error" ? item.error || "查询失败" : item.status === "retrying" ? `自动重拉中，第 ${item.attempt || 2}/${item.maxAttempts || 3} 次` : item.status === "loading" ? `查询中，第 ${item.attempt || 1}/${item.maxAttempts || 3} 次` : "待查询"}</small><strong>{item.dataCountLabel || "数据量待返回"}</strong><em>{item.dateLabel || "日期待返回"}</em></div>)}</div>
  </section>;
}

function MetricCard({ label, value, note, status }: { label: string; value: string; note?: string; status?: string }) {
  const tone = status === "critical" || status === "bad" ? "bad" : status === "warning" || status === "warn" ? "warn" : status === "good" ? "good" : "";
  return <article className={`operational-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note || "当前筛选口径"}</small></article>;
}

function Funnel({ rows = [], selectedTransition, onSelectTransition }: { rows?: AnyRow[]; selectedTransition?: DropoffSelection; onSelectTransition?: (selection: DropoffSelection) => void }) {
  if (!rows.length) return <div className="inline-empty">当前范围没有可用漏斗步骤</div>;
  const max = Math.max(...rows.map((row) => rowCount(row)), 1);
  return <div className="operational-funnel-list">{rows.map((row, index) => {
    const value = rowCount(row);
    const available = row.available !== false;
    const transition = index === 0 ? { fromIndex: 0, toIndex: Math.min(1, rows.length - 1) } : { fromIndex: index - 1, toIndex: index };
    const selected = selectedTransition?.fromIndex === transition.fromIndex && selectedTransition?.toIndex === transition.toIndex;
    return <button key={row.stepCode ?? row.code ?? row.name ?? index} className={selected ? "selected" : ""} disabled={!available} onClick={() => onSelectTransition?.(transition)} title={index === 0 ? "分析第 1 步到第 2 步的流失" : `分析 ${rowName(rows[index - 1])} → ${rowName(row)} 的流失`}><span>{index + 1}</span><div><strong>{rowName(row)}</strong><small>{rowEvent(row)}</small>{onSelectTransition && <small className="funnel-analysis-hint">{index === 0 ? "点击分析下一步流失" : "点击分析上一步流失"}</small>}</div><em>{available ? number(value) : "暂无数据"}</em><b>{row.conversionRate === null || row.conversionRate === undefined ? "—" : percent(row.conversionRate)}</b><i style={{ width: `${available ? Math.max(4, value / max * 100) : 0}%` }} /></button>;
  })}</div>;
}

function bestDropoffSelection(rows: AnyRow[]): DropoffSelection {
  if (rows.length < 2) return { fromIndex: 0, toIndex: 0 };
  let best = { fromIndex: 0, toIndex: 1 };
  let bestLoss = -Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    const loss = rowCount(rows[index - 1]) - rowCount(rows[index]);
    if (loss > bestLoss) {
      bestLoss = loss;
      best = { fromIndex: index - 1, toIndex: index };
    }
  }
  return best;
}

function pageMetricKeysForStep(step: AnyRow) {
  const raw = `${rowName(step)} ${rowEvent(step)}`.toLowerCase();
  if (raw.includes("eligibility") || raw.includes("资格") || raw.includes("check")) return ["eligibilityCheckUsers", "adCheckUsers", "checkUsers", "adEligibilityUsers", "opportunityUsers"];
  if (raw.includes("opportunity") || raw.includes("机会")) return ["opportunityUsers"];
  if (raw.includes("request") || raw.includes("请求")) return ["requestUsers", "adRequestUsers", "opportunityUsers"];
  if (raw.includes("show") || raw.includes("展示尝试")) return ["showAttemptUsers", "adShowAttemptUsers", "opportunityUsers"];
  if (raw.includes("impression") || raw.includes("展示")) return ["impressionUsers", "avUsers", "opportunityUsers"];
  return ["opportunityUsers", "impressionUsers"];
}

function pageStepUsers(row: AnyRow, step: AnyRow) {
  for (const key of pageMetricKeysForStep(step)) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return Number(value);
  }
  return null;
}

function DropoffAnalysisPanel({ rows, selection, onSelectionChange, pageData, diagnosisData, pageProgress, diagnosisProgress }: { rows: AnyRow[]; selection: DropoffSelection; onSelectionChange: (selection: DropoffSelection) => void; pageData?: AnyRow | null; diagnosisData?: AnyRow | null; pageProgress?: QueryProgressItem; diagnosisProgress?: QueryProgressItem }) {
  if (rows.length < 2) return null;
  const safeFrom = Math.max(0, Math.min(selection.fromIndex, rows.length - 2));
  const safeTo = Math.max(safeFrom + 1, Math.min(selection.toIndex, rows.length - 1));
  const from = rows[safeFrom];
  const to = rows[safeTo];
  const fromValue = rowCount(from);
  const toValue = rowCount(to);
  const loss = Math.max(0, fromValue - toValue);
  const passRate = fromValue > 0 ? toValue / fromValue * 100 : null;
  const lossRate = fromValue > 0 ? loss / fromValue * 100 : null;
  const pageRows: AnyRow[] = pageData?.pages ?? [];
  const analyzedPages = pageRows.map((page) => {
    const pageUsers = Number(page.pageUsers ?? page.users ?? page.viewUsers ?? 0);
    const reached = pageStepUsers(page, to);
    const missing = reached === null ? null : Math.max(0, pageUsers - reached);
    const missingRate = reached === null || pageUsers <= 0 ? null : missing! / pageUsers * 100;
    return { ...page, pageUsers, reached, missing, missingRate };
  }).sort((a, b) => Number(b.missing ?? -1) - Number(a.missing ?? -1));
  const topMissingPages = analyzedPages.filter((page) => page.missing !== null).slice(0, 8);
  const activePages = analyzedPages.filter((page) => Number(page.reached ?? 0) > 0).slice(0, 5);
  const inactivePages = analyzedPages.filter((page) => page.reached !== null && Number(page.reached) === 0 && page.pageUsers > 0).slice(0, 5);
  const reasons: AnyRow[] = diagnosisData?.reasons ?? [];
  const isFirstCheck = safeFrom === 0 && (`${rowName(to)} ${rowEvent(to)}`.toLowerCase().includes("check") || rowName(to).includes("资格"));
  return <section className="surface dropoff-analysis-panel">
    <div className="surface-title"><div><h2>漏斗断点分析：{rowName(from)} → {rowName(to)}</h2><p>点击漏斗步骤切换分析区间；当前重点判断这批用户为什么没有进入下一步事件。</p></div><span>{loss > 0 ? `流失 ${number(loss)}` : "无明显流失"}</span></div>
    <div className="dropoff-step-tabs">{rows.slice(1).map((step, index) => {
      const item = { fromIndex: index, toIndex: index + 1 };
      const active = safeFrom === item.fromIndex && safeTo === item.toIndex;
      const itemLoss = rowCount(rows[index]) - rowCount(step);
      return <button key={`${rowName(rows[index])}-${rowName(step)}`} className={active ? "active" : ""} onClick={() => onSelectionChange(item)}><strong>{rowName(rows[index])} → {rowName(step)}</strong><small>流失 {number(Math.max(0, itemLoss))}</small></button>;
    })}</div>
    <section className="operational-metric-grid dropoff-metrics">
      <MetricCard label="起点用户" value={number(fromValue)} note={rowEvent(from)} />
      <MetricCard label="到达用户" value={number(toValue)} note={rowEvent(to)} status={passRate !== null && passRate < 70 ? "warning" : "good"} />
      <MetricCard label="流失用户" value={number(loss)} note={`${rowName(from)} 未进入 ${rowName(to)}`} status={lossRate !== null && lossRate > 30 ? "bad" : "warn"} />
      <MetricCard label="流失率" value={lossRate === null ? "—" : percent(lossRate)} note={`通过率 ${passRate === null ? "—" : percent(passRate)}`} status={lossRate !== null && lossRate > 30 ? "bad" : "warn"} />
    </section>
    <div className="dropoff-conclusion"><strong>当前判断</strong><p>{isFirstCheck ? "DAU 到广告资格检查断层，说明用户已经活跃，但没有进入广告资格判断。优先排查：哪些页面没有触发广告入口/按钮点击，广告资格检查调用时机是否过晚，入口曝光后是否被条件拦截，以及 app_foreground 与 ad_eligibility_check 是否存在打点缺失。" : loss > 0 ? `主要流失发生在 ${rowName(from)} 到 ${rowName(to)}。优先看该步骤的触发条件、页面入口、SDK 回调是否完整，以及上一环节 ID 是否能串到下一环节。` : "当前环节没有明显流失，可优先分析后续转化更低的断点。"}</p></div>
    <section className="two-column wide-left">
      <div className="surface nested"><div className="surface-title"><div><h2>页面点击 / 未点击分析</h2><p>按页面 UV 对比进入下一广告动作的用户，定位漏在哪些页面。</p></div><span>{pageProgress?.status === "done" ? "页面路径已完成" : pageProgress?.status === "retrying" ? "页面路径自动重拉中" : pageProgress?.status === "loading" ? "页面路径查询中" : "等待页面路径"}</span></div>{topMissingPages.length ? <div className="table-wrap"><table><thead><tr><th>页面</th><th>页面UV</th><th>进入下一步</th><th>未进入</th><th>漏失率</th></tr></thead><tbody>{topMissingPages.map((page) => <tr key={page.screenName ?? page.label}><td><strong>{text(page.screenName ?? page.label)}</strong><small>{text(page.entrySource ?? page.pathType)}</small></td><td>{number(page.pageUsers)}</td><td>{number(page.reached)}</td><td>{number(page.missing)}</td><td>{page.missingRate === null ? "—" : percent(page.missingRate)}</td></tr>)}</tbody></table></div> : <div className="inline-empty">{pageProgress?.status === "loading" || pageProgress?.status === "pending" || pageProgress?.status === "retrying" ? "页面路径数据还在查询或自动重拉，完成后这里会自动显示每个页面的点击/未点击情况。" : "当前页面路径数据没有下一步用户字段，建议后端补充 page × step 的到达人数。"}</div>}</div>
      <aside className="surface nested"><div className="surface-title"><div><h2>快速结论</h2><p>运营优先看这两类页面</p></div></div><dl className="operational-kv"><div><dt>有进入下一步的页面</dt><dd>{activePages.length ? activePages.map((page) => text(page.screenName ?? page.label)).join("、") : "暂无"}</dd></div><div><dt>完全未进入下一步的页面</dt><dd>{inactivePages.length ? inactivePages.map((page) => text(page.screenName ?? page.label)).join("、") : "暂无"}</dd></div><div><dt>原因数据状态</dt><dd>{diagnosisProgress?.status === "done" ? "已完成" : diagnosisProgress?.status === "retrying" ? "自动重拉中" : diagnosisProgress?.status === "loading" ? "查询中" : "等待查询"}</dd></div></dl>{reasons.length > 0 && <div className="dropoff-reasons">{reasons.slice(0, 4).map((reason) => <div key={reason.code ?? reason.reason}><strong>{text(reason.label ?? reason.code ?? reason.reason)}</strong><small>{number(reason.count ?? reason.users)} · {percent(reason.share ?? reason.rate)}</small></div>)}</div>}</aside>
    </section>
  </section>;
}

function AvailabilityBanner({ data }: { data: AnyRow }) {
  const availability = data.dataAvailability ?? {};
  if (availability.dwsFunnelAvailable !== false) return null;
  const suggestions: string[] = availability.suggestions ?? [];
  return <section className="surface operational-warning"><div className="surface-title"><div><h2>当前项目暂无 DWS 标准事件汇总</h2><p>{text(availability.reason)}</p></div><span>{availability.adMobAvailable ? "AdMob 有数据" : "平台数据也为空"}</span></div><dl className="operational-kv"><div><dt>项目</dt><dd>{text(availability.projectCode)}</dd></div><div><dt>包名</dt><dd>{text(availability.appIdentifier)}</dd></div><div><dt>Firebase 近24小时事件</dt><dd>{number(availability.firebaseEvents24h)}</dd></div><div><dt>最新同步水位</dt><dd>{text(availability.firebaseLatestLoadedAt)}</dd></div></dl>{suggestions.length > 0 && <div className="inline-empty"><strong>建议排查：</strong>{suggestions.join("；")}</div>}</section>;
}

function Overview({ data, onPageChange, context }: { data: AnyRow; onPageChange: Props["onPageChange"]; context: { projectCode: string; range: string; dates: { dateFrom: string; dateTo: string }; loadedAt: string } }) {
  const summary = data.summary ?? {};
  const projects: AnyRow[] = data.projects ?? [];
  return <div className="page-stack">
    <section className="operational-metric-grid">
      <MetricCard label="日活跃用户（DAU）" value={number(summary.dauUsers)} />
      <MetricCard label="广告浏览人数（AV）" value={number(summary.impressionUsers)} />
      <MetricCard label="广告浏览者比例" value={percent(summary.adViewerRate)} status={summary.adViewerRateStatus} />
      <MetricCard label="广告机会用户" value={number(summary.opportunityUsers)} />
      <MetricCard label="人均展示次数" value={number(summary.impressionsPerViewer)} />
      <MetricCard label="广告收入" value={money(summary.revenue)} />
    </section>
    <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>全项目健康度</h2><p>只展示当前员工有权限的线上项目</p></div><span>{projects.length} 个项目</span></div>{projects.length ? <div className="table-wrap"><table><thead><tr><th>项目</th><th>DAU</th><th>AV</th><th>浏览者比例</th><th>机会覆盖</th><th>收入</th><th>异常步骤</th><th>状态</th></tr></thead><tbody>{projects.map((row) => <tr key={row.projectCode}><td><strong>{text(row.projectCode)}</strong><small>{text(row.appName)}</small></td><td>{number(row.dauUsers)}</td><td>{number(row.impressionUsers)}</td><td>{percent(row.adViewerRate)}</td><td>{percent(row.opportunityCoverage)}</td><td>{money(row.revenue)}</td><td>{text(row.abnormalStep)}</td><td>{text(row.status)}</td></tr>)}</tbody></table></div> : <div className="inline-empty">没有符合筛选条件的项目</div>}</div><aside className="surface"><div className="surface-title"><div><h2>数据时效</h2><p>运营结论必须先确认数据状态</p></div></div><dl className="operational-kv"><div><dt>校准状态</dt><dd>{text(data.freshness?.calibrationStatus)}</dd></div><div><dt>最新事件</dt><dd>{text(data.freshness?.latestEventAt)}</dd></div><div><dt>Firebase 行数</dt><dd>{number(data.freshness?.firebaseRows)}</dd></div><div><dt>API 行数</dt><dd>{number(data.freshness?.apiRows)}</dd></div></dl><button className="primary-button" onClick={() => onPageChange("workbench")}>进入单项目工作台</button></aside></section>
    <section className="surface"><div className="surface-title"><div><h2>广告用户覆盖主漏斗</h2><p>真实 ADB 标准事件按用户去重</p></div><div className="funnel-context-strip"><div><span>项目代号</span><strong>{context.projectCode}</strong></div><div><span>数据范围</span><strong>{context.dates.dateFrom} 至 {context.dates.dateTo}</strong></div><div><span>数据拉取时间</span><strong>{context.loadedAt || "刚刚"}</strong></div></div></div><Funnel rows={data.funnel} /></section>
  </div>;
}

function Workbench({ data, domain, setDomain, unit, setUnit, pageData, diagnosisData, pageProgress, diagnosisProgress }: { data: AnyRow; domain: string; setDomain: (domain: "ads" | "vpn" | "quality") => void; unit: FunnelUnit; setUnit: (unit: FunnelUnit) => void; pageData?: AnyRow | null; diagnosisData?: AnyRow | null; pageProgress?: QueryProgressItem; diagnosisProgress?: QueryProgressItem }) {
  const metrics: AnyRow[] = data.metrics ?? [];
  const funnelRows: AnyRow[] = data.funnel ?? [];
  const [dropoffSelection, setDropoffSelection] = useState<DropoffSelection>(() => bestDropoffSelection(funnelRows));
  useEffect(() => { setDropoffSelection(bestDropoffSelection(funnelRows)); }, [data]);
  return <div className="page-stack"><nav className="operational-tabs"><button className={domain === "ads" ? "active" : ""} onClick={() => setDomain("ads")}>广告变现</button><button className={domain === "vpn" ? "active" : ""} onClick={() => setDomain("vpn")}>VPN 功能</button><button className={domain === "quality" ? "active" : ""} onClick={() => setDomain("quality")}>数据质量</button></nav>{domain === "ads" && <nav className="operational-tabs unit-tabs"><button className={unit === "sessions" ? "active" : ""} onClick={() => setUnit("sessions")}>Session 漏斗</button><button className={unit === "users" ? "active" : ""} onClick={() => setUnit("users")}>用户 UV</button><button className={unit === "events" ? "active" : ""} onClick={() => setUnit("events")}>事件次数</button></nav>}<AvailabilityBanner data={data} /><section className="operational-metric-grid">{metrics.map((row) => <MetricCard key={row.metricKey ?? row.name} label={text(row.name)} value={row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))} note={row.detail ?? row.formula} status={row.status} />)}</section><section className="surface"><div className="surface-title"><div><h2>{domain === "vpn" ? "VPN 核心漏斗" : domain === "quality" ? "数据质量门禁" : "广告核心漏斗"}</h2><p>{domain === "vpn" ? "主漏斗按 vpn_session_id 串联；连接尝试细节按 connection_id 下钻" : domain === "ads" ? (unit === "sessions" ? "主漏斗按 session_id 串联，decision/opportunity/request/instance 作为二级诊断键；点击步骤可分析上一环节流失" : unit === "events" ? "按事件 ID 和广告链路 ID 统计次数，用于检查履约链断点；点击步骤可分析上一环节流失" : "按 my_user_id 去重，用于观察用户覆盖；点击步骤可分析上一环节流失") : "不可计算的指标明确显示暂无数据，不补零"}</p></div><span>点击步骤分析流失</span></div><Funnel rows={funnelRows} selectedTransition={dropoffSelection} onSelectTransition={setDropoffSelection} /></section><DropoffAnalysisPanel rows={funnelRows} selection={dropoffSelection} onSelectionChange={setDropoffSelection} pageData={pageData} diagnosisData={diagnosisData} pageProgress={pageProgress} diagnosisProgress={diagnosisProgress} />{data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与 P95</h2><p>按 connection_id 关联真实连接阶段</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{row.available === false ? "暂无数据" : text(row.status)}</td></tr>)}</tbody></table></div></section>}</div>;
}

function GenericPage({ page, data }: { page: FunnelPageKey; data: AnyRow }) {
  if (page === "diagnosis") return <div className="page-stack"><section className="operational-metric-grid"><MetricCard label="起点对象" value={number(data.selection?.start?.count)} /><MetricCard label="到达终点" value={number(data.selection?.end?.count)} /><MetricCard label="链路可关联率" value={percent(data.chainLinkRate)} /><MetricCard label="Unknown 率" value={percent(data.unknownRate)} /></section><section className="surface"><div className="surface-title"><div><h2>流失原因</h2><p>仅统计当前起点至终点区间可证明的失败对象</p></div></div><div className="table-wrap"><table><thead><tr><th>原因</th><th>说明</th><th>对象数</th><th>占比</th></tr></thead><tbody>{(data.reasons ?? []).map((row: AnyRow) => <tr key={row.code ?? row.reason}><td>{text(row.code ?? row.reason)}</td><td>{text(row.label ?? row.description)}</td><td>{number(row.count ?? row.users)}</td><td>{percent(row.share ?? row.rate)}</td></tr>)}</tbody></table></div></section></div>;
  if (page === "cohort") return <section className="surface"><div className="surface-title"><div><h2>异常切片对比</h2><p>按当前维度定位问题集中人群</p></div></div><div className="table-wrap"><table><thead><tr><th>切片</th><th>起点</th><th>终点</th><th>转化率</th><th>变化</th></tr></thead><tbody>{(data.items ?? []).map((row: AnyRow, index: number) => <tr key={row.value ?? index}><td>{text(row.label ?? row.value)}</td><td>{number(row.startCount ?? row.start)}</td><td>{number(row.endCount ?? row.end)}</td><td>{percent(row.conversionRate ?? row.rate)}</td><td>{text(row.deltaPp ?? row.delta)}</td></tr>)}</tbody></table></div></section>;
  if (page === "path") return <div className="page-stack"><section className="surface"><div className="surface-title"><div><h2>页面健康与路径</h2><p>只使用具有有效 session_id 的 screen_view</p></div></div><div className="table-wrap"><table><thead><tr><th>页面</th><th>页面 UV</th><th>进入</th><th>退出</th><th>退出率</th><th>广告机会</th><th>AV</th></tr></thead><tbody>{(data.pages ?? []).map((row: AnyRow) => <tr key={row.screenName}><td>{text(row.screenName)}</td><td>{number(row.pageUsers ?? row.users)}</td><td>{number(row.viewCount ?? row.entries)}</td><td>{number(row.exitCount ?? row.exits)}</td><td>{percent(row.exitRate)}</td><td>{number(row.opportunityUsers)}</td><td>{number(row.impressionUsers)}</td></tr>)}</tbody></table></div></section>{data.limited && <div className="operational-warning">已排除 {number(data.omittedMissingSessionEvents)} 条缺少 session_id 的页面事件。</div>}</div>;
  if (page === "evidence") return <section className="surface"><div className="surface-title"><div><h2>事件证据</h2><p>共 {number(data.total)} 条，异常 {number(data.abnormalTotal)} 条</p></div></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>用户/会话</th><th>业务 ID</th><th>结果</th><th>原因</th><th>来源</th></tr></thead><tbody>{(data.items ?? []).map((row: AnyRow) => <tr key={row.eventId}><td>{text(row.eventTimeUtc ?? row.eventTime)}</td><td><strong>{text(row.eventName)}</strong><small>{text(row.screenName)}</small></td><td>{text(row.myUserId)}<small>{text(row.sessionId)}</small></td><td>{text(row.opportunityId ?? row.requestId ?? row.adInstanceId)}</td><td>{text(row.resultStatus ?? row.qualityStatus)}</td><td>{text(row.errorCode ?? row.blockedReason)}</td><td>{text(row.sourceLabel)}</td></tr>)}</tbody></table></div></section>;
  if (page === "issues") return <section className="surface"><div className="surface-title"><div><h2>问题修复闭环</h2><p>问题必须完成修复、复测、指标验证后才能关闭</p></div></div><div className="table-wrap"><table><thead><tr><th>问题单</th><th>标题</th><th>等级</th><th>负责人</th><th>目标版本</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{(data.items ?? []).map((row: AnyRow) => <tr key={row.issueId}><td>{text(row.issueId)}</td><td>{text(row.title)}</td><td>{text(row.severity)}</td><td>{text(row.ownerId)}</td><td>{text(row.targetVersion)}</td><td>{text(row.status)}</td><td>{text(row.updatedAt)}</td></tr>)}</tbody></table></div></section>;
  return <section className="surface"><div className="surface-title"><div><h2>执行口径快照</h2><p>当前线上漏斗版本与步骤定义</p></div></div><dl className="operational-kv"><div><dt>来源</dt><dd>{text(data.source)}</dd></div><div><dt>版本</dt><dd>{text(data.version?.versionName ?? data.version?.versionId)}</dd></div><div><dt>状态</dt><dd>{text(data.version?.status)}</dd></div></dl><Funnel rows={data.steps} /></section>;
}

export function OperationalFunnel(props: Props) {
  const [dataPackage, setDataPackage] = useState<PackageData>({});
  const [packageErrors, setPackageErrors] = useState<Record<string, string>>({});
  const [progressItems, setProgressItems] = useState<QueryProgressItem[]>([]);
  const [loadedAt, setLoadedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [domain, setDomain] = useState<"ads" | "vpn" | "quality">("ads");
  const [unit, setUnit] = useState<FunnelUnit>("sessions");
  const [workbenchSection, setWorkbenchSection] = useState<"workbench" | "diagnosis" | "path">("workbench");
  const dates = useMemo(() => dateRange(props.range), [props.range]);
  const queryUnit: FunnelUnit = domain === "vpn" ? "sessions" : domain === "ads" ? unit : "users";
  const scope = props.page === "overview" ? "overview" : "project";
  const activePage: FunnelPageKey = props.page === "workbench" ? workbenchSection : props.page;
  const activeKey = packageKey(activePage, scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const data = dataPackage[activeKey] ?? null;
  const packageLabel = scope === "overview" ? "多项目总览" : "核心漏斗、流失诊断、页面路径、证据明细、问题闭环、口径快照";

  useEffect(() => {
    if (!props.enabled) {
      setLoading(true);
      return;
    }
    if (!props.projectCode && scope !== "overview") return;
    let active = true;
    const controllers: AbortController[] = [];
    setLoading(true); setError(""); setDataPackage({}); setPackageErrors({}); setLoadedAt("");
    const baseQuery = { ...dates, projectCode: scope === "overview" ? undefined : props.projectCode, appIdentifier: scope === "overview" ? undefined : props.appIdentifier, platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios", country: props.country === "全部国家" ? undefined : props.country, appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0] };
    const items = buildPackageItems(baseQuery, scope, domain, unit);
    const firstItem = items.find((item) => item.key === activeKey) ?? items[0];
    const restItems = items.filter((item) => item.key !== firstItem?.key);
    setProgressItems(items.map((item) => ({
      key: item.key,
      label: queryItemLabel(item),
      status: item.key === firstItem?.key ? "loading" : "pending",
      dataCountLabel: "数据量待返回",
      dateLabel: queryDateLabel(item.query),
    })));

    const markProgress = (key: string, patch: Partial<QueryProgressItem>) => {
      setProgressItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    };
    const waitRetryDelay = (attempt: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, attempt === 1 ? 1200 : 3200);
    });
    const runItem = async (item: FunnelQueryPackageItem, primary = false) => {
      const maxAttempts = primary ? 2 : 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        markProgress(item.key, {
          status: attempt === 1 ? "loading" : "retrying",
          error: undefined,
          attempt,
          maxAttempts,
          dataCountLabel: "数据量待返回",
          dateLabel: queryDateLabel(item.query),
        });
        setPackageErrors((current) => {
          const next = { ...current };
          delete next[item.key];
          return next;
        });
        const itemController = new AbortController();
        let itemTimedOut = false;
        const itemTimeout = window.setTimeout(() => {
          itemTimedOut = true;
          itemController.abort();
        }, primary ? 45000 : 120000);
        controllers.push(itemController);
        try {
          const result = await queryFunnel<AnyRow>(item.query, itemController.signal);
          if (!active) return;
          const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
          setDataPackage((current) => ({ ...current, [item.key]: result }));
          markProgress(item.key, {
            status: "done",
            finishedAt: now,
            attempt,
            maxAttempts,
            error: undefined,
            dataCountLabel: countLabel(result, item.query.page),
            dateLabel: resultDateLabel(result, item.query),
          });
          if (primary) {
            setLoadedAt(now);
            setLoading(false);
          }
          return;
        } catch (reason) {
          if (!active) return;
          const rawMessage = reason instanceof Error ? reason.message : "未知错误";
          const message = itemTimedOut ? `${queryItemLabel(item)}读取超时` : rawMessage.toLowerCase().includes("abort") ? `${queryItemLabel(item)}查询被中断` : rawMessage;
          window.clearTimeout(itemTimeout);
          if (attempt < maxAttempts) {
            markProgress(item.key, {
              status: "retrying",
              error: `${message}，正在自动重拉`,
              attempt: attempt + 1,
              maxAttempts,
              dataCountLabel: "数据量待返回",
              dateLabel: queryDateLabel(item.query),
            });
            await waitRetryDelay(attempt);
            if (!active) return;
            continue;
          }
          const finalMessage = `${message}，已自动重拉 ${maxAttempts} 次仍失败，请缩小筛选范围或稍后再试`;
          setPackageErrors((current) => ({ ...current, [item.key]: finalMessage }));
          markProgress(item.key, {
            status: "error",
            error: finalMessage,
            attempt,
            maxAttempts,
            dataCountLabel: "查询失败",
            dateLabel: queryDateLabel(item.query),
          });
          if (primary) {
            setError(finalMessage);
            setLoading(false);
          }
          return;
        } finally {
          window.clearTimeout(itemTimeout);
        }
      }
    };

    if (firstItem) {
      runItem(firstItem, true).then(() => {
        if (!active) return;
        restItems.forEach((item) => void runItem(item));
      });
    }
    return () => { active = false; controllers.forEach((controller) => controller.abort()); };
  }, [props.enabled, scope, props.projectCode, props.appIdentifier, props.range, props.platform, props.country, props.appVersion, props.refreshKey, dates, domain, unit, retryKey]);

  if (loading) return <StatePanel kind="loading" message={`正在优先加载当前页面：${packageLabel}。核心页完成后立即展示，其他数据后台继续查询。`}><QueryProgressPanel items={progressItems} compact /></StatePanel>;
  if (error) return <StatePanel kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  const activeProgress = progressItems.find((item) => item.key === activeKey);
  if (!data && (activeProgress?.status === "pending" || activeProgress?.status === "loading" || activeProgress?.status === "retrying")) return <div className="page-stack"><QueryProgressPanel items={progressItems} /><StatePanel kind="loading" message={`${activeProgress.label} ${activeProgress.status === "retrying" ? "正在自动重拉" : "还在后台查询"}，完成后会自动展示。`} /></div>;
  if (!data) return <StatePanel kind={packageErrors[activeKey] ? "error" : "empty"} message={packageErrors[activeKey] || "请调整项目、日期、平台或版本后重新查询。"} retry={packageErrors[activeKey] ? () => setRetryKey((value) => value + 1) : undefined} />;
  const hasRows = props.page === "overview" ? (data.projects?.length ?? 0) > 0 : activePage === "workbench" ? (data.metrics?.length ?? data.funnel?.length ?? 0) > 0 : true;
  const status = <PackageStatusBanner projectCode={props.page === "overview" ? "全部项目" : props.projectCode} range={props.range} dates={dates} loadedAt={loadedAt} partialErrors={packageErrors} progressItems={progressItems} />;
  const progress = <QueryProgressPanel items={progressItems} />;
  const pathKey = packageKey("path", scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const diagnosisKey = packageKey("diagnosis", scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const pageData = dataPackage[pathKey] ?? null;
  const diagnosisData = dataPackage[diagnosisKey] ?? null;
  const pageProgress = progressItems.find((item) => item.key === pathKey);
  const diagnosisProgress = progressItems.find((item) => item.key === diagnosisKey);
  if (!hasRows) return <div className="page-stack">{status}{progress}<StatePanel kind="empty" message="数据包已加载，但当前筛选范围没有可计算的标准事件。" /></div>;
  if (props.page === "overview") return <div className="page-stack">{status}{progress}<Overview data={data} onPageChange={props.onPageChange} context={{ projectCode: "全部项目", range: props.range, dates, loadedAt }} /></div>;
  if (props.page === "workbench") return <div className="page-stack">{status}{progress}<nav className="operational-tabs workbench-tabs"><button className={workbenchSection === "workbench" ? "active" : ""} onClick={() => setWorkbenchSection("workbench")}>核心漏斗</button><button className={workbenchSection === "diagnosis" ? "active" : ""} onClick={() => setWorkbenchSection("diagnosis")}>流失诊断</button><button className={workbenchSection === "path" ? "active" : ""} onClick={() => setWorkbenchSection("path")}>页面路径</button></nav>{workbenchSection === "workbench" ? <Workbench data={data} domain={domain} setDomain={setDomain} unit={unit} setUnit={setUnit} pageData={pageData} diagnosisData={diagnosisData} pageProgress={pageProgress} diagnosisProgress={diagnosisProgress} /> : <GenericPage page={workbenchSection} data={data} />}</div>;
  return <div className="page-stack">{status}{progress}<GenericPage page={props.page} data={data} /></div>;
}
