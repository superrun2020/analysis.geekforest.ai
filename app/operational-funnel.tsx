"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";
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
  onProjectSelect?: (projectCode: string) => void;
  initialDomain?: "ads" | "vpn" | "quality";
  lockDomain?: boolean;
  softFailure?: boolean;
  onSnapshotChange?: (snapshot: OperationalReportSnapshot | null) => void;
};

type AnyRow = Record<string, any>;
type FunnelUnit = "users" | "sessions" | "events";
type PackageData = Record<string, AnyRow>;
type QueryProgressStatus = "pending" | "loading" | "retrying" | "done" | "error";
type QueryProgressItem = { key: string; label: string; status: QueryProgressStatus; finishedAt?: string; error?: string; attempt?: number; maxAttempts?: number; dataCountLabel?: string; dateLabel?: string };
type DropoffSelection = { fromIndex: number; toIndex: number };
const operationalPackageCache = new Map<string, { value: AnyRow; loadedAt: string }>();
const OPERATIONAL_CACHE_LIMIT = 80;

function queryCacheKey(query: FunnelQuery) {
  return JSON.stringify({
    page: query.page,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    projectCode: query.projectCode ?? "",
    appIdentifier: query.appIdentifier ?? "",
    platform: query.platform ?? "",
    country: query.country ?? "",
    appVersion: query.appVersion ?? "",
    domain: query.domain ?? "",
    unit: query.unit ?? "",
    pageSize: query.pageSize ?? "",
  });
}

