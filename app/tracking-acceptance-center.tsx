"use client";

import { useEffect, useMemo, useState } from "react";
import { acceptanceApi, type AcceptanceDetail, type AcceptanceRun } from "./tracking-acceptance-api";
import type { TrackingConfigRecord } from "./tracking-config-data";

type TrackingProjectOption = { code: string; name: string; category?: string; appIdentifier?: string };

function normalizePlatform(value: string): "Android" | "iOS" {
  return value.toLowerCase() === "ios" ? "iOS" : "Android";
}

function parseVersion(value: string) {
  if (!value || value === "全部版本") return { appVersion: "", buildNumber: "" };
  const match = value.match(/^(.+?)\s*\(([^)]+)\)$/);
  return match ? { appVersion: match[1].trim(), buildNumber: match[2].trim() } : { appVersion: value, buildNumber: "" };
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
      <section className="acceptance-run-bar surface"><label><span>当前 Run</span><select value={detail?.run.runId ?? ""} onChange={async (e) => setDetail(await acceptanceApi.detail(e.target.value))}><option value="">选择验收 Run</option>{runs.map((run) => <option key={run.runId} value={run.runId}>{run.runId} · {run.appVersion} · {run.status}</option>)}</select></label><div><span>App / 构建</span><strong>{profile.appIdentifier}</strong><small>{profile.appVersion} ({profile.buildNumber}) · {profile.platform}</small></div><button className="secondary-button" onClick={loadRuns}>刷新结果</button></section>
      {detail && <>
        <section className="metric-grid six"><div className="metric-card"><span>总完成率</span><strong>{rate.toFixed(1)}%</strong><small>门槛 {detail.run.passThreshold}%</small></div><div className="metric-card"><span>成功事件</span><strong>{detail.run.passedCount}/{detail.run.expectedCount}</strong><small>按标准事件去重</small></div><div className="metric-card"><span>P0通过</span><strong>{detail.run.p0PassedCount}/{detail.run.p0ExpectedCount}</strong><small>必须100%</small></div><div className="metric-card"><span>失败</span><strong>{detail.run.failedCount}</strong><small>参数或关联链错误</small></div><div className="metric-card"><span>待操作/待接收</span><strong>{detail.run.pendingCount}</strong><small>不提前判定漏打</small></div><div className="metric-card"><span>Run状态</span><strong>{detail.run.status}</strong><small>{detail.run.snapshotId}</small></div></section>
        <section className="surface"><div className="surface-title"><div><h2>操作任务</h2><p>测试人员按模块执行操作，系统等待对应事件并自动更新结果。</p></div></div><div className="test-task-list">{modules.map((module) => { const events=detail.events.filter(e=>e.module===module);const passed=events.filter(e=>e.resultStatus==="PASSED").length;return <article key={module} className={`test-task-card ${passed===events.length?"passed":events.some(e=>["PARAM_INVALID","CHAIN_INVALID","NOT_RECEIVED"].includes(e.resultStatus))?"failed":"pending"}`}><header><div><strong>{module}</strong></div><span>{passed}/{events.length} 通过</span></header><dl><div><dt>在哪里操作</dt><dd>{events[0]?.trackingLocation || "按事件规范操作"}</dd></div><div><dt>什么时候触发</dt><dd>{events[0]?.triggerTiming || "操作成功后"}</dd></div><div><dt>应收事件</dt><dd>{events.map(e=>e.eventName).join("、")}</dd></div></dl><footer><button className="primary-button" onClick={()=>markModule(module)}>开始并标记已执行</button></footer></article>})}</div></section>
        <section className="surface"><div className="surface-title"><div><h2>事件接收与失败定位</h2><p>未执行不算漏打；执行后仍未收到、参数错误或关联链错误才进入失败。</p></div><div className="event-result-tabs">{[["all","全部"],["passed","成功"],["failed","失败"],["pending","待处理"]].map(([key,label])=><button key={key} className={filter===key?"active":""} onClick={()=>setFilter(key)}>{label}</button>)}</div></div><div className="table-wrap event-result-table"><table><thead><tr><th>事件</th><th>模块</th><th>优先级</th><th>场景</th><th>接收次数</th><th>结论</th><th>失败详情</th><th>操作建议</th></tr></thead><tbody>{visible.map((event)=><tr key={event.eventName} className={event.resultStatus!=="PASSED"?"row-warn":""}><td><strong>{event.eventName}</strong><small>{event.displayName}</small></td><td>{event.module}</td><td>{event.priority}</td><td>{event.sceneStatus}</td><td>{event.receivedCount}</td><td>{event.resultStatus}</td><td>{[...event.missingParams,...event.invalidParams,...event.chainErrors].join("、")||"—"}</td><td>{event.resultStatus==="PENDING"?(event.sceneStatus==="NOT_EXECUTED"?event.trackingLocation:"等待Firebase事件"):event.resultStatus==="PASSED"?"无需处理":"按打点位置重测并检查字段Provider/Context"}</td></tr>)}</tbody></table></div></section>
      </>}
    </>}
  </div>;
}
