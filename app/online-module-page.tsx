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
    { metric: "连接尝试成功率", formula: "connect_success / connect_start", source: "V1.8 VPN 事件", fields: "connection_id、vpn_session_id、result", purpose: "判断一次真实连接尝试是否成功", abnormal: "按失败阶段 DNS/TCP/TLS/协议握手拆原因" },
    { metric: "会话最终成功率", formula: "最终成功 vpn_session_id / 发起会话 vpn_session_id", source: "VPN 会话聚合", fields: "vpn_session_id、final_result、attempt_index", purpose: "避免多次重试把一次用户会话算乱", abnormal: "查协议回退、重连、节点切换是否恢复" },
    { metric: "连接前后 IP 变化率", formula: "ip_before_connect != ip_after_connect 的成功会话 / 双端可得会话", source: "VPN IP 状态事件 + 中台明文IP", fields: "ip_before_status、ip_after_status、ip_changed", purpose: "确认 VPN 是否真正切出到目标出口", abnormal: "查节点不可用、出口 IP 被封、DNS 下发失败" },
    { metric: "连接后广告覆盖", formula: "连接成功后广告 AV / 连接成功用户", source: "VPN × 广告关联链", fields: "vpn_session_id、connection_id、jk_ad_impression", purpose: "看 VPN 体验是否影响广告变现", abnormal: "查连接后页面、after IP 状态、广告请求是否携带会话ID" },
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

  if (loading) return <State kind="loading" message="正在优先读取线上 DWS 汇总表；只有证据链才读取明细。" />;
  if (error) return <State kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  if (!data) return <State kind="empty" message="当前页面没有返回数据。" />;

  const availability = data.dataAvailability ?? {};
  return <div className="page-stack online-module-page">
    <section className="surface online-module-hero"><div><div className="eyebrow">实时查询 · 线上接口 · {data.querySource ?? "backend"}</div><h2>{config.title}</h2><p>{config.hint}</p></div><div><span>{props.project}</span><strong>{props.range} · {props.platform} · {props.country}</strong><small>{props.appVersion} · 刷新后即时请求</small></div></section>
    {availability.dwsFunnelAvailable === false && <section className="surface operational-warning"><div className="surface-title"><div><h2>当前项目暂无 DWS 标准事件汇总</h2><p>{text(availability.reason)}</p></div><span>{availability.adMobAvailable ? "AdMob 有数据" : "无标准事件"}</span></div><div className="inline-empty">{(availability.suggestions ?? []).join("；") || "请检查 Firebase 同步、DWD 入库和 DWS ETL。"}</div></section>}
    <SourceContract module={props.module} data={data} />
    <MetricCards data={data} module={props.module} />
    <MetricFormulaBoard module={props.module} />
    {props.module === "global" ? <section className="surface"><div className="surface-title"><div><h2>线上项目列表</h2><p>来自 Firebase 绑定项目与 DWS 汇总表</p></div></div><ProjectTable rows={data.projects} /></section> : <section className="surface"><div className="surface-title"><div><h2>{props.module === "vpn" ? "VPN 核心漏斗" : props.module === "firebase" || props.module === "reconcile" ? "数据质量指标" : "广告核心漏斗"}</h2><p>{data.dataNotice ?? "按当前筛选口径查询线上数据"}</p></div></div>{props.module === "firebase" || props.module === "reconcile" ? <MetricsTable rows={data.metrics} /> : <FunnelTable rows={data.funnel} />}</section>}
    {props.module === "vpn" && data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与耗时</h2><p>按 V1.8 VPN 弱网专项汇总</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{text(row.status)}</td></tr>)}</tbody></table></div></section>}
    <DiagnosticLensBoard module={props.module} />
    <DiagnosticPlaybook module={props.module} onOpenModule={props.onOpenModule} onOpenDialog={props.onOpenDialog} />
    <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>指标明细</h2><p>运营可直接复制指标名给技术排查</p></div></div><MetricsTable rows={data.metrics} /></div><aside className="surface"><div className="surface-title"><div><h2>下一步动作</h2><p>每个按钮都跳到可用页面</p></div></div><div className="technical-actions"><button onClick={() => props.onOpenModule("funnel")}><strong>进入漏斗工作台</strong><span>查看核心漏斗 / 流失诊断 / 页面路径</span></button><button onClick={() => props.onOpenModule("tracking")}><strong>打点验收</strong><span>验证 P0 事件、参数和关联链</span></button><button onClick={() => props.onOpenModule("tasks")}><strong>任务与告警</strong><span>查看同步任务和接口错误</span></button><button onClick={() => props.onOpenDialog(props.module === "admob" ? "admob-report" : "diagnosis")}><strong>创建任务</strong><span>冻结当前筛选和证据范围</span></button></div></aside></section>
  </div>;
}
