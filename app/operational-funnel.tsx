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
type QueryProgressStatus = "pending" | "loading" | "done" | "error";
type QueryProgressItem = { key: string; label: string; status: QueryProgressStatus; finishedAt?: string; error?: string };
const number = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${number(value)}%`;
const money = (value: unknown) => value === null || value === undefined ? "—" : `$${number(value)}`;
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

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

function QueryProgressPanel({ items, compact = false }: { items: QueryProgressItem[]; compact?: boolean }) {
  if (!items.length) return null;
  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "error").length;
  const loading = items.find((item) => item.status === "loading");
  return <section className={`query-progress-panel ${compact ? "compact" : ""}`}>
    <div className="query-progress-title"><div><strong>查询进度</strong><small>{loading ? `正在查询：${loading.label}` : doneCount === items.length ? "全部数据查询完成" : "等待后台补齐剩余数据"}</small></div><span>{doneCount}/{items.length} 完成{failedCount ? ` · ${failedCount} 失败` : ""}</span></div>
    <div className="query-progress-list">{items.map((item) => <div key={item.key} className={item.status}><i>{item.status === "done" ? "✓" : item.status === "error" ? "!" : item.status === "loading" ? "…" : "○"}</i><span>{item.label}</span><small>{item.status === "done" ? `${item.finishedAt || "刚刚"} 完成` : item.status === "error" ? item.error || "查询失败" : item.status === "loading" ? "查询中" : "待查询"}</small></div>)}</div>
  </section>;
}

function MetricCard({ label, value, note, status }: { label: string; value: string; note?: string; status?: string }) {
  const tone = status === "critical" || status === "bad" ? "bad" : status === "warning" || status === "warn" ? "warn" : status === "good" ? "good" : "";
  return <article className={`operational-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note || "当前筛选口径"}</small></article>;
}