function setOperationalCache(key: string, value: AnyRow) {
  operationalPackageCache.set(key, { value, loadedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
  if (operationalPackageCache.size > OPERATIONAL_CACHE_LIMIT) {
    const oldestKey = operationalPackageCache.keys().next().value;
    if (oldestKey) operationalPackageCache.delete(oldestKey);
  }
}

export type OperationalReportSnapshot = {
  snapshotVersion: string;
  module: "funnel" | "vpn";
  page: FunnelPageKey;
  activePage: FunnelPageKey;
  projectCode: string;
  appIdentifier?: string;
  range: string;
  dates: { dateFrom: string; dateTo: string };
  platform: string;
  country: string;
  appVersion: string;
  domain: "ads" | "vpn" | "quality";
  unit: FunnelUnit;
  activeKey: string;
  loadedAt: string;
  capturedAt: string;
  context: Record<string, unknown>;
  progressItems: QueryProgressItem[];
  packageErrors: Record<string, string>;
  dataPackage: PackageData;
};
const number = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${number(value)}%`;
const money = (value: unknown) => value === null || value === undefined ? "—" : `$${number(value)}`;
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const rowCount = (row: AnyRow) => Number(row?.count ?? row?.value ?? row?.users ?? 0);
const rowName = (row: AnyRow) => text(row?.name ?? row?.stepName ?? row?.label);
const rowEvent = (row: AnyRow) => text(row?.eventName ?? row?.event);

function firstText(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return "";
}

function numericValue(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

function bestDauValue(data: AnyRow) {
  const funnelDau = findFunnelStep(data.funnel ?? [], [/^dau$|app_foreground|日活跃|活跃用户/]);
  const funnelValue = funnelDau ? rowCount(funnelDau) : null;
  if (funnelValue !== null && Number.isFinite(funnelValue) && funnelValue > 0) {
    return {
      value: funnelValue,
      source: "dws_app_funnel_stage_daily · scope_type=users · step_code=dau · subject_count",
      note: "优先使用用户漏斗阶段汇总；避免从广告履约多维表直接 sum(dau_users) 造成重复或偏差。",
    };
  }
  const summary = data.summary ?? {};
  const summaryValue = numericValue(summary, ["dauUsers", "activeUsers", "foregroundUsers", "appForegroundUsers", "middlePlatformDau", "firebaseDau"]);
  return {
    value: summaryValue,
    source: summaryValue === null ? "暂无可用 DAU 字段" : "summary.dauUsers / activeUsers 兜底",
    note: "如果这里为空，后端应优先补 dws_app_funnel_stage_daily 的 dau 用户口径。",
  };
}

function hasMetric(metrics: AnyRow[], patterns: RegExp[]) {
  return metrics.some((metric) => patterns.some((pattern) => pattern.test(`${metric.name ?? ""} ${metric.metricKey ?? ""} ${metric.key ?? ""}`.toLowerCase())));
}

function metricNumericValue(metrics: AnyRow[], patterns: RegExp[]) {
  const row = metrics.find((metric) => patterns.some((pattern) => pattern.test(`${metric.name ?? ""} ${metric.metricKey ?? ""} ${metric.key ?? ""}`.toLowerCase())));
  if (!row) return null;
  return numericValue(row, ["value", "count", "users", "displayValue", "metricValue", "metric_value"]);
}

function valueFromRows(rows: AnyRow[], patterns: RegExp[]) {
  const row = findFunnelStep(rows, patterns);
  return row ? rowCount(row) : null;
}

function addSingleProjectDerivedMetrics(metrics: AnyRow[], data: AnyRow, funnelRows: AnyRow[], domain: string) {
  if (domain !== "ads") return metrics;
  if (hasMetric(metrics, [/人均浏览者|impressions.*viewer|impressionsperviewer|展示.*浏览/])) return metrics;
  if (hasMetric(metrics, [/ad_impressions_per_viewer|人均广告展示次数|人均展示次数/])) {
    return metrics.map((metric) => /ad_impressions_per_viewer|人均广告展示次数|人均展示次数/.test(`${metric.name ?? ""} ${metric.metricKey ?? ""} ${metric.key ?? ""}`.toLowerCase())
      ? {
          ...metric,
          name: "人均浏览者比例",
          detail: metric.detail ?? "口径：广告展示次数 impression_count ÷ 广告浏览人数 AV；表示每个广告浏览用户平均看到几次广告。",
          formula: metric.formula ?? "impression_count / impression_users",
        }
      : metric);
  }
  const summary = data.summary ?? {};
  const impressionUsers = numericValue(summary, ["impressionUsers", "impression_users", "avUsers", "av_users", "adViewerUsers", "ad_viewer_users"])
    ?? metricNumericValue(metrics, [/广告浏览人数|浏览人数|impression.*users|av_users|av\b/])
    ?? valueFromRows(funnelRows, [/impression|广告展示|av|浏览/]);
  const impressionCount = numericValue(summary, ["impressionCount", "impression_count", "adImpressionCount", "ad_impression_count", "impressions", "showSuccessCount", "show_success_count"])
    ?? numericValue(data, ["impressionCount", "impression_count", "adImpressionCount", "ad_impression_count", "impressions"])
    ?? metricNumericValue(metrics, [/广告展示次数|展示次数|impression.*count|impressions\b/]);
  const apiValue = numericValue(summary, ["impressionsPerViewer", "impressions_per_viewer", "avgImpressionsPerViewer", "avg_impressions_per_viewer"])
    ?? numericValue(data, ["impressionsPerViewer", "impressions_per_viewer", "avgImpressionsPerViewer", "avg_impressions_per_viewer"]);
  const value = apiValue ?? (impressionUsers !== null && impressionUsers > 0 && impressionCount !== null ? impressionCount / impressionUsers : null);
  return [
    ...metrics,
    {
      metricKey: "impressions_per_viewer",
      name: "人均浏览者比例",
      displayValue: value === null ? "—" : number(value),
      detail: "口径：广告展示次数 impression_count ÷ 广告浏览人数 AV；表示每个广告浏览用户平均看到几次广告。",
      formula: "impression_count / impression_users",
      status: value === null ? "warn" : value < 1.2 ? "warning" : "good",
    },
  ];
}

function isActiveBaselineStep(row: AnyRow) {
  const raw = rowText(row);
  return /app_foreground|dau|日活跃|活跃用户|前台/.test(raw);
}

function hasMissingAdSessionBaseline(rows: AnyRow[], unit: FunnelUnit, domain: string) {
  if (domain !== "ads" || unit !== "sessions" || rows.length < 2) return false;
  const first = rows[0];
  if (!isActiveBaselineStep(first)) return false;
  return rowCount(first) <= 0 && rows.slice(1).some((row) => rowCount(row) > 0);
}

function normalizeWorkbenchFunnelRows(rows: AnyRow[], unit: FunnelUnit, domain: string) {
  if (!hasMissingAdSessionBaseline(rows, unit, domain)) return rows;
  return rows.map((row, index) => {
    if (index === 0) {
      return {
        ...row,
        name: "前台 Session 基准（待补）",
        stepName: "前台 Session 基准（待补）",
        conditionText: "Session口径缺 app_foreground_sessions / foreground_sessions",
        available: false,
        conversionRate: null,
        dataIssue: "missing_session_baseline",
      };
    }
    if (index === 1) {
      return {
        ...row,
        conversionRate: null,
        dataIssue: "previous_session_baseline_missing",
      };
    }
    return row;
  });
}

function lossText(loss: number, lossRate: number | null) {
  return lossRate === null ? `流失 ${number(loss)}` : `流失 ${number(loss)} · ${percent(lossRate)}`;
}

function isEligibilityPassTransition(from: AnyRow, to: AnyRow) {
  const combined = `${rowName(from)} ${rowEvent(from)} ${rowName(to)} ${rowEvent(to)}`.toLowerCase();
  return combined.includes("ad_eligibility_check") && (combined.includes("符合广告资格") || combined.includes("eligible") || combined.includes("资格"));
}

function metricNoteForTransition(kind: "from" | "to" | "loss" | "rate", from: AnyRow, to: AnyRow, fallback: string) {
  if (!isEligibilityPassTransition(from, to)) return fallback;
  if (kind === "from") return "事件 ad_eligibility_check · 不管 eligible 是什么都计入";
  if (kind === "to") return "同一事件里 eligible = 1，表示资格通过";
  if (kind === "loss") return "同一事件里 eligible = 0，原因看 blocked_reason";
  return "通过率 = eligible=1 ÷ 全部资格检查";
}

function stepCondition(row: AnyRow) {
  const explicit = firstText(row, ["conditionText", "condition_text", "condition", "filterText", "filter_text", "filter", "whereText", "where_text", "whereClause", "where_clause", "predicate", "rule"]);
  if (explicit) return explicit;
  const field = firstText(row, ["fieldName", "field_name", "paramName", "param_name", "eventParam", "event_param", "valueField", "value_field"]);
  const value = firstText(row, ["fieldValue", "field_value", "paramValue", "param_value", "eventParamValue", "event_param_value", "value"]);
  if (field && value) return `${field} = ${value}`;
  const name = `${rowName(row)} ${rowEvent(row)}`.toLowerCase();
  if (name.includes("符合广告资格") || name.includes("eligible")) return "eligible = 1";
  if (name.includes("广告资格检查") || name.includes("eligibility")) return "eligible = 0/1 都计入";
  if (name.includes("资格未通过") || name.includes("blocked")) return "eligible = 0；blocked_reason 非空";
  if ((name.includes("element_click") || name.includes("core_action") || name.includes("按钮")) && (name.includes("vpn") || name.includes("连接") || name.includes("connect"))) return "element_name/action_name in (home_connect_button, vpn_connect_button, connect_button, TAG_ButtonVPN)";
  if (name.includes("vpn_connection_start") || name.includes("连接开始") || name.includes("连接尝试")) return "connection_id 非空；一次底层连接尝试";
  if (name.includes("vpn_connection_result") && (name.includes("连接成功") || name.includes("success"))) return "vpn_status = success";
  if (name.includes("vpn_connection_result") && (name.includes("连接失败") || name.includes("failed"))) return "vpn_status = failed/prohibited";
  if (name.includes("vpn_permission") && (name.includes("授权") || name.includes("通过") || name.includes("granted"))) return "permission_status = granted";
  if (name.includes("vpn_permission")) return "permission_status = granted/denied/error";
  if (name.includes("ad_opportunity") || name.includes("广告机会")) return "opportunity_id 非空";
  if (name.includes("ad_request") || name.includes("广告请求")) return "request_id 非空";
  if (name.includes("ad_show_attempt") || name.includes("展示尝试")) return "ad_instance_id/opportunity_id 可关联";
  if (name.includes("ad_impression") || name.includes("展示用户") || name.includes("广告浏览")) return "收到 impression 回调";
  return "按该步骤事件与关联ID去重";
}

function StepEventDetail({ row }: { row: AnyRow }) {
  return <small className="step-event-detail"><span>{rowEvent(row)}</span><code>{stepCondition(row)}</code></small>;
}

function normalizedName(value: unknown) {
  return text(value).toLowerCase().replace(/[\s_\-·:：/()（）]+/g, "");
}

function zeroCheckRows(data: AnyRow | null | undefined) {
  return [
    ...firstArray(data, ["zeroValueChecks", "zero_value_checks", "autoChecks", "auto_checks", "anomalyChecks", "anomaly_checks"]),
    ...firstArray(data?.summary, ["zeroValueChecks", "zero_value_checks", "autoChecks", "auto_checks", "anomalyChecks", "anomaly_checks"]),
  ];
}

function checkMatchesStep(check: AnyRow, row: AnyRow, index: number) {
  const stepNames = [
    check.stepName, check.step_name, check.targetStepName, check.target_step_name,
    check.stepCode, check.step_code, check.targetStepCode, check.target_step_code,
    check.metricKey, check.metric_key, check.metricName, check.metric_name,
  ].map(normalizedName).filter(Boolean);
  if (!stepNames.length) return false;
  const rowNames = [
    rowName(row), rowEvent(row), row.stepCode, row.step_code, row.code,
    `${index + 1}`,
  ].map(normalizedName).filter(Boolean);
  return stepNames.some((name) => rowNames.some((rowNameValue) => rowNameValue.includes(name) || name.includes(rowNameValue)));
}

function readableCandidateValues(check: AnyRow) {
  const candidates = firstArray(check, ["candidateValues", "candidate_values", "matchedValues", "matched_values", "actualValues", "actual_values", "evidenceValues", "evidence_values"]);
  if (candidates.length) {
    return candidates.slice(0, 4).map((item) => typeof item === "string" ? item : text(item.value ?? item.name ?? item.elementName ?? item.element_name ?? item.actionName ?? item.action_name)).filter((item) => item !== "—").join("、");
  }
  const direct = firstText(check, ["candidateValue", "candidate_value", "matchedValue", "matched_value", "actualValue", "actual_value", "suggestedValue", "suggested_value"]);
  return direct;
}

function localZeroValueCheck(row: AnyRow, index: number, rows: AnyRow[], domain: string): AnyRow | null {
  const value = rowCount(row);
  const hasDownstream = rows.slice(index + 1).some((next) => rowCount(next) > 0);
  const unavailable = row.available === false;
  if ((value > 0 || !hasDownstream) && !unavailable) return null;
  const raw = `${rowName(row)} ${rowEvent(row)} ${stepCondition(row)}`.toLowerCase();
  const downstream = rows.slice(index + 1).find((next) => rowCount(next) > 0);
  if (domain === "vpn" && (raw.includes("按钮") || raw.includes("button") || raw.includes("element_click") || raw.includes("connect"))) {
    return {
      source: "frontend_infer",
      severity: "warn",
      title: "疑似连接按钮枚举未匹配",
      status: "待后端修正",
      detail: `后续「${rowName(downstream ?? {})}」已有 ${number(rowCount(downstream ?? {}))}，当前按钮节点为 0/暂无数据，不能当作真实无人点击。`,
      suggestion: "后端请从 DWD 明细按 project/date 聚合 element_click 的 element_name/action_name 分布，把连接按钮候选枚举归一到 vpn_connect_button_click_users。",
      candidateValues: ["home_connect_button", "vpn_connect_button", "connect_button", "TAG_ButtonVPN"],
      sqlHint: "event_name='element_click' AND element_name/action_name IN ('home_connect_button','vpn_connect_button','connect_button','TAG_ButtonVPN')",
    };
  }
  if (raw.includes("permission") || raw.includes("权限")) {
    return {
      source: "frontend_infer",
      severity: "warn",
      title: "疑似权限可用口径缺失",
      status: "待后端修正",
      detail: `后续「${rowName(downstream ?? {})}」已有 ${number(rowCount(downstream ?? {}))}，但权限节点为 0/暂无数据，不能当作真实权限未通过。`,
      suggestion: "后端请把 permission_status=granted/already_granted 都计入权限可用人数；老用户通常不会再次弹权限窗。",
      candidateValues: ["granted", "already_granted"],
      sqlHint: "event_name='vpn_permission_result' AND permission_status IN ('granted','already_granted')",
    };
  }
  return {
    source: "frontend_infer",
    severity: "warn",
    title: "疑似 0 值口径异常",
    status: "系统自动检查",
    detail: `当前步骤为 0/暂无数据，但后续「${rowName(downstream ?? {})}」已有 ${number(rowCount(downstream ?? {}))}，优先检查字段枚举、汇总表 step_code 和去重口径。`,
    suggestion: "后端请返回该步骤对应事件的原始字段分布、候选修正值和 corrected_count。",
  };
}

function zeroValueAutoCheck(row: AnyRow, index: number, rows: AnyRow[], data: AnyRow | null | undefined, domain: string) {
  const backend = zeroCheckRows(data).find((check) => checkMatchesStep(check, row, index));
  if (backend) return {
    source: "backend",
    severity: firstText(backend, ["severity", "level", "status"]) || "warn",
    title: firstText(backend, ["title", "name", "summary"]) || "后端自动检查已返回",
    status: firstText(backend, ["status", "state"]) || "后端已检查",
    detail: firstText(backend, ["detail", "message", "reason", "diagnosis"]) || "后端已返回该 0 值节点的检查结果。",
    suggestion: firstText(backend, ["suggestion", "action", "fix", "fixSuggestion", "fix_suggestion"]) || "按后端返回的候选字段修正聚合口径。",
    correctedCount: numericValue(backend, ["correctedCount", "corrected_count", "suggestedCount", "suggested_count", "actualCount", "actual_count", "value"]),
    candidates: readableCandidateValues(backend),
    sqlHint: firstText(backend, ["sqlHint", "sql_hint", "basis", "whereText", "where_text"]),
  };
  const local = localZeroValueCheck(row, index, rows, domain);
  if (!local) return null;
  return {
    source: local.source,
    severity: local.severity,
    title: local.title,
    status: local.status,
    detail: local.detail,
    suggestion: local.suggestion,
    correctedCount: numericValue(local, ["correctedCount", "corrected_count"]),
    candidates: readableCandidateValues(local),
    sqlHint: firstText(local, ["sqlHint", "sql_hint"]),
  };
}

const blockedReasonLabels: Record<string, string> = {
  no_presenter: "没有可用广告展示容器/Presenter",
  subscription_user: "订阅/去广告用户",
  remote_config_disabled: "远程配置关闭",
  frequency_cap: "频控限制",
  sdk_not_initialized: "广告 SDK 未初始化",
  no_network: "无网络",
  vpn_connect_not_clicked: "未点击 VPN 连接",
  vpn_permission_not_granted: "VPN 权限未授权",
  consent_not_ready: "隐私同意未完成",
  app_background: "App 已进入后台",
  user_left_page: "用户已离开页面",
  ad_not_ready: "广告未准备好",
  cache_expired: "缓存已过期",
  cache_empty: "缓存为空",
  placement_disabled: "广告位关闭",
  country_blocked: "国家策略拦截",
  version_blocked: "版本策略拦截",
  unknown: "未知原因",
};

function blockedReasonMeaning(value: unknown) {
  const code = String(value ?? "");
  if (code === "no_presenter") return "已经进入广告资格判断，但当前页面/场景没有拿到可承载广告展示的 Presenter、Activity 或广告位容器，通常是客户端绑定/生命周期问题，不是 AdMob 没填充。";
  if (code === "subscription_user") return "用户属于订阅或去广告人群，按策略不展示广告；如果占比高，先和订阅用户规模对账。";
  if (code === "remote_config_disabled" || code === "placement_disabled") return "远程配置或广告位开关关闭，用户会在资格阶段被拦截，不会继续生成机会和请求。";
  if (code === "frequency_cap") return "频控规则命中，说明用户已达到展示上限；需要判断阈值是否过严或场景是否重复触发。";
  if (code === "sdk_not_initialized") return "广告 SDK 初始化未完成或失败，资格检查无法放行；常见于冷启动、热启动或弱网初始化慢。";
  if (code === "no_network") return "当前设备网络不可用或网络状态被判断为不可请求广告；VPN/弱网国家需要重点拆分。";
  if (code === "vpn_connect_not_clicked") return "VPN 类产品前置动作未完成：用户还没有点击连接，按策略暂不展示连接后广告。";
  if (code === "vpn_permission_not_granted") return "用户未授予 VPN 权限，因此连接后广告场景不能成立。";
  if (code === "consent_not_ready") return "隐私同意/UMP 状态未就绪，广告请求被策略拦截。";
  if (code === "app_background") return "App 已进入后台，不能安全展示广告。";
  if (code === "user_left_page") return "用户已经离开原页面，继续展示可能影响体验或失败。";
  if (code === "unknown" || !code) return "客户端没有返回明确 blocked_reason，原因不可判定；这是打点质量问题。";
  return "当前原因来自 blocked_reason 枚举，需要结合国家、版本、页面、广告位继续下钻。";
}

function blockedReasonText(value: unknown) {
  const code = text(value);
  if (code === "—") return "未返回原因";
  return blockedReasonLabels[code] ? `${blockedReasonLabels[code]}（${code}）` : code;
}

function blockedReasonAction(value: unknown) {
  const code = String(value ?? "");
  if (code === "no_presenter") return "优先查页面 Activity/Fragment 生命周期、AdPresenter 注入、placement 注册、show 前容器是否为空；按页面和广告位拆，找具体漏绑定场景。";
  if (code === "subscription_user") return "正常拦截：订阅用户不应展示广告，可和订阅人数对账。";
  if (code === "remote_config_disabled" || code === "placement_disabled") return "查远程配置、广告位开关、国家/版本灰度配置是否关闭。";
  if (code === "frequency_cap") return "查频控阈值是否过严，按页面、广告位和用户当天展示次数拆分。";
  if (code === "sdk_not_initialized") return "查 SDK 初始化时机、初始化失败日志和首屏/热启动场景。";
  if (code === "no_network") return "按网络类型、VPN 状态、国家和 ASN 拆分，确认是否弱网导致。";
  if (code === "vpn_connect_not_clicked") return "这是前置动作未完成：查连接按钮曝光、点击率和页面引导。";
  if (code === "vpn_permission_not_granted") return "查 VPN 权限弹窗曝光、授权率、拒绝后的二次引导。";
  if (code === "consent_not_ready") return "查隐私弹窗/UMP 状态，确认 consent_status 是否阻止请求。";
  if (code === "app_background" || code === "user_left_page") return "这是展示前被阻止：查页面停留、跳转、后台和广告 show 调用时机。";
  if (code === "unknown" || !code) return "unknown 占比高时优先修打点：eligible=0 必须带 blocked_reason。";
  return "按该原因继续拆国家、版本、页面、广告位和入口，找最高占比的可修复项。";
}

function blockedReasonOptimization(value: unknown) {
  const code = String(value ?? "");
  if (code === "vpn_connect_not_clicked") {
    return {
      title: "未点击 VPN 连接怎么优化",
      summary: "这个原因不是广告 SDK 问题，而是用户还没完成广告前置动作。核心要提升首页连接按钮的曝光、理解、点击和连接成功闭环。",
      sections: [
        { title: "产品策略", items: [
          "确认广告策略：连接后广告必须依赖 VPN 已连接；如果业务允许，可在连接前增加轻量广告场景，不要全部押在连接后。",
          "把用户路径拆成：首页曝光 → 连接按钮曝光 → 连接按钮点击 → 权限弹窗 → 权限通过 → 连接成功 → 广告资格检查。",
          "首页首屏只保留一个主目标：让用户点击连接。减少清理、会员、设置、节点列表等次要入口抢注意力。",
          "对未点击用户做二次引导：停留 3–5 秒未点击时展示弱提示；返回首页后再次突出连接按钮，不要直接弹广告。",
        ] },
        { title: "UI/交互", items: [
          "连接按钮必须在首屏中心或拇指热区，尺寸足够大，颜色与背景有明显对比，文案用动作型：一键连接 / Connect Now。",
          "按钮周围增加价值提示：更快连接、安全访问、选择最快节点；不要只写技术词如 VPN、Proxy、Server。",
          "按钮状态要清楚：未连接、连接中、已连接、失败重试；失败后给明确重试按钮，避免用户以为点了没反应。",
          "权限弹窗前增加预解释页：为什么需要 VPN 权限；用户拒绝后给二次引导和系统设置入口。",
        ] },
        { title: "技术实现", items: [
          "补齐按钮曝光和点击打点：screen_view、connect_button_exposure、connect_button_click、vpn_permission_result、vpn_connect_start、vpn_connect_success。",
          "广告资格检查不要过早执行：如果策略要求连接后广告，应在连接成功后或明确广告场景到达时执行，否则大量用户会被 vpn_connect_not_clicked 拦截。",
          "确保按钮点击后立即有 loading、禁重复点击、防抖和失败终态；连接失败要有 error_code、stage、node、protocol、duration_ms。",
          "按 screen_name、app_version、country、network_type、vpn_permission_status 拆分，找具体是哪个页面/版本/国家点击低。",
        ] },
        { title: "验证指标", items: [
          "连接按钮曝光率 = connect_button_exposure_users / home_screen_users。",
          "连接按钮点击率 = connect_button_click_users / connect_button_exposure_users。",
          "权限通过率 = vpn_permission_granted_users / connect_button_click_users。",
          "连接成功率 = vpn_connect_success_users / vpn_connect_start_users。",
          "优化目标不是直接看 AdMob 填充，而是先把 vpn_connect_not_clicked 占拦截比例降下来。",
        ] },
      ],
    };
  }
  if (code === "vpn_permission_not_granted") {
    return {
      title: "VPN 权限未授权怎么优化",
      summary: "用户已经接近连接，但在系统权限环节流失。重点是权限前解释、拒绝后的二次引导和权限状态打点。",
      sections: [
        { title: "产品/UI", items: ["权限弹窗前增加简短说明：为什么需要 VPN 权限、不会收集个人内容。", "用户拒绝后不要直接结束流程，展示重新授权按钮和图文指引。", "避免在冷启动第一秒就弹系统权限，先让用户理解产品价值。"] },
        { title: "技术/数据", items: ["记录 permission_popup_show、permission_result、permission_denied_type、open_system_setting_click。", "区分首次拒绝、永久拒绝、系统限制、厂商 ROM 异常。", "按国家、机型、Android 版本拆授权率。"] },
      ],
    };
  }
  if (code === "no_presenter") {
    return {
      title: "没有 Presenter 怎么优化",
      summary: "已经通过资格判断，但页面没有可展示广告的容器或 Activity。多数是客户端生命周期和广告展示层绑定问题。",
      sections: [
        { title: "技术", items: ["检查每个广告位是否注册 AdPresenter，show 前 Activity/Fragment 是否 resumed。", "页面切换、弹窗、后台恢复时要重新绑定展示上下文。", "show blocked 时返回 from_screen、to_screen、activity_state、app_state。"] },
        { title: "UI/产品", items: ["避免在页面关闭动画、跳转中、权限弹窗上方触发展示。", "把广告展示点放在页面稳定态，例如连接成功结果页停留 300–800ms 后。"] },
      ],
    };
  }
  if (code === "subscription_user") {
    return {
      title: "订阅/去广告用户怎么处理",
      summary: "这是正常策略拦截，一般不应该优化成展示广告；重点是和订阅用户规模对账，避免误判为变现损失。",
      sections: [
        { title: "运营", items: ["对账订阅用户数、活跃订阅用户数、去广告权益状态。", "如果订阅用户占比异常升高，检查订阅状态同步或权益过期逻辑。"] },
        { title: "技术", items: ["记录 subscription_status、entitlement_source、subscription_updated_at。", "区分 active、trial、grace、expired，避免 expired 用户仍被当作去广告用户。"] },
      ],
    };
  }
  return {
    title: `${blockedReasonText(code)} 怎么处理`,
    summary: "先确认这是业务策略拦截、客户端状态问题，还是打点原因缺失；再按页面、国家、版本和广告位拆到可修复对象。",
    sections: [
      { title: "产品/运营", items: ["判断该原因是否应该拦截：订阅、频控、隐私未同意通常属于合理拦截；按钮未点击、权限未授权、SDK未初始化则属于可优化流失。", "优先处理占比高、且能通过配置或 UI 改善的原因。"] },
      { title: "技术/数据", items: ["确保 eligible=0 时必传 blocked_reason。", "按 screen_name、placement、country、app_version、network_type 拆分，定位具体页面和版本。", "补充事件证据：event_id、session_id、decision_id、blocked_reason、return_value。"] },
    ],
  };
}

function appStoreInspectionLink(data?: AnyRow | null) {
  const direct = firstText(data ?? {}, ["appUrl", "app_url", "storeUrl", "store_url", "googlePlayUrl", "google_play_url", "playUrl", "play_url"]);
  if (direct) return direct;
  const appIdentifier = firstText(data ?? {}, ["appIdentifier", "app_identifier", "packageName", "package_name"]) || firstText(data?.summary ?? {}, ["appIdentifier", "app_identifier", "packageName", "package_name"]);
  const platform = `${data?.platform ?? data?.query?.platform ?? data?.summary?.platform ?? ""}`.toLowerCase();
  if (appIdentifier && platform !== "ios") return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appIdentifier)}`;
  return "";
}

function BlockedReasonOptimizationGuide({ reasonCode, data }: { reasonCode: unknown; data?: AnyRow | null }) {
  const guide = blockedReasonOptimization(reasonCode);
  const appLink = appStoreInspectionLink(data);
  return <div className="blocked-optimization-guide">
    <div className="blocked-optimization-head">
      <div><strong>{guide.title}</strong><p>{guide.summary}</p></div>
      <span>可直接给产品/设计/技术</span>
    </div>
    <div className="blocked-optimization-grid">
      {guide.sections.map((section) => <article key={section.title}>
        <strong>{section.title}</strong>
        <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
      </article>)}
      <article className="app-link-review">
        <strong>有 App 链接能看什么？</strong>
        <ul>
          <li>可以看商店截图、首屏卖点、连接按钮是否突出、评论里是否有“不会用/连不上/广告多”等问题。</li>
          <li>可以给出 UI 和流程改版建议，但不能仅凭商店链接证明真实未点击原因。</li>
          <li>要精确定位，需要结合页面曝光、按钮点击、权限结果、连接成功率、用户录屏或测试包。</li>
        </ul>
        {appLink ? <a href={appLink} target="_blank" rel="noreferrer">打开 App 商店链接辅助检查</a> : <small>当前接口没有返回 app/store 链接；可在项目配置里补 app_url，或用包名生成 Google Play 链接。</small>}
      </article>
    </div>
  </div>;
}

function firstArray(data: AnyRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeBlockedReasons(diagnosisData: AnyRow | null | undefined, isEligibilityTransition: boolean, totalLoss: number, totalCheck?: number) {
  const direct = firstArray(diagnosisData, ["blockedReasons", "blocked_reasons", "blockedReasonDistribution", "blocked_reason_distribution", "eligibilityBlockedReasons", "eligibility_blocked_reasons", "adBlockedReasons", "ad_blocked_reasons"]);
  const fallback = direct.length ? direct : isEligibilityTransition ? firstArray(diagnosisData, ["reasons", "items"]) : [];
  const rows = fallback.map((row: AnyRow) => {
    const code = row.blockedReason ?? row.blocked_reason ?? row.reasonCode ?? row.reason_code ?? row.code ?? row.reason ?? row.label;
    const count = numericValue(row, ["count", "users", "userCount", "user_count", "sessions", "sessionCount", "session_count", "value"]);
    const apiShare = normalizeRate(row.share ?? row.rate ?? row.ratio ?? row.userShare ?? row.user_share);
    const apiBlockedShare = normalizeRate(row.blockedShare ?? row.blocked_share ?? row.blockedRate ?? row.blocked_rate);
    const apiCheckShare = normalizeRate(row.checkShare ?? row.check_share ?? row.totalShare ?? row.total_share ?? row.eligibilityShare ?? row.eligibility_share);
    return {
      ...row,
      code,
      label: row.label ?? row.description ?? blockedReasonText(code),
      count: count ?? 0,
      share: apiShare,
      blockedShare: apiBlockedShare,
      checkShare: apiCheckShare,
    };
  }).filter((row) => text(row.code) !== "—" || Number(row.count) > 0);
  const sum = rows.reduce((total, row) => total + Number(row.count ?? 0), 0);
  return rows.map((row) => {
    const count = Number(row.count ?? 0);
    const blockedShare = row.blockedShare ?? row.share ?? (sum > 0 ? count / sum * 100 : totalLoss > 0 ? count / totalLoss * 100 : null);
    const checkShare = row.checkShare ?? (totalCheck && totalCheck > 0 ? count / totalCheck * 100 : null);
    return { ...row, share: blockedShare, blockedShare, checkShare };
  }).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

function dateRange(range: string) {
  const exactDate = range.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (exactDate) return { dateFrom: exactDate, dateTo: exactDate };
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
    network_failure_matrix: "网络失败横向报表",
    version_comparison: "版本对比",
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

function funnelUnitLabel(unit: FunnelUnit = "users", domain = "ads") {
  if (domain === "vpn") return "去重用户 UV";
  if (unit === "sessions") return "去重 Session";
  if (unit === "events") return "事件次数";
  return "去重用户 UV";
}

function funnelUnitHint(unit: FunnelUnit = "users", domain = "ads") {
  if (domain === "vpn") return "VPN 主漏斗按 my_user_id 去重；连接后广告链路只统计连接成功用户里的后续覆盖，会话数和 connection_id 在原因证据中下钻。";
  if (unit === "sessions") return "按 session_id 去重统计；用于看一整个广告履约链路，不等于事件次数。";
  if (unit === "events") return "按 event_id / 广告链路 ID 统计触发次数；同一用户可能触发多次，所以不是独立用户。";
  return "按 my_user_id / user_pseudo_id 去重统计；这是独立用户 UV，不是事件次数。";
}

function Funnel({ rows = [], selectedTransition, onSelectTransition, unit = "users", domain = "ads", data = null }: { rows?: AnyRow[]; selectedTransition?: DropoffSelection; onSelectTransition?: (selection: DropoffSelection) => void; unit?: FunnelUnit; domain?: string; data?: AnyRow | null }) {
  if (!rows.length) return <div className="inline-empty">当前范围没有可用漏斗步骤</div>;
  const max = Math.max(...rows.map((row) => rowCount(row)), 1);
  const unitLabel = funnelUnitLabel(unit, domain);
  const unitHint = funnelUnitHint(unit, domain);
  const renderStage = (row: AnyRow, index: number, extraClass = "") => {
    const value = rowCount(row);
    const available = row.available !== false;
    const autoCheck = zeroValueAutoCheck(row, index, rows, data, domain);
    const transition = index === 0 ? { fromIndex: 0, toIndex: Math.min(1, rows.length - 1) } : { fromIndex: index - 1, toIndex: index };
    const selected = selectedTransition?.fromIndex === transition.fromIndex && selectedTransition?.toIndex === transition.toIndex;
    const conversionRate = normalizeRate(row.conversionRate);
    const conversionOverflow = conversionRate !== null && conversionRate > 100;
    const title = `${index === 0 ? "分析第 1 步到第 2 步的流失" : `分析 ${rowName(rows[index - 1])} → ${rowName(row)} 的流失`}；当前口径：${unitHint}${conversionOverflow ? "；当前转化率超过 100%，通常说明不是严格线性漏斗，需检查去重口径、预加载缓存、跨页面归因或上一步漏记。" : ""}${autoCheck ? `；系统自动检查：${autoCheck.detail}` : ""}`;
    return <button key={row.stepCode ?? row.code ?? row.name ?? index} className={`${selected ? "selected" : ""} ${autoCheck ? "needs-auto-check" : ""} ${extraClass}`.trim()} disabled={!available} onClick={() => onSelectTransition?.(transition)} title={title}><span>{index + 1}</span><div><strong>{rowName(row)}</strong><small>{rowEvent(row)}</small>{onSelectTransition && <small className="funnel-analysis-hint">{index === 0 ? "点击分析下一步流失" : "点击分析上一步流失"}</small>}{autoCheck && <small className="zero-auto-check-detail"><b>系统自动检查</b>{autoCheck.correctedCount !== null && autoCheck.correctedCount !== undefined ? ` · 修正候选 ${number(autoCheck.correctedCount)}` : ""}：{autoCheck.title}</small>}</div><em>{available ? <>{number(value)}<small className="funnel-count-unit">{unitLabel}</small></> : "暂无数据"}{autoCheck && <small className="zero-auto-check-badge">{autoCheck.source === "backend" ? "后端已检查" : "系统自动检查"}</small>}</em><b className={conversionOverflow ? "conversion-overflow" : ""}>{row.conversionRate === null || row.conversionRate === undefined ? "—" : <>{percent(row.conversionRate)}{conversionOverflow && <small>口径倒挂</small>}</>}</b><i style={{ width: `${available ? Math.max(4, value / max * 100) : 0}%` }} /></button>;
  };
  const branchIndexes = rows.map((row, index) => row.isBranch || row.branch ? index : -1).filter((index) => index >= 0);
  if (!branchIndexes.length) return <div className="operational-funnel-list">{rows.map((row, index) => renderStage(row, index))}</div>;
  const firstBranch = Math.min(...branchIndexes);
  const lastBranch = Math.max(...branchIndexes);
  const branchBase = Math.max(1, rowCount(rows[firstBranch - 1]));
  return <div className="operational-funnel-list branched-funnel">
    {rows.slice(0, firstBranch).map((row, index) => <div className="funnel-main-node" key={row.stepCode ?? row.code ?? index}>{renderStage(row, index)}<span className="vertical-flow-line" aria-hidden="true">↓</span></div>)}
    <section className="funnel-branch-stage" aria-label="广告履约分支">
      <header><span>广告机会进入两条履约路径</span><strong>缓存优先，未命中或需刷新时走实时请求</strong></header>
      <div className="branch-split-line"><i /><span>分流</span><i /></div>
      <div className="funnel-branch-grid">{branchIndexes.map((index) => {
        const row = rows[index];
        const share = rowCount(row) / branchBase * 100;
        const tone = String(row.code ?? row.stepCode ?? "").includes("cache") ? "cache" : "request";
        return <article className={`funnel-branch-card ${tone}`} key={row.stepCode ?? row.code ?? index}>
          <div className="branch-label"><span>{tone === "cache" ? "路径 A" : "路径 B"}</span><strong>{tone === "cache" ? "缓存履约" : "实时请求"}</strong></div>
          {renderStage(row, index, "branch-node")}
          <footer><span>占广告机会</span><strong>{percent(share)}</strong></footer>
        </article>;
      })}</div>
      <div className="branch-merge-line"><i /><span>两条路径在此汇合</span><i /></div>
    </section>
    {rows.slice(lastBranch + 1).map((row, offset) => {
      const index = lastBranch + 1 + offset;
      return <div className="funnel-main-node" key={row.stepCode ?? row.code ?? index}>{renderStage(row, index)}{index < rows.length - 1 && <span className="vertical-flow-line" aria-hidden="true">↓</span>}</div>;
    })}
  </div>;
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
  if (raw.includes("dau") || raw.includes("日活跃") || raw.includes("app_foreground")) return ["pageUsers", "page_users", "screenUsers", "screen_users", "users", "viewUsers", "view_users"];
  if (raw.includes("符合广告资格") || raw.includes("通过资格") || raw.includes("eligible") || raw.includes("eligibility_pass") || raw.includes("eligibility pass")) return ["eligibleUsers", "eligible_users", "adEligibleUsers", "ad_eligible_users", "eligibilityPassUsers", "eligibility_pass_users", "passedEligibilityUsers", "passed_eligibility_users"];
  if (raw.includes("eligibility") || raw.includes("资格") || raw.includes("check")) return ["eligibilityCheckUsers", "eligibility_check_users", "adCheckUsers", "ad_check_users", "checkUsers", "check_users", "adEligibilityUsers", "ad_eligibility_users"];
  if (raw.includes("opportunity") || raw.includes("机会")) return ["opportunityUsers", "opportunity_users", "adOpportunityUsers", "ad_opportunity_users"];
  if (raw.includes("request") || raw.includes("请求")) return ["requestUsers", "request_users", "adRequestUsers", "ad_request_users"];
  if (raw.includes("show") || raw.includes("展示尝试")) return ["showAttemptUsers", "show_attempt_users", "adShowAttemptUsers", "ad_show_attempt_users"];
  if (raw.includes("impression") || raw.includes("展示")) return ["impressionUsers", "impression_users", "avUsers", "av_users", "adViewerUsers", "ad_viewer_users"];
  return ["opportunityUsers", "opportunity_users", "impressionUsers", "impression_users"];
}

function pageStepUsers(row: AnyRow, step: AnyRow) {
  for (const key of pageMetricKeysForStep(step)) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return Number(value);
  }
  return null;
}

function pageField(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function pageIdentityText(row: AnyRow) {
  return [
    row.screenName, row.screen_name, row.label, row.pageName, row.page_name,
    row.currentScreen, row.current_screen, row.placement, row.adPlacement,
    row.entrySource, row.entry_source, row.pathType, row.path_type,
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
}

function isVpnConnectSuccessAdScene(row: AnyRow) {
  const raw = pageIdentityText(row);
  return /vpn.*connect.*success|connect.*success|connection.*success|connected|connect_result|vpn_connect_result|vpn_connect_success|vpn_connected|连接成功|链接成功/.test(raw)
    || /placement.*vpn.*connect|vpn_connect|connect_success/.test(raw);
}

function isVpnNodePageAdScene(row: AnyRow) {
  const raw = pageIdentityText(row);
  return /node_page|node.*page|node.*select|nodedetail|videonode|节点页|节点选择|节点选择页/.test(raw)
    || /placement.*node|node_page|node_select/.test(raw);
}

function adImpressionAudit(row: AnyRow) {
  const pageUsers = Number(pageField(row, ["pageUsers", "page_users", "users", "screenUsers", "screen_users", "viewUsers", "view_users"]) ?? 0);
  const pageAttributedAv = Number(pageField(row, ["impressionUsers", "impression_users", "avUsers", "av_users", "adViewerUsers", "ad_viewer_users"]) ?? 0);
  const linkedAv = pageField(row, [
    "linkedImpressionUsers", "linked_impression_users",
    "correlatedImpressionUsers", "correlated_impression_users",
    "sameSessionImpressionUsers", "same_session_impression_users",
    "sameUserImpressionUsers", "same_user_impression_users",
    "verifiedImpressionUsers", "verified_impression_users",
  ]);
  const linkedValue = linkedAv === null ? null : Number(linkedAv);
  if (Number.isFinite(linkedValue) && linkedValue !== null && linkedValue > 0) {
    return {
      tone: "good",
      value: number(linkedValue),
      label: "已核验展示",
      note: `页面归因 AV ${number(pageAttributedAv)}；同用户/同 session 关联 ad_impression 后确认 ${number(linkedValue)} 人展示。`,
    };
  }
  if (pageUsers > 0 && isVpnNodePageAdScene(row) && pageAttributedAv <= 0) {
    return {
      tone: "warn",
      value: "待核验",
      label: "真实展示未知",
      note: `页面 UV ${number(pageUsers)}，页面归因 AV=0；但 A024/A024A 已确认 node_page 有插页广告和底部原生广告，需要后端用这 ${number(pageUsers)} 个用户/session 关联 ad_impression 核验。`,
    };
  }
  if (pageUsers > 0 && pageAttributedAv <= 0) {
    return {
      tone: "bad",
      value: "0",
      label: "页面归因未展示",
      note: `当前页面归因 AV=0；如果业务确认该页应有广告，需要继续查 screen_name、placement 和入口打点。`,
    };
  }
  return {
    tone: "neutral",
    value: number(pageAttributedAv),
    label: "页面归因 AV",
    note: `按当前页面归因口径统计 ad_impression 去重人数。`,
  };
}

function AdImpressionAuditCell({ row }: { row: AnyRow }) {
  const audit = adImpressionAudit(row);
  return <span className={`ad-impression-audit ${audit.tone}`}>
    <strong>{audit.value}</strong>
    <small>{audit.label}</small>
    <em>{audit.note}</em>
  </span>;
}

function requestReasonText(code: unknown) {
  const raw = String(code ?? "").trim();
  const normalized = raw.toLowerCase();
  if (!raw || raw === "—") return "暂未返回失败原因";
  if (normalized.includes("no_fill") || normalized.includes("nofill") || normalized.includes("no fill")) return "无填充：AdMob/瀑布流当前没有返回可展示广告";
  if (normalized.includes("network") || normalized.includes("timeout") || normalized.includes("weak")) return "网络/超时：用户网络、代理/VPN、DNS 或 SDK 请求超时";
  if (normalized.includes("invalid") || normalized.includes("ad_unit") || normalized.includes("unit")) return "请求参数异常：ad_unit_id、广告格式、平台或包名配置不匹配";
  if (normalized.includes("sdk") || normalized.includes("init")) return "SDK 初始化异常：AdMob 或 mediation 初始化未完成";
  if (normalized.includes("adapter") || normalized.includes("mediation")) return "聚合适配器异常：adapter 未就绪、版本不兼容或返回错误";
  if (normalized.includes("cache") || normalized.includes("expired")) return "缓存对象异常：缓存过期、对象已消费或上下文丢失";
  if (normalized.includes("frequency") || normalized.includes("cap")) return "频控拦截：请求前后被策略限制";
  if (normalized.includes("consent") || normalized.includes("privacy")) return "隐私授权拦截：consent/UMP 状态不允许请求";
  return raw;
}

function requestReasonAction(code: unknown) {
  const raw = String(code ?? "").toLowerCase();
  if (!raw || raw === "—") return "后端需按 ad_load_failed.error_code/error_domain、ad_request.request_id 聚合失败原因。";
  if (raw.includes("no_fill") || raw.includes("nofill") || raw.includes("no fill")) return "看国家、广告位、广告格式、瀑布流和 eCPM floor；必要时放宽底价或补充广告源。";
  if (raw.includes("network") || raw.includes("timeout") || raw.includes("weak")) return "按国家/ASN/VPN 状态拆分，优化超时、重试、DNS 和弱网降级。";
  if (raw.includes("invalid") || raw.includes("ad_unit") || raw.includes("unit")) return "核对 ad_unit_id、包名、平台、广告格式、AdMob App 绑定和线上配置版本。";
  if (raw.includes("sdk") || raw.includes("init")) return "把 SDK 初始化状态上报到请求前，冷启动场景延迟请求或增加初始化完成事件。";
  if (raw.includes("adapter") || raw.includes("mediation")) return "检查 mediation adapter 版本、初始化状态、国家可用性和错误堆栈摘要。";
  if (raw.includes("cache") || raw.includes("expired")) return "检查缓存 TTL、ad_instance_id 保存、预加载取出后绑定 opportunity_id 的逻辑。";
  if (raw.includes("frequency") || raw.includes("cap")) return "确认频控是否过严；按用户展示次数分布和 session 间隔重新设策略。";
  if (raw.includes("consent") || raw.includes("privacy")) return "检查 UMP/consent 上报时机，未授权用户是否应降级为非个性化广告请求。";
  return "按失败原因继续拆国家、版本、广告位、广告格式、SDK adapter 和 request_id 明细。";
}

function requestBreakdown(row: AnyRow) {
  const requestUsers = Number(pageField(row, ["requestUsers", "request_users", "adRequestUsers", "ad_request_users"]) ?? 0);
  const successUsers = Number(pageField(row, [
    "requestSuccessUsers", "request_success_users",
    "loadSuccessUsers", "load_success_users",
    "adLoadSuccessUsers", "ad_load_success_users",
  ]) ?? 0);
  const failedUsers = Number(pageField(row, [
    "requestFailedUsers", "request_failed_users", "requestFailUsers", "request_fail_users",
    "loadFailedUsers", "load_failed_users", "loadFailUsers", "load_fail_users",
    "adLoadFailedUsers", "ad_load_failed_users",
  ]) ?? 0);
  const reason = pageField(row, [
    "topRequestFailReason", "top_request_fail_reason",
    "requestFailReason", "request_fail_reason",
    "loadFailReason", "load_fail_reason",
    "topLoadFailReason", "top_load_fail_reason",
    "errorCode", "error_code", "errorDomain", "error_domain",
  ]);
  const terminalUsers = successUsers + failedUsers;
  const missingTerminal = Math.max(0, requestUsers - terminalUsers);
  const successRate = requestUsers > 0 ? successUsers / requestUsers * 100 : null;
  const failRate = requestUsers > 0 ? failedUsers / requestUsers * 100 : null;
  const tone = requestUsers <= 0 ? "neutral" : failedUsers > 0 || missingTerminal > 0 ? "warn" : successUsers > 0 ? "good" : "bad";
  return { requestUsers, successUsers, failedUsers, reason, missingTerminal, successRate, failRate, tone };
}

function RequestBreakdownCell({ row }: { row: AnyRow }) {
  const item = requestBreakdown(row);
  const reasons: AnyRow[] = row.requestFailReasons ?? row.request_fail_reasons ?? row.loadFailReasons ?? row.load_fail_reasons ?? [];
  return <span className={`request-breakdown-cell ${item.tone}`}>
    <strong>发起 {number(item.requestUsers)}</strong>
    <small>成功 {number(item.successUsers)} · 失败 {number(item.failedUsers)}</small>
    <em>{item.requestUsers > 0 ? `成功率 ${percent(item.successRate)}，失败率 ${percent(item.failRate)}${item.missingTerminal > 0 ? `，缺终态 ${number(item.missingTerminal)}` : ""}` : "当前页面没有归因到 ad_request"}</em>
    {(item.failedUsers > 0 || item.missingTerminal > 0) && <i>{requestReasonText(item.reason)}；{requestReasonAction(item.reason)}</i>}
    {reasons.length > 0 && <b>{reasons.slice(0, 3).map((reason) => `${requestReasonText(reason.errorDomain ?? reason.error_domain ?? reason.errorCode ?? reason.error_code)} ${number(reason.users ?? reason.requests ?? reason.events)}人`).join(" / ")}</b>}
  </span>;
}

function canonicalAdPageLabel(row: AnyRow) {
  if (isVpnConnectSuccessAdScene(row)) return "VPN连接成功页广告场景";
  if (isVpnNodePageAdScene(row)) return "节点选择页广告场景";
  return text(row.screenName ?? row.screen_name ?? row.label ?? row.pageName ?? row.page_name ?? row.placement);
}

function mergeAdPageAliasRows(rows: AnyRow[]) {
  const numericKeys = [
    "pageUsers", "page_users", "users", "viewUsers", "screenUsers", "screen_users",
    "elementExposeUsers", "element_expose_users", "elementClickUsers", "element_click_users",
    "eligibilityCheckUsers", "eligibility_check_users", "checkUsers", "check_users",
    "eligibleUsers", "eligible_users", "eligibilityPassUsers", "eligibility_pass_users",
    "opportunityUsers", "opportunity_users", "requestUsers", "request_users",
    "requestSuccessUsers", "request_success_users", "requestFailedUsers", "request_failed_users",
    "loadSuccessUsers", "load_success_users", "loadFailedUsers", "load_failed_users",
    "showAttemptUsers", "show_attempt_users",
    "impressionUsers", "impression_users", "avUsers", "av_users",
    "exitRate", "exit_rate",
  ];
  const groups = new Map<string, AnyRow>();
  rows.forEach((row) => {
    const canonical = canonicalAdPageLabel(row);
    const key = isVpnConnectSuccessAdScene(row) ? "vpn_connect_success_ad_scene" : canonical;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...row,
        screenName: canonical,
        screen_name: canonical,
        canonicalScreenName: canonical,
        pageAliasMerged: isVpnConnectSuccessAdScene(row),
        sourcePageNames: [text(row.screenName ?? row.screen_name ?? row.label ?? row.placement)],
      });
      return;
    }
    numericKeys.forEach((numericKey) => {
      const left = Number(current[numericKey] ?? 0);
      const right = Number(row[numericKey] ?? 0);
      if (Number.isFinite(right) && right > 0) current[numericKey] = left + right;
    });
    current.pageAliasMerged = current.pageAliasMerged || isVpnConnectSuccessAdScene(row);
    current.sourcePageNames = Array.from(new Set([...(current.sourcePageNames ?? []), text(row.screenName ?? row.screen_name ?? row.label ?? row.placement)]));
    if (!current.placement && row.placement) current.placement = row.placement;
  });
  return Array.from(groups.values());
}

function pageStepDiagnosis(page: AnyRow, fromName: string, toName: string) {
  if (page.toUsers === null) return `当前页面缺少「${toName}」到达字段，后端/ETL 需要补 page × step UV`;
  if (page.fromUsers === null) return `当前页面缺少「${fromName}」起点字段，暂不能计算这个页面的局部流失`;
  if (page.toUsers > page.fromUsers) return "到达人数大于起点人数，说明页面归因口径不一致；建议检查 screen_name 归因或页面聚合逻辑";
  if (page.missing > 0 && page.missingRate >= 80) return `重点流失：${fromName} 到 ${toName} 基本没有转过去`;
  if (page.missing > 0 && page.missingRate >= 30) return `明显流失：优先检查该页面入口、触发时机和条件拦截`;
  if (page.missing > 0) return "轻微流失：可作为次级排查";
  return "该页面当前断点无明显流失";
}

function fallbackPageDiagnosis(page: AnyRow, fromName: string, toName: string) {
  const pageUsers = Number(page.pageUsers ?? page.users ?? page.viewUsers ?? 0);
  const opportunityUsers = Number(page.opportunityUsers ?? 0);
  const impressionUsers = Number(page.impressionUsers ?? page.avUsers ?? 0);
  const exitRate = Number(page.exitRate ?? 0);
  if (pageUsers <= 0) return "这个页面没有访问人数，暂时不用作为排查入口";
  if (isVpnConnectSuccessAdScene(page) && opportunityUsers <= 0 && impressionUsers <= 0) return `连接成功页业务上已确认有广告，当前更像 screen_name / placement 旧新命名未归一，优先检查「${fromName}」到「${toName}」的页面归因字段`;
  if (isVpnNodePageAdScene(page) && opportunityUsers <= 0 && impressionUsers <= 0) return `节点页业务上已确认有插页广告和底部原生广告，当前不是“没有广告”，更像入口曝光/点击/资格检查或 placement=node_page 没有归因到页面漏斗`;
  if (opportunityUsers <= 0 && impressionUsers <= 0) return `该页面有访问但没有广告机会/展示，优先检查这里是否触发「${fromName}」以及入口条件`;
  if (exitRate >= 50) return `该页面退出率高，可能在「${fromName} → ${toName}」前离开或进入后台`;
  if (opportunityUsers > 0 && impressionUsers <= 0) return "该页面产生广告机会但没有展示，继续下钻请求、加载、show 回调";
  return "有页面访问与广告链路信号，但缺少当前断点 page × step 字段，暂作为候选页面";
}

function fallbackPageProblem(page: AnyRow, fromName: string, toName: string) {
  const pageUsers = Number(page.pageUsers ?? page.users ?? page.viewUsers ?? 0);
  const opportunityUsers = Number(page.opportunityUsers ?? 0);
  const impressionUsers = Number(page.impressionUsers ?? page.avUsers ?? 0);
  const exitRate = Number(page.exitRate ?? 0);
  const exitAnomaly = exitRate > 100;
  if (pageUsers <= 0) {
    return { level: "neutral", title: "无访问样本", evidence: "页面访问 UV 为 0", action: "暂时不用排查这个页面；先看有访问量的页面。" };
  }
  if (isVpnConnectSuccessAdScene(page) && opportunityUsers <= 0 && impressionUsers <= 0) {
    return {
      level: "warn",
      title: "连接成功页广告归因需统一",
      evidence: `页面 UV ${number(pageUsers)}，但当前页面聚合下广告机会/AV 为 0；A024A 已确认连接成功后有广告，不能判断为“没有广告”。`,
      action: "统一旧版/新版页面名和广告位：connect_success_gate_page、connect_success、vpn_connected、连接成功页等都映射到「VPN连接成功页广告场景」；同时检查 ad_eligibility_check.screen_name、ad_opportunity.placement、ad_request.placement 是否一致。",
    };
  }
  if (isVpnNodePageAdScene(page) && opportunityUsers <= 0 && impressionUsers <= 0) {
    return {
      level: "warn",
      title: "节点页有广告，当前缺少页面归因",
      evidence: `页面 UV ${number(pageUsers)}，但当前页面聚合下广告机会/AV 为 0；A024/A024A 已确认 node 节点后有插页广告和底部原生广告，不能判断为“没有广告”。`,
      action: "把 node_page、NodeDetailActivity、VideoNodeActivity、node_select 等页面/广告位归一为「节点选择页广告场景」；重点查 ad_eligibility_check.screen_name、ad_opportunity.placement、ad_request.placement 是否使用 placement=node_page，并补齐入口曝光/点击字段。",
    };
  }
  if (opportunityUsers <= 0 && impressionUsers <= 0) {
    return {
      level: "bad",
      title: "页面有访问，但没有广告链路信号",
      evidence: `页面 UV ${number(pageUsers)}，广告机会 0，广告浏览 0${exitAnomaly ? `；退出率 ${percent(exitRate)} 也超过 100%，口径需校验` : ""}`,
      action: `先查该页面是否触发 ${rowEvent({ event: "ad_eligibility_check" })}；如果触发了，再看 eligible 与 blocked_reason；如果没触发，查入口曝光/点击、广告策略和 SDK 上报。`,
    };
  }
  if (exitAnomaly) {
    return {
      level: "warn",
      title: "页面退出率口径异常",
      evidence: `退出率 ${percent(exitRate)} 超过 100%，说明 screen_view 和 screen_exit 去重口径不一致。`,
      action: "先校验 screen_view_id、screen_name、screen_exit 是否重复或跨天归因；否则页面流失会被放大。",
    };
  }
  if (opportunityUsers > 0 && impressionUsers <= 0) {
    return {
      level: "warn",
      title: "有广告机会，但没有展示",
      evidence: `广告机会 UV ${number(opportunityUsers)}，广告浏览 AV 0。`,
      action: "继续查 ad_request、ad_load_success、ad_show_attempt、ad_show_blocked/show_failed，定位是请求、加载还是展示调用断了。",
    };
  }
  return {
    level: "neutral",
    title: "有链路信号，但缺精确步骤人数",
    evidence: `页面 UV ${number(pageUsers)}，广告机会 ${number(opportunityUsers)}，广告浏览 ${number(impressionUsers)}。`,
    action: `后端补齐该页面在「${fromName}」和「${toName}」的人数后，可精确计算局部流失。`,
  };
}

function inferFeatureFromPage(page: AnyRow) {
  const screenName = text(page.screenName ?? page.screen_name ?? page.label);
  const normalized = screenName.toLowerCase();
  if (normalized.includes("splash")) return { functionModule: "启动页变现", functionName: "启动页广告", elementId: "splash_ad_entry", placement: "splash", adFormat: "开屏/插屏", owner: "客户端广告模块" };
  if (isVpnConnectSuccessAdScene(page) || normalized.includes("connection") || normalized.includes("connect_success") || normalized.includes("连接成功")) return { functionModule: "连接成功变现", functionName: "连接成功页广告", elementId: "connect_success_ad_entry", placement: "connect_success", adFormat: "插屏", owner: "VPN 连接结果页" };
  if (normalized.includes("main")) return { functionModule: "首页变现", functionName: "首页核心入口广告", elementId: "home_ad_entry", placement: "home", adFormat: "插屏/Banner", owner: "首页业务模块" };
  if (normalized.includes("node")) return { functionModule: "节点页变现", functionName: "节点选择页广告", elementId: "node_select_ad_entry", placement: "node_page", adFormat: "插页 + 底部原生", owner: "节点选择模块" };
  if (normalized.includes("home")) return { functionModule: "首页变现", functionName: "首页广告入口", elementId: "home_page_ad_entry", placement: "home_page", adFormat: "Banner/原生", owner: "首页业务模块" };
  if (normalized.includes("loading")) return { functionModule: "加载页变现", functionName: "加载过程广告", elementId: "loading_ad_entry", placement: "loading", adFormat: "插屏/激励", owner: "加载流程模块" };
  return { functionModule: "页面广告场景", functionName: `${screenName} 广告入口`, elementId: `${screenName.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_ad_entry`, placement: screenName.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(), adFormat: "按配置", owner: "页面业务模块" };
}

function featureNumber(row: AnyRow, keys: string[]) {
  const value = pageField(row, keys);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function featureDiagnosis(row: AnyRow, fromName: string, toName: string, topBlockedReason?: AnyRow) {
  const pageUsers = Number(row.pageUsers ?? 0);
  const exposeUsers = Number(row.elementExposeUsers ?? 0);
  const clickUsers = Number(row.elementClickUsers ?? 0);
  const checkUsers = Number(row.checkUsers ?? 0);
  const eligibleUsers = Number(row.eligibleUsers ?? 0);
  const opportunityUsers = Number(row.opportunityUsers ?? 0);
  const requestUsers = Number(row.requestUsers ?? 0);
  const requestSuccessUsers = Number(row.requestSuccessUsers ?? 0);
  const requestFailedUsers = Number(row.requestFailedUsers ?? 0);
  const showAttemptUsers = Number(row.showAttemptUsers ?? 0);
  const impressionUsers = Number(row.impressionUsers ?? 0);
  const blockedCode = text(row.blockedReason ?? row.blocked_reason ?? topBlockedReason?.code);
  const requestFailReason = row.topRequestFailReason ?? row.top_request_fail_reason ?? row.requestFailReason ?? row.request_fail_reason ?? row.errorCode ?? row.error_code;
  const isConnectSuccessAdScene = isVpnConnectSuccessAdScene(row);
  const isNodeAdScene = isVpnNodePageAdScene(row);
  const hasRequestSignal = requestUsers > 0 || requestSuccessUsers > 0 || requestFailedUsers > 0 || showAttemptUsers > 0 || impressionUsers > 0;
  if (pageUsers > 0 && exposeUsers === 0 && clickUsers === 0 && checkUsers === 0 && opportunityUsers === 0 && hasRequestSignal) {
    return {
      level: "bad",
      missingStep: "前置入口/资格/机会归因",
      title: "后面已经有广告请求，但前置入口、资格检查、广告机会全部为 0",
      evidence: `页面UV ${number(pageUsers)}，入口曝光 0，入口点击 0，资格检查 0，机会 0；但请求 ${number(requestUsers)}，成功 ${number(requestSuccessUsers)}，失败 ${number(requestFailedUsers)}`,
      techFix: "这不是 AdMob 没填充，也不是页面没有广告。优先修前置链路：入口曝光/点击事件、ad_eligibility_check、ad_opportunity 必须带同一个 screen_name/placement/session_id；后端也要把 ad_request.placement 回填到该页面。",
    };
  }
  if (isConnectSuccessAdScene && pageUsers > 0 && exposeUsers === 0 && clickUsers === 0 && checkUsers === 0 && opportunityUsers === 0 && impressionUsers === 0) {
    return {
      level: "warn",
      missingStep: "页面名/广告位归一",
      title: "连接成功页已确认有广告，当前更像页面名或广告位归因混用",
      evidence: `页面UV ${number(pageUsers)}，入口曝光/点击/资格检查/机会/AV 均为 0；已将 connect_success_gate_page、connect_success、vpn_connected 等别名归为同一广告场景。`,
      techFix: "不要判断“连接成功页没有广告”。请检查新版/旧版 screen_name、placement、ad_eligibility_check.screen_name、ad_opportunity.placement 是否统一映射到 VPN连接成功页广告场景；A024A 连接成功后有广告。",
    };
  }
  if (isNodeAdScene && pageUsers > 0 && exposeUsers === 0 && clickUsers === 0 && checkUsers === 0 && opportunityUsers === 0 && impressionUsers === 0) {
    return {
      level: "warn",
      missingStep: "广告入口归因/资格检查",
      title: "节点页已确认有广告，当前是归因或打点未返回",
      evidence: `页面UV ${number(pageUsers)}，入口曝光/点击/资格检查/机会/AV 均为 0；但 A024/A024A 的 node 节点后有插页广告和底部原生广告。`,
      techFix: "不要判断“节点页没有广告”。请检查 node_page 相关广告入口事件、ad_eligibility_check.screen_name、ad_opportunity.placement、ad_request.placement 是否统一；后端需把 placement=node_page 的广告链路回填到该页面。",
    };
  }
  if (pageUsers > 0 && exposeUsers === 0 && clickUsers === 0 && checkUsers === 0) {
    return {
      level: "bad",
      missingStep: "广告入口曝光/点击/资格检查",
      title: "页面有访问，但没有任何广告入口和广告链路",
      evidence: `页面UV ${number(pageUsers)}，入口曝光 0，入口点击 0，资格检查 0`,
      techFix: "检查该页面是否渲染广告入口、是否初始化 AdPresenter、placement 是否注册、是否因配置/订阅/国家策略提前返回。",
    };
  }
  if ((exposeUsers > 0 || clickUsers > 0 || pageUsers > 0) && checkUsers === 0) {
    return {
      level: "bad",
      missingStep: "ad_eligibility_check",
      title: "入口或页面已到达，但没有调用广告资格检查",
      evidence: `页面UV ${number(pageUsers)}，入口点击 ${number(clickUsers)}，资格检查 0`,
      techFix: "在该功能入口触发广告前必须调用 ad_eligibility_check；检查 Presenter 绑定、入口 click/core_action 到广告模块的调用链。",
    };
  }
  if (checkUsers > 0 && eligibleUsers === 0) {
    return {
      level: "warn",
      missingStep: "eligible = 1",
      title: "资格检查有触发，但全部不符合广告资格",
      evidence: `资格检查 ${number(checkUsers)}，资格通过 0；blocked_reason=${blockedCode}`,
      techFix: `按 blocked_reason=${blockedCode} 拆国家、版本、页面、广告位；如果是 no_presenter，优先修 Presenter/placement 绑定。`,
    };
  }
  if (eligibleUsers > 0 && opportunityUsers === 0) {
    return {
      level: "warn",
      missingStep: "ad_opportunity",
      title: "资格通过后没有生成广告机会",
      evidence: `资格通过 ${number(eligibleUsers)}，广告机会 0`,
      techFix: "检查业务场景到达后是否创建 opportunity_id；预加载广告取出时是否绑定当前 opportunity_id。",
    };
  }
  if (opportunityUsers > 0 && requestUsers === 0) {
    return {
      level: "warn",
      missingStep: "ad_request",
      title: "有广告机会，但没有真实请求",
      evidence: `广告机会 ${number(opportunityUsers)}，请求用户 0`,
      techFix: "检查缓存命中、ad_unit_id、频控二次拦截、SDK load 调用和 request_id 生成。",
    };
  }
  if (requestUsers > 0 && requestSuccessUsers === 0 && requestFailedUsers > 0) {
    return {
      level: "warn",
      missingStep: "ad_load_success",
      title: "请求已发起，但主要失败在加载阶段",
      evidence: `请求用户 ${number(requestUsers)}，请求成功 0，请求失败 ${number(requestFailedUsers)}；主要原因=${requestReasonText(requestFailReason)}`,
      techFix: requestReasonAction(requestFailReason),
    };
  }
  if (requestUsers > 0 && requestSuccessUsers === 0 && requestFailedUsers === 0) {
    return {
      level: "warn",
      missingStep: "请求终态",
      title: "有请求发起，但缺少成功/失败终态",
      evidence: `请求用户 ${number(requestUsers)}，ad_load_success=0，ad_load_failed=0`,
      techFix: "检查 request_id 是否贯穿到 ad_load_success/ad_load_failed；失败回调也必须上报 error_code/error_domain，不能只上报 ad_request。",
    };
  }
  if (requestUsers > 0 && requestSuccessUsers > 0 && showAttemptUsers === 0) {
    return {
      level: "warn",
      missingStep: "ad_show_attempt",
      title: "请求后没有进入展示尝试",
      evidence: `请求用户 ${number(requestUsers)}，请求成功 ${number(requestSuccessUsers)}，展示尝试 0`,
      techFix: "检查 load_success 到 show 的消费链路、缓存 TTL、页面切后台、ad_instance_id 是否贯穿。",
    };
  }
  if (showAttemptUsers > 0 && impressionUsers === 0) {
    return {
      level: "warn",
      missingStep: "ad_impression",
      title: "展示尝试后没有产生广告浏览",
      evidence: `展示尝试 ${number(showAttemptUsers)}，AV 0`,
      techFix: "检查 show_failed、ad_show_blocked、SDK 展示回调、页面遮挡和广告对象状态。",
    };
  }
  return {
    level: "good",
    missingStep: "链路有到达",
    title: "该功能入口已有广告链路信号",
    evidence: `${fromName} → ${toName} 当前可继续看下一断点`,
    techFix: "继续按后续请求、加载、展示、收益回调逐步下钻。",
  };
}

function buildFeatureRows(pageRows: AnyRow[], fromName: string, toName: string, topBlockedReason?: AnyRow) {
  const rawSourceRows: AnyRow[] = firstArray({ rows: pageRows }, ["features", "featureRows", "rows"]) ?? pageRows;
  const sourceRows = mergeAdPageAliasRows(rawSourceRows);
  return sourceRows.map((row) => {
    const inferred = inferFeatureFromPage(row);
    const pageUsers = featureNumber(row, ["pageUsers", "page_users", "users", "screenUsers", "screen_users", "viewUsers"]);
    const elementExposeUsers = featureNumber(row, ["elementExposeUsers", "element_expose_users", "entryExposeUsers", "entry_expose_users", "exposeUsers"]);
    const elementClickUsers = featureNumber(row, ["elementClickUsers", "element_click_users", "entryClickUsers", "entry_click_users", "clickUsers", "coreActionUsers", "core_action_users"]);
    const checkUsers = featureNumber(row, ["eligibilityCheckUsers", "eligibility_check_users", "checkUsers", "check_users"]);
    const eligibleUsers = featureNumber(row, ["eligibleUsers", "eligible_users", "eligibilityPassUsers", "eligibility_pass_users"]);
    const opportunityUsers = featureNumber(row, ["opportunityUsers", "opportunity_users"]);
    const requestUsers = featureNumber(row, ["requestUsers", "request_users"]);
    const requestSuccessUsers = featureNumber(row, ["requestSuccessUsers", "request_success_users", "loadSuccessUsers", "load_success_users", "adLoadSuccessUsers", "ad_load_success_users"]);
    const requestFailedUsers = featureNumber(row, ["requestFailedUsers", "request_failed_users", "requestFailUsers", "request_fail_users", "loadFailedUsers", "load_failed_users", "loadFailUsers", "load_fail_users", "adLoadFailedUsers", "ad_load_failed_users"]);
    const showAttemptUsers = featureNumber(row, ["showAttemptUsers", "show_attempt_users"]);
    const impressionUsers = featureNumber(row, ["impressionUsers", "impression_users", "avUsers", "av_users"]);
    const enriched = {
      ...row,
      ...inferred,
      functionModule: row.functionModule ?? row.function_module ?? row.module ?? inferred.functionModule,
      functionName: row.functionName ?? row.function_name ?? row.featureName ?? row.feature_name ?? inferred.functionName,
      elementId: row.elementId ?? row.element_id ?? inferred.elementId,
      elementName: row.elementName ?? row.element_name ?? row.entryName ?? row.entry_name ?? inferred.functionName,
      placement: row.placement ?? row.adPlacement ?? row.ad_placement ?? inferred.placement,
      adFormat: row.adFormat ?? row.ad_format ?? inferred.adFormat,
      owner: row.owner ?? row.suggestedOwner ?? row.suggested_owner ?? inferred.owner,
      screenName: row.canonicalScreenName ?? row.screenName ?? row.screen_name ?? row.label,
      pageUsers,
      elementExposeUsers,
      elementClickUsers,
      checkUsers,
      eligibleUsers,
      opportunityUsers,
      requestUsers,
      requestSuccessUsers,
      requestFailedUsers,
      showAttemptUsers,
      impressionUsers,
      topRequestFailReason: row.topRequestFailReason ?? row.top_request_fail_reason ?? row.requestFailReason ?? row.request_fail_reason ?? row.loadFailReason ?? row.load_fail_reason ?? row.errorCode ?? row.error_code,
      blockedReason: row.blockedReason ?? row.blocked_reason ?? topBlockedReason?.code,
      pageAliasMerged: row.pageAliasMerged,
      sourcePageNames: row.sourcePageNames,
    };
    const diagnosis = featureDiagnosis(enriched, fromName, toName, topBlockedReason);
    const riskScore = (diagnosis.level === "bad" ? 1000000 : diagnosis.level === "warn" ? 500000 : 0) + pageUsers + Math.max(0, checkUsers - eligibleUsers);
    return { ...enriched, diagnosis, riskScore };
  }).filter((row) => row.pageUsers > 0 || row.checkUsers > 0 || row.opportunityUsers > 0).sort((left, right) => Number(right.riskScore ?? 0) - Number(left.riskScore ?? 0)).slice(0, 12);
}

function FeatureStepChain({ row }: { row: AnyRow }) {
  const steps = [
    { label: "页面访问", event: "screen_view/page_view", field: `screen_name=${text(row.screenName)}`, value: row.pageUsers },
    { label: "入口曝光", event: "element_expose", field: `element_id=${text(row.elementId)}`, value: row.elementExposeUsers },
    { label: "入口点击", event: "element_click/core_action", field: `element_id=${text(row.elementId)}`, value: row.elementClickUsers },
    { label: "资格检查", event: "ad_eligibility_check", field: `placement=${text(row.placement)}`, value: row.checkUsers },
    { label: "资格通过", event: "ad_eligibility_check", field: "eligible=1", value: row.eligibleUsers },
    { label: "广告机会", event: "ad_opportunity", field: "opportunity_id 非空", value: row.opportunityUsers },
    { label: "请求发起", event: "ad_request", field: "request_id 非空", value: row.requestUsers },
    { label: "请求成功", event: "ad_load_success", field: "request_id/ad_instance_id 非空", value: row.requestSuccessUsers },
    { label: "请求失败", event: "ad_load_failed", field: `error_code=${text(row.topRequestFailReason)}`, value: row.requestFailedUsers },
    { label: "展示尝试", event: "ad_show_attempt", field: "ad_instance_id 非空", value: row.showAttemptUsers },
    { label: "广告浏览", event: "ad_impression", field: "impression 回调", value: row.impressionUsers },
  ];
  return <div className="feature-step-chain">{steps.map((step, index) => <article key={step.label} className={Number(step.value ?? 0) > 0 ? "done" : index <= 3 && Number(row.pageUsers ?? 0) > 0 ? "missing" : ""}><span>{index + 1}</span><strong>{step.label}</strong><code>{step.event}</code><small>{step.field}</small><em>{number(step.value)}</em></article>)}</div>;
}

function featureRate(from: unknown, to: unknown) {
  const left = Number(from ?? 0);
  const right = Number(to ?? 0);
  if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right)) return null;
  return right / left * 100;
}

function featureLoss(from: unknown, to: unknown) {
  const left = Number(from ?? 0);
  const right = Number(to ?? 0);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return Math.max(0, left - right);
}

function FeatureDropoffStrip({ row }: { row: AnyRow }) {
  const transitions = [
    { label: "页面→曝光", from: row.pageUsers, to: row.elementExposeUsers, field: "screen_name → element_id" },
    { label: "曝光→点击", from: row.elementExposeUsers, to: row.elementClickUsers, field: "element_expose → element_click/core_action" },
    { label: "点击→资格", from: Math.max(Number(row.elementClickUsers ?? 0), Number(row.pageUsers ?? 0)), to: row.checkUsers, field: "触发 ad_eligibility_check" },
    { label: "资格→通过", from: row.checkUsers, to: row.eligibleUsers, field: "eligible=1" },
    { label: "通过→机会", from: row.eligibleUsers, to: row.opportunityUsers, field: "opportunity_id 非空" },
    { label: "机会→请求", from: row.opportunityUsers, to: row.requestUsers, field: "request_id 非空" },
    { label: "请求→成功", from: row.requestUsers, to: row.requestSuccessUsers, field: "ad_load_success" },
    { label: "成功→展示", from: row.requestSuccessUsers, to: row.impressionUsers, field: "ad_impression" },
  ].map((item) => ({ ...item, rate: featureRate(item.from, item.to), loss: featureLoss(item.from, item.to) }));
  const maxLoss = Math.max(...transitions.map((item) => item.loss));
  return <div className="feature-dropoff-strip">{transitions.map((item) => <article key={item.label} className={item.loss > 0 && item.loss === maxLoss ? "largest" : item.loss > 0 ? "loss" : "ok"}><strong>{item.label}</strong><span>{number(item.from)} → {number(item.to)}</span><div><i style={{ width: `${Math.max(3, Math.min(100, item.rate ?? 0))}%` }} /></div><small>到达 {item.rate === null ? "—" : percent(item.rate)} · 流失 {number(item.loss)}</small><code>{item.field}</code></article>)}</div>;
}

function featureActionPlan(row: AnyRow) {
  const request = requestBreakdown(row);
  const hasRequestWithoutPrefix = Number(row.requestUsers ?? 0) > 0 && Number(row.checkUsers ?? 0) === 0 && Number(row.opportunityUsers ?? 0) === 0;
  if (hasRequestWithoutPrefix) {
    return {
      product: "确认这个页面是否本来就应该出广告；如果应该出广告，把它写进广告场景配置表，明确 placement、广告格式、触发时机。",
      ui: "如果是用户触发广告，页面需要有可观测入口：按钮曝光用 element_expose，点击用 element_click/core_action；如果是自动弹广告，入口字段要标 trigger_type=auto，不要硬造点击。",
      tech: "广告请求前必须补齐 ad_eligibility_check 和 ad_opportunity；ad_request、ad_load_success、ad_load_failed 要复用同一 session_id/placement/request_id。当前已有 request，说明 SDK load 发生了，但前置链路没串上。",
      verify: "修完后看四个数：入口曝光/点击不再为 0、资格检查>0、机会>0、request_id 终态完整率≈100%。",
    };
  }
  if (Number(row.pageUsers ?? 0) > 0 && Number(row.elementClickUsers ?? 0) === 0 && Number(row.requestUsers ?? 0) === 0) {
    return {
      product: "页面 UV 高但没有入口点击，先判断是入口位置弱、用户看不到，还是这个场景应该自动触发广告。",
      ui: "把入口放到主操作完成后的视觉焦点区域；如果是连接成功页，建议在成功状态稳定后 300–800ms 展示，不要放在用户快速离开的区域。",
      tech: "检查入口曝光事件是否在 View 可见后上报；点击事件绑定到真实可点击控件；不要只在 debug 包或部分版本上报。",
      verify: "目标：入口曝光/pageUV > 80%；点击/曝光按产品形态设目标，自动广告则看资格检查覆盖。",
    };
  }
  if (Number(row.checkUsers ?? 0) > 0 && Number(row.eligibleUsers ?? 0) <= 0) {
    return {
      product: "资格通过为 0 时先不要改广告位，先看 blocked_reason Top，判断是订阅、频控、国家策略、隐私授权还是配置关闭。",
      ui: "如果 blocked_reason 是 consent_not_ready 或 permission_not_granted，UI 要提前引导授权，避免到广告场景才被挡。",
      tech: `eligible=0 必须上报 blocked_reason；当前主要原因：${blockedReasonText(row.blockedReason)}。`,
      verify: "目标：unknown/空原因 <1%；可优化原因占比下降后，eligibleUsers 应该同步上升。",
    };
  }
  if (Number(row.requestUsers ?? 0) > 0 && (request.failedUsers > 0 || request.missingTerminal > 0)) {
    return {
      product: "请求失败多时，按国家、广告位、广告格式决定是调低触发频次、换广告格式，还是放宽 eCPM floor。",
      ui: "失败不可直接打断主流程；请求失败后要有静默降级或稍后重试，避免用户感知卡顿。",
      tech: `${requestReasonAction(request.reason)} 同时检查 request_id 是否都有 load_success/load_failed 终态。`,
      verify: "目标：请求终态完整率 ≥99%；load_success_rate 按国家/广告源稳定提升。",
    };
  }
  return {
    product: "当前入口已有链路信号，继续看最大流失段，不要只看单个绝对数。",
    ui: "重点优化用户还在页面内、且广告对象已准备好的展示时机。",
    tech: "继续校验 opportunity_id、request_id、ad_instance_id 是否从机会、请求、加载到展示全链路贯穿。",
    verify: "看成功后展示率、展示回调率、Paid 回调率是否同步改善。",
  };
}

function FeatureActionPlanCard({ row }: { row: AnyRow }) {
  const plan = featureActionPlan(row);
  return <div className="feature-action-plan"><div><strong>产品怎么判断</strong><p>{plan.product}</p></div><div><strong>UI/交互怎么改</strong><p>{plan.ui}</p></div><div><strong>技术怎么修</strong><p>{plan.tech}</p></div><div><strong>验收看什么</strong><p>{plan.verify}</p></div></div>;
}

const featureEvidenceFields = [
  { label: "页面访问", valueKey: "pageUsers", sourceKeys: ["pageUsers", "page_users", "users", "screenUsers", "screen_users", "viewUsers"], event: "screen_view/page_view", field: "screen_name", owner: "页面埋点" },
  { label: "入口曝光", valueKey: "elementExposeUsers", sourceKeys: ["elementExposeUsers", "element_expose_users", "entryExposeUsers", "entry_expose_users", "exposeUsers"], event: "element_expose", field: "element_id", owner: "UI 埋点" },
  { label: "入口点击", valueKey: "elementClickUsers", sourceKeys: ["elementClickUsers", "element_click_users", "entryClickUsers", "entry_click_users", "clickUsers", "coreActionUsers", "core_action_users"], event: "element_click/core_action", field: "element_id/action_name", owner: "UI/业务入口" },
  { label: "资格检查", valueKey: "checkUsers", sourceKeys: ["eligibilityCheckUsers", "eligibility_check_users", "checkUsers", "check_users"], event: "ad_eligibility_check", field: "placement + eligible", owner: "广告策略层" },
  { label: "资格通过", valueKey: "eligibleUsers", sourceKeys: ["eligibleUsers", "eligible_users", "eligibilityPassUsers", "eligibility_pass_users"], event: "ad_eligibility_check", field: "eligible=1 / blocked_reason", owner: "广告策略层" },
  { label: "广告机会", valueKey: "opportunityUsers", sourceKeys: ["opportunityUsers", "opportunity_users"], event: "ad_opportunity", field: "opportunity_id", owner: "业务场景层" },
  { label: "请求发起", valueKey: "requestUsers", sourceKeys: ["requestUsers", "request_users", "adRequestUsers", "ad_request_users"], event: "ad_request", field: "request_id", owner: "广告 SDK 调用层" },
  { label: "请求成功", valueKey: "requestSuccessUsers", sourceKeys: ["requestSuccessUsers", "request_success_users", "loadSuccessUsers", "load_success_users", "adLoadSuccessUsers", "ad_load_success_users"], event: "ad_load_success", field: "request_id + ad_instance_id", owner: "广告 SDK 回调层" },
  { label: "请求失败", valueKey: "requestFailedUsers", sourceKeys: ["requestFailedUsers", "request_failed_users", "requestFailUsers", "request_fail_users", "loadFailedUsers", "load_failed_users", "loadFailUsers", "load_fail_users", "adLoadFailedUsers", "ad_load_failed_users"], event: "ad_load_failed", field: "error_domain + error_code", owner: "广告 SDK 回调层" },
  { label: "展示尝试", valueKey: "showAttemptUsers", sourceKeys: ["showAttemptUsers", "show_attempt_users"], event: "ad_show_attempt", field: "ad_instance_id", owner: "展示调用层" },
  { label: "广告浏览", valueKey: "impressionUsers", sourceKeys: ["impressionUsers", "impression_users", "avUsers", "av_users", "linkedImpressionUsers", "linked_impression_users", "correlatedImpressionUsers", "correlated_impression_users"], event: "ad_impression", field: "ad_instance_id/impression", owner: "展示回调层" },
];

function rowHasAnyField(row: AnyRow, keys: string[]) {
  return keys.some((key) => row[key] !== undefined && row[key] !== null);
}

function featureEvidenceRows(row: AnyRow) {
  return featureEvidenceFields.map((item, index) => {
    const value = Number(row[item.valueKey] ?? 0);
    const returned = rowHasAnyField(row, item.sourceKeys) || row[item.valueKey] !== undefined;
    const previous = index > 0 ? Number(row[featureEvidenceFields[index - 1].valueKey] ?? 0) : 0;
    const missingAfterArrival = index > 0 && previous > 0 && value <= 0;
    const status = !returned ? "缺后端字段" : missingAfterArrival ? "疑似断点" : value > 0 ? "有数据" : "0";
    const action = !returned
      ? `后端需返回 ${item.sourceKeys.slice(0, 3).join(" / ")}；可从 dwd_app_tracking_event_v18 按 ${item.event} 聚合。`
      : missingAfterArrival
        ? `上一环节已有 ${number(previous)}，这里为 0；优先查 ${item.event} 是否上报，且 ${item.field} 是否和页面/广告位一致。`
        : value > 0
          ? "当前环节已有数据，可继续看下一环节。"
          : "如果业务确认该页面应触发此环节，再按事件名和字段回查。";
    return { ...item, value, returned, status, action };
  });
}

function featureDecisionSummary(row: AnyRow) {
  const rows = featureEvidenceRows(row);
  const firstBreak = rows.find((item, index) => index > 0 && rows[index - 1].value > 0 && item.value <= 0);
  const missingFields = rows.filter((item) => !item.returned);
  const request = requestBreakdown(row);
  if (firstBreak) return `优先查「${firstBreak.label}」：${firstBreak.event}，字段 ${firstBreak.field}。`;
  if (missingFields.length) return `当前不是业务结论，先补后端返回字段：${missingFields.slice(0, 3).map((item) => item.label).join("、")}。`;
  if (request.failedUsers > 0) return `广告请求失败存在，先按 error_domain/error_code 拆：${requestReasonText(request.reason)}。`;
  return "链路暂未发现单点断裂，继续按国家、版本、广告位、用户分层看差异。";
}

function FeatureEvidenceMatrix({ row }: { row: AnyRow }) {
  const rows = featureEvidenceRows(row);
  const reasons: AnyRow[] = row.requestFailReasons ?? row.request_fail_reasons ?? row.loadFailReasons ?? row.load_fail_reasons ?? [];
  return <div className="feature-evidence-matrix">
    <header><strong>字段证据与研发排查</strong><span>{featureDecisionSummary(row)}</span></header>
    <div className="feature-evidence-grid">
      {rows.map((item) => <article key={item.label} className={!item.returned ? "missing-field" : item.status === "疑似断点" ? "breakpoint" : item.value > 0 ? "ok" : ""}>
        <strong>{item.label}</strong>
        <em>{number(item.value)}</em>
        <small>{item.event}</small>
        <code>{item.field}</code>
        <b>{item.status}</b>
        <p>{item.action}</p>
      </article>)}
    </div>
    <div className="feature-tech-ticket">
      <div><strong>技术定位字段</strong><p><code>screen_name={text(row.screenName)}</code>、<code>placement={text(row.placement)}</code>、<code>element_id={text(row.elementId)}</code>、<code>session_id</code>、<code>opportunity_id</code>、<code>request_id</code>、<code>ad_instance_id</code> 必须能串起来。</p></div>
      <div><strong>请求失败怎么拆</strong>{reasons.length ? <p>{reasons.slice(0, 4).map((reason) => `${requestReasonText(reason.errorDomain ?? reason.error_domain ?? reason.errorCode ?? reason.error_code)}：${number(reason.users ?? reason.requests ?? reason.events)}人`).join("；")}</p> : <p>当前未返回失败原因分布。后端建议返回 <code>request_fail_reasons[]</code>，字段包含 <code>error_domain</code>、<code>error_code</code>、<code>users</code>、<code>requests</code>、<code>rate</code>。</p>}</div>
    </div>
  </div>;
}

function FeatureDrilldownPanel({ rows, fromName, toName }: { rows: AnyRow[]; fromName: string; toName: string }) {
  if (!rows.length) return null;
  const top = rows[0];
  return <section className="surface feature-drilldown-panel">
    <div className="surface-title"><div><h2>功能入口 × 技术定位</h2><p>把“哪个页面流失”继续拆成“哪个功能入口、哪个事件没触发、技术该改哪里”。优先看红色行。</p></div><span>{rows.length} 个入口</span></div>
    <div className={`feature-root-cause ${top.diagnosis.level}`}>
      <div><strong>当前最该改的点：{text(top.screenName)} / {text(top.functionName)}</strong><p>{text(top.diagnosis.title)}。证据：{text(top.diagnosis.evidence)}</p>{top.pageAliasMerged && <small>已合并页面别名：{(top.sourcePageNames ?? []).map((item: string) => text(item)).join("、")}</small>}</div>
      <dl><div><dt>缺失步骤</dt><dd>{text(top.diagnosis.missingStep)}</dd></div><div><dt>广告位</dt><dd>{text(top.placement)}</dd></div><div><dt>建议负责人</dt><dd>{text(top.owner)}</dd></div></dl>
    </div>
    <div className="request-diagnosis-note"><strong>请求怎么拆：</strong><span>请求发起看 <code>ad_request.request_id</code>，请求成功看 <code>ad_load_success</code>，请求失败看 <code>ad_load_failed.error_code/error_domain</code>。如果入口/资格/机会为 0 但请求不为 0，优先判断为“前置埋点或页面归因断裂”，不是 AdMob 没填充。</span></div>
    <FeatureDropoffStrip row={top} />
    <FeatureEvidenceMatrix row={top} />
    <div className="table-wrap"><table className="feature-drilldown-table"><thead><tr><th>页面 / 功能</th><th>入口字段</th><th>页面UV</th><th>入口曝光</th><th>入口点击</th><th>资格检查</th><th>资格通过</th><th>机会</th><th>请求细分</th><th>展示核验</th><th>缺失步骤</th><th>技术可改点</th></tr></thead><tbody>{rows.map((row) => <Fragment key={`${row.screenName}-${row.elementId}`}><tr className={row.diagnosis.level === "bad" ? "row-bad" : row.diagnosis.level === "warn" ? "row-warn" : "row-good"}><td><strong>{text(row.screenName)}</strong><small>{text(row.functionModule)} / {text(row.functionName)}</small></td><td><code>element_id={text(row.elementId)}</code><small>placement={text(row.placement)} · {text(row.adFormat)}</small></td><td>{number(row.pageUsers)}</td><td>{number(row.elementExposeUsers)}</td><td>{number(row.elementClickUsers)}</td><td>{number(row.checkUsers)}</td><td>{number(row.eligibleUsers)}</td><td>{number(row.opportunityUsers)}</td><td><RequestBreakdownCell row={row} /></td><td><AdImpressionAuditCell row={row} /></td><td><strong>{text(row.diagnosis.missingStep)}</strong><small>{text(row.diagnosis.evidence)}</small></td><td><small>{text(row.diagnosis.techFix)}</small></td></tr><tr className="feature-detail-row"><td colSpan={12}><div className="feature-detail-grid"><FeatureDropoffStrip row={row} /><FeatureActionPlanCard row={row} /><FeatureEvidenceMatrix row={row} /></div></td></tr></Fragment>)}</tbody></table></div>
    <div className="surface nested feature-chain-card"><div className="surface-title"><div><h2>最高优先级入口事件链</h2><p>下面这条链给研发对照 SDK：哪一步为 0，就从那一步往前查调用和字段。</p></div><span>{text(top.functionName)}</span></div><FeatureStepChain row={top} /></div>
  </section>;
}

function DropoffAnalysisPanel({ rows, selection, onSelectionChange, data, pageData, diagnosisData, pageProgress, diagnosisProgress }: { rows: AnyRow[]; selection: DropoffSelection; onSelectionChange: (selection: DropoffSelection) => void; data?: AnyRow | null; pageData?: AnyRow | null; diagnosisData?: AnyRow | null; pageProgress?: QueryProgressItem; diagnosisProgress?: QueryProgressItem }) {
  if (rows.length < 2) return null;
  const safeFrom = Math.max(0, Math.min(selection.fromIndex, rows.length - 2));
  const safeTo = Math.max(safeFrom + 1, Math.min(selection.toIndex, rows.length - 1));
  const from = rows[safeFrom];
  const to = rows[safeTo];
  const fromValue = rowCount(from);
  const toValue = rowCount(to);
  const { loss, passRate, lossRate } = transitionMeta(fromValue, toValue);
  const pageRows: AnyRow[] = mergeAdPageAliasRows(pageData?.pages ?? []);
  const fromStepName = rowName(from);
  const toStepName = rowName(to);
  const analyzedPages = pageRows.map((page) => {
    const pageUsers = Number(page.pageUsers ?? page.users ?? page.viewUsers ?? 0);
    const fromUsers = pageStepUsers({ ...page, pageUsers }, from);
    const toUsers = pageStepUsers(page, to);
    const comparable = fromUsers !== null && toUsers !== null && toUsers <= fromUsers;
    const anomaly = fromUsers !== null && toUsers !== null && toUsers > fromUsers;
    const missing = comparable ? Math.max(0, fromUsers - toUsers) : null;
    const missingRate = comparable && fromUsers > 0 ? missing! / fromUsers * 100 : null;
    const diagnosis = pageStepDiagnosis({ fromUsers, toUsers, missing: missing ?? 0, missingRate: missingRate ?? 0 }, fromStepName, toStepName);
    return { ...page, pageUsers, fromUsers, toUsers, reached: toUsers, missing, missingRate, anomaly, diagnosis };
  }).sort((a, b) => Number(b.missing ?? -1) - Number(a.missing ?? -1));
  const topMissingPages = analyzedPages.filter((page) => page.missing !== null && page.missing > 0).slice(0, 8);
  const anomalyPages = analyzedPages.filter((page) => page.anomaly).slice(0, 5);
  const computablePages = analyzedPages.filter((page) => page.missing !== null);
  const activePages = computablePages.filter((page) => Number(page.toUsers ?? 0) > 0).slice(0, 5);
  const inactivePages = computablePages.filter((page) => Number(page.toUsers ?? 0) === 0 && Number(page.fromUsers ?? 0) > 0).slice(0, 5);
  const biggestDropoffPage = topMissingPages[0];
  const pageTableRows = topMissingPages.length || anomalyPages.length ? [...topMissingPages, ...anomalyPages].slice(0, 10) : activePages.slice(0, 10);
  const fallbackPageRows = !pageTableRows.length && pageRows.length ? pageRows.map((page) => {
    const pageUsers = Number(page.pageUsers ?? page.users ?? page.viewUsers ?? 0);
    const opportunityUsers = Number(page.opportunityUsers ?? 0);
    const impressionUsers = Number(page.impressionUsers ?? page.avUsers ?? 0);
    const exitRate = Number(page.exitRate ?? 0);
    const riskScore = pageUsers + (opportunityUsers <= 0 ? pageUsers * 2 : 0) + (impressionUsers <= 0 ? pageUsers : 0) + (exitRate >= 50 ? pageUsers : 0);
    const problem = fallbackPageProblem({ ...page, pageUsers, opportunityUsers, impressionUsers, exitRate }, fromStepName, toStepName);
    return { ...page, pageUsers, opportunityUsers, impressionUsers, exitRate, riskScore, problem, diagnosis: fallbackPageDiagnosis({ ...page, pageUsers, opportunityUsers, impressionUsers, exitRate }, fromStepName, toStepName) };
  }).sort((a, b) => Number(b.riskScore ?? 0) - Number(a.riskScore ?? 0)).slice(0, 10) : [];
  const fallbackRiskPage = fallbackPageRows[0];
  const fallbackNoAdPages = fallbackPageRows.filter((page) => Number(page.pageUsers ?? 0) > 0 && Number(page.opportunityUsers ?? 0) <= 0 && Number(page.impressionUsers ?? 0) <= 0).slice(0, 5);
  const fallbackExitAnomalyPages = fallbackPageRows.filter((page) => Number(page.exitRate ?? 0) > 100).slice(0, 5);
  const reasons: AnyRow[] = diagnosisData?.reasons ?? [];
  const isFirstCheck = safeFrom === 0 && (`${rowName(to)} ${rowEvent(to)}`.toLowerCase().includes("check") || rowName(to).includes("资格"));
  const isEligibilityTransition = isEligibilityPassTransition(from, to);
  const blockedReasons = normalizeBlockedReasons(diagnosisData, isEligibilityTransition, loss);
  const topBlockedReason = blockedReasons[0];
  const featureRows = buildFeatureRows(pageRows, fromStepName, toStepName, topBlockedReason);
  const fromAutoCheck = zeroValueAutoCheck(from, safeFrom, rows, data, rowEvent(from).toLowerCase().includes("vpn") || rowName(from).includes("VPN") ? "vpn" : "ads");
  const toAutoCheck = zeroValueAutoCheck(to, safeTo, rows, data, rowEvent(to).toLowerCase().includes("vpn") || rowName(to).includes("VPN") ? "vpn" : "ads");
  const activeAutoCheck = toAutoCheck ?? fromAutoCheck;
  return <section className="surface dropoff-analysis-panel">
    <div className="surface-title"><div><h2>漏斗断点分析：{rowName(from)} → {rowName(to)}</h2><p>点击漏斗步骤切换分析区间；当前重点判断这批用户为什么没有进入下一步事件。</p></div><span>{loss > 0 ? lossText(loss, lossRate) : `无明显流失 · 通过率 ${passRate === null ? "—" : percent(passRate)}`}</span></div>
    <div className="dropoff-step-tabs">{rows.slice(1).map((step, index) => {
      const item = { fromIndex: index, toIndex: index + 1 };
      const active = safeFrom === item.fromIndex && safeTo === item.toIndex;
      const itemMeta = transitionMeta(rowCount(rows[index]), rowCount(step));
      return <button key={`${rowName(rows[index])}-${rowName(step)}`} className={active ? "active" : ""} onClick={() => onSelectionChange(item)}><strong>{rowName(rows[index])} → {rowName(step)}</strong><small>{lossText(itemMeta.loss, itemMeta.lossRate)} · 通过 {itemMeta.passRate === null ? "—" : percent(itemMeta.passRate)}</small></button>;
    })}</div>
    <section className="operational-metric-grid dropoff-metrics">
      <MetricCard label="起点用户" value={number(fromValue)} note={metricNoteForTransition("from", from, to, rowEvent(from))} />
      <MetricCard label="到达用户" value={number(toValue)} note={metricNoteForTransition("to", from, to, rowEvent(to))} status={passRate !== null && passRate < 70 ? "warning" : "good"} />
      <MetricCard label="流失用户" value={number(loss)} note={metricNoteForTransition("loss", from, to, `${rowName(from)} 未进入 ${rowName(to)}`)} status={lossRate !== null && lossRate > 30 ? "bad" : "warn"} />
      <MetricCard label="流失率" value={lossRate === null ? "—" : percent(lossRate)} note={metricNoteForTransition("rate", from, to, `通过率 ${passRate === null ? "—" : percent(passRate)}`)} status={lossRate !== null && lossRate > 30 ? "bad" : "warn"} />
    </section>
    {activeAutoCheck && <div className="zero-auto-check-panel"><div><strong>系统自动检查：{activeAutoCheck.title}</strong><p>{activeAutoCheck.detail}</p></div><dl>{activeAutoCheck.correctedCount !== null && activeAutoCheck.correctedCount !== undefined && <div><dt>修正候选</dt><dd>{number(activeAutoCheck.correctedCount)}</dd></div>}{activeAutoCheck.candidates && <div><dt>候选返回值</dt><dd>{activeAutoCheck.candidates}</dd></div>}<div><dt>处理动作</dt><dd>{activeAutoCheck.suggestion}</dd></div>{activeAutoCheck.sqlHint && <div><dt>建议口径</dt><dd><code>{activeAutoCheck.sqlHint}</code></dd></div>}</dl></div>}
    {isEligibilityTransition && <div className="eligibility-rule-card"><div><strong>这个断点怎么看？</strong><p>起点和到达都来自同一个事件 <code>ad_eligibility_check</code>，不是两个不同事件。系统用字段 <code>eligible</code> 判断有没有通过。</p></div><dl><div><dt>起点</dt><dd>所有 <code>ad_eligibility_check</code></dd></div><div><dt>到达</dt><dd><code>eligible = 1</code>，表示符合广告资格</dd></div><div><dt>流失</dt><dd><code>eligible = 0</code>，不符合资格</dd></div><div><dt>原因</dt><dd>看 <code>blocked_reason</code> 的具体值，不只看字段名</dd></div></dl></div>}
    {isEligibilityTransition && <div className={`blocked-reason-panel ${blockedReasons.length ? "" : "empty"}`}><div className="blocked-reason-head"><div><strong>资格拦截原因 Top</strong><small>{blockedReasons.length ? `最大原因：${blockedReasonText(topBlockedReason?.code)}，${number(topBlockedReason?.count)} 个对象；占拦截 ${percent(topBlockedReason?.blockedShare ?? topBlockedReason?.share)}，占全部检查 ${percent(topBlockedReason?.checkShare)}` : "当前接口还没有返回 blocked_reason 分布"}</small></div><span>{diagnosisProgress?.status === "done" ? "原因查询已完成" : diagnosisProgress?.status === "retrying" ? "原因自动重拉中" : diagnosisProgress?.status === "loading" ? "原因查询中" : "等待原因数据"}</span></div>{blockedReasons.length ? <div className="blocked-reason-grid detailed">{blockedReasons.slice(0, 6).map((reason) => <article key={text(reason.code)}><header><strong>{blockedReasonText(reason.code)}</strong><span>{percent(reason.blockedShare ?? reason.share)}</span></header><div className="reason-bar"><i style={{ width: `${Math.max(3, Math.min(100, Number(reason.blockedShare ?? reason.share ?? 0)))}%` }} /></div><p>{number(reason.count)} 个对象被拦截</p><dl><div><dt>占拦截</dt><dd>{percent(reason.blockedShare ?? reason.share)}</dd></div><div><dt>占检查</dt><dd>{percent(reason.checkShare)}</dd></div></dl><small><b>说明：</b>{blockedReasonMeaning(reason.code)}</small><small><b>建议：</b>{blockedReasonAction(reason.code)}</small></article>)}</div> : <div className="blocked-reason-empty"><strong>这里应该展示具体 block 原因</strong><p>后端请在诊断接口返回 <code>blockedReasons</code> 或 <code>blocked_reason_distribution</code>，每项至少包含：<code>blocked_reason</code>、<code>users/count</code>、<code>share/rate</code>。来源口径：<code>ad_eligibility_check</code> 且 <code>eligible = 0</code>。</p></div>}</div>}
    <div className="dropoff-conclusion"><strong>当前判断</strong><p>{isEligibilityTransition ? "当前是在看资格检查通过率：所有触发 ad_eligibility_check 的用户/Session 作为起点，其中 eligible=1 算到达，eligible=0 算流失；如果流失多，优先按 blocked_reason 拆原因。" : isFirstCheck ? "DAU 到广告资格检查断层，说明用户已经活跃，但没有进入广告资格判断。优先排查：哪些页面没有触发广告入口/按钮点击，广告资格检查调用时机是否过晚，入口曝光后是否被条件拦截，以及 app_foreground 与 ad_eligibility_check 是否存在打点缺失。" : loss > 0 ? `主要流失发生在 ${rowName(from)} 到 ${rowName(to)}。优先看该步骤的触发条件、页面入口、SDK 回调是否完整，以及上一环节 ID 是否能串到下一环节。` : "当前环节没有明显流失，可优先分析后续转化更低的断点。"}</p></div>
    <FeatureDrilldownPanel rows={featureRows} fromName={fromStepName} toName={toStepName} />
    <section className="two-column wide-left">
      <div className="surface nested"><div className="surface-title"><div><h2>页面 × 断点流失分析</h2><p>按当前选择的「{fromStepName} → {toStepName}」逐页计算，定位哪个页面、从哪里到哪里流失最多；从哪里/到哪里会显示事件名和判定字段取值。</p></div><span>{pageProgress?.status === "done" ? "页面路径已完成" : pageProgress?.status === "retrying" ? "页面路径自动重拉中" : pageProgress?.status === "loading" ? "页面路径查询中" : "等待页面路径"}</span></div>{pageTableRows.length ? <div className="table-wrap"><table className="page-dropoff-table"><thead><tr><th>页面</th><th>从哪里（字段=值）</th><th>到哪里（字段=值）</th><th>起点人数</th><th>到达人数</th><th>流失人数</th><th>流失率</th><th>判断</th></tr></thead><tbody>{pageTableRows.map((page) => <tr key={`${page.screenName ?? page.label}-${page.anomaly ? "anomaly" : page.missing ? "dropoff" : "ok"}`} className={page.anomaly ? "row-warn" : page.missingRate >= 80 ? "row-bad" : page.missing === 0 ? "row-good" : ""}><td><strong>{text(page.screenName ?? page.label)}</strong><small>{text(page.entrySource ?? page.pathType)}</small></td><td><strong>{fromStepName}</strong><StepEventDetail row={from} /></td><td><strong>{toStepName}</strong><StepEventDetail row={to} /></td><td>{number(page.fromUsers)}</td><td>{number(page.toUsers)}</td><td>{page.missing === null ? "—" : number(page.missing)}</td><td>{page.missingRate === null ? "—" : percent(page.missingRate)}</td><td><small>{page.diagnosis}</small></td></tr>)}</tbody></table>{!topMissingPages.length && !anomalyPages.length && <div className="diagnosis-no-reasons compact"><strong>当前断点没有页面级流失</strong><p>已展示有到达下一步的页面样本。这里不是没查到数据，而是当前「{fromStepName} → {toStepName}」在可计算页面里没有明显流失；如果要找问题，请切换上方有流失数量的断点。</p></div>}</div> : fallbackPageRows.length ? <div className="table-wrap"><div className="page-problem-banner"><strong>当前能直接看到的问题：{fallbackRiskPage ? text(fallbackRiskPage.problem?.title) : "缺少页面级漏斗人数"}</strong><span>{fallbackRiskPage ? text(fallbackRiskPage.problem?.evidence) : `接口还没返回每个页面在「${fromStepName}」和「${toStepName}」的人数，先按页面访问和广告信号排查。`}</span></div><table className="page-dropoff-table fallback problem-first"><thead><tr><th>页面</th><th>问题在哪里</th><th>数据证据</th><th>页面访问 UV</th><th>机会 UV</th><th>展示核验</th><th>退出率</th><th>下一步怎么查</th></tr></thead><tbody>{fallbackPageRows.map((page) => <tr key={`${page.screenName ?? page.label}-fallback`} className={page.problem?.level === "bad" ? "row-bad" : page.problem?.level === "warn" ? "row-warn" : ""}><td><strong>{text(page.screenName ?? page.label)}</strong><small>{text(page.entrySource ?? page.pathType)}</small></td><td><strong>{text(page.problem?.title)}</strong><small>{fromStepName} → {toStepName}</small></td><td><small>{text(page.problem?.evidence)}</small></td><td>{number(page.pageUsers)}</td><td>{number(page.opportunityUsers)}</td><td><AdImpressionAuditCell row={page} /></td><td>{percent(page.exitRate)}</td><td><small>{text(page.problem?.action)}</small></td></tr>)}</tbody></table><div className="diagnosis-no-reasons compact warn"><strong>不是让你自己猜：当前先按“页面有访问但广告链路为 0”定位问题页</strong><p>当前断点整体流失 {number(loss)}。因为接口还没返回每个页面在「{fromStepName}」和「{toStepName}」的人数，所以不能精确说“某页从资格检查到资格通过流失多少”。但可以确定：这些页面有访问量，却没有广告机会/展示信号；如果业务上这些页面应该出广告，就优先查 <code>ad_eligibility_check.screen_name</code>、<code>eligible</code>、<code>blocked_reason</code>、入口点击和广告策略。</p></div></div> : <div className="inline-empty">{pageProgress?.status === "loading" || pageProgress?.status === "pending" || pageProgress?.status === "retrying" ? "页面路径数据还在查询或自动重拉，完成后这里会自动显示每个页面从当前步骤到下一步骤的流失。" : computablePages.length ? "当前断点没有明显页面级流失，可切换其他漏斗步骤继续看。" : "当前还缺少页面级断点数据，也没有可降级展示的页面路径数据。建议后端补充每个页面在各漏斗步骤的人数。"}</div>}</div>
      <aside className="surface nested"><div className="surface-title"><div><h2>快速结论</h2><p>运营优先看最大断点和异常口径</p></div></div><dl className="operational-kv"><div><dt>最大问题页</dt><dd>{biggestDropoffPage ? `${text(biggestDropoffPage.screenName ?? biggestDropoffPage.label)}：${fromStepName} → ${toStepName}，流失 ${number(biggestDropoffPage.missing)}` : fallbackRiskPage ? `${text(fallbackRiskPage.screenName ?? fallbackRiskPage.label)}：${text(fallbackRiskPage.problem?.title)}，UV ${number(fallbackRiskPage.pageUsers)}` : "暂无"}</dd></div><div><dt>完全没有广告信号</dt><dd>{inactivePages.length ? inactivePages.map((page) => text(page.screenName ?? page.label)).join("、") : fallbackNoAdPages.length ? fallbackNoAdPages.map((page) => text(page.screenName ?? page.label)).join("、") : "暂无"}</dd></div><div><dt>有进入下一步</dt><dd>{activePages.length ? activePages.map((page) => text(page.screenName ?? page.label)).join("、") : "暂无"}</dd></div><div><dt>口径异常</dt><dd>{anomalyPages.length ? anomalyPages.map((page) => text(page.screenName ?? page.label)).join("、") : fallbackExitAnomalyPages.length ? fallbackExitAnomalyPages.map((page) => text(page.screenName ?? page.label)).join("、") : "暂无"}</dd></div><div><dt>原因数据状态</dt><dd>{diagnosisProgress?.status === "done" ? "已完成" : diagnosisProgress?.status === "retrying" ? "自动重拉中" : diagnosisProgress?.status === "loading" ? "查询中" : fallbackPageRows.length ? "缺页面级步骤人数" : "等待查询"}</dd></div></dl>{reasons.length > 0 && <div className="dropoff-reasons">{reasons.slice(0, 4).map((reason) => <div key={reason.code ?? reason.reason}><strong>{text(reason.label ?? reason.code ?? reason.reason)}</strong><small>{number(reason.count ?? reason.users)} · {percent(reason.share ?? reason.rate)}</small></div>)}</div>}</aside>
    </section>
  </section>;
}

function AvailabilityBanner({ data }: { data: AnyRow }) {
  const availability = data.dataAvailability ?? {};
  if (availability.dwsFunnelAvailable !== false) return null;
  const suggestions: string[] = availability.suggestions ?? [];
  return <section className="surface operational-warning"><div className="surface-title"><div><h2>当前项目暂无 DWS 标准事件汇总</h2><p>{text(availability.reason)}</p></div><span>{availability.adMobAvailable ? "AdMob 有数据" : "平台数据也为空"}</span></div><dl className="operational-kv"><div><dt>项目</dt><dd>{text(availability.projectCode)}</dd></div><div><dt>包名</dt><dd>{text(availability.appIdentifier)}</dd></div><div><dt>Firebase 近24小时事件</dt><dd>{number(availability.firebaseEvents24h)}</dd></div><div><dt>最新同步水位</dt><dd>{text(availability.firebaseLatestLoadedAt)}</dd></div></dl>{suggestions.length > 0 && <div className="inline-empty"><strong>建议排查：</strong>{suggestions.join("；")}</div>}</section>;
}

function eligibilityCompare(row: AnyRow) {
  const checkUsers = numericValue(row, ["eligibilityCheckUsers", "eligibility_check_users", "adEligibilityCheckUsers", "ad_eligibility_check_users", "eligibilityCheckSessions", "eligibility_check_sessions", "checkUsers", "checkSessions"]);
  const eligibleUsers = numericValue(row, ["eligibleUsers", "eligible_users", "adEligibleUsers", "ad_eligible_users", "eligibilityPassUsers", "eligibility_pass_users", "eligibleSessions", "eligible_sessions", "passedEligibilityUsers"]);
  const apiRate = normalizeRate(row.eligibilityPassRate ?? row.eligibility_pass_rate ?? row.adEligibilityPassRate ?? row.ad_eligibility_pass_rate ?? row.eligibleRate ?? row.eligible_rate);
  const passRate = apiRate !== null ? apiRate : checkUsers !== null && checkUsers > 0 && eligibleUsers !== null ? eligibleUsers / checkUsers * 100 : null;
  const loss = checkUsers !== null && eligibleUsers !== null ? Math.max(0, checkUsers - eligibleUsers) : null;
  const lossRate = checkUsers !== null && checkUsers > 0 && loss !== null ? loss / checkUsers * 100 : null;
  const status = passRate === null ? "待补字段" : passRate < 55 ? "严重" : passRate < 70 ? "预警" : "正常";
  return { checkUsers, eligibleUsers, passRate, loss, lossRate, status, available: checkUsers !== null || eligibleUsers !== null || passRate !== null };
}

function ProjectEligibilityComparison({ projects }: { projects: AnyRow[] }) {
  const rows = projects
    .map((project) => ({ ...project, eligibility: eligibilityCompare(project) }))
    .sort((left, right) => Number(left.eligibility.passRate ?? 999) - Number(right.eligibility.passRate ?? 999));
  const availableRows = rows.filter((row) => row.eligibility.available);
  return <section className="surface package-eligibility-comparison">
    <div className="surface-title"><div><h2>各包广告资格通过率横向对比</h2><p>口径：eligibleUsers / eligibilityCheckUsers；V1.8 由 ad_eligibility_check.eligible=1 聚合，不需要新增 SDK 字段。</p></div><span>{availableRows.length ? `${availableRows.length}/${projects.length} 个包有字段` : "等待后端字段"}</span></div>
    {availableRows.length ? <div className="table-wrap"><table><thead><tr><th>项目/包</th><th>资格检查</th><th>符合资格</th><th>通过率</th><th>流失</th><th>流失率</th><th>状态</th></tr></thead><tbody>{rows.map((row) => {
      const item = row.eligibility;
      const width = item.passRate === null ? 0 : Math.max(3, Math.min(100, item.passRate));
      return <tr key={row.projectCode} className={item.status === "严重" ? "row-bad" : item.status === "预警" ? "row-warn" : ""}><td><strong>{text(row.projectCode)}</strong><small>{text(row.appName ?? row.appIdentifier)}</small></td><td>{number(item.checkUsers)}</td><td>{number(item.eligibleUsers)}</td><td><div className="rate-bar"><i style={{ width: `${width}%` }} /><strong>{item.passRate === null ? "—" : percent(item.passRate)}</strong></div></td><td>{number(item.loss)}</td><td>{item.lossRate === null ? "—" : percent(item.lossRate)}</td><td>{item.status}</td></tr>;
    })}</tbody></table></div> : <div className="inline-empty"><strong>当前多项目接口还没有返回资格通过率字段。</strong><br />后端按 V1.8 可直接聚合：ad_eligibility_check 去重得到 eligibilityCheckUsers，eligible=1 去重得到 eligibleUsers，再计算 eligibilityPassRate = eligibleUsers / eligibilityCheckUsers。</div>}
  </section>;
}

function metricValueByName(metrics: AnyRow[], patterns: RegExp[]) {
  return metricNumericValue(metrics, patterns);
}

function stageCount(rows: AnyRow[], patterns: RegExp[], data?: AnyRow | null, metrics: AnyRow[] = [], fallbackKeys: string[] = []) {
  const rowValue = valueFromRows(rows, patterns);
  if (rowValue !== null && Number.isFinite(rowValue)) return rowValue;
  const summary = data?.summary ?? {};
  const dataValue = numericValue(data ?? {}, fallbackKeys) ?? numericValue(summary, fallbackKeys);
  if (dataValue !== null) return dataValue;
  return metricValueByName(metrics, patterns);
}

function viewerStageIssue(label: string, from: number | null, to: number | null, threshold: number, reason: string, action: string) {
  const rate = from !== null && from > 0 && to !== null ? to / from * 100 : null;
  const loss = from !== null && to !== null ? Math.max(0, from - to) : null;
  const severity = rate === null ? "unknown" : rate < threshold - 20 ? "bad" : rate < threshold ? "warn" : "good";
  return { label, from, to, rate, loss, threshold, severity, reason, action };
}

function viewerStageDetail(label: string) {
  if (label.startsWith("DAU")) return {
    headline: "这个断点决定“有多少活跃用户进入广告判断”。广告浏览者比例低，第一优先就是看这里有没有漏触发。",
    owner: "产品入口 + 客户端广告策略",
    ops: ["按页面看 pageUsers → eligibilityCheckUsers，找访问高但资格检查低的页面。", "重点看连接成功页、首页、返回前台、断开页、节点选择页是否应该触发广告。", "如果某页面 UV 高但 check=0，先不要查 AdMob，先查入口/策略/打点。"],
    tech: ["在所有广告场景入口统一调用 ad_eligibility_check，不允许业务提前 return 后不上报。", "检查 screen_name、placement、trigger_type 是否统一，预加载广告不能替代业务场景资格检查。", "检查广告模块初始化、隐私状态、订阅状态、远程配置读取时机。"],
    fields: ["screen_name/page_name", "placement", "trigger_type", "ad_config_enabled", "consent_status", "subscription_status", "event_id", "session_id"],
    quickWin: "先拉页面级表：page_users、eligibility_check_users、element_click_users，按 eligibility_check_users/page_users 升序排。",
  };
  if (label.startsWith("资格检查")) return {
    headline: "这里解释“为什么用户被广告策略挡住”。eligible=0 多，不是填充问题，是策略/用户状态问题。",
    owner: "商业化策略 + 客户端策略实现",
    ops: ["看 blocked_reason Top，占比最高的原因先处理。", "把 blocked_reason 按国家、版本、广告位、订阅状态拆开，确认是不是某个包或国家策略过严。", "频控、订阅去广告属于可能正常；no_presenter、unknown、config_disabled 通常要修。"],
    tech: ["eligible=0 必须带 blocked_reason，禁止 unknown/空字符串长期存在。", "把策略判断拆成可观测字段：频控、订阅、隐私、配置、页面状态、SDK 初始化。", "如果 no_presenter 高，检查 Activity/Fragment 生命周期和 AdPresenter 绑定。"],
    fields: ["eligible=0/1", "blocked_reason", "blocked_sub_reason", "country", "app_version", "placement", "is_subscriber", "consent_status"],
    quickWin: "输出 blocked_reason_distribution：reason、users、blocked_share、check_share、top_page、top_version。",
  };
  if (label.includes("广告机会")) return {
    headline: "资格通过后必须生成 opportunity_id。这里低，说明业务场景和广告机会没有接上。",
    owner: "客户端业务场景 + 广告 SDK 封装",
    ops: ["看哪些页面 eligibleUsers 高但 opportunityUsers 低。", "VPN 产品重点检查连接成功后广告、回前台广告、断开页广告。", "检查是否把预加载广告误认为已经产生业务广告机会。"],
    tech: ["真实业务场景到达时生成 opportunity_id；预加载阶段不生成机会。", "缓存广告取出展示时，必须绑定当前业务场景的 opportunity_id。", "重试/二次触发要新建 request_id，但不能复用错误 opportunity。"],
    fields: ["opportunity_id", "placement", "trigger_type", "screen_name", "is_preload", "ad_scene", "vpn_session_id", "session_id"],
    quickWin: "按 placement 聚合 eligibleUsers → opportunityUsers，低于 90% 的广告位优先排查。",
  };
  if (label.includes("请求")) return {
    headline: "有机会但没有请求，通常是缓存、频控、ad_unit_id 或 SDK load 调用断了。",
    owner: "广告 SDK 封装 + 远程配置",
    ops: ["拆 cache_hit/cache_miss，看是缓存命中后没展示，还是实时请求没发出。", "检查广告位是否缺 ad_unit_id 或被远程配置关闭。", "看 VPN/弱网状态是否在请求前被拦截。"],
    tech: ["每次真实 load 前必须创建 request_id 和 requestContext。", "无论缓存命中还是实时请求，都要能串到 opportunity_id。", "请求未发出要上报 ad_request_blocked 或等价原因，不要静默丢。"],
    fields: ["request_id", "opportunity_id", "ad_unit_id", "cache_status", "cache_hit", "is_preload", "retry_index", "network_type", "vpn_active"],
    quickWin: "补实时请求启动率、缓存命中率、request_id 缺失率、ad_unit_id 缺失率四个指标。",
  };
  if (label.includes("加载成功")) return {
    headline: "请求后加载失败，要区分 AdMob 无填充、网络/Adapter 失败、超时、客户端终态缺失。",
    owner: "广告 SDK + 数据平台",
    ops: ["如果 AdMob 匹配率正常但这里低，多半是客户端 load 失败或终态漏报。", "按 error_domain/error_code/adapter 拆，先处理占比最高的失败。", "按国家和网络类型拆，弱网国家看 load_duration_ms P95。"],
    tech: ["ad_request 后必须有终态：load_success/load_failed/timeout/cancel。", "load_failed 要带 error_code、error_domain、adapter、load_duration_ms。", "成功后保存 ad_instance_id 和 instanceContext，供 show/impression/paid 复用。"],
    fields: ["request_id", "ad_instance_id", "response_id", "error_code", "error_domain", "adapter", "load_duration_ms", "terminal_status"],
    quickWin: "看请求终态完整率：有 request_id 的请求中，是否 100% 有 load_success 或 load_failed。",
  };
  if (label.includes("展示尝试")) return {
    headline: "加载成功后没有 show，是广告浏览者比例低最常见、也最值得产品和技术一起改的断点。",
    owner: "客户端页面生命周期 + 产品展示策略",
    ops: ["看 loaded_to_show_ms，广告是否加载完用户已经离开。", "看 App 后台、页面离开、Activity 不可用、全屏互斥、广告过期。", "评估展示时机：连接成功页是否太快跳转、按钮后是否缺承接页、是否被其他弹窗抢占。"],
    tech: ["load_success 后缓存对象和 instanceContext 必须一起保存到对象终态。", "show 前失败要上报 ad_show_blocked/ad_show_failed，并带原因。", "检查 TTL、Activity 状态、页面可见性、全屏广告互斥锁、缓存消费状态。"],
    fields: ["ad_instance_id", "loaded_to_show_ms", "cache_age_ms", "app_state", "activity_state", "show_blocked_reason", "screen_name", "placement"],
    quickWin: "补加载成功未展示率，并按 show_blocked_reason 排序：expired/background/activity_null/user_left/fullscreen_busy。",
  };
  return {
    headline: "已经调用 show 但没有 Impression，重点看 SDK 回调、展示失败、可见性和广告格式场景是否匹配。",
    owner: "广告 SDK + 页面可见性",
    ops: ["查看 show_failed 和 dismissed 是否异常高。", "Banner/原生广告要看可见面积和停留时长，不要只看 show_attempt。", "按广告格式、广告源、页面、国家拆 Impression 到达率。"],
    tech: ["show_attempt 后必须有 impression/show_failed/dismissed 中至少一个终态。", "impression 要保留 ad_instance_id、response_id、adapter、paid_event 关联。", "Banner 类要补 banner_visible、visibility_reason、visible_duration_ms。"],
    fields: ["ad_instance_id", "response_id", "ad_format", "ad_source", "show_failed_reason", "visibility_reason", "visible_duration_ms", "adapter_status"],
    quickWin: "补展示尝试终态完整率和 show_attempt → impression 到达率，低于 90% 的广告格式单独排查。",
  };
}

function viewerFrequencyStats(data: AnyRow, metrics: AnyRow[], av: number | null) {
  const summary = data.summary ?? {};
  const impressionCount = numericValue(summary, ["impressionCount", "impression_count", "adImpressionCount", "ad_impression_count", "impressions", "ad_impressions"])
    ?? numericValue(data, ["impressionCount", "impression_count", "adImpressionCount", "ad_impression_count", "impressions", "ad_impressions"])
    ?? metricNumericValue(metrics, [/广告展示次数|展示次数|impression.*count|impressions\b/]);
  const avg = numericValue(summary, ["impressionsPerViewer", "impressions_per_viewer", "avgImpressionsPerViewer", "avg_impressions_per_viewer", "avgViewerImpressions", "avg_viewer_impressions"])
    ?? numericValue(data, ["impressionsPerViewer", "impressions_per_viewer", "avgImpressionsPerViewer", "avg_impressions_per_viewer"])
    ?? (av !== null && av > 0 && impressionCount !== null ? impressionCount / av : null);
  const max = numericValue(summary, ["maxImpressionsPerViewer", "max_impressions_per_viewer", "maxViewerImpressions", "max_viewer_impressions", "viewerMaxImpressions", "viewer_max_impressions"])
    ?? numericValue(data, ["maxImpressionsPerViewer", "max_impressions_per_viewer", "maxViewerImpressions", "max_viewer_impressions"]);
  const min = numericValue(summary, ["minImpressionsPerViewer", "min_impressions_per_viewer", "minViewerImpressions", "min_viewer_impressions", "viewerMinImpressions", "viewer_min_impressions"])
    ?? numericValue(data, ["minImpressionsPerViewer", "min_impressions_per_viewer", "minViewerImpressions", "min_viewer_impressions"]);
  const rawDistribution = firstArray(data, ["viewerFrequencyDistribution", "viewer_frequency_distribution", "impressionFrequencyDistribution", "impression_frequency_distribution", "frequencyBuckets", "frequency_buckets"])
    .concat(firstArray(summary, ["viewerFrequencyDistribution", "viewer_frequency_distribution", "impressionFrequencyDistribution", "impression_frequency_distribution", "frequencyBuckets", "frequency_buckets"]));
  const distribution = rawDistribution.map((row: AnyRow, index: number) => ({
    label: text(row.bucket ?? row.label ?? row.range ?? row.frequency ?? row.impressionBucket ?? row.impression_bucket ?? `${index + 1}次`),
    users: numericValue(row, ["users", "userCount", "user_count", "viewerUsers", "viewer_users", "count", "value"]),
    share: normalizeRate(row.share ?? row.rate ?? row.ratio),
  })).filter((row) => row.users !== null || row.share !== null);
  return { impressionCount, avg, max, min, distribution };
}

function ViewerFrequencyPanel({ stats, av }: { stats: ReturnType<typeof viewerFrequencyStats>; av: number | null }) {
  const chartRows = stats.distribution.length
    ? stats.distribution
    : [
        { label: "最少", users: stats.min, share: null },
        { label: "平均", users: stats.avg, share: null },
        { label: "最多", users: stats.max, share: null },
      ].filter((row) => row.users !== null);
  const maxValue = Math.max(1, ...chartRows.map((row) => Number(row.users ?? 0)));
  return <section className="surface nested viewer-frequency-panel">
    <div className="surface-title"><div><h2>人均广告浏览次数</h2><p>这个指标回答“已经看到广告的人，平均看了几次；是否有少数用户被过度展示”。</p></div><span>{stats.distribution.length ? "真实分布" : "统计摘要"}</span></div>
    <div className="viewer-frequency-cards">
      <article><span>广告展示次数</span><strong>{number(stats.impressionCount)}</strong><small>所有 ad_impression 次数，不去重用户。</small></article>
      <article><span>广告浏览人数 AV</span><strong>{number(av)}</strong><small>至少看到一次广告的去重用户。</small></article>
      <article className="focus"><span>平均每人浏览</span><strong>{number(stats.avg)} 次</strong><small>impression_count / AV。</small></article>
      <article><span>最少</span><strong>{stats.min === null ? "待补" : `${number(stats.min)} 次`}</strong><small>后端字段 min_impressions_per_viewer。</small></article>
      <article><span>最多</span><strong>{stats.max === null ? "待补" : `${number(stats.max)} 次`}</strong><small>用于发现过度展示用户。</small></article>
    </div>
    {chartRows.length ? <div className="viewer-frequency-chart">
      {chartRows.map((row) => {
        const width = row.share !== null ? Math.max(3, Math.min(100, row.share)) : Math.max(3, Math.min(100, Number(row.users ?? 0) / maxValue * 100));
        return <div key={row.label}><span>{row.label}</span><div><i style={{ width: `${width}%` }} /></div><strong>{row.share !== null ? percent(row.share) : number(row.users)}</strong></div>;
      })}
    </div> : <div className="inline-empty compact"><strong>浏览次数分布还没返回。</strong><br />建议后端补 <code>viewer_frequency_distribution</code>：按用户当天 impression 次数分桶，例如 1次、2次、3-5次、6-10次、10次以上，并返回 users/share。</div>}
  </section>;
}

function AdViewerRatioDeepDive({ rows, data, metrics, pageData, diagnosisData, diagnosisProgress, pageProgress }: { rows: AnyRow[]; data: AnyRow; metrics: AnyRow[]; pageData?: AnyRow | null; diagnosisData?: AnyRow | null; diagnosisProgress?: QueryProgressItem; pageProgress?: QueryProgressItem }) {
  const targetRate = 80;
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const dau = stageCount(rows, [/^dau$|app_foreground|日活跃|活跃用户/], data, metrics, ["dauUsers", "activeUsers", "foregroundUsers", "appForegroundUsers"]);
  const check = stageCount(rows, [/ad_eligibility_check|广告资格检查|资格检查/], data, metrics, ["eligibilityCheckUsers", "eligibility_check_users", "adEligibilityCheckUsers", "checkUsers"]);
  const eligible = stageCount(rows, [/eligible|符合广告资格|资格通过/], data, metrics, ["eligibleUsers", "eligible_users", "adEligibleUsers", "eligibilityPassUsers"]);
  const opportunity = stageCount(rows, [/ad_opportunity|opportunity|广告机会/], data, metrics, ["opportunityUsers", "opportunity_users", "adOpportunityUsers"]);
  const request = stageCount(rows, [/ad_request|广告请求|request/], data, metrics, ["requestUsers", "request_users", "adRequestUsers"]);
  const loadSuccess = stageCount(rows, [/load_success|加载成功|ad_load_success|广告加载成功/], data, metrics, ["loadSuccessUsers", "load_success_users", "adLoadSuccessUsers"]);
  const showAttempt = stageCount(rows, [/show_attempt|展示尝试|尝试展示|ad_show_attempt/], data, metrics, ["showAttemptUsers", "show_attempt_users", "adShowAttemptUsers"]);
  const av = stageCount(rows, [/ad_impression|impression|广告浏览|广告展示|^av$/], data, metrics, ["impressionUsers", "impression_users", "avUsers", "adViewerUsers"]);
  const frequencyStats = viewerFrequencyStats(data, metrics, av);
  const currentRate = dau !== null && dau > 0 && av !== null ? av / dau * 100 : normalizeRate(data.summary?.adViewerRate ?? data.summary?.viewerRate ?? data.adViewerRate);
  if (currentRate === null || currentRate >= targetRate) return null;
  const targetAv = dau !== null && dau > 0 ? Math.ceil(dau * targetRate / 100) : null;
  const gap = targetAv !== null && av !== null ? Math.max(0, targetAv - av) : null;
  const directReasonData = firstArray(data, ["eligibilityBlockedReasons", "eligibility_blocked_reasons", "blockedReasons", "blocked_reasons"]).length
    ? { blockedReasons: firstArray(data, ["eligibilityBlockedReasons", "eligibility_blocked_reasons", "blockedReasons", "blocked_reasons"]) }
    : diagnosisData;
  const blockedReasons = normalizeBlockedReasons(directReasonData, true, eligible !== null && check !== null ? Math.max(0, check - eligible) : undefined, check ?? undefined);
  const stageIssues = [
    viewerStageIssue("DAU → 资格检查", dau, check, 90, "活跃用户没有进入广告资格判断；通常是页面没到广告场景、入口没曝光/没点击、广告初始化/隐私/订阅状态提前挡住，或 SDK 漏报 ad_eligibility_check。", "先按页面看 pageUsers → eligibilityCheckUsers，再查入口曝光/点击、AdPolicy 调用时机、consent_status、subscription_status、ad_config_enabled。"),
    viewerStageIssue("资格检查 → 资格通过", check, eligible, 85, "触发了资格检查，但 eligible=0 太多；这是策略或用户状态拦截，不是 AdMob 填充问题。", "看 blocked_reason Top：频控、订阅去广告、隐私未授权、国家/版本策略、配置关闭、网络状态；优先处理占比最高且可配置优化的原因。"),
    viewerStageIssue("资格通过 → 广告机会", eligible, opportunity, 90, "用户已经符合广告资格，但业务没有生成真实广告机会；常见于机会 ID 生成时机错误、页面场景没触发、缓存广告没有绑定当前 opportunity_id。", "检查 placement、trigger_type、opportunity_id 创建点；VPN 产品重点看连接成功页、回前台、断开页、节点选择页是否生成机会。"),
    viewerStageIssue("广告机会 → 请求", opportunity, request, 90, "有广告机会但没有真正向 SDK 发起 load；可能是缓存逻辑、二次频控、ad_unit_id 缺失、requestContext 没保存或网络/VPN 状态阻断。", "拆 cache_hit/cache_miss、实时请求启动率、request_id 缺失率、ad_unit_id、retry_index、is_preload；缓存命中也必须后续进入展示。"),
    viewerStageIssue("请求 → 加载成功", request, loadSuccess, 85, "请求发出但没有可展示广告对象；如果 AdMob 匹配率正常，则多半是客户端 load 失败、广告单元、网络、Adapter、超时或回调终态缺失。", "看 ad_load_failed error_code/error_domain、adapter、load_duration_ms、终态完整率；区分无填充、网络错误、超时和 SDK 初始化问题。"),
    viewerStageIssue("加载成功 → 展示尝试", loadSuccess ?? request, showAttempt, 90, "广告对象已可用但没有调用 show；这通常是广告浏览者比例低的核心问题之一。", "查页面离开、App 后台、Activity 不可用、广告过期、全屏互斥、缓存未消费、业务没有调用展示方法；重点看 loaded_to_show_ms 和 ad_show_blocked。"),
    viewerStageIssue("展示尝试 → AV", showAttempt, av, 90, "已经尝试展示但没有 Impression；可能是 show_failed、广告被快速关闭/遮挡、SDK 回调缺失、页面可见性不足或广告格式场景不匹配。", "看 ad_show_failed、ad_impression、ad_dismissed、banner_visible、activity_state、app_state、response_id、adapter_status。"),
  ];
  const problemStages = stageIssues.filter((item) => item.severity === "bad" || item.severity === "warn" || item.severity === "unknown");
  const worst = problemStages.filter((item) => item.loss !== null).sort((left, right) => Number(right.loss ?? 0) - Number(left.loss ?? 0))[0] ?? problemStages[0];
  const pageRows: AnyRow[] = mergeAdPageAliasRows(firstArray(pageData, ["pages", "items"])).map((row) => {
    const pageUsers = numericValue(row, ["pageUsers", "page_users", "users"]);
    const impressionUsers = numericValue(row, ["impressionUsers", "impression_users", "avUsers", "av_users"]);
    const checkUsers = numericValue(row, ["eligibilityCheckUsers", "eligibility_check_users", "checkUsers"]);
    const opportunityUsers = numericValue(row, ["opportunityUsers", "opportunity_users"]);
    const rate = pageUsers !== null && pageUsers > 0 && impressionUsers !== null ? impressionUsers / pageUsers * 100 : null;
    const gap = pageUsers !== null && impressionUsers !== null ? Math.max(0, Math.ceil(pageUsers * targetRate / 100) - impressionUsers) : null;
    const aliasMappingRisk = isVpnConnectSuccessAdScene(row) && checkUsers === 0 && opportunityUsers === 0;
    const riskScore = Number(gap ?? 0) + (aliasMappingRisk ? Number(pageUsers ?? 0) / 3 : checkUsers === 0 ? Number(pageUsers ?? 0) : 0) + (opportunityUsers === 0 ? Number(pageUsers ?? 0) / 2 : 0);
    return { ...row, pageUsers, impressionUsers, checkUsers, opportunityUsers, rate, gap, riskScore };
  }).filter((row) => row.pageUsers !== null || row.impressionUsers !== null).sort((left, right) => Number(right.riskScore ?? 0) - Number(left.riskScore ?? 0)).slice(0, 8);

  return <section className="surface ad-viewer-deep-dive">
    <div className="surface-title"><div><h2>广告浏览者比例深度诊断</h2><p>优秀目标按 <strong>80%</strong> 计算：广告浏览者比例 = AV / DAU。这里把没到 80% 的缺口拆到每个广告链路节点。</p></div><span className={currentRate < 50 ? "bad" : "warn"}>当前 {percent(currentRate)}</span></div>
    <div className="viewer-gap-hero">
      <article><span>目标 AV</span><strong>{number(targetAv)}</strong><small>DAU × 80%，目标是让大部分活跃用户至少真实看到一次广告。</small></article>
      <article className="bad"><span>当前 AV</span><strong>{number(av)}</strong><small>来自 jk_ad_impression 去重用户，不能用请求或展示尝试代替。</small></article>
      <article className={gap && gap > 0 ? "warn" : "good"}><span>距离 80% 差距</span><strong>{number(gap)}</strong><small>{worst ? `最大可疑断点：${worst.label}，流失 ${number(worst.loss)}。` : "等待更多链路字段。"}</small></article>
      <article><span>查询状态</span><strong>{pageProgress?.status === "done" ? "页面数据已完成" : pageProgress?.status === "retrying" ? "页面数据重拉中" : diagnosisProgress?.status === "loading" ? "原因查询中" : "核心数据已返回"}</strong><small>页面和原因数据回来后，会补充具体页面与 blocked_reason。</small></article>
    </div>
    <ViewerFrequencyPanel stats={frequencyStats} av={av} />
    <div className="table-wrap"><table className="viewer-stage-table expandable"><thead><tr><th>链路段</th><th>起点</th><th>到达</th><th>到达率</th><th>流失</th><th>目标阈值</th><th>为什么会低</th><th>怎么优化</th></tr></thead><tbody>{stageIssues.map((item) => {
      const detail = viewerStageDetail(item.label);
      const expanded = expandedStages[item.label] ?? item.severity === "bad";
      return <Fragment key={item.label}><tr className={item.severity === "bad" ? "row-bad" : item.severity === "warn" ? "row-warn" : item.severity === "unknown" ? "row-warn" : "row-good"}><td><button className="stage-expand-button" type="button" onClick={() => setExpandedStages((current) => ({ ...current, [item.label]: !expanded }))}><strong>{item.label}</strong><small>{expanded ? "收起详细原因" : "展开详细原因"}</small></button></td><td>{number(item.from)}</td><td>{number(item.to)}</td><td>{item.rate === null ? "字段缺失" : percent(item.rate)}</td><td>{number(item.loss)}</td><td>{percent(item.threshold)}</td><td><small>{item.reason}</small></td><td><small>{item.action}</small></td></tr>{expanded && <tr className="viewer-stage-detail-row"><td colSpan={8}><div className="viewer-stage-detail"><header><div><strong>{detail.headline}</strong><p>建议负责人：{detail.owner}；当前流失 {number(item.loss)}，到达率 {item.rate === null ? "字段缺失" : percent(item.rate)}。</p></div><span>{detail.quickWin}</span></header><div className="viewer-stage-detail-grid"><article><h3>运营先看</h3><ul>{detail.ops.map((textValue) => <li key={textValue}>{textValue}</li>)}</ul></article><article><h3>技术怎么改</h3><ul>{detail.tech.map((textValue) => <li key={textValue}>{textValue}</li>)}</ul></article><article><h3>要查字段</h3><div className="field-chip-list">{detail.fields.map((field) => <code key={field}>{field}</code>)}</div></article></div></div></td></tr>}</Fragment>;
    })}</tbody></table></div>
    <div className="viewer-diagnosis-grid">
      <div className="surface nested"><div className="surface-title"><div><h2>blocked_reason 对广告浏览者比例的影响</h2><p>只有「资格检查 → 资格通过」这段，才用 blocked_reason 解释。</p></div><span>{blockedReasons.length ? `${blockedReasons.length} 类原因` : "等待原因"}</span></div>{blockedReasons.length ? <div className="blocked-reason-grid compact detailed">{blockedReasons.slice(0, 6).map((reason) => <article key={text(reason.code)}><header><strong>{blockedReasonText(reason.code)}</strong><span>{percent(reason.blockedShare ?? reason.share)}</span></header><p>{number(reason.count)} 个对象</p><small><b>建议：</b>{blockedReasonAction(reason.code)}</small></article>)}</div> : <div className="inline-empty">当前还没返回 blocked_reason 分布。后端需按 <code>ad_eligibility_check</code> 且 <code>eligible=0</code> 聚合 blocked_reason、users/count、share。</div>}</div>
      <div className="surface nested"><div className="surface-title"><div><h2>页面/广告位优先排查</h2><p>优先找页面 UV 高但 AV 低、资格检查或机会为 0 的页面；连接成功页会合并旧版/新版页面名后再判断。</p></div><span>{pageRows.length ? `${pageRows.length} 个页面` : "等待页面路径"}</span></div>{pageRows.length ? <div className="table-wrap"><table><thead><tr><th>页面</th><th>页面UV</th><th>资格检查</th><th>机会</th><th>AV</th><th>页面浏览者比例</th><th>距离80%缺口</th></tr></thead><tbody>{pageRows.map((page) => <tr key={text(page.screenName ?? page.screen_name)} className={page.rate !== null && page.rate < 40 ? "row-bad" : page.rate !== null && page.rate < 80 ? "row-warn" : ""}><td><strong>{text(page.screenName ?? page.screen_name ?? page.label)}</strong><small>{page.pageAliasMerged ? `已合并：${(page.sourcePageNames ?? []).map((item: string) => text(item)).join("、")}` : text(page.placement ?? page.entrySource ?? page.pathType)}</small></td><td>{number(page.pageUsers)}</td><td>{number(page.checkUsers)}</td><td>{number(page.opportunityUsers)}</td><td>{number(page.impressionUsers)}</td><td>{page.rate === null ? "—" : percent(page.rate)}</td><td>{number(page.gap)}</td></tr>)}</tbody></table></div> : <div className="inline-empty">{pageProgress?.status === "loading" || pageProgress?.status === "retrying" ? "页面路径还在查询，完成后会显示页面级 AV 缺口。" : "后端需要返回页面级 page_users、eligibility_check_users、opportunity_users、impression_users，才能定位具体页面。"}</div>}</div>
    </div>
  </section>;
}

function projectIssueMeta(row: AnyRow) {
  const dauUsers = numericValue(row, ["dauUsers", "activeUsers", "users", "foregroundUsers", "appForegroundUsers"]) ?? 0;
  const avUsers = numericValue(row, ["impressionUsers", "impression_users", "avUsers", "adViewerUsers"]) ?? null;
  const checkUsers = numericValue(row, ["eligibilityCheckUsers", "eligibility_check_users", "adEligibilityCheckUsers", "checkUsers"]);
  const eligibleUsers = numericValue(row, ["eligibleUsers", "eligible_users", "adEligibleUsers", "eligibilityPassUsers"]);
  const opportunityUsers = numericValue(row, ["opportunityUsers", "opportunity_users", "adOpportunityUsers"]);
  const requestUsers = numericValue(row, ["requestUsers", "request_users", "adRequestUsers"]);
  const showAttemptUsers = numericValue(row, ["showAttemptUsers", "show_attempt_users", "adShowAttemptUsers"]);
  const impressionUsers = numericValue(row, ["impressionUsers", "impression_users", "avUsers", "adViewerUsers"]);
  const viewerRate = normalizeRate(row.adViewerRate ?? row.ad_viewer_rate ?? row.viewerRate ?? row.viewer_ratio);
  const opportunityCoverage = normalizeRate(row.opportunityCoverage ?? row.opportunity_coverage);
  const eligibility = eligibilityCompare(row);
  const statusTextRaw = `${row.status ?? row.healthStatus ?? row.dataStatus ?? ""}`;
  const abnormalStep = firstText(row, ["abnormalStep", "abnormal_step", "worstStep", "worst_step", "largestDropoffStep", "largest_dropoff_step"]);
  const issues: Array<{ severity: "bad" | "warn"; score: number; title: string; detail: string; action: string; loss?: number | null; rate?: number | null }> = [];

  if (abnormalStep && !/正常|健康|ok|good|none|无/.test(abnormalStep.toLowerCase())) {
    issues.push({ severity: "bad", score: 95, title: abnormalStep, detail: "后端已标记该项目存在异常步骤。", action: "点击项目进入单项目分析，直接查看核心漏斗最大断点与页面路径。" });
  }
  if (eligibility.passRate !== null && eligibility.passRate < 70) {
    issues.push({ severity: eligibility.passRate < 55 ? "bad" : "warn", score: eligibility.passRate < 55 ? 90 : 70, title: "广告资格通过率低", detail: `资格检查 ${number(eligibility.checkUsers)}，通过 ${number(eligibility.eligibleUsers)}，通过率 ${percent(eligibility.passRate)}。`, action: "进入单项目后看 blocked_reason 分布，优先处理占比最高的拦截原因。", loss: eligibility.loss, rate: eligibility.passRate });
  }
  if (viewerRate !== null && viewerRate < 50) {
    issues.push({ severity: "bad", score: 86, title: "广告浏览者比例低", detail: `AV/DAU 只有 ${percent(viewerRate)}，活跃用户没有充分看到广告。`, action: "先看 DAU→资格检查、资格通过→机会、加载成功→展示尝试三个断点。", rate: viewerRate });
  } else if (viewerRate !== null && viewerRate < 65) {
    issues.push({ severity: "warn", score: 62, title: "广告浏览者比例偏低", detail: `AV/DAU 为 ${percent(viewerRate)}，建议继续拆页面入口和展示链路。`, action: "进入单项目对比页面级 AV 与机会覆盖。", rate: viewerRate });
  }
  if (opportunityCoverage !== null && opportunityCoverage < 60) {
    issues.push({ severity: opportunityCoverage < 40 ? "bad" : "warn", score: opportunityCoverage < 40 ? 82 : 64, title: "广告机会覆盖不足", detail: `机会覆盖 ${percent(opportunityCoverage)}，说明可展示广告的业务场景不足或机会未生成。`, action: "检查广告入口页面、opportunity_id 生成时机、VPN成功页/返回前台场景。", rate: opportunityCoverage });
  }
  if (opportunityUsers !== null && requestUsers !== null && opportunityUsers > 0) {
    const requestRate = requestUsers / opportunityUsers * 100;
    if (requestRate < 70) issues.push({ severity: requestRate < 50 ? "bad" : "warn", score: requestRate < 50 ? 78 : 60, title: "机会后请求启动不足", detail: `机会用户 ${number(opportunityUsers)}，请求用户 ${number(requestUsers)}，启动率 ${percent(requestRate)}。`, action: "查缓存命中、实时请求启动、ad_unit_id、request_id 和请求前二次拦截。", loss: Math.max(0, opportunityUsers - requestUsers), rate: requestRate });
  }
  if (showAttemptUsers !== null && impressionUsers !== null && showAttemptUsers > 0) {
    const impressionRate = impressionUsers / showAttemptUsers * 100;
    if (impressionRate < 75) issues.push({ severity: impressionRate < 55 ? "bad" : "warn", score: impressionRate < 55 ? 76 : 58, title: "展示尝试后 Impression 不足", detail: `展示尝试 ${number(showAttemptUsers)}，AV ${number(impressionUsers)}，到达率 ${percent(impressionRate)}。`, action: "查 show_failed、页面可见性、Activity 状态、广告对象过期和 SDK 回调。", loss: Math.max(0, showAttemptUsers - impressionUsers), rate: impressionRate });
  }
  if (/异常|失败|预警|error|fail|warn|bad/i.test(statusTextRaw)) {
    issues.push({ severity: /失败|error|bad/i.test(statusTextRaw) ? "bad" : "warn", score: 72, title: `项目状态：${statusTextRaw}`, detail: "项目状态字段已标记异常。", action: "进入单项目后先确认数据时效、同步水位和事件缺失率。" });
  }
  if (!issues.length && dauUsers > 0 && (avUsers === null || checkUsers === null)) {
    issues.push({ severity: "warn", score: 45, title: "关键漏斗字段缺失", detail: "有 DAU，但缺少 AV 或资格检查字段，无法判断广告漏斗是否完整。", action: "检查多项目汇总接口是否返回 DAU、eligibilityCheckUsers、impressionUsers 等字段。" });
  }
  if (!issues.length) return { isProblem: false, severity: "good" as const, score: 0, title: "暂无明显问题", detail: "当前可用字段未触发预警。", action: "无需优先处理。", dauUsers, avUsers, viewerRate, opportunityCoverage };
  const top = issues.sort((left, right) => right.score - left.score)[0];
  return { isProblem: true, ...top, dauUsers, avUsers, viewerRate, opportunityCoverage };
}

function rowText(row: AnyRow) {
  return `${rowName(row)} ${rowEvent(row)} ${firstText(row, ["stepCode", "step_code", "code", "metricKey", "metric_key"])}`.toLowerCase();
}

function findFunnelStep(rows: AnyRow[], patterns: RegExp[]) {
  return rows.find((row) => patterns.some((pattern) => pattern.test(rowText(row)))) ?? null;
}

function valueFromMetrics(data: AnyRow, metrics: AnyRow[], keys: string[]) {
  const direct = numericValue(data, keys);
  if (direct !== null) return direct;
  for (const row of metrics) {
    const raw = `${row.metricKey ?? row.metric_key ?? ""} ${row.name ?? ""} ${row.label ?? ""}`.toLowerCase();
    if (keys.some((key) => raw.includes(key.toLowerCase().replace(/_/g, "")) || raw.includes(key.toLowerCase()))) {
      const value = numericValue(row, ["value", "count", "users", "userCount", "user_count"]);
      if (value !== null) return value;
    }
  }
  return null;
}

function syntheticStep(name: string, eventName: string, condition: string, count: number | null, previousCount?: number | null) {
  const conversionRate = previousCount && previousCount > 0 && count !== null ? count / previousCount * 100 : null;
  return {
    name,
    stepName: name,
    eventName,
    event: eventName,
    conditionText: condition,
    count,
    users: count,
    value: count,
    conversionRate,
    available: count !== null,
    synthetic: true,
  };
}

function vpnSyntheticStep(name: string, eventName: string, condition: string, count: number | null, previousCount?: number | null, downstreamCount?: number | null) {
  const unavailable = (count === null || count === 0) && downstreamCount !== null && downstreamCount > 0;
  return {
    ...syntheticStep(name, eventName, condition, unavailable ? null : count, previousCount),
    available: !unavailable && count !== null,
    unavailableReason: unavailable ? `后续「连接尝试」已有 ${number(downstreamCount)}，但当前节点没有返回真实聚合字段，不能解释为 0。` : "",
    requiredAggregation: name.includes("按钮")
      ? "element_click 且 element_name/action_name in (vpn_connect_button, connect)"
      : "vpn_permission_result 且 permission_status=granted；已授权老用户可能不会再次弹权限窗，需补“权限已具备”口径。",
  };
}

function ensureVpnRequiredSteps(rows: AnyRow[], data: AnyRow, metrics: AnyRow[]) {
  const result = [...rows];
  const dau = findFunnelStep(result, [/app_foreground|dau|日活跃|活跃用户/]);
  const button = findFunnelStep(result, [/vpn.*button|connect.*button|按钮点击|连接按钮|element_click.*(vpn|connect)/]);
  const permission = findFunnelStep(result, [/vpn_permission|permission.*granted|权限.*(通过|授权)/]);
  const start = findFunnelStep(result, [/vpn_connection_start|连接开始|连接尝试/]);

  const buttonCount = valueFromMetrics(data, metrics, ["vpnConnectButtonClickUsers", "vpn_connect_button_click_users", "connectButtonClickUsers", "connect_button_click_users", "vpnButtonClickUsers", "vpn_button_click_users", "buttonClickUsers", "button_click_users", "connectClickUsers", "connect_click_users"]);
  const permissionCount = valueFromMetrics(data, metrics, ["vpnPermissionGrantedUsers", "vpn_permission_granted_users", "permissionGrantedUsers", "permission_granted_users", "vpnPermissionPassUsers", "vpn_permission_pass_users", "vpnPermissionUsers", "vpn_permission_users"]);
  const dauCount = dau ? rowCount(dau) : null;
  const startCount = start ? rowCount(start) : null;
  const buttonStep = button ?? vpnSyntheticStep("连接按钮点击", "element_click", "element_name/action_name = vpn_connect_button 或 connect", buttonCount, dauCount, startCount);
  const permissionStep = permission ?? vpnSyntheticStep("VPN权限通过", "vpn_permission_result", "permission_status = granted", permissionCount, button ? rowCount(button) : buttonCount, startCount);

  if (!button) {
    const insertAt = dau ? result.indexOf(dau) + 1 : 1;
    result.splice(Math.max(0, insertAt), 0, buttonStep);
  }
  if (!permission) {
    const buttonIndex = result.findIndex((row) => row === buttonStep || rowText(row).includes("连接按钮") || rowText(row).includes("button"));
    const startIndex = start ? result.indexOf(start) : -1;
    const insertAt = buttonIndex >= 0 ? buttonIndex + 1 : startIndex >= 0 ? startIndex : 1;
    result.splice(Math.max(0, insertAt), 0, permissionStep);
  }
  return result;
}

function AdEligibilityInsight({ rows, data, diagnosisData, diagnosisProgress }: { rows: AnyRow[]; data?: AnyRow | null; diagnosisData?: AnyRow | null; diagnosisProgress?: QueryProgressItem }) {
  const check = findFunnelStep(rows, [/ad_eligibility_check|广告资格检查/]);
  const eligible = findFunnelStep(rows, [/eligible|符合广告资格|资格通过/]);
  if (!check || !eligible) return null;
  const checkUsers = rowCount(check);
  const eligibleUsers = rowCount(eligible);
  if (checkUsers <= 0) return null;
  const blocked = Math.max(0, checkUsers - eligibleUsers);
  const passRate = eligibleUsers / checkUsers * 100;
  const directReasonData = firstArray(data, ["eligibilityBlockedReasons", "eligibility_blocked_reasons", "blockedReasons", "blocked_reasons"]).length
    ? { blockedReasons: firstArray(data, ["eligibilityBlockedReasons", "eligibility_blocked_reasons", "blockedReasons", "blocked_reasons"]) }
    : diagnosisData;
  const blockedReasons = normalizeBlockedReasons(directReasonData, true, blocked, checkUsers);
  const top = blockedReasons[0];
  const shouldShow = passRate < 70 || blockedReasons.length > 0;
  if (!shouldShow) return null;
  return <section className={`surface eligibility-insight ${passRate < 55 ? "bad" : "warn"}`}>
    <div className="surface-title"><div><h2>广告资格通过率偏低诊断</h2><p>系统自动识别：资格检查人数 {number(checkUsers)}，符合资格 {number(eligibleUsers)}，被拦截 {number(blocked)}。下方原因按 <code>ad_eligibility_check</code> 且 <code>eligible=0</code> 聚合。</p></div><span>通过率 {percent(passRate)}</span></div>
    <div className="eligibility-insight-grid">
      <article><span>当前最可能原因</span><strong>{top ? blockedReasonText(top.code) : "等待 blocked_reason 分布"}</strong><small>{top ? `${number(top.count)} 个对象；占拦截 ${percent(top.blockedShare ?? top.share)}，占全部检查 ${percent(top.checkShare)}。${blockedReasonMeaning(top.code)}` : `后端诊断接口需要返回 blocked_reason_distribution。当前只能确认 eligible=0 较多，还不能判断是订阅、频控、权限、配置还是无网络。`}</small></article>
      <article><span>应该怎么优化</span><strong>{top ? "先处理 Top 拦截原因" : "先补原因分布"}</strong><small>{top ? blockedReasonAction(top.code) : "查询 ad_eligibility_check 且 eligible=0，按 blocked_reason 聚合 users/count/share。"}</small></article>
      <article><span>原因数据状态</span><strong>{blockedReasons.length ? `${blockedReasons.length} 类原因` : "原因未返回"}</strong><small>{diagnosisProgress?.status === "done" ? "诊断接口已完成；如果仍为空，就是后端未返回原因字段。" : diagnosisProgress?.status === "loading" || diagnosisProgress?.status === "retrying" ? "诊断接口查询中，完成后会自动显示原因。" : "等待诊断接口。"}</small></article>
    </div>
    {top && <BlockedReasonOptimizationGuide reasonCode={top.code} data={data} />}
    {blockedReasons.length > 0 && <div className="blocked-reason-grid compact detailed">{blockedReasons.slice(0, 6).map((reason) => <article key={text(reason.code)}><header><strong>{blockedReasonText(reason.code)}</strong><span>{percent(reason.blockedShare ?? reason.share)}</span></header><div className="reason-bar"><i style={{ width: `${Math.max(3, Math.min(100, Number(reason.blockedShare ?? reason.share ?? 0)))}%` }} /></div><p>{number(reason.count)} 个对象</p><dl><div><dt>占拦截</dt><dd>{percent(reason.blockedShare ?? reason.share)}</dd></div><div><dt>占检查</dt><dd>{percent(reason.checkShare)}</dd></div></dl><small><b>说明：</b>{blockedReasonMeaning(reason.code)}</small><small><b>建议：</b>{blockedReasonAction(reason.code)}</small></article>)}</div>}
  </section>;
}

function evidenceSummary(items: AnyRow[] | undefined) {
  const rows = (items ?? []).slice(0, 3);
  if (!rows.length) return "暂无明细原因";
  return rows.map((row) => {
    const count = numericValue(row, ["users", "sessions", "connections", "events", "count"]) ?? 0;
    const extra = firstText(row, ["protocol", "nodeRegion", "node_region", "source"]);
    return `${text(row.label ?? row.code ?? row.reason)}：${number(count)}${extra ? `（${extra}）` : ""}`;
  }).join("；");
}

function VpnHomeSignalBoard({ data }: { data: AnyRow }) {
  const rows: AnyRow[] = firstArray(data, ["vpnHomeSignals", "vpn_home_signals"]);
  if (!rows.length) return null;
  const official = rows.find((row) => row.canBeOfficial === true || row.key === "official");
  const selected = rows.find((row) => row.selectedForFunnel === true);
  return <section className="surface vpn-home-signal-board">
    <div className="surface-title"><div><h2>进入首页多信号对照</h2><p>正式指标只认 <code>core_action.actionName=vpn_home</code>；页面事件和后续动作分别展示，帮助运营判断真实到达范围与埋点缺失。</p></div><span>{official?.status === "missing" ? "正式首页事件缺失" : "正式首页事件可用"}</span></div>
    {official?.status === "missing" && <div className="diagnosis-no-reasons compact warn"><strong>正式事件缺失，已自动使用 MainActivity 计算</strong><p><code>vpn_home</code> 当前为 0；主漏斗现使用「{text(selected?.name)}」{number(selected?.users)} UV 作为首页人数。页面保留降级口径标记，同时推动客户端补齐 <code>core_action.actionName=vpn_home</code>。</p></div>}
    <div className="table-wrap"><table className="vpn-home-signal-table"><thead><tr><th>判断方式</th><th>事件与返回值</th><th>UV</th><th>Session</th><th>事件次数</th><th>占 DAU</th><th>未记录人数</th><th>用途</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.key)} className={row.selectedForFunnel ? "row-selected" : row.status === "missing" ? "row-bad" : ""}>
      <td><strong>{text(row.name)}</strong><small>{row.selectedForFunnel ? "当前主漏斗采用" : row.canBeOfficial ? "正式运营口径" : "辅助分析信号"}</small></td>
      <td><code>{text(row.eventName)}</code><small>{text(row.condition)}</small></td>
      <td><strong>{number(row.users)}</strong></td><td>{number(row.sessions)}</td><td>{number(row.events)}</td>
      <td>{row.coverageRate === null || row.coverageRate === undefined ? "暂无" : percent(row.coverageRate)}</td>
      <td>{row.unrecordedUsers === null || row.unrecordedUsers === undefined ? "暂无" : number(row.unrecordedUsers)}</td>
      <td><span className={`signal-level ${row.selectedForFunnel ? "selected" : row.canBeOfficial ? "official" : "proxy"}`}>{row.selectedForFunnel ? "当前采用" : text(row.level)}</span></td>
    </tr>)}</tbody></table></div>
  </section>;
}

