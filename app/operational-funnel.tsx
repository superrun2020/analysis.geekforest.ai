"use client";

import { useEffect, useMemo, useState } from "react";
import { queryFunnel, type FunnelPageKey } from "./funnel-analysis-api";

type Props = {
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
const number = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${number(value)}%`;
const money = (value: unknown) => value === null || value === undefined ? "—" : `$${number(value)}`;
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

function dateRange(range: string) {
  const end = new Date();
  const start = new Date(end);
  if (range === "昨天") start.setDate(start.getDate() - 1), end.setDate(end.getDate() - 1);
  if (range === "近7天") start.setDate(start.getDate() - 6);
  if (range === "近30天") start.setDate(start.getDate() - 29);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { dateFrom: iso(start), dateTo: iso(end) };
}

function StatePanel({ kind, message, retry }: { kind: "loading" | "empty" | "error"; message: string; retry?: () => void }) {
  return <section className={`surface operational-state ${kind}`}><span>{kind === "loading" ? "同步" : kind === "empty" ? "空" : "!"}</span><div><h2>{kind === "loading" ? "正在读取线上数据" : kind === "empty" ? "当前筛选范围没有数据" : "数据读取失败"}</h2><p>{message}</p>{retry && <button onClick={retry}>重新加载</button>}</div></section>;
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

function Overview({ data, onPageChange }: { data: AnyRow; onPageChange: Props["onPageChange"] }) {
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
    <section className="surface"><div className="surface-title"><div><h2>广告用户覆盖主漏斗</h2><p>真实 ADB 标准事件按用户去重</p></div></div><Funnel rows={data.funnel} /></section>
  </div>;
}

function Workbench({ data, domain, setDomain }: { data: AnyRow; domain: string; setDomain: (domain: "ads" | "vpn" | "quality") => void }) {
  const metrics: AnyRow[] = data.metrics ?? [];
  return <div className="page-stack"><nav className="operational-tabs"><button className={domain === "ads" ? "active" : ""} onClick={() => setDomain("ads")}>广告变现</button><button className={domain === "vpn" ? "active" : ""} onClick={() => setDomain("vpn")}>VPN 功能</button><button className={domain === "quality" ? "active" : ""} onClick={() => setDomain("quality")}>数据质量</button></nav><section className="operational-metric-grid">{metrics.map((row) => <MetricCard key={row.metricKey ?? row.name} label={text(row.name)} value={row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))} note={row.detail ?? row.formula} status={row.status} />)}</section><section className="surface"><div className="surface-title"><div><h2>{domain === "vpn" ? "VPN 核心漏斗" : domain === "quality" ? "数据质量门禁" : "广告核心漏斗"}</h2><p>不可计算的指标明确显示暂无数据，不补零</p></div></div><Funnel rows={data.funnel} /></section>{data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与 P95</h2><p>按 connection_id 关联真实连接阶段</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{row.available === false ? "暂无数据" : text(row.status)}</td></tr>)}</tbody></table></div></section>}</div>;
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
  const [data, setData] = useState<AnyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [domain, setDomain] = useState<"ads" | "vpn" | "quality">("ads");
  const [workbenchSection, setWorkbenchSection] = useState<"workbench" | "diagnosis" | "path">("workbench");
  const dates = useMemo(() => dateRange(props.range), [props.range]);
  const effectivePage: FunnelPageKey = props.page === "workbench" ? workbenchSection : props.page;

  useEffect(() => {
    if (!props.projectCode && props.page !== "overview") return;
    const controller = new AbortController();
    setLoading(true); setError("");
    queryFunnel({ page: effectivePage, ...dates, projectCode: props.page === "overview" ? undefined : props.projectCode, appIdentifier: props.page === "overview" ? undefined : props.appIdentifier, platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios", country: props.country === "全部国家" ? undefined : props.country, appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0], domain, unit: "users", evidenceMode: "ad", pageSize: 100 }, controller.signal)
      .then(setData).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "未知错误"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.page, props.projectCode, props.appIdentifier, props.range, props.platform, props.country, props.appVersion, props.refreshKey, dates, domain, effectivePage, retryKey]);

  if (loading) return <StatePanel kind="loading" message="正在从 ADB/Firebase 标准事件和问题控制表聚合当前筛选范围。" />;
  if (error) return <StatePanel kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  if (!data) return <StatePanel kind="empty" message="请调整项目、日期、平台或版本后重新查询。" />;
  const hasRows = props.page === "overview" ? (data.projects?.length ?? 0) > 0 : props.page === "workbench" ? (data.metrics?.length ?? data.funnel?.length ?? 0) > 0 : true;
  if (!hasRows) return <StatePanel kind="empty" message="接口连接正常，但当前筛选范围没有可计算的标准事件。" />;
  if (props.page === "overview") return <Overview data={data} onPageChange={props.onPageChange} />;
  if (props.page === "workbench") return <div className="page-stack"><nav className="operational-tabs workbench-tabs"><button className={workbenchSection === "workbench" ? "active" : ""} onClick={() => setWorkbenchSection("workbench")}>核心漏斗</button><button className={workbenchSection === "diagnosis" ? "active" : ""} onClick={() => setWorkbenchSection("diagnosis")}>流失诊断</button><button className={workbenchSection === "path" ? "active" : ""} onClick={() => setWorkbenchSection("path")}>页面路径</button></nav>{workbenchSection === "workbench" ? <Workbench data={data} domain={domain} setDomain={setDomain} /> : <GenericPage page={workbenchSection} data={data} />}</div>;
  return <GenericPage page={props.page} data={data} />;
}