function Funnel({ rows = [] }: { rows?: AnyRow[] }) {
  if (!rows.length) return <div className="inline-empty">当前范围没有可用漏斗步骤</div>;
  const max = Math.max(...rows.map((row) => Number(row.count ?? row.value ?? 0)), 1);
  return <div className="operational-funnel-list">{rows.map((row, index) => {
    const value = Number(row.count ?? row.value ?? 0);
    const available = row.available !== false;
    return <button key={row.stepCode ?? row.code ?? row.name ?? index} disabled={!available}><span>{index + 1}</span><div><strong>{text(row.name ?? row.stepName ?? row.label)}</strong><small>{text(row.eventName ?? row.event)}</small></div><em>{available ? number(value) : "暂无数据"}</em><b>{row.conversionRate === null || row.conversionRate === undefined ? "—" : percent(row.conversionRate)}</b><i style={{ width: `${available ? Math.max(4, value / max * 100) : 0}%` }} /></button>;
  })}</div>;
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

function Workbench({ data, domain, setDomain, unit, setUnit }: { data: AnyRow; domain: string; setDomain: (domain: "ads" | "vpn" | "quality") => void; unit: FunnelUnit; setUnit: (unit: FunnelUnit) => void }) {
  const metrics: AnyRow[] = data.metrics ?? [];
  return <div className="page-stack"><nav className="operational-tabs"><button className={domain === "ads" ? "active" : ""} onClick={() => setDomain("ads")}>广告变现</button><button className={domain === "vpn" ? "active" : ""} onClick={() => setDomain("vpn")}>VPN 功能</button><button className={domain === "quality" ? "active" : ""} onClick={() => setDomain("quality")}>数据质量</button></nav>{domain === "ads" && <nav className="operational-tabs unit-tabs"><button className={unit === "sessions" ? "active" : ""} onClick={() => setUnit("sessions")}>Session 漏斗</button><button className={unit === "users" ? "active" : ""} onClick={() => setUnit("users")}>用户 UV</button><button className={unit === "events" ? "active" : ""} onClick={() => setUnit("events")}>事件次数</button></nav>}<AvailabilityBanner data={data} /><section className="operational-metric-grid">{metrics.map((row) => <MetricCard key={row.metricKey ?? row.name} label={text(row.name)} value={row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))} note={row.detail ?? row.formula} status={row.status} />)}</section><section className="surface"><div className="surface-title"><div><h2>{domain === "vpn" ? "VPN 核心漏斗" : domain === "quality" ? "数据质量门禁" : "广告核心漏斗"}</h2><p>{domain === "vpn" ? "主漏斗按 vpn_session_id 串联；连接尝试细节按 connection_id 下钻" : domain === "ads" ? (unit === "sessions" ? "主漏斗按 session_id 串联，decision/opportunity/request/instance 作为二级诊断键" : unit === "events" ? "按事件 ID 和广告链路 ID 统计次数，用于检查履约链断点" : "按 my_user_id 去重，用于观察用户覆盖") : "不可计算的指标明确显示暂无数据，不补零"}</p></div></div><Funnel rows={data.funnel} /></section>{data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与 P95</h2><p>按 connection_id 关联真实连接阶段</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{row.available === false ? "暂无数据" : text(row.status)}</td></tr>)}</tbody></table></div></section>}</div>;
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
    let timedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
    setLoading(true); setError(""); setDataPackage({}); setPackageErrors({}); setLoadedAt("");
    const baseQuery = { ...dates, projectCode: scope === "overview" ? undefined : props.projectCode, appIdentifier: scope === "overview" ? undefined : props.appIdentifier, platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios", country: props.country === "全部国家" ? undefined : props.country, appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0] };
    const items = buildPackageItems(baseQuery, scope, domain, unit);
    const firstItem = items.find((item) => item.key === activeKey) ?? items[0];
    const restItems = items.filter((item) => item.key !== firstItem?.key);
    setProgressItems(items.map((item) => ({ key: item.key, label: queryItemLabel(item), status: item.key === firstItem?.key ? "loading" : "pending" })));

    const markProgress = (key: string, patch: Partial<QueryProgressItem>) => {
      setProgressItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    };
    const runItem = async (item: FunnelQueryPackageItem, primary = false) => {
      markProgress(item.key, { status: "loading", error: undefined });
      try {
        const result = await queryFunnel<AnyRow>(item.query, controller.signal);
        if (!active) return;
        const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        setDataPackage((current) => ({ ...current, [item.key]: result }));
        markProgress(item.key, { status: "done", finishedAt: now });
        if (primary) {
          setLoadedAt(now);
          setLoading(false);
        }
      } catch (reason) {
        if (!active) return;
        const message = timedOut ? "读取超时，请重试或缩小筛选范围" : reason instanceof Error ? reason.message : "未知错误";
        setPackageErrors((current) => ({ ...current, [item.key]: message }));
        markProgress(item.key, { status: "error", error: message });
        if (primary) {
          setError(message);
          setLoading(false);
        }
      }
    };

    if (firstItem) {
      runItem(firstItem, true).then(() => {
        if (!active) return;
        restItems.forEach((item) => void runItem(item));
      });
    }
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [props.enabled, scope, props.projectCode, props.appIdentifier, props.range, props.platform, props.country, props.appVersion, props.refreshKey, dates, domain, unit, retryKey]);

  if (loading) return <StatePanel kind="loading" message={`正在优先加载当前页面：${packageLabel}。核心页完成后立即展示，其他数据后台继续查询。`}><QueryProgressPanel items={progressItems} compact /></StatePanel>;
  if (error) return <StatePanel kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  const activeProgress = progressItems.find((item) => item.key === activeKey);
  if (!data && (activeProgress?.status === "pending" || activeProgress?.status === "loading")) return <div className="page-stack"><QueryProgressPanel items={progressItems} /><StatePanel kind="loading" message={`${activeProgress.label} 还在后台查询，完成后会自动展示。`} /></div>;
  if (!data) return <StatePanel kind={packageErrors[activeKey] ? "error" : "empty"} message={packageErrors[activeKey] || "请调整项目、日期、平台或版本后重新查询。"} retry={packageErrors[activeKey] ? () => setRetryKey((value) => value + 1) : undefined} />;
  const hasRows = props.page === "overview" ? (data.projects?.length ?? 0) > 0 : activePage === "workbench" ? (data.metrics?.length ?? data.funnel?.length ?? 0) > 0 : true;
  const status = <PackageStatusBanner projectCode={props.page === "overview" ? "全部项目" : props.projectCode} range={props.range} dates={dates} loadedAt={loadedAt} partialErrors={packageErrors} progressItems={progressItems} />;
  const progress = <QueryProgressPanel items={progressItems} />;
  if (!hasRows) return <div className="page-stack">{status}{progress}<StatePanel kind="empty" message="数据包已加载，但当前筛选范围没有可计算的标准事件。" /></div>;
  if (props.page === "overview") return <div className="page-stack">{status}{progress}<Overview data={data} onPageChange={props.onPageChange} context={{ projectCode: "全部项目", range: props.range, dates, loadedAt }} /></div>;
  if (props.page === "workbench") return <div className="page-stack">{status}{progress}<nav className="operational-tabs workbench-tabs"><button className={workbenchSection === "workbench" ? "active" : ""} onClick={() => setWorkbenchSection("workbench")}>核心漏斗</button><button className={workbenchSection === "diagnosis" ? "active" : ""} onClick={() => setWorkbenchSection("diagnosis")}>流失诊断</button><button className={workbenchSection === "path" ? "active" : ""} onClick={() => setWorkbenchSection("path")}>页面路径</button></nav>{workbenchSection === "workbench" ? <Workbench data={data} domain={domain} setDomain={setDomain} unit={unit} setUnit={setUnit} /> : <GenericPage page={workbenchSection} data={data} />}</div>;
  return <div className="page-stack">{status}{progress}<GenericPage page={props.page} data={data} /></div>;
}