function VpnDropoffReasonBoard({ data }: { data: AnyRow }) {
  const rows: AnyRow[] = firstArray(data, ["vpnDropoffReasons", "vpn_dropoff_reasons", "vpnTransitionReasons", "vpn_transition_reasons"]);
  if (!rows.length) return null;
  const worst = [...rows].filter((row) => row.measurable !== false && row.status !== "missing").sort((left, right) => Number(right.lostCount ?? 0) - Number(left.lostCount ?? 0))[0];
  return <section className="surface vpn-dropoff-reason-board">
    <div className="surface-title"><div><h2>VPN 大流失原因拆解</h2><p>后端按真实 DWD 字段计算：按钮点击、权限可用、节点选择、连接开始、连接成功；同时返回权限状态、出口检查和失败原因。</p></div><span>{worst ? `最大断点：${text(worst.fromStep)} → ${text(worst.toStep)}` : "等待数据"}</span></div>
    {worst && <div className="vpn-root-cause-hero">
      <div><span>当前最应该先看</span><strong>{text(worst.fromStep)} → {text(worst.toStep)}</strong><small>流失 {number(worst.lostCount)} · {percent(worst.lossRate)}；通过率 {percent(worst.passRate)}</small></div>
      <div><span>字段口径</span><strong>{text(worst.basis)}</strong><small>这里展示的是 UV 口径，connection_id / events 放在证据里。</small></div>
      <div><span>处理建议</span><strong>{text(worst.topReason)}</strong><small>{text(worst.action)}</small></div>
    </div>}
    <div className="table-wrap"><table className="vpn-dropoff-reason-table"><thead><tr><th>断点</th><th>起点</th><th>到达</th><th>流失</th><th>流失率</th><th>后端字段/SQL口径</th><th>原因证据</th><th>建议动作</th></tr></thead><tbody>{rows.map((row) => <tr key={text(row.code)} className={row.status === "bad" ? "row-bad" : row.status === "warn" ? "row-warn" : ""}>
      <td><strong>{text(row.fromStep)} → {text(row.toStep)}</strong><small>{text(row.topReason)}</small></td>
      <td>{number(row.fromCount)}</td>
      <td>{number(row.toCount)}</td>
      <td>{row.measurable === false ? "口径缺失" : number(row.lostCount)}</td>
      <td>{percent(row.lossRate)}</td>
      <td><small>{text(row.basis)}</small></td>
      <td><small>{evidenceSummary(row.evidence)}</small></td>
      <td><small>{text(row.action)}</small></td>
    </tr>)}</tbody></table></div>
  </section>;
}

