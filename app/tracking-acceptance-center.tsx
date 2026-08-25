"use client";

import { useEffect, useMemo, useState } from "react";
import { acceptanceApi, type AcceptanceDetail, type AcceptanceFieldCoverage, type AcceptanceRun } from "./tracking-acceptance-api";
import { trackingEventCatalog, type TrackingCatalogEvent, type TrackingConfigRecord } from "./tracking-config-data";
import type { V18EventParameter } from "./v18-event-catalog";

type TrackingProjectOption = { code: string; name: string; category?: string; appIdentifier?: string };

function normalizePlatform(value: string): "Android" | "iOS" {
  return value.toLowerCase() === "ios" ? "iOS" : "Android";
}

function parseVersion(value: string) {
  if (!value || value === "全部版本") return { appVersion: "", buildNumber: "" };
  const match = value.match(/^(.+?)\s*\(([^)]+)\)$/);
  return match ? { appVersion: match[1].trim(), buildNumber: match[2].trim() } : { appVersion: value, buildNumber: "" };
}

const pageTrackingEventNames = new Set(["screen_view", "screen_exit", "element_click", "core_action", "app_background", "app_start_complete"]);
const pageResultFailures = new Set(["PARAM_INVALID", "CHAIN_INVALID", "NOT_RECEIVED"]);
const commonTrackingFields: V18EventParameter[] = [
  { name: "event_id", displayName: "事件唯一ID", dataType: "str", reportingMode: "P0｜每次触发", description: "所有事件必带；用于去重、隔离表和端到端追踪。" },
  { name: "session_id", displayName: "App会话ID", dataType: "str", reportingMode: "P0｜每次触发", description: "公共字段；用于串联页面路径、广告链路和App前后台。" },
  { name: "my_user_id", displayName: "内部用户ID", dataType: "str", reportingMode: "P0｜每次触发", description: "公共字段；用户级UV、AV和漏斗去重分母。" },
  { name: "logged_at_ms", displayName: "客户端事件时间", dataType: "int", reportingMode: "P0｜每次触发", description: "公共字段；用于排序、窗口关联和计算页面停留/链路耗时。" },
  { name: "screen_name", displayName: "当前页面", dataType: "str", reportingMode: "页面事件P0/上下文P1", description: "页面分析核心字段；广告、点击和核心动作建议带页面上下文。" },
  { name: "screen_view_id", displayName: "页面访问ID", dataType: "str", reportingMode: "页面事件P0", description: "同一次页面访问内保持不变；screen_view 与 screen_exit 的关联键。" },
  { name: "app_version", displayName: "App版本", dataType: "str", reportingMode: "P0｜每次触发", description: "公共字段；用于判断某版本是否漏打或变差。" },
  { name: "build_number", displayName: "构建号", dataType: "str", reportingMode: "P1｜每次触发", description: "公共字段；用于灰度包和构建级回归。" },
  { name: "platform", displayName: "平台", dataType: "str", reportingMode: "P0｜每次触发", description: "Android/iOS 分析与验收分组。" },
  { name: "country", displayName: "国家", dataType: "str", reportingMode: "P1｜每次触发", description: "国家维度；俄罗斯/伊朗弱网分析重点字段。" },
];

