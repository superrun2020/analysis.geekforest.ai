"use client";

import { useMemo, useState } from "react";
import { queryTrackingOnlineCoverage, type OnlineCoverageResult } from "./tracking-online-coverage-api";
import { trackingEventCatalog, type TrackingCatalogEvent } from "./tracking-config-data";
import { launcherV18Events, launcherV18Source } from "./launcher-v18-catalog";

type ProjectOption = { projectCode: string; appName?: string; appIdentifier?: string; category?: string; projectType?: string };
type TestModule = "ads" | "vpn" | "launcher";
type SpecEvent = Pick<TrackingCatalogEvent, "id" | "name" | "displayName" | "stage" | "priority" | "trackingLocation" | "triggerTiming" | "metricPurpose" | "parameters">;

const adStages = new Set(["隐私与SDK", "广告机会", "广告请求", "广告加载", "广告缓存", "广告展示", "广告收入", "Banner专项"]);
const vpnStages = new Set(["App生命周期", "页面行为", "核心行为", "VPN业务", "接口质量", "上报健康"]);

function normalized(value?: string) { return (value ?? "").replace(/^jk_/, ""); }
function statusLabel(status: string) { return ({ PASSED: "已通过", PARAM_INVALID: "字段异常", CHAIN_INVALID: "关联链异常", NOT_RECEIVED: "未收到", PENDING: "待验证" } as Record<string, string>)[status] ?? status; }
function statusTone(status: string) { return status === "PASSED" ? "good" : status === "PENDING" ? "pending" : "bad"; }
function yesterday() { const date = new Date(); date.setDate(date.getDate() - 1); return date.toISOString().slice(0, 10); }

function moduleEvents(module: TestModule): SpecEvent[] {
  if (module === "launcher") return launcherV18Events.map((event) => ({ ...event, parameters: [...event.parameters] })) as SpecEvent[];
  return trackingEventCatalog.filter((event) => (module === "ads" ? adStages : vpnStages).has(event.stage));
}

function specMeta(module: TestModule) {
  if (module === "launcher") return { version: launcherV18Source.version, source: "Launcher 飞书执行表", url: launcherV18Source.sourceUrl };
  return { version: "V1.8", source: module === "ads" ? "广告变现打点" : "VPN 功能打点", url: "https://geekforest.feishu.cn/wiki/LLzEwd5bXimWkUkirt1cOy3Knbe?sheet=3Pn2sr" };
}