function VpnPrerequisiteInsight({ rows, data }: { rows: AnyRow[]; data: AnyRow }) {
  const dau = findFunnelStep(rows, [/app_foreground|dau|日活跃|活跃用户/]);
  const home = findFunnelStep(rows, [/home_entry|进入首页|core_action.*vpn_home/]);
  const click = findFunnelStep(rows, [/vpn.*button|connect.*button|连接按钮|按钮点击|element_click.*(vpn|connect)/]);
  const permission = findFunnelStep(rows, [/vpn_permission|permission.*granted|权限.*(通过|授权)/]);
  const node = findFunnelStep(rows, [/vpn_node_selected|节点选择/]);
  const start = findFunnelStep(rows, [/vpn_connection_start|连接开始|连接尝试/]);
  const success = findFunnelStep(rows, [/vpn_connection_result.*success|连接成功/]);
  const items = [
    { label: "DAU", row: dau, condition: "app_foreground" },
    { label: "进入首页人数", row: home, condition: "core_action · actionName=vpn_home" },
    { label: "按钮点击人数", row: click, condition: "element_click · connect" },
    { label: "权限可用人数", row: permission, condition: "vpn_permission_result · permission_status=granted/already_granted" },
    { label: "节点选择人数", row: node, condition: "vpn_node_selected" },
    { label: "连接开始人数", row: start, condition: "vpn_connection_start · connection_id非空" },
    { label: "连接成功人数", row: success, condition: "vpn_connection_result · vpn_status=success" },
  ];
  const missing = items.filter((item) => !item.row || item.row.available === false);
  const unavailable = items.filter((item) => item.row?.available === false);
  return <><VpnHomeSignalBoard data={data} /><section className={`surface vpn-prerequisite-insight ${missing.length ? "warn" : "good"}`}>
    <div className="surface-title"><div><h2>VPN 连接前置链路诊断</h2><p>VPN 漏斗必须先看用户有没有点连接按钮、权限有没有通过，再看连接尝试和连接成功；没有返回字段时不能按 0 解释。</p></div><span>{missing.length ? `缺 ${missing.length} 个可计算节点` : "前置节点完整"}</span></div>
    <div className="vpn-prerequisite-flow">{items.map((item, index) => {
      const unavailableNode = item.row?.available === false;
      return <article key={item.label} className={!item.row || unavailableNode ? "missing" : "ok"}><span>{index + 1}</span><strong>{item.label}</strong><em>{item.row && !unavailableNode ? number(rowCount(item.row)) : "待补字段"}</em><small>{item.row ? stepCondition(item.row) : item.condition}</small>{item.row?.unavailableReason && <small>{item.row.unavailableReason}</small>}</article>;
    })}</div>
    {missing.length > 0 && <div className="diagnosis-no-reasons compact warn"><strong>为什么按钮点击和权限通过没有数量？</strong><p>{unavailable.length ? "因为后端/汇总表没有返回这两个前置节点的真实聚合字段；但连接尝试已经有数据，说明不能把它们当成 0。" : "当前接口没有返回这两个前置节点。" } 请在 VPN 工作台接口/汇总表返回：<code>vpn_connect_button_click_users</code>、<code>vpn_permission_available_users</code>，或在 funnel steps 中返回「连接按钮点击」「VPN权限可用」。权限口径必须包含 <code>already_granted</code>，否则老用户已授权不会再次触发弹窗，会被误判。</p></div>}
  </section><VpnDropoffReasonBoard data={data} /></>;
}