const pageTrackingChecks = [
  {
    key: "screen_view",
    name: "页面进入 / 页面展示",
    eventName: "screen_view",
    fields: "screen_name(P0)、screen_view_id(P0)、session_id(公共字段)",
    location: "Navigation destination / Compose LaunchedEffect / Fragment 首次可见",
    rule: "页面真正可见时必须收到；页面路径的基础分母来自它。",
    impact: "没有它，页面UV、页面到达率、页面广告场景覆盖都算不出来。",
  },
  {
    key: "screen_exit",
    name: "页面离开",
    eventName: "screen_exit",
    fields: "screen_view_id(P0)、screen_name、next_screen、exit_action、screen_duration_ms、app_state",
    location: "Navigation 离开监听 / Fragment.onDestroyView / Compose DisposableEffect",
    rule: "每次有效页面访问结束一次；必须能通过 screen_view_id 关联进入事件。",
    impact: "没有它，页面停留、退出路径、用户离页导致广告损耗无法归因。",
  },
  {
    key: "element_click",
    name: "元素点击",
    eventName: "element_click",
    fields: "element_name、action_name、screen_name(页面上下文)、session_id",
    location: "统一 UI 点击代理层 / Compose clickable / View.OnClickListener 封装",
    rule: "用户真实点击、滑动或切 Tab 时上报；禁止用动态文案做 element_name。",
    impact: "没有它，首页按钮、VPN按钮、广告触发入口的点击转化无法分析。",
  },
  {
    key: "core_action",
    name: "核心动作终态",
    eventName: "core_action",
    fields: "action_name、action_result、duration_ms、error_code(失败时)、screen_name(页面上下文)",
    location: "业务 UseCase / Repository 最终成功或失败回调",
    rule: "不能在按钮点击时认定成功；必须等业务动作形成终态。",
    impact: "没有它，页面点击后到底业务有没有完成会断层。",
  },
  {
    key: "app_background",
    name: "当前页面后台上下文",
    eventName: "app_background",
    fields: "current_screen、session_duration_ms、background_reason、pending_ad_count",
    location: "App lifecycle observer；不得用 screen_exit 代替 App 后台",
    rule: "App 进入后台时要带最后可见页面 current_screen。",
    impact: "没有它，无法区分用户离开页面和整个 App 进入后台。",
  },
  {
    key: "app_start_complete",
    name: "启动到首屏",
    eventName: "app_start_complete",
    fields: "first_screen、duration_ms、start_type、success/error_code",
    location: "必要 SDK 初始化完成且首屏可交互处",
    rule: "冷启动/暖启动完成都要形成终态，失败也要上报。",
    impact: "没有它，无法判断 A054 是没到页面，还是到了页面但 screen_view 没打。",
  },
];

function normalizeEventName(value?: string) {
  return (value ?? "").replace(/^jk_/, "");
}

function matchesPageTrackingEvent(value?: string) {
  const normalized = normalizeEventName(value);
  return pageTrackingEventNames.has(normalized);
}

function resultTone(status?: string): "neutral" | "good" | "warn" | "bad" | "blue" {
  if (status === "PASSED") return "good";
  if (status && pageResultFailures.has(status)) return "bad";
  if (status === "PENDING") return "warn";
  return "neutral";
}

function fieldListIncludes(values: string[], fieldName: string) {
  const target = fieldName.trim();
  return values.some((value) => {
    const item = String(value ?? "").trim();
    return item === target || item.startsWith(`${target}:`) || item.startsWith(`${target}：`) || item.includes(`'${target}'`) || item.includes(`"${target}"`);
  });
}

function uniqueFieldOptions(event?: TrackingCatalogEvent) {
  const map = new Map<string, V18EventParameter>();
  [...(event?.parameters ?? []), ...commonTrackingFields].forEach((field) => {
    if (!map.has(field.name)) map.set(field.name, field);
  });
  return Array.from(map.values());
}

