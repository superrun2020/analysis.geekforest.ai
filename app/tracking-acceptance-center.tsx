"use client";

import { useEffect, useMemo, useState } from "react";
import { acceptanceApi, type AcceptanceDetail, type AcceptanceFieldCoverage, type AcceptanceRun } from "./tracking-acceptance-api";
import { queryTrackingOnlineCoverage, type OnlineCoverageEvent, type OnlineCoverageResult } from "./tracking-online-coverage-api";
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

function resultLabel(status?: string) {
  const value = (status ?? "").trim().toUpperCase();
  const labels: Record<string, string> = {
    PASSED: "通过",
    PARAM_INVALID: "参数错误",
    CHAIN_INVALID: "关联链错误",
    NOT_RECEIVED: "未收到",
    PENDING: "待处理",
    SCENE_NOT_EXECUTED: "未执行场景",
    NOT_CONFIGURED: "未纳入配置",
    NEED_RUN: "待创建Run",
    EVENT_NOT_RECEIVED: "事件未收到",
    REPORTED: "已上报",
    INVALID: "格式错误",
    MISSING: "字段缺失",
    LIKELY_REPORTED: "疑似已上报",
    PASSED_BY_RUN_DETAIL: "当前Run通过",
    CHAIN_WARN: "关联链预警",
    RUNNING: "运行中",
    SUCCESS: "成功",
    FAILED: "失败",
    UNKNOWN: "未知",
  };
  return labels[value] ?? status ?? "—";
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
    return { source: "local" as const, tone: "warn" as const, title: "字段不在当前配置字典", status: "NOT_CONFIGURED", description: "请确认字段名是否属于 V1.8 当前配置；如果是新字段，需要先进入打点测试配置发布新快照。", eventReceivedCount: detailEvent?.receivedCount, presentCount: undefined, missingCount: undefined, invalidCount: undefined, coverageRate: undefined, lastReceivedAt: detailEvent?.lastReceivedAt, sampleValues: [] };
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
    {expectedCount === 0 && <div className="page-acceptance-callout danger"><strong>当前配置没有纳入页面事件</strong><span>请在“打点测试配置”里把 页面行为 / 核心行为 模块加入配置，否则验收中心无法把页面数据缺失算进失败。</span><button onClick={openConfig}>去配置页面事件</button></div>}
    <div className="table-wrap page-check-table"><table><thead><tr><th>检查项</th><th>标准事件</th><th>必须字段 / 上下文</th><th>打点位置</th><th>验收规则</th><th>当前结果</th><th>影响</th></tr></thead><tbody>{pageTrackingChecks.map((check) => {
      const detailEvent = eventByName.get(check.eventName);
      const configured = configuredNames.has(check.eventName);
      const status = !configured ? "未纳入配置" : !detail ? "待创建Run" : detailEvent?.resultStatus ?? "NOT_RECEIVED";
      return <tr key={check.key} className={status === "PASSED" ? "" : "row-warn"}><td><strong>{check.name}</strong></td><td><code>{check.eventName}</code></td><td>{check.fields}</td><td>{check.location}</td><td>{check.rule}</td><td><span className={`badge badge-${resultTone(status)}`}>{configured ? resultLabel(status) : "未纳入配置"}</span><small>{detailEvent ? `收到 ${detailEvent.receivedCount} 次` : configured ? "暂无接收记录" : "不进本次分母"}</small></td><td>{check.impact}</td></tr>;
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
  const [configId, setConfigId] = useState(compatible[0]?.id ?? "V18_FULL");
  const [coverage, setCoverage] = useState<OnlineCoverageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [queryDate, setQueryDate] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const projectOption = projects.find((item) => item.code === project);
  const parsedVersion = parseVersion(appVersion);
  const profile = {
    appIdentifier: projectOption?.appIdentifier ?? "",
    appVersion: parsedVersion.appVersion,
    buildNumber: parsedVersion.buildNumber,
    platform: normalizePlatform(platform),
  };
  const selectedConfig = compatible.find((item) => item.id === configId);
  const expectedEvents = useMemo(() => {
    if (!selectedConfig) return trackingEventCatalog;
    const selectedIds = new Set(selectedConfig.selectedEventIds ?? []);
    return trackingEventCatalog.filter((event) => selectedIds.has(event.id));
  }, [selectedConfig]);
  const coverageByName = useMemo(() => {
    const map = new Map<string, OnlineCoverageEvent>();
    coverage?.events.forEach((event) => map.set(normalizeEventName(event.eventName), event));
    return map;
  }, [coverage]);
  const moduleOptions = useMemo(() => Array.from(new Set(expectedEvents.map((event) => event.stage))).sort(), [expectedEvents]);

  useEffect(() => {
    setConfigId(compatible[0]?.id ?? "V18_FULL");
    setCoverage(null);
    setError("");
  }, [project]);

  function getEventStatus(event: TrackingCatalogEvent) {
    const online = coverageByName.get(normalizeEventName(event.name));
    if (!coverage) return { key: "pending", label: "待查询", tone: "neutral" as const, suggestion: "选择项目、配置和日期后点击查询，系统会检查线上是否收到这个事件。" };
    if (!online?.received) return { key: "missing", label: "未收到", tone: "bad" as const, suggestion: `按“${event.trackingLocation || event.triggerTiming || "对应业务场景"}”触发一次；若仍未收到，检查事件名、Firebase 上报开关、ADB 隔离表和客户端触发时机。` };
    if ((online.quarantineCount ?? 0) > 0) return { key: "quarantine", label: "隔离异常", tone: "bad" as const, suggestion: "先查隔离原因：event_id、schema_version、my_user_id、时间戳、必填字段是否非法；修好后重新触发该事件。" };
    if ((online.typeMismatchCount ?? 0) > 0) return { key: "type", label: "类型异常", tone: "bad" as const, suggestion: "检查 bool / timestamp / decimal 是否按 V1.8 转成 String、Int 或 Double，枚举值不要传空字符串。" };
    if (online.p0CompletenessRate !== null && online.p0CompletenessRate !== undefined && online.p0CompletenessRate < 99) return { key: "field", label: "字段缺失", tone: "warn" as const, suggestion: "事件已收到，但 P0 字段不完整；重点查统一 Provider、广告/VPN Context、session_id/request_id/vpn_session_id 是否贯穿。" };
    return { key: "success", label: "成功", tone: "good" as const, suggestion: "事件已在线上收到，且未发现明显字段/隔离/类型异常。" };
  }

  const rows = useMemo(() => expectedEvents.map((event) => ({ event, online: coverageByName.get(normalizeEventName(event.name)), status: getEventStatus(event) })), [expectedEvents, coverageByName, coverage]);
  const visibleRows = rows.filter(({ event, status }) => {
    const text = `${event.stage} ${event.name} ${event.displayName} ${event.trackingLocation} ${event.triggerTiming}`.toLowerCase();
    const matchesKeyword = !keyword.trim() || text.includes(keyword.trim().toLowerCase());
    const matchesModule = moduleFilter === "all" || event.stage === moduleFilter;
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "success" && status.key === "success")
      || (statusFilter === "failed" && ["missing", "field", "type", "quarantine"].includes(status.key))
      || (statusFilter === "missing" && status.key === "missing")
      || (statusFilter === "pending" && status.key === "pending");
    return matchesKeyword && matchesModule && matchesStatus;
  });
  const summary = useMemo(() => {
    const total = rows.length;
    const success = rows.filter((row) => row.status.key === "success").length;
    const failed = rows.filter((row) => ["missing", "field", "type", "quarantine"].includes(row.status.key)).length;
    const p0Total = rows.filter((row) => row.event.priority === "P0").length;
    const p0Success = rows.filter((row) => row.event.priority === "P0" && row.status.key === "success").length;
    const received = rows.filter((row) => row.online?.received).length;
    const p0Rates = rows.map((row) => row.online?.p0CompletenessRate).filter((value): value is number => value !== null && value !== undefined);
    const avgP0 = p0Rates.length ? p0Rates.reduce((sum, value) => sum + value, 0) / p0Rates.length : null;
    return { total, success, failed, received, p0Total, p0Success, avgP0 };
  }, [rows]);

  async function queryCoverage() {
    if (!profile.appIdentifier) { setError("当前项目没有包名 / app_identifier，无法和 Firebase/ADB 数据精确匹配。请先检查 Firebase 对接配置表。"); return; }
    if (!expectedEvents.length) { setError("当前配置没有选择任何应测事件，请先新建或编辑打点配置。"); return; }
    setLoading(true);
    setError("");
    try {
      const data = await queryTrackingOnlineCoverage({
        projectCode: project,
        appIdentifier: profile.appIdentifier,
        date: queryDate,
        eventNames: expectedEvents.map((event) => event.name),
      });
      setCoverage(data);
      notify(`${project} ${queryDate} 打点检查完成：已收到 ${data.events.filter((event) => event.received).length}/${expectedEvents.length} 个应测事件`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "线上打点查询失败");
    } finally {
      setLoading(false);
    }
  }

  return <div className="page-stack">
    <section className="tracking-product-selector surface">
      <div><h2>打点测试配置</h2><p>选择线上项目和打点配置，系统直接查 Firebase/ADB 入库结果，判断“应该打的点有没有打成功”。</p></div>
      <label><span>产品</span><select value={project} onChange={(e) => onProjectChange(e.target.value)}>{projects.map((item) => <option key={item.code} value={item.code}>{item.code}{item.name ? ` · ${item.name}` : ""}</option>)}</select></label>
      <label><span>应测配置</span><select value={selectedConfig?.id ?? "V18_FULL"} onChange={(e) => setConfigId(e.target.value)}><option value="V18_FULL">V1.8 全量事件自检 · {trackingEventCatalog.length}事件</option>{compatible.map((item) => <option key={item.id} value={item.id}>{item.name} {item.version} · {item.selectedCount}事件</option>)}</select></label>
      <label><span>查询日期</span><input type="date" value={queryDate} onChange={(e) => setQueryDate(e.target.value)} /></label>
      <button className="primary-button" disabled={loading || !expectedEvents.length} onClick={queryCoverage}>{loading ? "查询中..." : "查询打点结果"}</button>
    </section>
    {error && <section className="surface acceptance-api-error"><strong>线上打点查询不可用</strong><span>{error}</span><button className="secondary-button" onClick={queryCoverage} disabled={loading}>重新查询</button></section>}
    {!selectedConfig && <section className="surface page-acceptance-callout danger"><strong>当前项目没有发布配置</strong><span>已临时使用 V1.8 全量事件自检。正式发版验收前，请先创建该项目的打点配置，选择本版本真正需要验证的事件。</span><button onClick={openConfig}>新建配置</button></section>}
    <section className="metric-grid six">
      <div className="metric-card"><span>应测事件</span><strong>{summary.total}</strong><small>{selectedConfig ? `${selectedConfig.name} · ${selectedConfig.version}` : "V1.8 全量事件自检"}</small></div>
      <div className="metric-card"><span>已收到</span><strong>{coverage ? summary.received : "—"}</strong><small>按项目+包名+日期查线上数据</small></div>
      <div className="metric-card"><span>未通过</span><strong>{coverage ? summary.failed : "—"}</strong><small>未收到/字段缺失/类型或隔离异常</small></div>
      <div className="metric-card"><span>P0通过</span><strong>{coverage ? `${summary.p0Success}/${summary.p0Total}` : "—"}</strong><small>P0 应 100% 通过</small></div>
      <div className="metric-card"><span>P0字段完整率</span><strong>{summary.avgP0 === null ? "—" : `${summary.avgP0.toFixed(1)}%`}</strong><small>DWS 有值时展示平均完整率</small></div>
      <div className="metric-card"><span>数据时间</span><strong>{coverage?.queryPlan.queriedAt?.slice(11, 16) ?? "未查询"}</strong><small>{coverage ? `${coverage.date} · ${coverage.queryPlan.summaryMatched}个汇总命中` : `${profile.appIdentifier || "缺包名"} · ${platform}`}</small></div>
    </section>
    <section className="surface tracking-clean-console">
      <div className="surface-title">
        <div><h2>应测事件接收结果</h2><p>这里不再创建 Run，只判断当前配置里应该打的事件，线上有没有收到、字段是否完整、失败后该去哪里修。</p></div>
        <div className="event-result-tabs">{[["all","全部"],["success","成功"],["failed","需处理"],["missing","未收到"],["pending","待查询"]].map(([key,label])=><button key={key} className={statusFilter===key?"active":""} onClick={()=>setStatusFilter(key)}>{label}</button>)}</div>
      </div>
      <div className="tracking-test-toolbar">
        <label><span>事件模块</span><select value={moduleFilter} onChange={(e)=>setModuleFilter(e.target.value)}><option value="all">全部模块</option>{moduleOptions.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>搜索事件</span><input value={keyword} onChange={(e)=>setKeyword(e.target.value)} placeholder="搜标准事件名 / 显示名 / 打点位置" /></label>
        <button className="secondary-button" onClick={()=>{ setModuleFilter("all"); setStatusFilter("all"); setKeyword(""); }}>重置筛选</button>
      </div>
      {loading && <div className="query-progress-panel"><div className="query-progress-title"><div><strong>正在检查线上打点</strong><small>优先查 dws_app_event_quality_daily，缺失事件再查 DWD 明细回填。</small></div><span>{project} · {queryDate}</span></div><div className="query-progress-list"><div className="loading"><i>1</i><span>汇总表查询</span><small>事件数量、隔离、类型异常、P0完整率</small><strong>进行中</strong></div><div className="loading"><i>2</i><span>明细表补查</span><small>汇总没有命中的事件用 DWD 再确认</small><strong>等待返回</strong></div><div className="loading"><i>3</i><span>生成修复建议</span><small>按未收到/字段缺失/类型/隔离分类</small><strong>准备中</strong></div></div></div>}
      <div className="table-wrap event-result-table"><table><thead><tr><th>模块</th><th>标准事件名</th><th>事件显示名</th><th>优先级</th><th>在哪里打点 / 怎么触发</th><th>是否收到</th><th>次数 / UV</th><th>P0完整率</th><th>异常</th><th>最后收到</th><th>建议</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map(({ event, online, status }) => <tr key={event.id} className={status.key === "success" ? "" : "row-warn"}><td>{event.stage}</td><td><strong>{event.name}</strong><small>{event.chainKey}</small></td><td>{event.displayName}</td><td><span className={`badge badge-${event.priority === "P0" ? "bad" : event.priority === "P1" ? "warn" : "neutral"}`}>{event.priority}</span></td><td><strong>{event.trackingLocation || event.page}</strong><small>{event.triggerTiming || event.operation}</small></td><td><span className={`badge badge-${status.tone}`}>{status.label}</span><small>{online?.source ?? "待查询"}</small></td><td><strong>{online?.eventCount ?? 0}</strong><small>UV {online?.users ?? "—"} · 有效 {online?.acceptedCount ?? "—"}</small></td><td>{online?.p0CompletenessRate === null || online?.p0CompletenessRate === undefined ? "—" : `${online.p0CompletenessRate.toFixed(1)}%`}</td><td><small>隔离 {online?.quarantineCount ?? 0}</small><small>类型 {online?.typeMismatchCount ?? 0}</small></td><td>{online?.latestAt ?? "—"}</td><td>{status.suggestion}</td></tr>) : <tr><td colSpan={11}><div className="empty-table-state"><strong>没有匹配的事件</strong><span>请放宽模块、状态或搜索条件。</span></div></td></tr>}</tbody></table></div>
    </section>
  </div>;
}
