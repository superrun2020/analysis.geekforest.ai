"use client";

import { useEffect, useMemo, useState } from "react";
import { queryFunnel } from "./funnel-analysis-api";
import type { OnlineProject } from "./project-options-api";
import type { DialogKey } from "./action-dialog";

type ModuleKey = "global" | "project" | "vpn" | "admob" | "firebase" | "reconcile";
type AnyRow = Record<string, any>;

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

function FunnelTable({ rows = [] }: { rows?: AnyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>步骤</th><th>事件</th><th>对象数</th><th>转化率</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.stepCode ?? row.code ?? index}><td><strong>{index + 1}. {text(row.name ?? row.stepName ?? row.label)}</strong></td><td><code>{text(row.eventName ?? row.event)}</code></td><td>{row.available === false ? "暂无数据" : number(row.count ?? row.value)}</td><td>{row.available === false ? "—" : percent(row.conversionRate)}</td><td>{row.available === false ? text(row.unavailableReason) : text(row.status ?? "可计算")}</td></tr>) : <tr><td colSpan={5}><div className="empty-table-state"><strong>暂无漏斗步骤</strong><span>当前筛选范围没有可计算的标准事件。</span></div></td></tr>}</tbody></table></div>;
}

function ProjectTable({ rows = [] }: { rows?: AnyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>项目</th><th>DAU</th><th>AV</th><th>浏览者比例</th><th>机会覆盖</th><th>收入</th><th>数据状态</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.projectCode}><td><strong>{text(row.projectCode)}</strong><small>{text(row.appName || row.appIdentifier)}</small></td><td>{number(row.dauUsers)}</td><td>{number(row.impressionUsers)}</td><td>{percent(row.adViewerRate)}</td><td>{percent(row.opportunityCoverage)}</td><td>{money(row.revenue)}</td><td>{text(row.statusReason || row.status)}</td></tr>) : <tr><td colSpan={7}><div className="empty-table-state"><strong>暂无项目汇总</strong><span>请检查 Firebase 配置、DWS ETL 或日期范围。</span></div></td></tr>}</tbody></table></div>;
}

function MetricsTable({ rows = [] }: { rows?: AnyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>指标</th><th>值</th><th>公式</th><th>来源</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.metricKey ?? row.name}><td><strong>{text(row.name)}</strong><small>{text(row.metricKey)}</small></td><td>{row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))}</td><td>{text(row.formula)}</td><td>{text(row.source)}</td><td>{text(row.statusReason ?? row.status)}</td></tr>) : <tr><td colSpan={5}><div className="empty-table-state"><strong>暂无指标</strong><span>接口正常，但当前维度没有可计算指标。</span></div></td></tr>}</tbody></table></div>;
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

  if (loading) return <State kind="loading" message="正在优先读取线上 DWS 汇总表；只有证据链才读取明细。" />;
  if (error) return <State kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  if (!data) return <State kind="empty" message="当前页面没有返回数据。" />;

  const availability = data.dataAvailability ?? {};
  return <div className="page-stack online-module-page">
    <section className="surface online-module-hero"><div><div className="eyebrow">实时查询 · 线上接口 · {data.querySource ?? "backend"}</div><h2>{config.title}</h2><p>{config.hint}</p></div><div><span>{props.project}</span><strong>{props.range} · {props.platform} · {props.country}</strong><small>{props.appVersion} · 刷新后即时请求</small></div></section>
    {availability.dwsFunnelAvailable === false && <section className="surface operational-warning"><div className="surface-title"><div><h2>当前项目暂无 DWS 标准事件汇总</h2><p>{text(availability.reason)}</p></div><span>{availability.adMobAvailable ? "AdMob 有数据" : "无标准事件"}</span></div><div className="inline-empty">{(availability.suggestions ?? []).join("；") || "请检查 Firebase 同步、DWD 入库和 DWS ETL。"}</div></section>}
    <SourceContract module={props.module} data={data} />
    <MetricCards data={data} module={props.module} />
    {props.module === "global" ? <section className="surface"><div className="surface-title"><div><h2>线上项目列表</h2><p>来自 Firebase 绑定项目与 DWS 汇总表</p></div></div><ProjectTable rows={data.projects} /></section> : <section className="surface"><div className="surface-title"><div><h2>{props.module === "vpn" ? "VPN 核心漏斗" : props.module === "firebase" || props.module === "reconcile" ? "数据质量指标" : "广告核心漏斗"}</h2><p>{data.dataNotice ?? "按当前筛选口径查询线上数据"}</p></div></div>{props.module === "firebase" || props.module === "reconcile" ? <MetricsTable rows={data.metrics} /> : <FunnelTable rows={data.funnel} />}</section>}
    {props.module === "vpn" && data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与耗时</h2><p>按 V1.8 VPN 弱网专项汇总</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{text(row.status)}</td></tr>)}</tbody></table></div></section>}
    <DiagnosticPlaybook module={props.module} onOpenModule={props.onOpenModule} onOpenDialog={props.onOpenDialog} />
    <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>指标明细</h2><p>运营可直接复制指标名给技术排查</p></div></div><MetricsTable rows={data.metrics} /></div><aside className="surface"><div className="surface-title"><div><h2>下一步动作</h2><p>每个按钮都跳到可用页面</p></div></div><div className="technical-actions"><button onClick={() => props.onOpenModule("funnel")}><strong>进入漏斗工作台</strong><span>查看核心漏斗 / 流失诊断 / 页面路径</span></button><button onClick={() => props.onOpenModule("tracking")}><strong>打点验收</strong><span>验证 P0 事件、参数和关联链</span></button><button onClick={() => props.onOpenModule("tasks")}><strong>任务与告警</strong><span>查看同步任务和接口错误</span></button><button onClick={() => props.onOpenDialog(props.module === "admob" ? "admob-report" : "diagnosis")}><strong>创建任务</strong><span>冻结当前筛选和证据范围</span></button></div></aside></section>
  </div>;
}