function formatCoverageRate(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function buildBackendFieldResult(data: AcceptanceFieldCoverage) {
  const status = data.status ?? "UNKNOWN";
  const tone: ReturnType<typeof resultTone> =
    status === "REPORTED" ? "good" :
      status === "INVALID" || status === "MISSING" || status === "EVENT_NOT_RECEIVED" ? "bad" :
        status === "NOT_CONFIGURED" ? "warn" : "neutral";
  const title =
    status === "REPORTED" ? "字段已上报" :
      status === "INVALID" ? "字段已上报但格式错误" :
        status === "MISSING" ? "字段未上报 / 缺失" :
          status === "EVENT_NOT_RECEIVED" ? "事件未收到，字段自然没有数据" :
            status === "NOT_CONFIGURED" ? "字段不在当前验收配置" : "字段状态待确认";
  return {
    source: "backend" as const,
    tone,
    title,
    status,
    description: data.message || "来自后端字段级覆盖查询，优先级高于页面本地粗判。",
    eventReceivedCount: data.eventReceivedCount,
    presentCount: data.presentCount,
    missingCount: data.missingCount,
    invalidCount: data.invalidCount,
    coverageRate: data.coverageRate,
    lastReceivedAt: data.lastReceivedAt,
    sampleValues: data.sampleValues ?? [],
  };
}

function inferLocalFieldResult(detail: AcceptanceDetail | null, eventName: string, fieldName: string, event?: TrackingCatalogEvent) {
  const detailEvent = detail?.events.find((item) => normalizeEventName(item.eventName) === normalizeEventName(eventName));
  const knownField = uniqueFieldOptions(event).find((field) => field.name === fieldName);
  if (!detail) {
    return { source: "local" as const, tone: "neutral" as const, title: "待创建或选择验收 Run", status: "NEED_RUN", description: "创建 Run 后才能判断字段是否随事件进入 Firebase/ADB。", eventReceivedCount: undefined, presentCount: undefined, missingCount: undefined, invalidCount: undefined, coverageRate: undefined, lastReceivedAt: undefined, sampleValues: [] };
  }
  if (!event || !knownField) {
    return { source: "local" as const, tone: "warn" as const, title: "字段不在当前配置字典", status: "NOT_CONFIGURED", description: "请确认字段名是否属于 V1.8 当前配置；如果是新字段，需要先进入规范与配置发布新快照。", eventReceivedCount: detailEvent?.receivedCount, presentCount: undefined, missingCount: undefined, invalidCount: undefined, coverageRate: undefined, lastReceivedAt: detailEvent?.lastReceivedAt, sampleValues: [] };
  }
  if (!detailEvent || detailEvent.receivedCount <= 0) {
    return { source: "local" as const, tone: "bad" as const, title: "事件未收到，字段没有上报进来", status: "EVENT_NOT_RECEIVED", description: `当前 Run 没收到 ${eventName}，所以 ${fieldName} 不可能进入字段统计。先让测试机触发对应页面/动作。`, eventReceivedCount: detailEvent?.receivedCount ?? 0, presentCount: 0, missingCount: undefined, invalidCount: undefined, coverageRate: 0, lastReceivedAt: detailEvent?.lastReceivedAt, sampleValues: [] };
  }
  if (fieldListIncludes(detailEvent.missingParams, fieldName)) {
    return { source: "local" as const, tone: "bad" as const, title: "字段缺失", status: "MISSING", description: "当前 Run 的参数校验已经把这个字段列为缺失；需要回到对应 Provider 或 Context 注入位置补传。", eventReceivedCount: detailEvent.receivedCount, presentCount: 0, missingCount: detailEvent.receivedCount, invalidCount: 0, coverageRate: 0, lastReceivedAt: detailEvent.lastReceivedAt, sampleValues: [] };
  }
  if (fieldListIncludes(detailEvent.invalidParams, fieldName)) {
    return { source: "local" as const, tone: "bad" as const, title: "字段已出现但格式/枚举错误", status: "INVALID", description: "字段可能已经上报，但类型、枚举、长度或空值规则不符合 V1.8，需要检查客户端转换和字段清洗。", eventReceivedCount: detailEvent.receivedCount, presentCount: detailEvent.receivedCount, missingCount: 0, invalidCount: detailEvent.invalidParams.length, coverageRate: 100, lastReceivedAt: detailEvent.lastReceivedAt, sampleValues: [] };
  }
  if (fieldListIncludes(detailEvent.chainErrors, fieldName)) {
    return { source: "local" as const, tone: "warn" as const, title: "字段关联链异常", status: "CHAIN_WARN", description: "字段未被标记为缺失，但参与关联链时异常；建议检查同一 session_id / screen_view_id / request_id 是否贯穿。", eventReceivedCount: detailEvent.receivedCount, presentCount: undefined, missingCount: undefined, invalidCount: undefined, coverageRate: undefined, lastReceivedAt: detailEvent.lastReceivedAt, sampleValues: [] };
  }
  const isCommonField = commonTrackingFields.some((field) => field.name === fieldName);
  return { source: "local" as const, tone: isCommonField ? "warn" as const : "good" as const, title: isCommonField ? "未发现缺失，等待精确覆盖接口确认" : "未发现缺失或格式错误", status: isCommonField ? "LIKELY_REPORTED" : "PASSED_BY_RUN_DETAIL", description: isCommonField ? "公共字段通常不在事件专属参数表里逐项返回；后端接入 field-coverage 后会显示准确出现次数和覆盖率。" : "当前 Run 的事件已收到，且该字段没有出现在缺失/非法列表里，可先按通过处理。", eventReceivedCount: detailEvent.receivedCount, presentCount: undefined, missingCount: 0, invalidCount: 0, coverageRate: undefined, lastReceivedAt: detailEvent.lastReceivedAt, sampleValues: [] };
}

function FieldCoverageLookup({
  detail,
  configuredEvents,
}: {
  detail: AcceptanceDetail | null;
  configuredEvents: TrackingCatalogEvent[];
}) {
  const [fieldEventName, setFieldEventName] = useState("screen_view");
  const [fieldName, setFieldName] = useState("screen_view_id");
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [fieldResult, setFieldResult] = useState<ReturnType<typeof inferLocalFieldResult> | ReturnType<typeof buildBackendFieldResult> | null>(null);
  const eventOptions = configuredEvents.length > 0 ? configuredEvents : trackingEventCatalog.filter((event) => event.stage === "页面行为" || event.stage === "核心行为" || matchesPageTrackingEvent(event.name));
  const selectedEvent = eventOptions.find((event) => normalizeEventName(event.name) === normalizeEventName(fieldEventName)) ?? eventOptions[0];
  const fieldOptions = uniqueFieldOptions(selectedEvent);
  const selectedField = fieldOptions.find((field) => field.name === fieldName);
  const datalistId = `field-options-${selectedEvent?.id ?? "all"}`;

  useEffect(() => {
    const preferred = eventOptions.find((event) => normalizeEventName(event.name) === "screen_view") ?? eventOptions[0];
    if (preferred && !eventOptions.some((event) => normalizeEventName(event.name) === normalizeEventName(fieldEventName))) {
      setFieldEventName(preferred.name);
      setFieldName(normalizeEventName(preferred.name) === "screen_view" ? "screen_view_id" : uniqueFieldOptions(preferred)[0]?.name ?? "session_id");
      setFieldResult(null);
      setQueryError("");
    }
  }, [configuredEvents.length]);

  async function checkField() {
    if (!selectedEvent || !fieldName.trim()) return;
    const nextFieldName = fieldName.trim();
    setQuerying(true);
    setQueryError("");
    try {
      if (!detail) throw new Error("请先创建或选择一个验收 Run");
      const precise = await acceptanceApi.fieldCoverage(detail.run.runId, selectedEvent.name, nextFieldName);
      setFieldResult(buildBackendFieldResult(precise));
    } catch (error) {
      const fallback = inferLocalFieldResult(detail, selectedEvent.name, nextFieldName, selectedEvent);
      setFieldResult(fallback);
      setQueryError(error instanceof Error ? `精确字段接口暂不可用：${error.message}` : "精确字段接口暂不可用，已按当前 Run 粗判");
    } finally {
      setQuerying(false);
    }
  }

  return <div className="field-coverage-lookup">
    <div className="field-lookup-head">
      <div><strong>字段级查询</strong><span>选择事件和字段，检查这个字段有没有真正上报进来；适合排查 A054 的页面字段缺失。</span></div>
      <code>GET /tracking-acceptance/runs/field-coverage</code>
    </div>
    <div className="field-lookup-form">
      <label><span>事件</span><select value={selectedEvent?.name ?? fieldEventName} onChange={(event) => { const nextEvent = eventOptions.find((item) => item.name === event.target.value); setFieldEventName(event.target.value); setFieldName(nextEvent ? uniqueFieldOptions(nextEvent)[0]?.name ?? "" : ""); setFieldResult(null); setQueryError(""); }}>{eventOptions.map((event) => <option key={event.id} value={event.name}>{event.name} · {event.displayName}</option>)}</select></label>
      <label><span>字段</span><input list={datalistId} value={fieldName} placeholder="输入字段名，如 screen_view_id / session_id" onChange={(event) => { setFieldName(event.target.value); setFieldResult(null); setQueryError(""); }} /><datalist id={datalistId}>{fieldOptions.map((field) => <option key={field.name} value={field.name}>{field.displayName}</option>)}</datalist></label>
      <button className="primary-button" onClick={checkField} disabled={!selectedEvent || !fieldName.trim() || querying}>{querying ? "查询中..." : "检查字段"}</button>
    </div>
    <div className="field-lookup-quick">
      {["screen_view_id", "screen_name", "session_id", "current_screen", "element_name", "action_name", "logged_at_ms"].map((field) => <button key={field} onClick={() => { setFieldName(field); setFieldResult(null); setQueryError(""); }}>{field}</button>)}
    </div>
    <div className="field-lookup-result">
      <div>
        <span>字段定义</span>
        <strong>{fieldName || "未选择字段"}</strong>
        <small>{selectedField ? `${selectedField.displayName} · ${selectedField.dataType} · ${selectedField.reportingMode}` : "当前事件字典未找到该字段；仍可向后端精确查询原始参数。"}</small>
        {selectedField?.description && <em>{selectedField.description}</em>}
      </div>
      <div className={`field-result-card ${fieldResult?.tone ?? "neutral"}`}>
        <span>{fieldResult?.source === "backend" ? "后端精确结果" : "当前Run本地判断"}</span>
        <strong>{fieldResult?.title ?? "等待查询"}</strong>
        <small>{fieldResult?.description ?? "选择事件和字段后点击检查。"}</small>
        {queryError && <em>{queryError}</em>}
      </div>
      <div className="field-count-grid">
        <div><span>事件收到</span><strong>{fieldResult?.eventReceivedCount ?? "—"}</strong></div>
        <div><span>字段出现</span><strong>{fieldResult?.presentCount ?? "—"}</strong></div>
        <div><span>字段缺失</span><strong>{fieldResult?.missingCount ?? "—"}</strong></div>
        <div><span>字段非法</span><strong>{fieldResult?.invalidCount ?? "—"}</strong></div>
        <div><span>覆盖率</span><strong>{formatCoverageRate(fieldResult?.coverageRate)}</strong></div>
        <div><span>最后收到</span><strong>{fieldResult?.lastReceivedAt ?? "—"}</strong></div>
      </div>
    </div>
    {fieldResult?.sampleValues?.length ? <div className="field-samples"><span>样例值</span>{fieldResult.sampleValues.slice(0, 5).map((value) => <code key={value}>{value}</code>)}</div> : null}
  </div>;
}

function PageTrackingAcceptancePanel({
  project,
  selectedConfig,
  detail,
  loading,
  onCreateRun,
  onRefresh,
  onMarkPageScene,
  openConfig,
}: {
  project: string;
  selectedConfig?: TrackingConfigRecord;
  detail: AcceptanceDetail | null;
  loading: boolean;
  onCreateRun: () => void;
  onRefresh: () => void;
  onMarkPageScene: (eventNames: string[]) => void;
  openConfig: () => void;
}) {
  const selectedIds = new Set(selectedConfig?.selectedEventIds ?? []);
  const configuredPageEvents = trackingEventCatalog.filter((event) =>
    selectedIds.has(event.id) && (event.stage === "页面行为" || event.stage === "核心行为" || matchesPageTrackingEvent(event.name))
  );
  const configuredEvents = trackingEventCatalog.filter((event) => selectedIds.has(event.id));
  const configuredNames = new Set(configuredPageEvents.map((event) => normalizeEventName(event.name)));
  const pageDetailEvents = detail?.events.filter((event) => matchesPageTrackingEvent(event.eventName) || event.module === "页面行为" || event.module === "核心行为") ?? [];
  const eventByName = new Map(pageDetailEvents.map((event) => [normalizeEventName(event.eventName), event]));
  const expectedCount = configuredPageEvents.length;
  const receivedCount = pageDetailEvents.filter((event) => event.receivedCount > 0).length;
  const passedCount = pageDetailEvents.filter((event) => event.resultStatus === "PASSED").length;
  const failedCount = pageDetailEvents.filter((event) => pageResultFailures.has(event.resultStatus)).length;
  const missingCriticalNames = pageTrackingChecks
    .filter((check) => configuredNames.has(check.eventName) && !eventByName.get(check.eventName)?.receivedCount)
    .map((check) => check.eventName);
  const pageEventNamesForScene = pageTrackingChecks
    .filter((check) => configuredNames.has(check.eventName))
    .map((check) => check.eventName);
  const pageStatus = !selectedConfig
    ? "未配置"
    : expectedCount === 0
      ? "配置缺页面事件"
      : !detail
        ? "待创建 Run"
        : failedCount > 0 || missingCriticalNames.length > 0
          ? "页面数据异常"
          : passedCount >= expectedCount
            ? "通过"
            : "待执行/待接收";

  return <section className="surface page-tracking-acceptance">
    <div className="surface-title">
      <div><h2>页面打点数据专项验收</h2><p>针对 A054 这类“V1.8 已接入但没有页面数据”的情况，单独检查页面进入、离开、点击和页面上下文。</p></div>
      <span className={`badge badge-${pageStatus === "通过" ? "good" : pageStatus === "页面数据异常" || pageStatus === "配置缺页面事件" ? "bad" : "warn"}`}>{pageStatus}</span>
    </div>
    <div className="page-acceptance-summary">
      <div><span>配置内页面事件</span><strong>{expectedCount}</strong><small>{selectedConfig?.snapshotId ?? "未选择配置快照"}</small></div>
      <div><span>已收到页面事件</span><strong>{detail ? receivedCount : "—"}</strong><small>{detail ? "按当前 Run 返回" : "创建 Run 后展示"}</small></div>
      <div><span>页面事件通过</span><strong>{detail ? `${passedCount}/${Math.max(expectedCount, 1)}` : "—"}</strong><small>P0 必须 100%</small></div>
      <div><span>A054重点判断</span><strong>{project === "A054" ? "专项开启" : "通用规则"}</strong><small>screen_view 为页面数据分母</small></div>
    </div>
    {project === "A054" && <div className="page-acceptance-callout"><strong>A054 无页面数据时先按这个顺序排：</strong><span>① Firebase 是否收到 screen_view；② screen_view 是否带 session_id 和 screen_view_id；③ DWS 页面路径是否过滤了缺 ID 事件；④ App 后台是否只打了 app_background 但没有 screen_exit。</span></div>}
    {expectedCount === 0 && <div className="page-acceptance-callout danger"><strong>当前配置没有纳入页面事件</strong><span>请在“规范与配置”里把 页面行为 / 核心行为 模块加入配置，否则验收中心无法把页面数据缺失算进失败。</span><button onClick={openConfig}>去配置页面事件</button></div>}
    <div className="table-wrap page-check-table"><table><thead><tr><th>检查项</th><th>标准事件</th><th>必须字段 / 上下文</th><th>打点位置</th><th>验收规则</th><th>当前结果</th><th>影响</th></tr></thead><tbody>{pageTrackingChecks.map((check) => {
      const detailEvent = eventByName.get(check.eventName);
      const configured = configuredNames.has(check.eventName);
      const status = !configured ? "未纳入配置" : !detail ? "待创建Run" : detailEvent?.resultStatus ?? "NOT_RECEIVED";
      return <tr key={check.key} className={status === "PASSED" ? "" : "row-warn"}><td><strong>{check.name}</strong></td><td><code>{check.eventName}</code></td><td>{check.fields}</td><td>{check.location}</td><td>{check.rule}</td><td><span className={`badge badge-${resultTone(status)}`}>{configured ? status : "未纳入配置"}</span><small>{detailEvent ? `收到 ${detailEvent.receivedCount} 次` : configured ? "暂无接收记录" : "不进本次分母"}</small></td><td>{check.impact}</td></tr>;
    })}</tbody></table></div>
    <FieldCoverageLookup detail={detail} configuredEvents={configuredEvents} />
    <div className="page-acceptance-actions">
      <button className="secondary-button" onClick={onRefresh} disabled={loading || !selectedConfig}>{loading ? "刷新中..." : "刷新页面事件结果"}</button>
      <button className="secondary-button" onClick={() => onMarkPageScene(pageEventNamesForScene)} disabled={!detail || pageEventNamesForScene.length === 0}>标记页面场景已执行</button>
      <button className="primary-button" onClick={onCreateRun} disabled={!selectedConfig || loading}>创建页面验收 Run</button>
    </div>
  </section>;
}

export function TrackingAcceptanceCenter({ project, projects, configs, platform, appVersion, onProjectChange, openConfig, notify }: {
  project: string; projects: TrackingProjectOption[]; configs: TrackingConfigRecord[]; platform: string; appVersion: string;
  onProjectChange: (value: string) => void; openConfig: () => void; notify: (message: string) => void;
}) {
  const compatible = configs.filter((item) => item.status === "PUBLISHED" && item.projects.includes(project));
  const [configId, setConfigId] = useState(compatible[0]?.id ?? "");
  const [runs, setRuns] = useState<AcceptanceRun[]>([]);
  const [detail, setDetail] = useState<AcceptanceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const projectOption = projects.find((item) => item.code === project);
  const parsedVersion = parseVersion(appVersion);
  const profile = {
    appIdentifier: projectOption?.appIdentifier ?? "",
    appVersion: parsedVersion.appVersion,
    buildNumber: parsedVersion.buildNumber,
    platform: normalizePlatform(platform),
  };
  const selectedConfig = compatible.find((item) => item.id === configId) ?? compatible[0];

  useEffect(() => {
    setConfigId(compatible[0]?.id ?? "");
    setDetail(null);
    setRuns([]);
    setError("");
    if (compatible[0]) void loadRuns();
  }, [project]);
  async function loadRuns() {
    if (!selectedConfig) return;
    setLoading(true); setError("");
    try { const data = await acceptanceApi.list(project); setRuns(data.items); if (data.items[0]) setDetail(await acceptanceApi.detail(data.items[0].runId)); }
    catch (e) { setError(e instanceof Error ? e.message : "后端连接失败"); }
    finally { setLoading(false); }
  }
  async function createRun() {
    if (!selectedConfig) return;
    if (!profile.appIdentifier) { setError("当前线上项目缺少 app_identifier / 包名，请先在 Firebase 对接或项目管理里补齐"); return; }
    if (!profile.appVersion) { setError("请先选择具体 App 版本后再创建验收 Run，不能用“全部版本”创建验收"); return; }
    setLoading(true); setError("");
    try {
      const data = await acceptanceApi.create({ projectCode: project, configRevisionId: selectedConfig.id, ...profile, environment: "TEST", testerName: "当前用户" });
      setDetail(data); await loadRuns(); notify(`验收 Run ${data.run.runId} 已创建`);
    } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); setLoading(false); }
  }
  async function markModule(module: string) {
    if (!detail) return; const names = detail.events.filter((event) => event.module === module).map((event) => event.eventName);
    try { setDetail(await acceptanceApi.markScene(detail.run.runId, names)); notify(`${module}已标记操作完成，等待事件`); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
  }
  async function markPageScene(eventNames: string[]) {
    if (!detail) return;
    const detailNames = detail.events
      .filter((event) => eventNames.includes(normalizeEventName(event.eventName)) || event.module === "页面行为")
      .map((event) => event.eventName);
    const names = detailNames.length > 0 ? detailNames : eventNames;
    try { setDetail(await acceptanceApi.markScene(detail.run.runId, names)); notify("页面场景已标记执行，正在等待 screen_view / screen_exit / element_click"); }
    catch (e) { setError(e instanceof Error ? e.message : "页面场景标记失败"); }
  }
  const modules = useMemo(() => detail ? Array.from(new Set(detail.events.map((event) => event.module ?? "未分组"))) : [], [detail]);
  const visible = detail?.events.filter((event) => filter === "all" || (filter === "passed" && event.resultStatus === "PASSED") || (filter === "failed" && ["PARAM_INVALID", "CHAIN_INVALID", "NOT_RECEIVED"].includes(event.resultStatus)) || (filter === "pending" && event.resultStatus === "PENDING")) ?? [];
  const rate = detail?.run.completionRate ?? 0;

  return <div className="page-stack">
    <section className="tracking-product-selector surface">
      <div><div className="eyebrow">配置快照 → 操作任务 → 事件接收 → 参数/关联链校验 → P0 100%</div><h2>选择产品并开始验收</h2><p>验收分母只来自已发布配置；Run 创建后冻结，不受后续配置修改影响。</p></div>
      <label><span>产品</span><select value={project} onChange={(e) => onProjectChange(e.target.value)}>{projects.map((item) => <option key={item.code} value={item.code}>{item.code}{item.name ? ` · ${item.name}` : ""}</option>)}</select></label>
      <label><span>已发布配置</span><select value={selectedConfig?.id ?? ""} disabled={compatible.length === 0} onChange={(e) => setConfigId(e.target.value)}>{compatible.length === 0 ? <option value="">当前线上项目暂无发布配置</option> : compatible.map((item) => <option key={item.id} value={item.id}>{item.name} {item.version} · {item.selectedCount}事件</option>)}</select></label>
      <button className="primary-button" disabled={!selectedConfig || loading} onClick={createRun}>＋ 创建验收 Run</button>
    </section>
    <section className="acceptance-run-bar surface"><div><span>当前线上项目</span><strong>{project}</strong><small>{projectOption?.name || "未返回项目名称"}</small></div><div><span>App / 包名</span><strong>{profile.appIdentifier || "未配置包名"}</strong><small>{profile.appVersion || "未选择具体版本"}{profile.buildNumber ? ` (${profile.buildNumber})` : ""} · {platform}</small></div><div><span>项目来源</span><strong>线上项目接口</strong><small>不再使用本地演示项目</small></div></section>
    {error && <section className="surface acceptance-api-error"><strong>{error.includes("尚未配置") ? "验收接口未配置" : "验收后端暂不可用"}</strong><span>{error}</span>{selectedConfig && <button className="secondary-button" onClick={loadRuns}>重新连接</button>}</section>}
    {!selectedConfig && <section className="surface empty-table-state"><strong>{project} 没有已发布打点配置</strong><span>当前产品来自线上项目列表，但没有匹配到已发布配置快照；创建 Run 前必须先为这个项目发布配置。</span><button className="primary-button" onClick={openConfig}>去配置</button></section>}
    {selectedConfig && <>
      <PageTrackingAcceptancePanel project={project} selectedConfig={selectedConfig} detail={detail} loading={loading} onCreateRun={createRun} onRefresh={loadRuns} onMarkPageScene={markPageScene} openConfig={openConfig} />
      <section className="acceptance-run-bar surface"><label><span>当前 Run</span><select value={detail?.run.runId ?? ""} onChange={async (e) => setDetail(await acceptanceApi.detail(e.target.value))}><option value="">选择验收 Run</option>{runs.map((run) => <option key={run.runId} value={run.runId}>{run.runId} · {run.appVersion} · {run.status}</option>)}</select></label><div><span>App / 构建</span><strong>{profile.appIdentifier}</strong><small>{profile.appVersion} ({profile.buildNumber}) · {profile.platform}</small></div><button className="secondary-button" onClick={loadRuns}>刷新结果</button></section>
      {detail && <>
        <section className="metric-grid six"><div className="metric-card"><span>总完成率</span><strong>{rate.toFixed(1)}%</strong><small>门槛 {detail.run.passThreshold}%</small></div><div className="metric-card"><span>成功事件</span><strong>{detail.run.passedCount}/{detail.run.expectedCount}</strong><small>按标准事件去重</small></div><div className="metric-card"><span>P0通过</span><strong>{detail.run.p0PassedCount}/{detail.run.p0ExpectedCount}</strong><small>必须100%</small></div><div className="metric-card"><span>失败</span><strong>{detail.run.failedCount}</strong><small>参数或关联链错误</small></div><div className="metric-card"><span>待操作/待接收</span><strong>{detail.run.pendingCount}</strong><small>不提前判定漏打</small></div><div className="metric-card"><span>Run状态</span><strong>{detail.run.status}</strong><small>{detail.run.snapshotId}</small></div></section>
        <section className="surface"><div className="surface-title"><div><h2>操作任务</h2><p>测试人员按模块执行操作，系统等待对应事件并自动更新结果。</p></div></div><div className="test-task-list">{modules.map((module) => { const events=detail.events.filter(e=>e.module===module);const passed=events.filter(e=>e.resultStatus==="PASSED").length;return <article key={module} className={`test-task-card ${passed===events.length?"passed":events.some(e=>["PARAM_INVALID","CHAIN_INVALID","NOT_RECEIVED"].includes(e.resultStatus))?"failed":"pending"}`}><header><div><strong>{module}</strong></div><span>{passed}/{events.length} 通过</span></header><dl><div><dt>在哪里操作</dt><dd>{events[0]?.trackingLocation || "按事件规范操作"}</dd></div><div><dt>什么时候触发</dt><dd>{events[0]?.triggerTiming || "操作成功后"}</dd></div><div><dt>应收事件</dt><dd>{events.map(e=>e.eventName).join("、")}</dd></div></dl><footer><button className="primary-button" onClick={()=>markModule(module)}>开始并标记已执行</button></footer></article>})}</div></section>
        <section className="surface"><div className="surface-title"><div><h2>事件接收与失败定位</h2><p>未执行不算漏打；执行后仍未收到、参数错误或关联链错误才进入失败。</p></div><div className="event-result-tabs">{[["all","全部"],["passed","成功"],["failed","失败"],["pending","待处理"]].map(([key,label])=><button key={key} className={filter===key?"active":""} onClick={()=>setFilter(key)}>{label}</button>)}</div></div><div className="table-wrap event-result-table"><table><thead><tr><th>事件</th><th>模块</th><th>优先级</th><th>场景</th><th>接收次数</th><th>结论</th><th>失败详情</th><th>操作建议</th></tr></thead><tbody>{visible.map((event)=><tr key={event.eventName} className={event.resultStatus!=="PASSED"?"row-warn":""}><td><strong>{event.eventName}</strong><small>{event.displayName}</small></td><td>{event.module}</td><td>{event.priority}</td><td>{event.sceneStatus}</td><td>{event.receivedCount}</td><td>{event.resultStatus}</td><td>{[...event.missingParams,...event.invalidParams,...event.chainErrors].join("、")||"—"}</td><td>{event.resultStatus==="PENDING"?(event.sceneStatus==="NOT_EXECUTED"?event.trackingLocation:"等待Firebase事件"):event.resultStatus==="PASSED"?"无需处理":"按打点位置重测并检查字段Provider/Context"}</td></tr>)}</tbody></table></div></section>
      </>}
    </>}
  </div>;
}