const MATRIX_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "country_code", label: "国家" },
  { key: "asn", label: "ASN" },
  { key: "server_id", label: "节点" },
  { key: "protocol", label: "协议" },
];

function matrixDimensionLabel(key: string): string {
  return MATRIX_DIMENSIONS.find((dimension) => dimension.key === key)?.label ?? key;
}

function AdNetworkFailureMatrix({ data, dimensions, onDimensionsChange }: { data: AnyRow; dimensions: string[]; onDimensionsChange: (dimensions: string[]) => void }) {
  const matrix = data.adNetworkFailureMatrix ?? {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const totals = matrix.totals ?? {};
  const activeDimensions: string[] = Array.isArray(matrix.dimensions) && matrix.dimensions.length ? (matrix.dimensions as string[]) : dimensions;
  const topBad = rows.find((row: AnyRow) => row.status === "bad") ?? rows[0];
  const statusLabel: Record<string, string> = { bad: "严重", warn: "关注", good: "正常", unavailable: "暂无数据" };

  const toggleDimension = (key: string) => {
    if (activeDimensions.includes(key)) {
      if (activeDimensions.length <= 1) return;
      onDimensionsChange(activeDimensions.filter((dimension) => dimension !== key));
      return;
    }
    onDimensionsChange([...activeDimensions, key]);
  };

  const renderDimensionCell = (dimension: string, value: unknown) => {
    if (dimension === "server_id") return <code>{text(value)}</code>;
    return <strong>{text(value)}</strong>;
  };

  return <section className="surface ad-network-failure-matrix">
    <div className="surface-title">
      <div>
        <h2>广告网络失败横向报表</h2>
        <p>按所选维度横向看广告请求、加载失败、展示失败和展示拦截的成功率与失败率；去掉某个维度即向上聚合。</p>
      </div>
      <span>{matrix.available === false ? "等待网络上下文" : `${rows.length} 个组合`}</span>
    </div>
    {matrix.available === false ? <div className="diagnosis-no-reasons compact warn"><strong>当前没有可聚合的网络维度广告事件</strong><p>{text(matrix.reason)}。需要广告事件携带 <code>country_code</code>、<code>asn</code>、<code>server_id</code>、<code>protocol</code>，否则只能看到普通广告漏斗，不能定位到具体网络出口。</p></div> : <>
      <div className="matrix-dimension-picker">
        <span>聚合维度：</span>
        {MATRIX_DIMENSIONS.map((dimension) => <label key={dimension.key} className={activeDimensions.includes(dimension.key) ? "active" : ""} title={activeDimensions.includes(dimension.key) ? "取消勾选即向上聚合" : "勾选后按此维度细分"}><input type="checkbox" checked={activeDimensions.includes(dimension.key)} onChange={() => toggleDimension(dimension.key)} disabled={activeDimensions.includes(dimension.key) && activeDimensions.length <= 1} /><span>{dimension.label}</span></label>)}
        <small>至少保留一个维度；去掉维度 = 向上聚合</small>
      </div>
      <div className="matrix-summary-grid">
        <article><span>请求数</span><strong>{number(totals.requestCount)}</strong><small>ad_request · request_id 去重</small></article>
        <article><span>加载成功率</span><strong>{percent(totals.loadSuccessRate)}</strong><small>{number(totals.loadSuccessCount)} 成功 / {number(totals.requestCount)} 请求</small></article>
        <article><span>失败率</span><strong>{percent(totals.failureRate)}</strong><small>加载失败 + 展示失败 + 展示拦截</small></article>
        <article><span>Impression</span><strong>{number(totals.impressionCount)}</strong><small>展示率 {percent(totals.impressionRate)}</small></article>
      </div>
      {topBad && <div className={`matrix-risk-card ${topBad.status === "bad" ? "bad" : topBad.status === "warn" ? "warn" : "good"}`}>
        <div><span>优先排查组合</span><strong>{activeDimensions.map((dimension) => `${matrixDimensionLabel(dimension)} ${text((topBad.dimensions ?? {})[dimension] ?? "unknown")}`).join(" × ")}</strong></div>
        <div><span>主要问题</span><strong>{statusLabel[String(topBad.status)] ?? text(topBad.status)} · 失败 {number(topBad.failureCount)} · {percent(topBad.failureRate)}</strong></div>
        <div><span>建议动作</span><strong>{text(topBad.suggestion)}</strong></div>
      </div>}
      <div className="table-wrap">
        <table className="ad-network-failure-table">
          <thead><tr>
            {activeDimensions.map((dimension) => <th key={dimension}>{matrixDimensionLabel(dimension)}</th>)}
            <th>请求</th><th>加载成功</th><th>加载失败</th><th>展示失败/拦截</th><th>Impression</th><th>失败率</th><th>Top原因</th><th>建议</th>
          </tr></thead>
          <tbody>{rows.slice(0, 50).map((row: AnyRow, index: number) => {
            const reasons = Array.isArray(row.topReasons) ? row.topReasons : [];
            const dimValues: AnyRow = row.dimensions ?? {};
            return <tr key={`${activeDimensions.map((dimension) => text(dimValues[dimension] ?? "unknown")).join("-")}-${index}`} className={row.status === "bad" ? "row-bad" : row.status === "warn" ? "row-warn" : ""}>
              {activeDimensions.map((dimension) => <td key={dimension}>{renderDimensionCell(dimension, dimValues[dimension] ?? "unknown")}</td>)}
              <td>{number(row.requestCount)}</td>
              <td><strong>{percent(row.loadSuccessRate)}</strong><small>{number(row.loadSuccessCount)}</small></td>
              <td>{number(row.loadFailedCount)}</td>
              <td>{number(Number(row.showFailedCount ?? 0) + Number(row.showBlockedCount ?? 0))}<small>失败 {number(row.showFailedCount)} / 拦截 {number(row.showBlockedCount)}</small></td>
              <td>{number(row.impressionCount)}<small>展示率 {percent(row.impressionRate)}</small></td>
              <td><div className="rate-bar"><i style={{ width: `${Math.max(3, Math.min(100, Number(row.failureRate ?? 0)))}%` }} /><strong>{percent(row.failureRate)}</strong></div></td>
              <td>{reasons.length ? reasons.map((reason: AnyRow) => <small key={text(reason.reason)}>{text(reason.reason)} · {number(reason.events)} · {percent(reason.share)}</small>) : <small>暂无失败原因</small>}</td>
              <td><small>{text(row.suggestion)}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="matrix-footnote">字段来源：{text(matrix.source)}；口径：仅统计携带 VPN/网络上下文的广告事件，当前维度为 {activeDimensions.map((dimension) => <code key={dimension}>{dimension}</code>)}。去掉维度即向上聚合，成功率/失败率按所选维度组合重算。</div>
    </>}
  </section>;
}

function AdSessionBaselineWarning({ rows, rawRows }: { rows: AnyRow[]; rawRows: AnyRow[] }) {
  if (!hasMissingAdSessionBaseline(rawRows, "sessions", "ads")) return null;
  const next = rows[1];
  return <section className="surface ad-session-baseline-warning">
    <div className="surface-title"><div><h2>为什么这里“日活跃”是 0？</h2><p>当前选择的是「去重 Session」口径，但 DAU/日活跃用户是用户 UV 口径。后端没有返回前台 Session 基准，所以之前被误显示成 0。</p></div><span>口径缺失，不是业务为0</span></div>
    <div className="baseline-warning-grid">
      <article><span>当前错误来源</span><strong>Session 口径缺少前台基准</strong><small>第一步来自 <code>app_foreground</code>，但 session 聚合没有 <code>app_foreground_sessions</code> / <code>foreground_sessions</code>。</small></article>
      <article><span>为什么后面还有 2,284</span><strong>{next ? rowName(next) : "后续事件"} 有 Session 数据</strong><small>后续 <code>ad_eligibility_check</code> 有 session_id 聚合，所以会出现“第一步0，第二步有值”的口径倒挂。</small></article>
      <article><span>后端要补什么</span><strong>补 Session 基准字段</strong><small>建议在 workbench/funnel 的 Session 口径返回 <code>app_foreground_sessions</code> 或步骤「前台 Session」。没有这个字段时前端显示暂无数据。</small></article>
    </div>
  </section>;
}

function compactRows(rows: AnyRow[] | undefined, limit = 10) {
  return (rows ?? []).slice(0, limit).map((row) => {
    const result: AnyRow = {};
    Object.entries(row).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") return;
      if (typeof value === "object") return;
      result[key] = value;
    });
    return result;
  });
}

function buildAiAnalysisPayload({ data, metrics, funnelRows, rawFunnelRows, domain, unit, pageData, diagnosisData }: { data: AnyRow; metrics: AnyRow[]; funnelRows: AnyRow[]; rawFunnelRows: AnyRow[]; domain: string; unit: FunnelUnit; pageData?: AnyRow | null; diagnosisData?: AnyRow | null }) {
  const transitions = funnelRows.slice(1).map((to, index) => {
    const from = funnelRows[index];
    const fromValue = rowCount(from);
    const toValue = rowCount(to);
    const meta = transitionMeta(fromValue, toValue);
    const kind = transitionKind(from, to, index);
    return {
      fromStep: rowName(from),
      fromEvent: rowEvent(from),
      fromCondition: stepCondition(from),
      fromValue,
      toStep: rowName(to),
      toEvent: rowEvent(to),
      toCondition: stepCondition(to),
      toValue,
      lost: meta.loss,
      lostRate: meta.lossRate,
      passRate: meta.passRate,
      diagnosis: kind.status,
      likelyReason: kind.reason,
      suggestedAction: kind.action,
    };
  });
  const biggest = transitions.filter((item) => item.fromValue >= item.toValue).sort((left, right) => Number(right.lost ?? 0) - Number(left.lost ?? 0))[0] ?? transitions[0] ?? null;
  return {
    source: "analysis.geekforest.ai",
    page: "workbench",
    domain,
    unit,
    context: {
      projectCode: data.projectCode ?? data.summary?.projectCode,
      appIdentifier: data.appIdentifier ?? data.summary?.appIdentifier,
      appName: data.appName ?? data.summary?.appName,
      dateFrom: data.dateFrom ?? data.query?.dateFrom,
      dateTo: data.dateTo ?? data.query?.dateTo,
      platform: data.platform ?? data.query?.platform,
      country: data.country ?? data.query?.country,
      appVersion: data.appVersion ?? data.query?.appVersion,
      dataStatus: data.dataStatus ?? data.freshness?.calibrationStatus,
      computedAt: data.computedAt ?? data.freshness?.latestEventAt,
    },
    currentIssues: {
      missingAdSessionBaseline: hasMissingAdSessionBaseline(rawFunnelRows, unit, domain),
      biggestDropoff: biggest,
      dataAvailability: data.dataAvailability ?? null,
    },
    metrics: compactRows(metrics, 12),
    funnel: funnelRows.map((row) => ({
      stepName: rowName(row),
      eventName: rowEvent(row),
      condition: stepCondition(row),
      count: rowCount(row),
      conversionRate: row.conversionRate ?? null,
      available: row.available !== false,
      dataIssue: row.dataIssue ?? null,
    })),
    transitions,
    pagePathTop: compactRows(pageData?.pages, 12),
    diagnosisReasons: compactRows(diagnosisData?.reasons ?? diagnosisData?.blockedReasons ?? diagnosisData?.blocked_reason_distribution, 12),
    ask: "请作为资深广告变现/增长产品经理，结合本页面指标和后端可查数据库数据，输出一份运营能直接执行的诊断文档：1）最大问题在哪里；2）证据是什么；3）可能原因排序；4）应该查哪些字段/SQL；5）研发/运营修复动作；6）哪些数据口径还不可信。",
  };
}

async function requestAiAnalysis(payload: AnyRow) {
  const baseUrl = trackingApiBaseUrl();
  if (!baseUrl) throw new Error("未配置漏斗分析服务地址");
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");
  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/ai-analysis`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...payload, frontendBaseUrl: typeof window !== "undefined" ? window.location.origin : "" }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("登录已失效，请重新登录");
  if (response.status === 403) throw new Error("当前账号无权使用 AI 分析");
  if (!response.ok || (body.code !== undefined && body.code !== 0)) throw new Error(body.msg || body.error || `AI 分析接口 HTTP ${response.status}`);
  return body.data ?? body;
}

function aiResultText(result: AnyRow | null) {
  if (!result) return "";
  return text(result.markdown ?? result.document ?? result.analysis ?? result.summary ?? JSON.stringify(result, null, 2));
}

function extractReportUrl(result: AnyRow | null) {
  if (!result) return "";
  const direct = result.shareUrlWithPassword ?? result.share_url_with_password ?? result.reportUrlWithPassword ?? result.report_url_with_password ?? result.reportUrl ?? result.report_url ?? result.shareUrl ?? result.share_url ?? result.url;
  if (direct) return String(direct);
  const nested = result.report?.shareUrlWithPassword ?? result.report?.share_url_with_password ?? result.report?.url ?? result.report?.shareUrl ?? result.report?.share_url;
  return nested ? String(nested) : "";
}

function extractPlainShareUrl(result: AnyRow | null) {
  if (!result) return "";
  return String(result.shareUrl ?? result.share_url ?? result.reportUrl ?? result.report_url ?? result.report?.shareUrl ?? result.report?.share_url ?? "");
}

function extractSharePassword(result: AnyRow | null) {
  if (!result) return "";
  return String(result.password ?? result.sharePassword ?? result.share_password ?? result.report?.password ?? "");
}

function extractShareCopyText(result: AnyRow | null) {
  if (!result) return "";
  const copyText = result.copyText ?? result.copy_text;
  if (copyText) return String(copyText);
  const url = extractReportUrl(result);
  const password = extractSharePassword(result);
  if (!url && !password) return "";
  return `AI诊断报告分享链接：${url}\n访问密码：${password}\n说明：无需系统登录，最多可成功打开 3 次，超过后需重新生成。`;
}

function analysisProjectCode(payload: AnyRow, data: AnyRow) {
  return text(payload.context?.projectCode ?? data.projectCode ?? data.summary?.projectCode);
}

function buildProjectReportUrl(payload: AnyRow, domain: string, unit: FunnelUnit) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const context = payload.context ?? {};
  const projectCode = context.projectCode;
  url.searchParams.set("module", "funnel");
  url.searchParams.set("page", "workbench");
  if (projectCode) url.searchParams.set("project", String(projectCode));
  url.searchParams.set("domain", domain);
  url.searchParams.set("unit", unit);
  if (context.platform) url.searchParams.set("platform", String(context.platform));
  if (context.country) url.searchParams.set("country", String(context.country));
  if (context.appVersion) url.searchParams.set("appVersion", String(context.appVersion));
  return url.toString();
}

function AiAnalysisPanel({ data, metrics, funnelRows, rawFunnelRows, domain, unit, pageData, diagnosisData }: { data: AnyRow; metrics: AnyRow[]; funnelRows: AnyRow[]; rawFunnelRows: AnyRow[]; domain: string; unit: FunnelUnit; pageData?: AnyRow | null; diagnosisData?: AnyRow | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnyRow | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const payload = useMemo(() => buildAiAnalysisPayload({ data, metrics, funnelRows, rawFunnelRows, domain, unit, pageData, diagnosisData }), [data, metrics, funnelRows, rawFunnelRows, domain, unit, pageData, diagnosisData]);
  const resultText = aiResultText(result);
  const fallbackReportUrl = useMemo(() => buildProjectReportUrl(payload, domain, unit), [payload, domain, unit]);
  const reportUrl = extractReportUrl(result);
  const plainShareUrl = extractPlainShareUrl(result);
  const sharePassword = extractSharePassword(result);
  const shareCopyText = extractShareCopyText(result);
  const projectCode = analysisProjectCode(payload, data);

  async function generate() {
    setLoading(true);
    setError("");
    setCopyStatus("");
    try {
      const next = await requestAiAnalysis(payload);
      setResult(next);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "AI 分析失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyText() {
    const content = resultText || JSON.stringify(payload, null, 2);
    await navigator.clipboard?.writeText(content).catch(() => undefined);
    setCopyStatus(resultText ? "文档内容已复制" : "分析上下文已复制");
  }

  async function copyReportLink() {
    if (!shareCopyText) return;
    await navigator.clipboard?.writeText(shareCopyText).catch(() => undefined);
    setCopyStatus("分享链接和访问密码已复制");
  }

  return <section className="surface ai-analysis-panel">
    <div className="ai-analysis-copy"><div className="surface-title"><div><h2>AI 分析报告</h2><p>把当前页面指标、漏斗、流失原因、页面路径和数据状态交给 AI，生成可分享给产品/研发的诊断报告。</p></div><span>后端代调绩效系统 AI token</span></div>
      <div className="ai-analysis-points"><span>当前模块：{domain === "ads" ? "广告变现" : domain === "vpn" ? "VPN 功能" : "数据质量"}</span><span>当前口径：{funnelUnitLabel(unit, domain)}</span><span>最大断点：{text(payload.currentIssues?.biggestDropoff?.fromStep)} → {text(payload.currentIssues?.biggestDropoff?.toStep)}</span></div>
      {error && <div className="ai-analysis-error"><strong>AI 接口暂不可用</strong><span>{error}。需要后端新增 <code>POST /api/v3/jkcl-funnel/ai-analysis</code>，服务端使用绩效系统/DeepSeek token，不要把 token 下发前端。</span></div>}
      {reportUrl && <div className="ai-report-latest"><strong>最新 AI 报告：</strong><a href={reportUrl} target="_blank" rel="noreferrer">打开分享报告</a><small>无需系统登录，自动带入本次随机密码，最多成功打开 3 次。</small></div>}
      {resultText && <pre className="ai-analysis-result">{resultText}</pre>}
    </div>
    <div className="ai-analysis-actions">
      <div className="ai-report-link-card">
        <strong>受限分享链接</strong>
        <span>项目：{projectCode}</span>
        {plainShareUrl ? <a href={plainShareUrl} target="_blank" rel="noreferrer">打开密码页</a> : <em>生成 AI 报告后创建</em>}
        {sharePassword && <code>密码：{sharePassword}</code>}
        {result && <small>剩余可打开：{number(result.remainingAccessCount ?? result.remaining_access_count)} / {number(result.maxAccessCount ?? result.max_access_count ?? 3)}</small>}
      </div>
      <button className="primary-button" onClick={generate} disabled={loading}>{loading ? "AI 正在分析…" : result ? "生成新报告" : "生成 AI 报告"}</button>
      <button onClick={copyReportLink} disabled={!shareCopyText}>复制分享链接+密码</button>
      <button onClick={copyText}>{result ? "复制报告内容" : "复制分析上下文"}</button>
      {copyStatus && <small className="ai-report-copy-status">{copyStatus}</small>}
      <small>分享链接不需要登录，但需要随机密码；每个链接最多成功打开 3 次，超过后需要重新生成。</small>
    </div>
  </section>;
}

function transitionKind(from: AnyRow, to: AnyRow, index: number) {
  const rawFrom = `${rowName(from)} ${rowEvent(from)}`.toLowerCase();
  const rawTo = `${rowName(to)} ${rowEvent(to)}`.toLowerCase();
  if (rowCount(to) > rowCount(from)) {
    return { status: "口径异常", tone: "warn", meaning: "下一步人数大于上一步，不能按线性流失解释。", reason: "多项目聚合、预加载/缓存分支、用户/Session/次数混用、同一用户多机会，都可能让后续步骤倒挂。", action: "先检查 DWS scope_type、unit、去重键和是否把次数当用户；确认口径后再看真实流失。" };
  }
  if ((index === 0 || rawFrom.includes("foreground") || rawFrom.includes("dau") || rawFrom.includes("日活跃")) && (rawTo.includes("ad_eligibility_check") || rawTo.includes("资格"))) {
    return { status: "未触发资格检查", tone: "bad", meaning: "用户活跃了，但没有进入广告资格判断。", reason: "通常不是 AdMob 填充问题，而是页面没有到广告场景、入口未曝光/未点击、广告初始化/隐私/订阅/版本策略提前挡住，或 SDK 漏报 ad_eligibility_check。", action: "下钻 page × step：看 pageUsers → eligibilityCheckUsers；再看 element_click/core_action、广告配置、consent_status、subscription_status 和 SDK 上报日志。" };
  }
  if (isEligibilityPassTransition(from, to)) {
    return { status: "资格未通过", tone: "warn", meaning: "已触发资格检查，但 eligible=0 的对象没有进入后续广告链路。", reason: "原因应由 ad_eligibility_check.blocked_reason 给出，例如频控、订阅去广告、隐私未授权、广告配置关闭、国家/版本策略不允许。", action: "按 blocked_reason、国家、版本、页面拆分；优先修占比最高且可运营/可配置修复的拦截原因。" };
  }
  if (rawTo.includes("opportunity") || rawTo.includes("机会")) {
    return { status: "机会未覆盖", tone: "warn", meaning: "资格通过后，没有生成广告机会。", reason: "可能是业务场景没发起机会、预加载未绑定当前机会、入口点击后没有创建 opportunity_id，或缓存广告没有在展示场景重新绑定机会。", action: "检查 opportunity_id 生成时机、广告位配置、预加载缓存命中后绑定逻辑、页面入口点击到机会创建链路。" };
  }
  if (rawTo.includes("request") || rawTo.includes("请求")) {
    return { status: "请求未启动", tone: "warn", meaning: "有广告机会，但没有真正向广告 SDK 发起请求。", reason: "常见原因是缓存可用但未进入展示、频控二次拦截、广告对象状态异常、网络/VPN 状态、ad_unit_id 缺失或请求 Context 没保存。", action: "看缓存命中率、实时请求启动率、request_id 缺失率、ad_unit_id 和 load 调用日志。" };
  }
  if (rawTo.includes("show") || rawTo.includes("展示尝试")) {
    return { status: "未尝试展示", tone: "bad", meaning: "广告加载成功或请求后，没有走到 showAttempt。", reason: "多半是缓存广告没有被业务场景消费、页面切走/进入后台、广告对象过期、show 调用条件不满足或业务没有调用展示方法。", action: "看 load_success → show_attempt 耗时、缓存命中、页面停留时长、background_reason、ad_instance_id 是否贯穿。" };
  }
  if (rawTo.includes("impression") || rawTo.includes("展示")) {
    return { status: "展示未回调", tone: "warn", meaning: "已经尝试展示，但没有收到 impression。", reason: "可能是 show 失败、广告被关闭/遮挡、SDK 回调缺失、广告格式不支持当前场景，或前台/页面可见性不足。", action: "看 show_failed、dismiss、banner_visible、response_id、adapter、错误码和页面可见性。" };
  }
  return { status: "普通流失", tone: "warn", meaning: `${rowName(from)} 没有进入 ${rowName(to)}。`, reason: "需要结合该步骤的触发条件、ID 串联和页面路径继续拆。", action: "进入单项目工作台，点击对应断点查看 page × step、原因和证据明细。" };
}

function OverviewFunnelDiagnosis({ rows, projects, onPageChange, onProjectSelect }: { rows: AnyRow[]; projects: AnyRow[]; onPageChange: Props["onPageChange"]; onProjectSelect?: Props["onProjectSelect"] }) {
  if (rows.length < 2) return null;
  const transitions = rows.slice(1).map((to, index) => {
    const from = rows[index];
    const fromValue = rowCount(from);
    const toValue = rowCount(to);
    const anomaly = toValue > fromValue;
    const { loss, lossRate, passRate } = transitionMeta(fromValue, toValue);
    const kind = transitionKind(from, to, index);
    return { from, to, fromValue, toValue, anomaly, loss, lossRate, passRate, kind };
  });
  const maxDrop = transitions.filter((item) => !item.anomaly && item.loss > 0).sort((left, right) => right.loss - left.loss)[0] ?? transitions[0];
  const checkProjectRows = projects.map((project) => {
    const dauUsers = numericValue(project, ["dauUsers", "activeUsers", "users", "foregroundUsers", "appForegroundUsers"]);
    const checkUsers = numericValue(project, ["eligibilityCheckUsers", "eligibility_check_users", "adEligibilityCheckUsers", "ad_eligibility_check_users", "checkUsers"]);
    const loss = dauUsers !== null && checkUsers !== null ? Math.max(0, dauUsers - checkUsers) : null;
    const rate = dauUsers !== null && dauUsers > 0 && checkUsers !== null ? checkUsers / dauUsers * 100 : null;
    return { ...project, dauUsers, checkUsers, loss, rate };
  }).filter((project) => project.dauUsers !== null || project.checkUsers !== null).sort((left, right) => Number(right.loss ?? -1) - Number(left.loss ?? -1)).slice(0, 8);
  const anomalyCount = transitions.filter((item) => item.anomaly).length;
  return <section className="surface overview-funnel-diagnosis">
    <div className="surface-title"><div><h2>最大漏斗流失诊断</h2><p>把“少了多少人”翻译成“该查什么原因”。当前总览先看相邻步骤，倒挂步骤会标为口径异常。</p></div><span>{rowName(maxDrop.from)} → {rowName(maxDrop.to)}</span></div>
    <div className="overview-diagnosis-hero">
      <article className={`overview-diagnosis-card ${maxDrop.kind.tone}`}><span>最大流失段</span><strong>{rowName(maxDrop.from)} → {rowName(maxDrop.to)}</strong><small>{maxDrop.kind.meaning}</small></article>
      <article className={`overview-diagnosis-card ${maxDrop.kind.tone}`}><span>流失用户 / 流失率</span><strong>{number(maxDrop.loss)} / {maxDrop.lossRate === null ? "—" : percent(maxDrop.lossRate)}</strong><small>到达率 {maxDrop.passRate === null ? "—" : percent(maxDrop.passRate)}；起点 {number(maxDrop.fromValue)}，到达 {number(maxDrop.toValue)}</small></article>
      <article className={`overview-diagnosis-card ${anomalyCount ? "warn" : "good"}`}><span>判断类型</span><strong>{maxDrop.kind.status}</strong><small>{anomalyCount ? `另有 ${anomalyCount} 段倒挂，先不要当作流失。` : "当前相邻漏斗口径未发现倒挂。"}</small></article>
    </div>
    <div className="overview-diagnosis-explain"><div><strong>最可能原因</strong><p>{maxDrop.kind.reason}</p></div><div><strong>下一步怎么查</strong><p>{maxDrop.kind.action}</p></div></div>
    <div className="overview-diagnosis-grid">
      <div className="surface nested"><div className="surface-title"><div><h2>断点明细</h2><p>看每一段到底是流失、到达，还是口径倒挂。</p></div></div><div className="table-wrap"><table className="overview-break-table"><thead><tr><th>断点</th><th>起点</th><th>到达</th><th>流失</th><th>流失率</th><th>判断</th><th>排查动作</th></tr></thead><tbody>{transitions.map((item) => <tr key={`${rowName(item.from)}-${rowName(item.to)}`} className={item.anomaly ? "row-warn" : item.lossRate !== null && item.lossRate >= 35 ? "row-bad" : item.lossRate !== null && item.lossRate >= 15 ? "row-warn" : "row-good"}><td><strong>{rowName(item.from)} → {rowName(item.to)}</strong><small>{rowEvent(item.from)} → {rowEvent(item.to)}</small></td><td>{number(item.fromValue)}</td><td>{number(item.toValue)}</td><td>{item.anomaly ? "倒挂" : number(item.loss)}</td><td>{item.anomaly ? "—" : item.lossRate === null ? "—" : percent(item.lossRate)}</td><td><strong>{item.kind.status}</strong><small>{item.kind.meaning}</small></td><td><small>{item.kind.action}</small></td></tr>)}</tbody></table></div></div>
      <aside className="surface nested"><div className="surface-title"><div><h2>运营排查优先级</h2><p>按截图里的最大断点，先别去查 AdMob 填充。</p></div></div><ol className="overview-root-cause-list"><li><strong>先查页面触发覆盖</strong><span>用 page × step 看哪些页面有 pageUsers，但 eligibilityCheckUsers 很低或为 0。</span></li><li><strong>再查入口动作</strong><span>看广告入口曝光、按钮点击、核心操作是否触发；有点击没 check 才是代码/策略断点。</span></li><li><strong>再查策略拦截</strong><span>只有触发了 ad_eligibility_check 后，blocked_reason 才能解释 eligible=0。</span></li><li><strong>最后查数据质量</strong><span>如果后续步骤大于前一步，优先查 scope_type、unit、ID 串联和预加载缓存口径。</span></li></ol><button className="primary-button" onClick={() => onPageChange("workbench")}>进入单项目工作台继续下钻</button></aside>
    </div>
    <div className="surface nested overview-package-check"><div className="surface-title"><div><h2>各包资格检查覆盖横向看</h2><p>口径：eligibilityCheckUsers / DAU。这个表用来找“哪个包最大漏斗最严重”。点击项目进入单项目分析。</p></div><span>{checkProjectRows.length ? `${checkProjectRows.length} 个包可看` : "等待后端字段"}</span></div>{checkProjectRows.length ? <div className="table-wrap"><table><thead><tr><th>项目/包</th><th>DAU</th><th>资格检查人数</th><th>未触发资格检查</th><th>资格检查覆盖</th><th>建议</th></tr></thead><tbody>{checkProjectRows.map((project) => <tr key={project.projectCode ?? project.appIdentifier} className={project.rate !== null && project.rate < 55 ? "row-bad clickable-row" : project.rate !== null && project.rate < 70 ? "row-warn clickable-row" : "clickable-row"} onClick={() => project.projectCode && onProjectSelect?.(String(project.projectCode))}><td><button className="table-project-link" type="button" onClick={(event) => { event.stopPropagation(); project.projectCode && onProjectSelect?.(String(project.projectCode)); }}><strong>{text(project.projectCode)}</strong><small>{text(project.appName ?? project.appIdentifier)}</small></button></td><td>{number(project.dauUsers)}</td><td>{number(project.checkUsers)}</td><td>{number(project.loss)}</td><td><div className="rate-bar"><i style={{ width: `${project.rate === null ? 0 : Math.max(3, Math.min(100, project.rate))}%` }} /><strong>{project.rate === null ? "—" : percent(project.rate)}</strong></div></td><td><small>{project.rate !== null && project.rate < 55 ? "优先排查该包页面入口/资格检查是否漏触发" : project.rate !== null && project.rate < 70 ? "需要关注入口覆盖和版本策略" : "覆盖相对正常，继续看后续资格通过率"}</small></td></tr>)}</tbody></table></div> : <div className="inline-empty">当前项目列表没有返回 eligibilityCheckUsers。后端建议在多项目接口补：DAU、eligibilityCheckUsers、eligibleUsers、opportunityUsers、requestUsers、showAttemptUsers、impressionUsers，这样总览可以直接横向定位哪个包漏。</div>}</div>
  </section>;
}

function Overview({ data, onPageChange, onProjectSelect, context }: { data: AnyRow; onPageChange: Props["onPageChange"]; onProjectSelect?: Props["onProjectSelect"]; context: { projectCode: string; range: string; dates: { dateFrom: string; dateTo: string }; loadedAt: string } }) {
  const summary = data.summary ?? {};
  const projects: AnyRow[] = data.projects ?? [];
  const problemProjects = projects
    .map((project) => ({ ...project, issue: projectIssueMeta(project) }))
    .filter((project) => project.issue.isProblem)
    .sort((left, right) => Number(right.issue.score ?? 0) - Number(left.issue.score ?? 0));
  const severeProjects = problemProjects.filter((project) => project.issue.severity === "bad");
  const impactedDau = problemProjects.reduce((sum, project) => sum + Number(project.issue.dauUsers ?? 0), 0);
  const dau = bestDauValue(data);
  return <div className="page-stack">
    <section className="surface overview-snapshot-rule">
      <div className="surface-title"><div><h2>多项目漏斗预览规则</h2><p>本页只看全项目问题，不做项目筛选；每天早上 05:00 产出前一天全项目快照。需要筛选或下钻时，点击项目进入单项目分析。</p></div><span>每日 05:00 快照</span></div>
      <div className="snapshot-rule-grid"><div><span>查询范围</span><strong>全部有权限项目</strong></div><div><span>展示规则</span><strong>只展示问题项目</strong></div><div><span>下钻方式</span><strong>点击项目 → 单项目分析</strong></div><div><span>当前数据</span><strong>{context.dates.dateFrom} 至 {context.dates.dateTo}</strong></div></div>
    </section>
    <section className="operational-metric-grid">
      <MetricCard label="日活跃用户（DAU）" value={number(dau.value)} note={dau.source} />
      <MetricCard label="问题项目数" value={`${problemProjects.length}/${projects.length}`} note="只展示触发异常规则的项目" status={severeProjects.length ? "bad" : problemProjects.length ? "warn" : "good"} />
      <MetricCard label="严重问题项目" value={number(severeProjects.length)} note="广告浏览、资格、机会、请求或展示链路明显异常" status={severeProjects.length ? "bad" : "good"} />
      <MetricCard label="影响 DAU" value={number(impactedDau)} note="问题项目涉及的活跃用户规模，用于排优先级" />
      <MetricCard label="广告浏览人数（AV）" value={number(summary.impressionUsers)} />
      <MetricCard label="广告收入" value={money(summary.revenue)} />
    </section>
    <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>全项目问题榜</h2><p>只展示异常项目：广告浏览者比例低、资格通过率低、机会覆盖不足、请求/展示链路异常或字段缺失。点击项目进入单项目分析。</p></div><span>{problemProjects.length ? `${problemProjects.length} 个问题项目` : "暂无明显问题"}</span></div>{problemProjects.length ? <div className="table-wrap"><table className="overview-project-issue-table"><thead><tr><th>项目</th><th>主要问题</th><th>DAU</th><th>AV</th><th>浏览者比例</th><th>机会覆盖</th><th>收入</th><th>建议动作</th></tr></thead><tbody>{problemProjects.map((row) => <tr key={row.projectCode ?? row.appIdentifier} className={`${row.issue.severity === "bad" ? "row-bad" : "row-warn"} clickable-row`} onClick={() => row.projectCode && onProjectSelect?.(String(row.projectCode))}><td><button className="table-project-link" type="button" onClick={(event) => { event.stopPropagation(); row.projectCode && onProjectSelect?.(String(row.projectCode)); }}><strong>{text(row.projectCode)}</strong><small>{text(row.appName ?? row.appIdentifier)}</small></button></td><td><strong>{row.issue.title}</strong><small>{row.issue.detail}</small></td><td>{number(row.issue.dauUsers)}</td><td>{number(row.issue.avUsers ?? row.impressionUsers)}</td><td>{percent(row.issue.viewerRate ?? row.adViewerRate)}</td><td>{percent(row.issue.opportunityCoverage ?? row.opportunityCoverage)}</td><td>{money(row.revenue)}</td><td><small>{row.issue.action}</small></td></tr>)}</tbody></table></div> : <div className="inline-empty"><strong>当前全项目快照没有明显问题。</strong><br />如果你认为应有异常，请让后端确认多项目接口是否返回 DAU、AV、资格检查、资格通过、机会、请求、展示尝试、Impression 和异常步骤字段。</div>}</div><aside className="surface"><div className="surface-title"><div><h2>数据时效</h2><p>总览使用定时快照，不按项目筛选</p></div></div><dl className="operational-kv"><div><dt>快照时间</dt><dd>每日 05:00</dd></div><div><dt>数据范围</dt><dd>{context.dates.dateFrom} 至 {context.dates.dateTo}</dd></div><div><dt>校准状态</dt><dd>{text(data.freshness?.calibrationStatus)}</dd></div><div><dt>最新事件</dt><dd>{text(data.freshness?.latestEventAt)}</dd></div><div><dt>Firebase 行数</dt><dd>{number(data.freshness?.firebaseRows)}</dd></div><div><dt>API 行数</dt><dd>{number(data.freshness?.apiRows)}</dd></div></dl><button className="primary-button" onClick={() => problemProjects[0]?.projectCode ? onProjectSelect?.(String(problemProjects[0].projectCode)) : onPageChange("workbench")}>{problemProjects[0]?.projectCode ? `查看最大问题项目 ${problemProjects[0].projectCode}` : "进入单项目工作台"}</button></aside></section>
    <ProjectEligibilityComparison projects={problemProjects.length ? problemProjects : projects} />
    <section className="surface"><div className="surface-title"><div><h2>全项目广告漏斗异常预览</h2><p>这是每日 05:00 的全项目聚合漏斗，用来判断整体最大断点；具体项目请点击上方问题榜进入单项目分析。</p></div><div className="funnel-context-strip"><div><span>项目范围</span><strong>全部项目</strong></div><div><span>数据范围</span><strong>{context.dates.dateFrom} 至 {context.dates.dateTo}</strong></div><div><span>数据拉取时间</span><strong>{context.loadedAt || "刚刚"}</strong></div></div></div><Funnel rows={data.funnel} unit="users" domain="ads" data={data} /></section>
    <OverviewFunnelDiagnosis rows={data.funnel ?? []} projects={problemProjects.length ? problemProjects : projects} onPageChange={onPageChange} onProjectSelect={onProjectSelect} />
  </div>;
}

type VersionCompareColumn = { key: string; label: string; unit: "count" | "ratio"; num?: string; den?: string };

function versionCompareColumns(domain: string): VersionCompareColumn[] {
  if (domain === "vpn") {
    return [
      { key: "dauUsers", label: "DAU", unit: "count" },
      { key: "connectAttemptUsers", label: "连接点击/尝试UV", unit: "count" },
      { key: "connectAttemptRate", label: "连接发起率", unit: "ratio", num: "connectAttemptUsers", den: "dauUsers" },
      { key: "connectSuccessUsers", label: "连接成功UV", unit: "count" },
      { key: "connectSuccessRate", label: "连接成功率", unit: "ratio", num: "connectSuccessUsers", den: "connectAttemptUsers" },
    ];
  }
  return [
    { key: "dauUsers", label: "DAU", unit: "count" },
    { key: "eligibilityCheckUsers", label: "资格检查UV", unit: "count" },
    { key: "eligibilityPassRate", label: "资格通过率", unit: "ratio", num: "eligibleUsers", den: "eligibilityCheckUsers" },
    { key: "opportunityUsers", label: "机会UV", unit: "count" },
    { key: "opportunityCoverageRate", label: "机会完整率", unit: "ratio", num: "opportunityUsers", den: "eligibleUsers" },
    { key: "requestUsers", label: "请求UV", unit: "count" },
    { key: "requestCoverageRate", label: "请求覆盖率", unit: "ratio", num: "requestUsers", den: "opportunityUsers" },
    { key: "impressionUsers", label: "展示UV", unit: "count" },
    { key: "viewerRatio", label: "浏览者比例", unit: "ratio", num: "impressionUsers", den: "dauUsers" },
    { key: "impressionConversionRate", label: "展示转化率", unit: "ratio", num: "impressionUsers", den: "requestUsers" },
    { key: "paidUsers", label: "Paid UV", unit: "count" },
  ];
}

const versionCompareDimensions = [
  { key: "app_version", label: "应用版本" },
  { key: "country_code", label: "国家" },
  { key: "platform", label: "平台" },
];

/** Compare dimension labels naturally: version parts as numbers, rest lexically. */
function compareDimensionLabels(a: string, b: string): number {
  const parse = (value: string) => value.split(/[.\s]+/).map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) || String(num) !== part ? part.toLowerCase() : num;
  });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? (typeof right[i] === "number" ? 0 : "");
    const r = right[i] ?? (typeof left[i] === "number" ? 0 : "");
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "number") return l - r;
    return String(l).localeCompare(String(r), "zh-CN");
  }
  return 0;
}

function VersionComparison({ data, domain, projectCode, appIdentifier, platform, country, appVersion, initialRange, refreshKey }: {
  data: AnyRow;
  domain: "ads" | "vpn" | "quality";
  projectCode: string;
  appIdentifier?: string;
  platform: string;
  country: string;
  appVersion: string;
  initialRange: string;
  refreshKey: number;
}) {
  const allColumns = useMemo(() => versionCompareColumns(domain), [domain]);
  const [dimension, setDimension] = useState<string>("app_version");
  const [range, setRange] = useState<string>(initialRange);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    allColumns.forEach((column) => { map[column.key] = true; });
    return map;
  });
  const [comparison, setComparison] = useState<AnyRow>(data.versionComparison ?? {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isDefault = dimension === "app_version" && range === initialRange;
  useEffect(() => {
    if (isDefault) {
      setComparison(data.versionComparison ?? {});
      setLoading(false);
      setError("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const dates = dateRange(range);
    const baseQuery = {
      ...dates,
      projectCode,
      appIdentifier,
      platform: platform === "全部" ? undefined : platform.toLowerCase() as "android" | "ios",
      country: country === "全部国家" ? undefined : country,
      appVersion: appVersion === "全部版本" ? undefined : appVersion.split(" ")[0],
    };
    queryFunnel<AnyRow>({ ...baseQuery, page: "version_comparison", domain, unit: "users", dimension }, controller.signal)
      .then((result) => { if (active) setComparison(result.versionComparison ?? {}); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "查询失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [dimension, range, isDefault, projectCode, appIdentifier, platform, country, appVersion, refreshKey, data]);

  const rows: AnyRow[] = comparison.rows ?? [];
  const selectedColumns = allColumns.filter((column) => visible[column.key] !== false);
  const dimensionLabel = text(comparison.dimensionLabel ?? "应用版本");
  const suggested = text(comparison.suggestedBaseline) || text(rows[0]?.dimensionLabel);
  const [baselineLabel, setBaselineLabel] = useState(suggested);
  useEffect(() => { setBaselineLabel(suggested); }, [suggested]);
  const baseline = rows.find((row) => text(row.dimensionLabel) === baselineLabel) ?? rows[0];

  const [sortKey, setSortKey] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "__dimension" ? "asc" : "desc");
  };
  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "__dimension") {
        return direction * compareDimensionLabels(text(a.dimensionLabel), text(b.dimensionLabel));
      }
      return direction * (Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0));
    });
  }, [rows, sortKey, sortDirection]);

  const rateDelta = (value: unknown, base: unknown) => {
    const delta = Number(value ?? 0) - Number(base ?? 0);
    return <span className={delta < -3 ? "version-delta bad" : delta > 3 ? "version-delta good" : "version-delta"}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}pp</span>;
  };

  const totals = useMemo(() => {
    const result: Record<string, number> = {};
    selectedColumns.forEach((column) => {
      if (column.unit === "count") {
        result[column.key] = rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0);
      }
    });
    selectedColumns.forEach((column) => {
      if (column.unit === "ratio" && column.num && column.den) {
        const numKey = column.num;
        const denKey = column.den;
        const num = result[numKey] ?? rows.reduce((sum, row) => sum + Number(row[numKey] ?? 0), 0);
        const den = result[denKey] ?? rows.reduce((sum, row) => sum + Number(row[denKey] ?? 0), 0);
        result[column.key] = den > 0 ? (num / den) * 100 : 0;
      }
    });
    return result;
  }, [rows, selectedColumns]);

  const formatCell = (value: unknown, unit: "count" | "ratio") => (unit === "ratio" ? percent(value) : number(value));

  return <div className="page-stack version-compare-page">
    <section className="surface version-compare-header">
      <div className="surface-title"><div><h2>App 版本核心指标对比</h2><p>固定同一项目、平台和国家，按「{dimensionLabel}」对比核心漏斗指标；右侧可选展示列、维度和日期范围，差异相对所选基准。</p></div></div>
    </section>
    <div className="version-compare-layout">
      <div className="version-compare-main">
        {loading && <div className="version-compare-loading">正在读取 {dimensionLabel} 对比数据…</div>}
        {error && <div className="version-compare-loading warn">{error}</div>}
        {!rows.length && !loading ? <section className="surface"><div className="empty-table-state"><strong>当前筛选范围没有可对比数据</strong><span>请确认所选维度字段已上报，并选择包含多个分组的日期范围。</span></div></section> : <section className="surface"><div className="table-wrap"><table className="version-compare-table">
          <thead><tr>
            <th className="sortable" onClick={() => toggleSort("__dimension")}><span>{dimensionLabel}</span>{sortKey === "__dimension" && <span className="sort-indicator">{sortDirection === "asc" ? "▲" : "▼"}</span>}</th>
            {selectedColumns.map((column) => <th key={column.key} className="sortable" onClick={() => toggleSort(column.key)}><span>{column.label}</span>{column.unit === "ratio" && <small title="同组分子分母计算的比例">%</small>}{sortKey === column.key && <span className="sort-indicator">{sortDirection === "asc" ? "▲" : "▼"}</span>}</th>)}
          </tr></thead>
          <tbody>{sortedRows.map((row) => {
            const sampleSmall = Number(row.dauUsers ?? 0) < 100;
            const isBaseline = text(row.dimensionLabel) === text(baseline?.dimensionLabel);
            return <tr key={text(row.dimensionLabel)} className={isBaseline ? "row-baseline" : ""}>
              <td><strong>{text(row.dimensionLabel)}</strong>{isBaseline && <small>当前基准</small>}{sampleSmall && <small className="sample-small">小样本</small>}</td>
              {selectedColumns.map((column) => <td key={column.key}>
                {formatCell(row[column.key], column.unit)}
                {column.unit === "ratio" && !isBaseline && baseline ? rateDelta(row[column.key], baseline[column.key]) : null}
              </td>)}
            </tr>;
          })}</tbody>
          {rows.length > 1 && <tfoot><tr>
            <td><strong>摘要</strong><small>全部 {rows.length} 组</small></td>
            {selectedColumns.map((column) => <td key={column.key}><strong>{formatCell(totals[column.key], column.unit)}</strong></td>)}
          </tr></tfoot>}
        </table></div><div className="version-compare-footnote">数据源：{text(comparison.source)}；口径：{text(comparison.notice)}</div></section>}
      </div>
      <aside className="version-compare-config surface">
        <div className="config-group">
          <div className="config-title">维度</div>
          <div className="config-options">{versionCompareDimensions.map((item) => <button key={item.key} className={dimension === item.key ? "active" : ""} onClick={() => setDimension(item.key)}>{item.label}</button>)}</div>
        </div>
        <div className="config-group">
          <div className="config-title">日期范围</div>
          <div className="config-options">{[initialRange, "近7天", "近30天"].filter((item, index, arr) => arr.indexOf(item) === index).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
        </div>
        <div className="config-group">
          <div className="config-title">展示列</div>
          <div className="config-checkboxes">{allColumns.map((column) => <label key={column.key}><input type="checkbox" checked={visible[column.key] !== false} onChange={(event) => setVisible((current) => ({ ...current, [column.key]: event.target.checked }))} /><span>{column.label}</span></label>)}</div>
        </div>
      </aside>
    </div>
  </div>;
}

function Workbench({ data, domain, setDomain, unit, setUnit, pageData, diagnosisData, pageProgress, diagnosisProgress, lockDomain }: { data: AnyRow; domain: string; setDomain: (domain: "ads" | "vpn" | "quality") => void; unit: FunnelUnit; setUnit: (unit: FunnelUnit) => void; pageData?: AnyRow | null; diagnosisData?: AnyRow | null; pageProgress?: QueryProgressItem; diagnosisProgress?: QueryProgressItem; lockDomain?: boolean }) {
  const isVpnProduct = data.isVpnProduct === true;
  const baseMetrics: AnyRow[] = data.metrics ?? [];
  const rawFunnelRows: AnyRow[] = data.funnel ?? [];
  const funnelRows: AnyRow[] = useMemo(() => {
    const base = domain === "vpn" ? ensureVpnRequiredSteps(rawFunnelRows, data, baseMetrics) : rawFunnelRows;
    return normalizeWorkbenchFunnelRows(base, unit, domain);
  }, [data, domain, baseMetrics, rawFunnelRows, unit]);
  const metrics: AnyRow[] = useMemo(() => addSingleProjectDerivedMetrics(baseMetrics, data, funnelRows, domain), [baseMetrics, data, funnelRows, domain]);
  const [dropoffSelection, setDropoffSelection] = useState<DropoffSelection>(() => bestDropoffSelection(funnelRows));
  useEffect(() => { setDropoffSelection(bestDropoffSelection(funnelRows)); }, [data, domain, funnelRows]);
  return <div className="page-stack">{!lockDomain && <nav className="operational-tabs"><button className={domain === "ads" ? "active" : ""} onClick={() => setDomain("ads")}>广告变现</button><button className={domain === "vpn" ? "active" : ""} onClick={() => setDomain("vpn")}>VPN 功能</button><button className={domain === "quality" ? "active" : ""} onClick={() => setDomain("quality")}>数据质量</button></nav>}{domain === "ads" && <nav className="operational-tabs unit-tabs"><button className={unit === "sessions" ? "active" : ""} onClick={() => setUnit("sessions")}>Session 漏斗</button><button className={unit === "users" ? "active" : ""} onClick={() => setUnit("users")}>用户 UV</button><button className={unit === "events" ? "active" : ""} onClick={() => setUnit("events")}>履约次数</button></nav>}<AvailabilityBanner data={data} /><section className="operational-metric-grid">{metrics.map((row) => <MetricCard key={row.metricKey ?? row.name} label={text(row.name)} value={row.displayValue ?? (row.unit === "ratio" ? percent(row.value) : number(row.value))} note={row.detail ?? row.formula} status={row.status} />)}</section><AiAnalysisPanel data={data} metrics={metrics} funnelRows={funnelRows} rawFunnelRows={rawFunnelRows} domain={domain} unit={unit} pageData={pageData} diagnosisData={diagnosisData} />{domain === "ads" && isVpnProduct && unit !== "events" && <VpnHomeSignalBoard data={data} />}{domain === "ads" && unit === "sessions" && !isVpnProduct && <AdSessionBaselineWarning rows={funnelRows} rawRows={rawFunnelRows} />}{domain === "ads" && <AdViewerRatioDeepDive rows={funnelRows} data={data} metrics={metrics} pageData={pageData} diagnosisData={diagnosisData} diagnosisProgress={diagnosisProgress} pageProgress={pageProgress} />}{domain === "ads" && <AdEligibilityInsight rows={funnelRows} data={data} diagnosisData={diagnosisData} diagnosisProgress={diagnosisProgress} />}{domain === "vpn" && <VpnPrerequisiteInsight rows={funnelRows} data={data} />}<section className="surface"><div className="surface-title"><div><h2>{domain === "vpn" ? "VPN 功能详细漏斗" : domain === "quality" ? "数据质量门禁" : isVpnProduct && unit !== "events" ? "VPN 品类广告变现全链路漏斗" : "广告核心漏斗"}</h2><p>{domain === "vpn" ? "DAU → 进入首页 → 点击连接 → 权限可用 → 节点选择 → 连接开始 → 连接成功。" : domain === "ads" && isVpnProduct && unit !== "events" ? "DAU → 进入首页 → 资格检查/不通过原因 → 资格通过 → 广告机会 → 缓存或实时请求 → 加载成功 → 广告可展示 → 展示尝试 → Impression → Paid。" : domain === "ads" && unit === "events" ? "按广告链路 ID 统计履约次数，用于检查缓存、请求、加载和展示断点。" : "按当前去重口径展示广告变现链路。"}</p></div><span title={funnelUnitHint(unit, domain)}>当前口径：{domain === "vpn" ? "用户 UV" : funnelUnitLabel(unit, domain)}</span></div><Funnel rows={funnelRows} selectedTransition={dropoffSelection} onSelectTransition={setDropoffSelection} unit={unit} domain={domain} data={data} /></section><DropoffAnalysisPanel rows={funnelRows} selection={dropoffSelection} onSelectionChange={setDropoffSelection} data={data} pageData={pageData} diagnosisData={diagnosisData} pageProgress={pageProgress} diagnosisProgress={diagnosisProgress} />{data.vpnStageHealth?.stages?.length > 0 && <section className="surface"><div className="surface-title"><div><h2>连接阶段成功率与 P95</h2><p>按 connection_id 关联真实连接阶段</p></div></div><div className="table-wrap"><table><thead><tr><th>阶段</th><th>样本</th><th>成功率</th><th>P95</th><th>状态</th></tr></thead><tbody>{data.vpnStageHealth.stages.map((row: AnyRow) => <tr key={row.stageKey}><td>{text(row.stageName)}</td><td>{number(row.totalCount)}</td><td>{percent(row.successRate)}</td><td>{text(row.displayP95 ?? row.p95Ms)}</td><td>{row.available === false ? "暂无数据" : text(row.status)}</td></tr>)}</tbody></table></div></section>}</div>;
}

function DiagnosisPage({ data, workbenchData, onOpenWorkbench }: { data: AnyRow; workbenchData?: AnyRow | null; onOpenWorkbench?: () => void }) {
  const reasons: AnyRow[] = data.reasons ?? [];
  const funnelRows: AnyRow[] = workbenchData?.funnel ?? [];
  const start = Number(data.selection?.start?.count ?? 0);
  const end = Number(data.selection?.end?.count ?? 0);
  const loss = Math.max(0, start - end);
  const passRate = start > 0 ? end / start * 100 : null;
  const bestSelection = bestDropoffSelection(funnelRows);
  const bestFrom = funnelRows[bestSelection.fromIndex];
  const bestTo = funnelRows[bestSelection.toIndex];
  const bestLoss = bestFrom && bestTo ? Math.max(0, rowCount(bestFrom) - rowCount(bestTo)) : 0;
  const emptyTitle = loss === 0 ? "当前诊断区间没有可证明流失" : "当前有流失，但原因规则没有返回分类";
  const emptyMessage = loss === 0
    ? `当前默认诊断区间起点 ${number(start)}、终点 ${number(end)}，链路可关联率 ${percent(data.chainLinkRate)}，Unknown 率 ${percent(data.unknownRate)}。所以原因表为 0 条是正常结果，不是 A054 没有数据。`
    : `当前区间有 ${number(loss)} 个对象未到达终点，但后端没有返回 reason_code。需要看证据明细或补充流失规则，避免把 UNKNOWN 当成正常。`;
  return <div className="page-stack">
    <section className="operational-metric-grid">
      <MetricCard label="起点对象" value={number(start || data.selection?.start?.count)} />
      <MetricCard label="到达终点" value={number(end || data.selection?.end?.count)} />
      <MetricCard label="链路可关联率" value={percent(data.chainLinkRate)} status={data.chainLinkRate >= 99 ? "good" : "warn"} />
      <MetricCard label="Unknown 率" value={percent(data.unknownRate)} status={data.unknownRate > 1 ? "warn" : "good"} />
    </section>
    {!reasons.length && <section className="surface diagnosis-no-reasons">
      <div className="surface-title"><div><h2>{emptyTitle}</h2><p>这里以前直接空表，运营会误以为没查到；现在明确说明当前口径的诊断结果。</p></div><span>{loss === 0 ? "无流失原因" : "规则待补齐"}</span></div>
      <p>{emptyMessage}</p>
      <div className="diagnosis-empty-grid">
        <div><span>当前区间结论</span><strong>{loss === 0 ? "闭环完整" : "有未解释流失"}</strong><small>{passRate === null ? "通过率暂无" : `通过率 ${percent(passRate)}`}</small></div>
        <div><span>推荐下一步</span><strong>{bestLoss > 0 ? `${rowName(bestFrom)} → ${rowName(bestTo)}` : "查看其他口径"}</strong><small>{bestLoss > 0 ? `核心漏斗中该断点流失 ${number(bestLoss)}，更适合继续排查` : "当前 Session 口径整体无明显断点，可切到用户 UV / 事件次数 / 国家版本维度"}</small></div>
        <div><span>是否该建问题单</span><strong>{loss === 0 ? "暂不建议" : "建议补规则"}</strong><small>{loss === 0 ? "没有可证明失败对象，先不要创建研发问题" : "先补 reason_code 或进入证据明细确认根因"}</small></div>
      </div>
      {onOpenWorkbench && <button className="primary-button" onClick={onOpenWorkbench}>回到核心漏斗选择断点</button>}
    </section>}
    <section className="surface"><div className="surface-title"><div><h2>流失原因</h2><p>仅统计当前起点至终点区间可证明的失败对象</p></div><span>{reasons.length ? `${reasons.length} 条` : "0 条"}</span></div>{reasons.length ? <div className="table-wrap"><table><thead><tr><th>原因</th><th>说明</th><th>对象数</th><th>占比</th></tr></thead><tbody>{reasons.map((row: AnyRow) => <tr key={row.code ?? row.reason}><td>{text(row.code ?? row.reason)}</td><td>{text(row.label ?? row.description)}</td><td>{number(row.count ?? row.users)}</td><td>{percent(row.share ?? row.rate)}</td></tr>)}</tbody></table></div> : <div className="inline-empty">当前筛选下没有失败对象原因。若你要分析“哪个页面哪里漏”，请回到核心漏斗，点击有流失数的相邻步骤，页面会展示 page × step 的起点 UV、到达 UV、流失 UV 和判断。</div>}</section>
  </div>;
}

function statusText(value: unknown) {
  const raw = text(value);
  if (raw === "—" || /[\u4e00-\u9fa5]/.test(raw)) return raw;
  const key = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    PASSED: "通过",
    SUCCESS: "成功",
    SUCCEEDED: "成功",
    OK: "正常",
    GOOD: "正常",
    VALID: "有效",
    WARNING: "预警",
    WARN: "预警",
    DEGRADED: "降级",
    PARAM_INVALID: "参数错误",
    CHAIN_INVALID: "关联链错误",
    NOT_RECEIVED: "未收到",
    PENDING: "待处理",
    RUNNING: "处理中",
    REVIEWING: "评审中",
    OPEN: "待处理",
    TODO: "待处理",
    FIXING: "修复中",
    RETESTING: "待复测",
    VERIFIED: "已验证",
    CLOSED: "已关闭",
    FAILED: "失败",
    ERROR: "错误",
    UNKNOWN: "未知",
  };
  return map[key] ?? raw;
}

function evidenceTone(row: AnyRow) {
  const raw = `${row.resultStatus ?? row.qualityStatus ?? row.result ?? ""}`.toUpperCase();
  if (["PASSED", "SUCCESS", "VALID", "OK"].includes(raw)) return "good";
  if (["PARAM_INVALID", "CHAIN_INVALID", "NOT_RECEIVED", "FAILED", "ERROR"].includes(raw)) return "bad";
  if (["WARNING", "DEGRADED", "PENDING"].includes(raw)) return "warn";
  return "neutral";
}

function evidenceBusinessIds(row: AnyRow) {
  const ids = [
    ["session", row.sessionId ?? row.session_id],
    ["vpn", row.vpnSessionId ?? row.vpn_session_id],
    ["connection", row.connectionId ?? row.connection_id],
    ["opportunity", row.opportunityId ?? row.opportunity_id],
    ["request", row.requestId ?? row.request_id],
    ["instance", row.adInstanceId ?? row.ad_instance_id],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
  return ids.length ? ids.map(([key, value]) => `${key}: ${value}`).join(" / ") : "—";
}

function evidenceAdvice(row: AnyRow) {
  const raw = `${row.resultStatus ?? row.qualityStatus ?? ""} ${row.eventName ?? ""} ${row.errorCode ?? ""} ${row.blockedReason ?? ""}`.toLowerCase();
  if (raw.includes("param")) return "检查字段 Provider、类型转换、枚举值和空字符串清洗";
  if (raw.includes("chain") || raw.includes("opportunity") || raw.includes("request")) return "检查 session_id / opportunity_id / request_id / ad_instance_id 是否从上一步透传";
  if (raw.includes("not_received")) return "回到打点验收，按页面操作路径复测该事件是否触发";
  if (raw.includes("vpn")) return "按 vpn_session_id 与 connection_id 下钻连接阶段和终态";
  if (raw.includes("ad_")) return "按广告机会、请求、实例、展示回调逐步核对";
  return "保留为证据样本；若影响用户较多，可创建问题单并绑定复测指标";
}

function EvidencePage({ data }: { data: AnyRow }) {
  const items: AnyRow[] = data.items ?? [];
  const abnormal = items.filter((row) => evidenceTone(row) === "bad" || evidenceTone(row) === "warn");
  const users = new Set(items.map((row) => row.myUserId ?? row.my_user_id).filter(Boolean));
  const sessions = new Set(items.map((row) => row.sessionId ?? row.session_id).filter(Boolean));
  const withBusinessId = items.filter((row) => evidenceBusinessIds(row) !== "—").length;
  return <div className="page-stack evidence-workbench">
    <section className="operational-metric-grid">
      <MetricCard label="证据总量" value={number(data.total ?? items.length)} note="当前筛选范围返回的事件样本" />
      <MetricCard label="异常证据" value={number(data.abnormalTotal ?? abnormal.length)} note="参数、关联链、未收到、质量异常" status={abnormal.length ? "warning" : "good"} />
      <MetricCard label="涉及用户" value={number(users.size || data.userTotal)} note="按 my_user_id 去重" />
      <MetricCard label="涉及会话" value={number(sessions.size || data.sessionTotal)} note="按 session_id / vpn_session_id 串链路" />
      <MetricCard label="带业务ID" value={number(withBusinessId)} note="可直接追 opportunity/request/connection" status={withBusinessId ? "good" : "warn"} />
      <MetricCard label="证据用途" value="定位根因" note="能复制给研发复现和查明细" />
    </section>
    <section className="surface evidence-guide">
      <div className="surface-title"><div><h2>证据怎么用</h2><p>这页不是看大盘，是把某个断点对应的原始事件、关联 ID 和错误原因拿出来，支持研发复现。</p></div><span>{items.length ? "已返回证据" : "等待证据明细"}</span></div>
      <div className="diagnosis-empty-grid">
        <div><span>先看结果</span><strong>结果 / 原因</strong><small>判断是未收到、参数错、关联链断，还是业务拦截。</small></div>
        <div><span>再看 ID</span><strong>session / request / connection</strong><small>ID 连不上时，漏斗会断但单个事件可能看起来正常。</small></div>
        <div><span>最后处理</span><strong>创建问题单</strong><small>只把可证明的异常证据带入闭环，避免凭感觉派单。</small></div>
      </div>
    </section>
    <section className="surface"><div className="surface-title"><div><h2>事件证据与原始参数</h2><p>共 {number(data.total ?? items.length)} 条，异常 {number(data.abnormalTotal ?? abnormal.length)} 条；优先展示可追链路的 ID。</p></div><span>可复制给研发</span></div>{items.length ? <div className="table-wrap"><table className="evidence-detail-table"><thead><tr><th>时间</th><th>事件 / 页面</th><th>用户</th><th>链路 ID</th><th>结果</th><th>原因 / 返回值</th><th>来源</th><th>操作建议</th></tr></thead><tbody>{items.map((row: AnyRow, index: number) => <tr key={row.eventId ?? `${row.eventName}-${index}`} className={evidenceTone(row) === "bad" ? "row-bad" : evidenceTone(row) === "warn" ? "row-warn" : ""}><td>{text(row.eventTimeUtc ?? row.eventTime ?? row.loggedAt)}</td><td><strong>{text(row.eventName)}</strong><small>{text(row.screenName ?? row.currentScreen)}</small></td><td><strong>{text(row.myUserId ?? row.my_user_id)}</strong><small>{text(row.sessionId ?? row.session_id)}</small></td><td><code>{evidenceBusinessIds(row)}</code></td><td><BadgeLike tone={evidenceTone(row)}>{statusText(row.resultStatus ?? row.qualityStatus ?? row.result)}</BadgeLike></td><td><strong>{text(row.errorCode ?? row.blockedReason ?? row.returnValue ?? row.reason)}</strong><small>{text(row.errorMessage ?? row.message)}</small></td><td>{text(row.sourceLabel ?? row.source)}</td><td>{evidenceAdvice(row)}</td></tr>)}</tbody></table></div> : <div className="inline-empty"><strong>当前没有返回事件证据明细。</strong><br />如果漏斗页有流失但这里为空，后端需要按当前项目、日期、domain、unit、startStep/endStep 查询 DWD 明细或隔离表，并返回 event_id、event_name、my_user_id、session_id、业务ID、result_status、error_code。</div>}</section>
  </div>;
}

function issueTone(row: AnyRow) {
  const raw = `${row.severity ?? row.priority ?? row.level ?? ""} ${row.status ?? ""}`.toUpperCase();
  if (raw.includes("P0") || raw.includes("BLOCK") || raw.includes("FAILED") || raw.includes("严重")) return "bad";
  if (raw.includes("P1") || raw.includes("RETEST") || raw.includes("预警") || raw.includes("修复")) return "warn";
  if (raw.includes("CLOSED") || raw.includes("VERIFIED") || raw.includes("已关闭")) return "good";
  return "neutral";
}

function issueNextAction(row: AnyRow) {
  const raw = `${row.status ?? ""}`.toUpperCase();
  if (raw.includes("RETEST") || raw.includes("VERIFY")) return "产品复测：按配置快照重新跑验收 Run，并确认指标回升";
  if (raw.includes("FIX") || raw.includes("OPEN") || raw.includes("TODO")) return "研发修复：绑定证据事件、影响范围、目标版本和负责人";
  if (raw.includes("CLOSED")) return "已关闭：保留复测记录和指标恢复截图";
  return "补齐问题单字段：负责人、目标版本、验收条件、证据链接";
}

function IssuesPage({ data }: { data: AnyRow }) {
  const items: AnyRow[] = data.items ?? [];
  const open = items.filter((row) => !`${row.status ?? ""}`.toUpperCase().includes("CLOSED"));
  const retest = items.filter((row) => /RETEST|VERIFY|复测|验证/i.test(`${row.status ?? ""}`));
  const blockers = items.filter((row) => issueTone(row) === "bad");
  return <div className="page-stack issue-closure-page">
    <section className="operational-metric-grid">
      <MetricCard label="待处理问题" value={number(open.length)} note="未关闭问题单" status={open.length ? "warning" : "good"} />
      <MetricCard label="严重阻断" value={number(blockers.length)} note="P0 / BLOCKED / FAILED" status={blockers.length ? "bad" : "good"} />
      <MetricCard label="待产品复测" value={number(retest.length)} note="修复后必须复测才可关闭" status={retest.length ? "warning" : "good"} />
      <MetricCard label="可关闭条件" value="证据+指标" note="修复、重测、指标恢复三者都要有" />
    </section>
    <section className="surface issue-flow-card">
      <div className="surface-title"><div><h2>闭环规则</h2><p>问题不是修完代码就结束；必须完成复测和效果验证，才允许关闭。</p></div><span>标准流转</span></div>
      <div className="acceptance-flow compact">{[["发现问题", "来自漏斗/证据/验收"], ["绑定证据", "event_id + 关联ID"], ["研发修复", "负责人 + 版本"], ["产品复测", "验收Run通过"], ["指标恢复", "观察期达标"]].map((row, index) => <div key={row[0]} className={index < 2 ? "done" : index === 2 ? "current" : ""}><span>{index < 2 ? "✓" : index + 1}</span><strong>{row[0]}</strong><small>{row[1]}</small></div>)}</div>
    </section>
    <section className="surface"><div className="surface-title"><div><h2>问题修复闭环</h2><p>每条问题都要能看见：谁负责、哪个版本修、怎么验收、下一步做什么。</p></div><span>{items.length ? `${items.length} 个问题` : "暂无问题单"}</span></div>{items.length ? <div className="table-wrap"><table className="issue-closure-table"><thead><tr><th>问题单</th><th>标题 / 证据</th><th>等级</th><th>负责人</th><th>目标版本</th><th>当前状态</th><th>验收条件</th><th>下一步</th><th>更新时间</th></tr></thead><tbody>{items.map((row: AnyRow, index: number) => <tr key={row.issueId ?? index} className={issueTone(row) === "bad" ? "row-bad" : issueTone(row) === "warn" ? "row-warn" : ""}><td><strong>{text(row.issueId)}</strong><small>{text(row.source ?? row.metricKey)}</small></td><td><strong>{text(row.title)}</strong><small>{text(row.evidenceId ?? row.evidenceLink ?? row.reason)}</small></td><td><BadgeLike tone={issueTone(row)}>{text(row.severity ?? row.priority ?? row.level)}</BadgeLike></td><td>{text(row.ownerId ?? row.ownerName ?? row.owner)}</td><td>{text(row.targetVersion ?? row.fixVersion)}</td><td>{statusText(row.status)}</td><td>{text(row.acceptanceCriteria ?? row.verifyRule ?? "复测通过 + 指标恢复到阈值")}</td><td>{issueNextAction(row)}</td><td>{text(row.updatedAt)}</td></tr>)}</tbody></table></div> : <div className="inline-empty"><strong>当前没有问题单。</strong><br />这不等于没有问题：如果漏斗或证据页已经发现异常，请从证据页创建问题，至少写入 issue_id、title、severity、owner、target_version、evidence_id、acceptance_criteria、status、updated_at。</div>}</section>
  </div>;
}

function BadgeLike({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`badge badge-${tone === "bad" ? "bad" : tone === "warn" ? "warn" : tone === "good" ? "good" : "neutral"}`}>{children}</span>;
}

function GenericPage({ page, data, workbenchData, onOpenWorkbench }: { page: FunnelPageKey; data: AnyRow; workbenchData?: AnyRow | null; onOpenWorkbench?: () => void }) {
  if (page === "diagnosis") return <DiagnosisPage data={data} workbenchData={workbenchData} onOpenWorkbench={onOpenWorkbench} />;
  if (page === "cohort") return <section className="surface"><div className="surface-title"><div><h2>异常切片对比</h2><p>按当前维度定位问题集中人群</p></div></div><div className="table-wrap"><table><thead><tr><th>切片</th><th>起点</th><th>终点</th><th>转化率</th><th>变化</th></tr></thead><tbody>{(data.items ?? []).map((row: AnyRow, index: number) => <tr key={row.value ?? index}><td>{text(row.label ?? row.value)}</td><td>{number(row.startCount ?? row.start)}</td><td>{number(row.endCount ?? row.end)}</td><td>{percent(row.conversionRate ?? row.rate)}</td><td>{text(row.deltaPp ?? row.delta)}</td></tr>)}</tbody></table></div></section>;
  if (page === "path") {
    const pageRows: AnyRow[] = mergeAdPageAliasRows(data.pages ?? data.pageFunnel?.pages ?? data.adPageFunnel?.pages ?? []);
    const rows = pageRows.map((row) => {
      const pageUsers = Number(pageField(row, ["pageUsers", "page_users", "users", "screenUsers", "screen_users"]) ?? 0);
      const checkUsers = Number(pageField(row, ["eligibilityCheckUsers", "eligibility_check_users", "checkUsers", "check_users"]) ?? 0);
      const eligibleUsers = Number(pageField(row, ["eligibleUsers", "eligible_users", "eligibilityPassUsers", "eligibility_pass_users"]) ?? 0);
      const opportunityUsers = Number(pageField(row, ["opportunityUsers", "opportunity_users"]) ?? 0);
      const requestUsers = Number(pageField(row, ["requestUsers", "request_users"]) ?? 0);
      const requestSuccessUsers = Number(pageField(row, ["requestSuccessUsers", "request_success_users", "loadSuccessUsers", "load_success_users", "adLoadSuccessUsers", "ad_load_success_users"]) ?? 0);
      const requestFailedUsers = Number(pageField(row, ["requestFailedUsers", "request_failed_users", "requestFailUsers", "request_fail_users", "loadFailedUsers", "load_failed_users", "loadFailUsers", "load_fail_users", "adLoadFailedUsers", "ad_load_failed_users"]) ?? 0);
      const showAttemptUsers = Number(pageField(row, ["showAttemptUsers", "show_attempt_users"]) ?? 0);
      const impressionUsers = Number(pageField(row, ["impressionUsers", "impression_users", "avUsers", "av_users"]) ?? 0);
      const transitions = [
        ["页面访问 → 资格检查", pageUsers, checkUsers],
        ["资格检查 → 资格通过", checkUsers, eligibleUsers],
        ["资格通过 → 广告机会", eligibleUsers, opportunityUsers],
        ["广告机会 → 广告请求", opportunityUsers, requestUsers],
        ["广告请求 → 请求成功", requestUsers, requestSuccessUsers],
        ["请求成功 → 展示尝试", requestSuccessUsers, showAttemptUsers],
        ["展示尝试 → AV", showAttemptUsers, impressionUsers],
      ].filter((item) => Number(item[1]) > 0).map(([label, from, to]) => {
        const fromValue = Number(from);
        const toValue = Number(to);
        const loss = Math.max(0, fromValue - toValue);
        return { label, loss, lossRate: fromValue > 0 ? loss / fromValue * 100 : null };
      }).sort((left, right) => right.loss - left.loss);
      return { ...row, pageUsers, checkUsers, eligibleUsers, opportunityUsers, requestUsers, requestSuccessUsers, requestFailedUsers, showAttemptUsers, impressionUsers, worst: transitions[0] };
    });
    return <div className="page-stack"><section className="surface"><div className="surface-title"><div><h2>页面健康与广告漏斗</h2><p>这里优先使用 <code>dws_ad_page_funnel_daily</code>：每个项目、包、日期、页面一行，直接看页面访问后资格检查、资格通过、机会、请求、请求成功、请求失败、展示尝试、AV 分别漏在哪里。</p></div><span>{rows.length ? `${rows.length} 个页面` : "等待页面漏斗汇总"}</span></div><div className="path-metric-note"><strong>怎么理解这些数：</strong><span>页面UV = page_users；资格检查 = eligibility_check_users；资格通过 = eligible_users；广告机会 = opportunity_users；请求发起 = ad_request；请求成功 = ad_load_success；请求失败 = ad_load_failed。展示核验优先看后端关联后的 linked/correlated impression users，否则只代表页面归因 AV。节点页会合并为「节点选择页广告场景」，不能因为页面归因 AV=0 就判断无广告。</span></div><div className="table-wrap"><table><thead><tr><th>页面</th><th>页面UV</th><th>资格检查</th><th>资格通过</th><th>广告机会</th><th>请求细分</th><th>展示尝试</th><th>展示核验</th><th>最大流失</th></tr></thead><tbody>{rows.length ? rows.map((row: AnyRow) => <tr key={text(row.screenName ?? row.screen_name)} className={row.worst?.lossRate > 50 ? "row-bad" : row.worst?.lossRate > 25 ? "row-warn" : ""}><td><strong>{text(row.screenName ?? row.screen_name)}</strong><small>{row.pageAliasMerged ? `已合并：${(row.sourcePageNames ?? []).map((item: string) => text(item)).join("、")}` : text(row.entrySource ?? row.entry_source ?? row.pathType ?? row.path_type)}</small></td><td>{number(row.pageUsers)}</td><td>{number(row.checkUsers)}</td><td>{number(row.eligibleUsers)}</td><td>{number(row.opportunityUsers)}</td><td><RequestBreakdownCell row={row} /></td><td>{number(row.showAttemptUsers)}</td><td><AdImpressionAuditCell row={row} /></td><td>{row.worst ? <><strong>{text(row.worst.label)}</strong><small>{number(row.worst.loss)} · {percent(row.worst.lossRate)}</small></> : "—"}</td></tr>) : <tr><td colSpan={9}><div className="empty-table-state"><strong>页面漏斗汇总还没返回</strong><span>请后端从 dws_ad_page_funnel_daily 返回 pages 数组，字段包括 screen_name、page_users、eligibility_check_users、eligible_users、opportunity_users、request_users、load_success_users、load_failed_users、show_attempt_users、impression_users；节点页还建议返回 linked_impression_users/correlated_impression_users。</span></div></td></tr>}</tbody></table></div></section>{data.limited && <div className="operational-warning">有 {number(data.omittedMissingSessionEvents)} 条页面事件缺少 session_id，已经先排除，避免把路径算偏。</div>}</div>;
  }
  if (page === "evidence") return <EvidencePage data={data} />;
  if (page === "issues") return <IssuesPage data={data} />;
  return <section className="surface"><div className="surface-title"><div><h2>执行口径快照</h2><p>当前线上漏斗版本与步骤定义</p></div><span>当前口径：去重用户 UV</span></div><dl className="operational-kv"><div><dt>来源</dt><dd>{text(data.source)}</dd></div><div><dt>版本</dt><dd>{text(data.version?.versionName ?? data.version?.versionId)}</dd></div><div><dt>状态</dt><dd>{text(data.version?.status)}</dd></div></dl><Funnel rows={data.steps} unit="users" data={data} /></section>;
}

function readInitialOperationalView(): { domain: "ads" | "vpn" | "quality"; unit: FunnelUnit } {
  if (typeof window === "undefined") return { domain: "ads", unit: "users" };
  const params = new URLSearchParams(window.location.search);
  const rawDomain = params.get("domain");
  const rawUnit = params.get("unit");
  return {
    domain: rawDomain === "vpn" || rawDomain === "quality" ? rawDomain : "ads",
    unit: rawUnit === "users" || rawUnit === "events" || rawUnit === "sessions" ? rawUnit : "users",
  };
}

export function OperationalFunnel(props: Props) {
  const [dataPackage, setDataPackage] = useState<PackageData>({});
  const [packageErrors, setPackageErrors] = useState<Record<string, string>>({});
  const [progressItems, setProgressItems] = useState<QueryProgressItem[]>([]);
  const [loadedAt, setLoadedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const initialOperationalView = readInitialOperationalView();
  const [domain, setDomain] = useState<"ads" | "vpn" | "quality">(props.initialDomain ?? initialOperationalView.domain);
  const [unit, setUnit] = useState<FunnelUnit>(props.initialDomain === "vpn" ? "sessions" : initialOperationalView.unit);
  const [workbenchSection, setWorkbenchSection] = useState<"workbench" | "diagnosis" | "path" | "versions">("workbench");
  const [matrixData, setMatrixData] = useState<AnyRow | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState("");
  const [matrixDimensions, setMatrixDimensions] = useState<string[]>(["country_code", "asn", "server_id", "protocol"]);
  const dates = useMemo(() => dateRange(props.range), [props.range]);
  const queryUnit: FunnelUnit = domain === "vpn" ? "sessions" : domain === "ads" ? unit : "users";
  const scope = props.page === "overview" ? "overview" : "project";
  const activePage: FunnelPageKey = props.page === "workbench"
    ? (workbenchSection === "versions" ? "workbench" : workbenchSection)
    : props.page;
  const activeKey = packageKey(activePage, scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const data = dataPackage[activeKey] ?? null;
  const packageLabel = scope === "overview" ? "多项目总览" : "核心漏斗、流失诊断、页面路径、证据明细、问题闭环、口径快照";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("domain", domain);
    url.searchParams.set("unit", unit);
    window.history.replaceState({}, "", url);
  }, [domain, unit]);

  useEffect(() => {
    if (!props.lockDomain || !props.initialDomain) return;
    setDomain(props.initialDomain);
    if (props.initialDomain === "vpn") setUnit("sessions");
  }, [props.initialDomain, props.lockDomain]);

  useEffect(() => () => {
    props.onSnapshotChange?.(null);
  }, [props.onSnapshotChange]);

  useEffect(() => {
    if (props.page === "network_failure_matrix") return;
    if (!props.enabled) {
      setLoading(true);
      props.onSnapshotChange?.(null);
      return;
    }
    if (!props.projectCode && scope !== "overview") return;
    let active = true;
    const controllers: AbortController[] = [];
    const baseQuery = { ...dates, projectCode: scope === "overview" ? undefined : props.projectCode, appIdentifier: scope === "overview" ? undefined : props.appIdentifier, platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios", country: props.country === "全部国家" ? undefined : props.country, appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0] };
    const items = buildPackageItems(baseQuery, scope, domain, unit);
    const firstItem = items.find((item) => item.key === activeKey) ?? items[0];
    const restItems = items.filter((item) => item.key !== firstItem?.key);
    const cachedPackage: PackageData = {};
    let cachedLoadedAt = "";
    items.forEach((item) => {
      const cached = operationalPackageCache.get(queryCacheKey(item.query));
      if (!cached) return;
      cachedPackage[item.key] = cached.value;
      cachedLoadedAt = cached.loadedAt || cachedLoadedAt;
    });
    setLoading(!(firstItem && cachedPackage[firstItem.key]));
    setError("");
    setDataPackage(cachedPackage);
    setPackageErrors({});
    setLoadedAt(cachedLoadedAt);
    setProgressItems(items.map((item) => ({
      key: item.key,
      label: queryItemLabel(item),
      status: cachedPackage[item.key] ? "done" : item.key === firstItem?.key ? "loading" : "pending",
      finishedAt: cachedPackage[item.key] ? cachedLoadedAt || "缓存" : undefined,
      dataCountLabel: cachedPackage[item.key] ? countLabel(cachedPackage[item.key], item.query.page) : "数据量待返回",
      dateLabel: cachedPackage[item.key] ? resultDateLabel(cachedPackage[item.key], item.query) : queryDateLabel(item.query),
    })));

    const markProgress = (key: string, patch: Partial<QueryProgressItem>) => {
      setProgressItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    };
    const waitRetryDelay = (attempt: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, attempt === 1 ? 1200 : 3200);
    });
    const runItem = async (item: FunnelQueryPackageItem, primary = false) => {
      const maxAttempts = primary || props.softFailure ? 2 : 2;
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
        }, primary ? 75000 : 65000);
        controllers.push(itemController);
        try {
          const result = await queryFunnel<AnyRow>(item.query, itemController.signal);
          if (!active) return;
          const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
          setOperationalCache(queryCacheKey(item.query), result);
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
          const message = itemTimedOut ? `${queryItemLabel(item)}查询较慢` : rawMessage.toLowerCase().includes("abort") ? `${queryItemLabel(item)}查询被中断` : rawMessage;
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
          const finalMessage = `${message}，已自动重拉 ${maxAttempts} 次仍未返回；系统保留进度，请稍后刷新或缩小日期范围`;
          setPackageErrors((current) => ({ ...current, [item.key]: finalMessage }));
          markProgress(item.key, {
            status: "error",
            error: finalMessage,
            attempt,
            maxAttempts,
            dataCountLabel: "查询失败",
            dateLabel: queryDateLabel(item.query),
          });
          if (primary && !props.softFailure) {
            setError(finalMessage);
            setLoading(false);
          } else if (primary) {
            setLoading(false);
          }
          return;
        } finally {
          window.clearTimeout(itemTimeout);
        }
      }
    };

    const unblockTimer = window.setTimeout(() => {
      if (active) setLoading(false);
    }, firstItem && cachedPackage[firstItem.key] ? 0 : 8000);

    if (firstItem) {
      const runBackgroundItems = async () => {
        for (const item of restItems) {
          if (!active) return;
          if (cachedPackage[item.key]) continue;
          await runItem(item);
        }
      };
      void runItem(firstItem, true).finally(() => {
        if (!active) return;
        void runBackgroundItems();
      });
      const backgroundTimer = window.setTimeout(() => {
        if (!active || dataPackage[firstItem.key]) return;
        markProgress(firstItem.key, {
          status: "loading",
          error: "当前项目明细量较大，核心漏斗仍在查询；查完会先展示，其他页面随后后台加载",
        });
      }, 12000);
      controllers.push({ abort: () => window.clearTimeout(backgroundTimer) } as AbortController);
    }
    return () => { active = false; window.clearTimeout(unblockTimer); controllers.forEach((controller) => controller.abort()); };
  }, [props.enabled, scope, props.projectCode, props.appIdentifier, props.range, props.platform, props.country, props.appVersion, props.refreshKey, dates, domain, unit, retryKey, props.softFailure]);

  useEffect(() => {
    if (props.page !== "network_failure_matrix" || !props.enabled || !props.projectCode) return;
    let active = true;
    const controller = new AbortController();
    setMatrixLoading(true);
    setMatrixError("");
    setMatrixData(null);
    const baseQuery = {
      ...dates,
      projectCode: props.projectCode,
      appIdentifier: props.appIdentifier,
      platform: props.platform === "全部" ? undefined : props.platform.toLowerCase() as "android" | "ios",
      country: props.country === "全部国家" ? undefined : props.country,
      appVersion: props.appVersion === "全部版本" ? undefined : props.appVersion.split(" ")[0],
    };
    queryFunnel<AnyRow>({ ...baseQuery, page: "network_failure_matrix", domain: "vpn", unit: "users", evidenceMode: "ad", pageSize: 50, dimensions: matrixDimensions }, controller.signal)
      .then((result) => { if (active) { setMatrixData(result); setMatrixLoading(false); } })
      .catch((reason) => { if (active) { setMatrixError(reason instanceof Error ? reason.message : "查询失败"); setMatrixLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [props.page, props.enabled, props.projectCode, props.appIdentifier, props.platform, props.country, props.appVersion, props.refreshKey, dates, matrixDimensions]);

  useEffect(() => {
    if (!props.enabled || Object.keys(dataPackage).length === 0) {
      props.onSnapshotChange?.(null);
      return;
    }
    props.onSnapshotChange?.({
      snapshotVersion: "V1",
      module: props.initialDomain === "vpn" ? "vpn" : "funnel",
      page: props.page,
      activePage,
      projectCode: props.page === "overview" ? "全部项目" : props.projectCode,
      appIdentifier: props.appIdentifier,
      range: props.range,
      dates,
      platform: props.platform,
      country: props.country,
      appVersion: props.appVersion,
      domain,
      unit: queryUnit,
      activeKey,
      loadedAt,
      capturedAt: new Date().toISOString(),
      context: {
        projectCode: props.page === "overview" ? "全部项目" : props.projectCode,
        appIdentifier: props.appIdentifier,
        range: props.range,
        dateFrom: dates.dateFrom,
        dateTo: dates.dateTo,
        platform: props.platform,
        country: props.country,
        appVersion: props.appVersion,
        domain,
        unit: queryUnit,
      },
      progressItems,
      packageErrors,
      dataPackage,
    });
  }, [props.enabled, props.initialDomain, props.page, props.projectCode, props.appIdentifier, props.range, props.platform, props.country, props.appVersion, activePage, activeKey, dates, domain, queryUnit, loadedAt, progressItems, packageErrors, dataPackage, props.onSnapshotChange]);

  if (props.page === "network_failure_matrix") {
    if (matrixLoading) return <StatePanel kind="loading" message="正在读取广告网络失败横向报表，按国家 × ASN × 节点 × 协议横向聚合…" />;
    if (matrixError) return <StatePanel kind="error" message={matrixError} retry={() => setRetryKey((value) => value + 1)} />;
    if (!matrixData) return <StatePanel kind="empty" message="当前筛选范围没有可聚合的网络维度广告事件。" />;
    return <div className="page-stack"><AdNetworkFailureMatrix data={matrixData} dimensions={matrixDimensions} onDimensionsChange={setMatrixDimensions} /></div>;
  }

  if (loading) return <StatePanel kind="loading" message={`正在优先加载当前页面：${packageLabel}。核心页完成后立即展示，其他数据后台继续查询。`}><QueryProgressPanel items={progressItems} compact /></StatePanel>;
  if (error) return <StatePanel kind="error" message={error} retry={() => setRetryKey((value) => value + 1)} />;
  const activeProgress = progressItems.find((item) => item.key === activeKey);
  if (!data && (activeProgress?.status === "pending" || activeProgress?.status === "loading" || activeProgress?.status === "retrying")) return <div className="page-stack"><QueryProgressPanel items={progressItems} /><StatePanel kind="loading" message={`${activeProgress.label} ${activeProgress.status === "retrying" ? "正在自动重拉" : "还在后台查询"}，完成后会自动展示。`} /></div>;
  if (!data && props.softFailure) return <div className="page-stack"><QueryProgressPanel items={progressItems} /><StatePanel kind="loading" message={packageErrors[activeKey] ? "核心数据暂未返回，系统已自动重拉；你可以先看上方每个数据包的进度，稍后点击刷新继续查询。" : "当前数据包还在查询，完成后会自动展示。"} retry={() => setRetryKey((value) => value + 1)} /></div>;
  if (!data) return <StatePanel kind={packageErrors[activeKey] ? "error" : "empty"} message={packageErrors[activeKey] || "请调整项目、日期、平台或版本后重新查询。"} retry={packageErrors[activeKey] ? () => setRetryKey((value) => value + 1) : undefined} />;
  const hasRows = props.page === "overview" ? (data.projects?.length ?? 0) > 0 : activePage === "workbench" ? (data.metrics?.length ?? data.funnel?.length ?? 0) > 0 : true;
  const status = <PackageStatusBanner projectCode={props.page === "overview" ? "全部项目" : props.projectCode} range={props.range} dates={dates} loadedAt={loadedAt} partialErrors={packageErrors} progressItems={progressItems} />;
  const progress = <QueryProgressPanel items={progressItems} />;
  const workbenchKey = packageKey("workbench", scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const pathKey = packageKey("path", scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const diagnosisKey = packageKey("diagnosis", scope === "overview" ? "ads" : domain, scope === "overview" ? "users" : queryUnit);
  const workbenchData = dataPackage[workbenchKey] ?? null;
  const pageData = dataPackage[pathKey] ?? null;
  const diagnosisData = dataPackage[diagnosisKey] ?? null;
  const pageProgress = progressItems.find((item) => item.key === pathKey);
  const diagnosisProgress = progressItems.find((item) => item.key === diagnosisKey);
  if (!hasRows) return <div className="page-stack">{status}{progress}<StatePanel kind="empty" message="数据包已加载，但当前筛选范围没有可计算的标准事件。" /></div>;
  if (props.page === "overview") return <div className="page-stack">{status}{progress}<Overview data={data} onPageChange={props.onPageChange} onProjectSelect={props.onProjectSelect} context={{ projectCode: "全部项目", range: props.range, dates, loadedAt }} /></div>;
  if (props.page === "workbench") return <div className="page-stack">{status}{progress}<nav className="operational-tabs workbench-tabs"><button className={workbenchSection === "workbench" ? "active" : ""} onClick={() => setWorkbenchSection("workbench")}>核心漏斗</button><button className={workbenchSection === "diagnosis" ? "active" : ""} onClick={() => setWorkbenchSection("diagnosis")}>流失诊断</button><button className={workbenchSection === "path" ? "active" : ""} onClick={() => setWorkbenchSection("path")}>页面路径</button><button className={workbenchSection === "versions" ? "active" : ""} onClick={() => setWorkbenchSection("versions")}>版本对比</button></nav>{workbenchSection === "workbench" ? <Workbench data={data} domain={domain} setDomain={setDomain} unit={unit} setUnit={setUnit} pageData={pageData} diagnosisData={diagnosisData} pageProgress={pageProgress} diagnosisProgress={diagnosisProgress} lockDomain={props.lockDomain} /> : workbenchSection === "versions" ? <VersionComparison data={workbenchData ?? data} domain={domain} projectCode={props.projectCode} appIdentifier={props.appIdentifier} platform={props.platform} country={props.country} appVersion={props.appVersion} initialRange={props.range} refreshKey={props.refreshKey} /> : <GenericPage page={workbenchSection} data={data} workbenchData={workbenchData} onOpenWorkbench={() => setWorkbenchSection("workbench")} />}</div>;
  return <div className="page-stack">{status}{progress}<GenericPage page={props.page} data={data} workbenchData={workbenchData} /></div>;
}