export function TrackingModuleTestConfig({ projects, notify }: { projects: ProjectOption[]; notify: (message: string) => void }) {
  const [projectCode, setProjectCode] = useState(projects[0]?.projectCode ?? "");
  const [module, setModule] = useState<TestModule>("ads");
  const [onlineDate, setOnlineDate] = useState(yesterday);
  const [coverage, setCoverage] = useState<OnlineCoverageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "passed" | "problem">("all");
  const [keyword, setKeyword] = useState("");
  const selectedProject = projects.find((item) => item.projectCode === projectCode);
  const expectedEvents = useMemo(() => moduleEvents(module), [module]);
  const onlineByName = useMemo(() => new Map((coverage?.events ?? []).map((event) => [normalized(event.eventName), event])), [coverage]);
  const rows = expectedEvents.map((event) => {
    const online = onlineByName.get(normalized(event.name));
    const hasFieldProblem = Boolean(online && ((online.typeMismatchCount ?? 0) > 0 || (online.quarantineCount ?? 0) > 0 || (online.p0CompletenessRate !== null && online.p0CompletenessRate !== undefined && online.p0CompletenessRate < 100)));
    const status = !coverage ? "PENDING" : !online?.received ? "NOT_RECEIVED" : hasFieldProblem ? "PARAM_INVALID" : "PASSED";
    const missing = online?.p0CompletenessRate !== null && online?.p0CompletenessRate !== undefined && online.p0CompletenessRate < 100 ? [`P0字段完整率 ${online.p0CompletenessRate}%`] : [];
    const invalid = [...((online?.typeMismatchCount ?? 0) > 0 ? [`类型错误 ${online?.typeMismatchCount}`] : []), ...((online?.quarantineCount ?? 0) > 0 ? [`隔离数据 ${online?.quarantineCount}`] : [])];
    const completeFields = event.parameters.filter((field) => !missing.includes(field.name) && !invalid.includes(field.name));
    return { event, online, status, missing, invalid, completeFields };
  });
  const passed = rows.filter((row) => row.status === "PASSED").length;
  const problem = rows.filter((row) => row.status !== "PASSED" && row.status !== "PENDING").length;
  const received = rows.filter((row) => row.online?.received).length;
  const visibleRows = rows.filter((row) => {
    const matchesStatus = filter === "all" || (filter === "passed" ? row.status === "PASSED" : row.status !== "PASSED");
    const haystack = `${row.event.stage} ${row.event.name} ${row.event.displayName} ${row.event.trackingLocation} ${row.event.parameters.map((field) => `${field.name} ${field.displayName}`).join(" ")}`.toLowerCase();
    return matchesStatus && (!keyword || haystack.includes(keyword.toLowerCase()));
  });

  async function queryOnline() {
    if (!projectCode) return;
    setLoading(true); setError(""); setCoverage(null);
    try {
      setCoverage(await queryTrackingOnlineCoverage({ projectCode, appIdentifier: selectedProject?.appIdentifier, date: onlineDate, eventNames: expectedEvents.map((event) => event.name) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "线上打点查询失败");
    } finally { setLoading(false); }
  }

  function exportReport() {
    const now = new Date().toLocaleString("zh-CN", { hour12: false });
    const title = `${projectCode}_${module}_${specMeta(module).version}_打点验收整改报告`;
    const lines = [
      `# ${title}`, "", `- 生成时间：${now}`, `- 项目代号：${projectCode}`, `- App：${selectedProject?.appName ?? "—"}`, `- 包名：${selectedProject?.appIdentifier ?? "—"}`, `- 线上数据日期：${onlineDate}`, `- 测试模块：${module === "ads" ? "广告变现" : module === "vpn" ? "VPN 功能" : "Launcher"}`, `- 内置规范：${specMeta(module).version}（${specMeta(module).source}）`, `- 查询顺序：${coverage ? `${coverage.queryPlan.summaryTable} → ${coverage.queryPlan.detailFallbackTable}` : "尚未查询"}`, `- 事件结果：应测 ${rows.length}，收到 ${received}，通过 ${passed}，需技术检查 ${problem || rows.length - passed}`, "",
      "## 技术修复优先级", "", "1. P0 未收到事件或P0字段缺失：阻断发布。", "2. 字段类型、枚举、长度错误：修复 Provider/序列化层并重测。", "3. session_id / vpn_session_id / request_id 等关联链异常：检查创建、缓存绑定与终态复用。", "4. 修复后使用同一 App、版本、设备重新执行测试场景并生成新 Run。", "",
      "## 事件与字段检查明细", "",
      ...rows.flatMap(({ event, online, status, missing, invalid, completeFields }) => [
        `### ${event.name}｜${event.displayName}｜${statusLabel(status)}`,
        `- 模块/优先级：${event.stage} / ${event.priority}`,
        `- 线上收到：${online?.eventCount ?? 0} 次；数据来源：${online?.source ?? "未查询"}；最后收到/聚合：${online?.latestAt ?? "—"}`,
        `- 具体打点位置：${event.trackingLocation}`,
        `- 上报时机：${event.triggerTiming}`,
        `- 分析用途：${event.metricPurpose}`,
        `- 缺失字段：${missing.length ? missing.join("、") : "无"}`,
        `- 非法字段：${invalid.length ? invalid.join("、") : "无"}`,
        `- 已完整字段：${completeFields.length ? completeFields.map((field) => field.name).join("、") : "无可确认字段"}`,
        `- 全部应传字段：${event.parameters.map((field) => `${field.name}[${field.dataType}/${field.reportingMode}]`).join("、") || "无事件专属字段"}`,
        `- 技术建议：${status === "NOT_RECEIVED" ? `在「${event.trackingLocation}」按「${event.triggerTiming}」补触发并确认 Firebase/ADB 收到。` : missing.length || invalid.length ? "检查字段 Provider、类型转换、枚举映射、空值省略和字符串长度限制。" : status === "CHAIN_INVALID" ? "检查链路ID创建时机及同一对象全生命周期复用。" : "当前检查通过，回归时继续保留。"}`,
        "",
      ]),
      "## 验收完成标准", "", "- P0事件收到率与P0字段完整率必须100%。", "- 条件必填字段在条件成立样本中必须100%。", "- 不允许非法类型、非法枚举、重复终态和孤儿链路ID。", "- 技术修复后需附 Run ID、App版本、build、设备、测试时间与关键事件样例。", "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${title}.md`; link.click(); URL.revokeObjectURL(link.href);
    notify("技术整改文档已生成，包含问题字段、完整字段、打点位置和修复建议");
  }

  return <section className="module-test-config surface">
    <div className="surface-title"><div><div className="eyebrow">内置规范 × 线上数据 × 技术整改报告</div><h2>按模块测试 App 打点</h2><p>选择 App 和测试模块，系统只用对应规范作为分母；线上未收到、字段缺失、字段非法和关联链异常会进入技术检查。</p></div><button className="primary-button" onClick={exportReport}>导出技术检查文档</button></div>
    <div className="module-test-steps"><div className="active"><i>1</i><span>选择 App</span></div><div className="active"><i>2</i><span>日期与模块</span></div><div className={coverage ? "active" : ""}><i>3</i><span>汇总→明细查询</span></div><div className={coverage ? "active" : ""}><i>4</i><span>输出整改文档</span></div></div>
    <div className="module-test-controls">
      <label><span>测试 App</span><select value={projectCode} onChange={(event) => { setProjectCode(event.target.value); setCoverage(null); setError(""); }}>{projects.map((item) => <option key={item.projectCode} value={item.projectCode}>{item.projectCode} · {item.appName ?? "未命名"} · {item.appIdentifier ?? "无包名"}</option>)}</select></label>
      <label><span>线上数据日期</span><input type="date" value={onlineDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => { setOnlineDate(event.target.value); setCoverage(null); setError(""); }} /></label>
      <label><span>测试模块</span><select value={module} onChange={(event) => { setModule(event.target.value as TestModule); setCoverage(null); setError(""); }}><option value="ads">广告变现模块</option><option value="vpn">VPN 功能模块</option><option value="launcher">Launcher 模块</option></select></label>
      <div><span>内置规范</span><strong>{specMeta(module).version}</strong><small>{specMeta(module).source} · {expectedEvents.length} 个事件</small></div>
      <button className="primary-button" disabled={!projectCode || loading} onClick={queryOnline}>{loading ? "正在读取线上数据…" : "检查线上打点"}</button>
    </div>
    {error && <div className="module-test-error"><strong>线上数据暂未完成对照</strong><span>{error}</span><small>当前仅展示内置应测事件，不能把空白误判为已通过；请检查日期、项目权限或线上查询接口。</small></div>}
    {coverage && <div className="coverage-query-proof"><strong>{onlineDate} 线上查询完成</strong><span>先查 {coverage.queryPlan.summaryTable}：命中 {coverage.queryPlan.summaryMatched} 个事件；其余 {coverage.queryPlan.detailFallbackChecked} 个事件已自动查询 {coverage.queryPlan.detailFallbackTable}。</span><small>查询时间：{coverage.queryPlan.queriedAt}</small></div>}
    <div className="module-test-summary"><div><span>内置应测事件</span><strong>{rows.length}</strong><small>{expectedEvents.reduce((sum, event) => sum + event.parameters.length, 0)} 个字段定义</small></div><div><span>线上已收到事件</span><strong>{coverage ? received : "—"}</strong><small>{coverage ? `${onlineDate} · 汇总优先` : "等待选择日期查询"}</small></div><div><span>检查通过</span><strong>{coverage ? passed : "—"}</strong><small>P0必须100%</small></div><div className={problem ? "bad" : ""}><span>需要技术检查</span><strong>{coverage ? problem : "—"}</strong><small>缺事件/字段/类型/隔离</small></div></div>
    <div className="module-test-toolbar"><div className="dimension-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {rows.length}</button><button className={filter === "passed" ? "active" : ""} onClick={() => setFilter("passed")}>已通过 {passed}</button><button className={filter === "problem" ? "active" : ""} onClick={() => setFilter("problem")}>需检查 {coverage ? problem : rows.length}</button></div><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索事件模块、标准事件名、字段、打点位置" /></div>
    <div className="table-wrap module-test-table"><table><thead><tr><th>模块 / 标准事件</th><th>优先级</th><th>内置字段</th><th>线上数据 / 来源</th><th>字段质量</th><th>打点位置 / 上报时机</th><th>结论</th></tr></thead><tbody>{visibleRows.map(({ event, online, status, missing, invalid, completeFields }) => <tr key={event.id} className={status === "PASSED" ? "" : status === "PENDING" ? "row-pending" : "row-warn"}><td><strong>{event.name}</strong><small>{event.stage} · {event.displayName}</small></td><td><span className={`test-priority ${event.priority.toLowerCase()}`}>{event.priority}</span></td><td><strong>{event.parameters.length}</strong><small>{event.parameters.slice(0, 4).map((field) => field.name).join("、")}{event.parameters.length > 4 ? "…" : ""}</small></td><td><strong>{online ? `${online.eventCount} 次` : coverage ? "0 次" : "待查询"}</strong><small>{online ? `${online.source === "DWS_SUMMARY" ? "汇总表" : online.source === "DWD_FALLBACK" ? "明细表兜底" : "未找到"} · ${online.latestAt ?? "—"}` : "—"}</small></td><td><strong>{missing.length + invalid.length ? "存在异常" : status === "PASSED" ? "当前汇总正常" : "待确认"}</strong><small>{[...missing, ...invalid].join("；") || (online?.p0CompletenessRate !== null && online?.p0CompletenessRate !== undefined ? `P0完整率 ${online.p0CompletenessRate}%` : `规范字段 ${completeFields.length}/${event.parameters.length}`)}</small></td><td><strong>{event.trackingLocation}</strong><small>{event.triggerTiming}</small></td><td><span className={`test-status ${statusTone(status)}`}>{statusLabel(status)}</span><small>{status === "NOT_RECEIVED" ? "汇总和明细均无数据，检查触发与上报链路" : status === "PARAM_INVALID" ? "按DWS质量指标下钻DWD修复字段" : status === "PASSED" ? "线上日期数据已确认" : "选择日期后查询"}</small></td></tr>)}</tbody></table></div>
  </section>;
}
