"use client";

import { useEffect, useMemo, useState } from "react";
import type { DialogKey } from "./action-dialog";
import { firebaseTaskLogsApi, type FirebaseCheckLog, type FirebaseSyncRunLog } from "./firebase-task-logs-api";

type ConfigTab = "overview" | "resources" | "runs" | "latest" | "health" | "api";
type StatusTone = "good" | "warn" | "bad" | "blue" | "neutral";

const apiRows = [
  ["GET", "/api/v3/{securePath}/firebase-integration/sync-runs", "items[]", "读取真实 Firebase 同步任务", "当前页面已接入"],
  ["GET", "/api/v3/{securePath}/firebase-integration/check-logs", "items[]", "读取真实 Firebase 资源/权限检查", "当前页面已接入"],
  ["GET", "/api/v3/{securePath}/firebase-integration/connections", "items[]", "读取连接、Project、App、Dataset 资源树", "接口待接入；页面不展示假资源"],
  ["GET", "/api/v3/{securePath}/firebase-integration/latest-events", "items[]", "读取最新标准化事件明细", "接口待接入；页面不展示假事件"],
  ["POST", "/api/v3/{securePath}/firebase-integration/sync-runs", "run_id", "触发单项目或批量同步", "接口待接入；当前仅保留入口"],
  ["POST", "/api/v3/{securePath}/firebase-integration/sync-runs/{id}/retry", "run_id", "重试失败同步任务", "接口待接入；失败重试由后端任务实现"],
];

function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function isFailedStatus(status?: string | null) {
  return ["FAILED", "FAIL", "ERROR", "TIMEOUT", "NO_DATA"].includes(String(status ?? "").toUpperCase());
}

function isRunningStatus(status?: string | null) {
  return ["QUEUED", "RUNNING", "PROCESSING", "VERIFYING", "RETRYING"].includes(String(status ?? "").toUpperCase());
}

function statusTone(status?: string | null): StatusTone {
  if (isFailedStatus(status)) return "bad";
  if (isRunningStatus(status)) return "blue";
  if (["SUCCESS", "SUCCEEDED", "PASS", "PASSED", "OK", "READY"].includes(String(status ?? "").toUpperCase())) return "good";
  if (!status) return "neutral";
  return "warn";
}

function statusLabel(status?: string | null) {
  const normalized = String(status ?? "").toUpperCase();
  const labels: Record<string, string> = {
    SUCCESS: "成功",
    SUCCEEDED: "成功",
    PASS: "通过",
    PASSED: "通过",
    OK: "正常",
    READY: "就绪",
    FAILED: "失败",
    FAIL: "失败",
    ERROR: "错误",
    TIMEOUT: "超时",
    NO_DATA: "无数据",
    QUEUED: "排队中",
    RUNNING: "运行中",
    PROCESSING: "处理中",
    VERIFYING: "验证中",
    RETRYING: "重试中",
  };
  return labels[normalized] ?? status ?? "未知";
}

function formatRows(value?: number | null) {
  if (value === undefined || value === null) return "—";
  return Number(value).toLocaleString();
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value?: number | null) {
  if (value === undefined || value === null) return "—";
  if (value < 1000) return `${value}ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60000)}m${Math.round((value % 60000) / 1000)}s`;
}

function projectLabel(row: FirebaseSyncRunLog | FirebaseCheckLog) {
  return row.projectCode || row.projectName || row.packageName || row.connectionName || "未关联项目";
}

function EmptyRealState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-table-state"><strong>{title}</strong><span>{detail}</span>{action}</div>;
}

export function FirebaseConfiguration({ openDialog, notify }: { openDialog: (dialog: DialogKey) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<ConfigTab>("overview");
  const [projectFilter, setProjectFilter] = useState("all");
  const [syncRuns, setSyncRuns] = useState<FirebaseSyncRunLog[]>([]);
  const [checkLogs, setCheckLogs] = useState<FirebaseCheckLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      firebaseTaskLogsApi.syncRuns({ page: 1, pageSize: 100 }),
      firebaseTaskLogsApi.checkLogs({ page: 1, pageSize: 100 }),
    ])
      .then(([runs, logs]) => {
        if (cancelled) return;
        setSyncRuns(runs.items ?? []);
        setCheckLogs(logs.items ?? []);
      })
      .catch((reason) => {
        if (cancelled) return;
        setSyncRuns([]);
        setCheckLogs([]);
        setError(reason instanceof Error ? reason.message : "Firebase 真实接口读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshIndex]);

  const tabs: Array<[ConfigTab, string]> = [
    ["overview", "接入总览"], ["resources", "连接与资源"], ["runs", "同步任务"], ["latest", "最新数据"], ["health", "接口健康"], ["api", "接口说明"],
  ];

  const projects = useMemo(() => Array.from(new Set([...syncRuns.map(projectLabel), ...checkLogs.map(projectLabel)].filter(Boolean))), [syncRuns, checkLogs]);
  const visibleRuns = useMemo(() => syncRuns.filter((item) => projectFilter === "all" || projectLabel(item) === projectFilter), [syncRuns, projectFilter]);
  const visibleChecks = useMemo(() => checkLogs.filter((item) => projectFilter === "all" || projectLabel(item) === projectFilter), [checkLogs, projectFilter]);
  const failedRuns = syncRuns.filter((item) => isFailedStatus(item.status)).length;
  const runningRuns = syncRuns.filter((item) => isRunningStatus(item.status)).length;
  const failedChecks = checkLogs.filter((item) => isFailedStatus(item.status)).length;
  const resources = useMemo(() => {
    const map = new Map<string, { connectionName: string; projectCode: string; app: string; firebaseProjectId: string; firebaseAppId: string; lastSeen: string }>();
    [...syncRuns, ...checkLogs].forEach((row) => {
      const key = [row.connectionName, row.firebaseProjectId, row.firebaseAppId, row.packageName].join("|");
      if (!key.replace(/\|/g, "")) return;
      const lastSeen = ("startedAt" in row ? row.startedAt || row.createdAt : row.checkedAt || row.createdAt) ?? "";
      map.set(key, {
        connectionName: row.connectionName || "未命名连接",
        projectCode: projectLabel(row),
        app: row.packageName || row.appName || row.firebaseAppIdentifier || "未返回 App 标识",
        firebaseProjectId: row.firebaseProjectId || "未返回 Firebase Project",
        firebaseAppId: row.firebaseAppId || "未返回 Firebase App",
        lastSeen,
      });
    });
    return Array.from(map.values());
  }, [syncRuns, checkLogs]);
  const latestRun = syncRuns.find((item) => item.startedAt || item.finishedAt || item.createdAt);
  const latestCheck = checkLogs.find((item) => item.checkedAt || item.createdAt);

  return (
    <section className="surface firebase-config-v5 firebase-integration-v13">
      <div className="surface-title firebase-config-head">
        <div><div className="eyebrow">Firebase 真实数据源控制面</div><h2>Firebase 数据源设置</h2><p>只展示后端接口返回或日志可推导的数据；未接入接口不展示演示数字。</p></div>
        <div className="config-actions"><button className="secondary-button" onClick={() => { setRefreshIndex((value) => value + 1); notify("正在重新读取 Firebase 真实任务日志"); }}>刷新真实日志</button><button className="primary-button" onClick={() => openDialog("firebase-connection")}>＋ 新建连接</button></div>
      </div>

      <div className="config-tabbar firebase-main-tabs" role="tablist">
        {tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
      </div>

      <div className="firebase-demo-banner real-data-banner" role="status"><span>真实数据</span><p><strong>本页已移除演示项目、演示事件和演示健康状态。</strong>同步任务与检查记录来自线上接口；连接资源树和最新事件明细在专用接口接入前，只展示日志中能真实推导出的信息。</p></div>

      {error && <div className="firebase-log-state warn"><strong>Firebase 控制接口未返回真实数据</strong><p>{error}。当前不会展示任何演示数字，请检查后端地址、securePath、登录态和 firebase-integration 接口。</p></div>}
      {loading && <EmptyRealState title="正在读取 Firebase 真实接口" detail="读取同步任务和接口检查日志中，请稍候。" />}

      {!loading && tab === "overview" && <div className="config-tab-content">
        <div className="firebase-overview-metrics">
          <button onClick={() => setTab("resources")}><span>日志可识别项目</span><strong>{projects.length || "—"}</strong><small>{projects.length ? "由同步/检查日志推导" : "暂无真实日志"}</small></button>
          <button onClick={() => setTab("resources")}><span>日志可识别资源</span><strong>{resources.length || "—"}</strong><small>Firebase Project/App/包名</small></button>
          <button onClick={() => setTab("runs")}><span>同步任务</span><strong>{syncRuns.length || "—"}</strong><small>{runningRuns ? `${runningRuns} 个运行中` : "最近任务记录"}</small></button>
          <button onClick={() => setTab("runs")}><span>失败任务</span><strong>{failedRuns}</strong><small>来自真实 status 字段</small></button>
          <button onClick={() => setTab("health")}><span>检查记录</span><strong>{checkLogs.length || "—"}</strong><small>{failedChecks ? `${failedChecks} 个失败` : "服务账号/Firebase/BQ"}</small></button>
          <button onClick={() => setTab("latest")}><span>最近任务时间</span><strong>{formatTime(latestRun?.startedAt || latestRun?.finishedAt || latestRun?.createdAt).slice(11) || "—"}</strong><small>{formatTime(latestRun?.startedAt || latestRun?.finishedAt || latestRun?.createdAt).slice(0, 10) || "暂无"}</small></button>
        </div>
        <div className="firebase-pipeline-v13">
          {[["1","连接日志","sync-runs / check-logs","good"],["2","资源推导","从真实日志提取 Project/App","blue"],["3","同步水位","range_start / range_end","blue"],["4","ADB写入","adb_rows / source_rows","blue"],["5","错误隔离","status / error_message","blue"],["6","运营面板","无接口则空态","good"]].map(([no,title,detail,tone], index) => <div key={title}><span className={tone}>{no}</span><strong>{title}</strong><small>{detail}</small>{index < 5 && <i>→</i>}</div>)}
        </div>
        <div className="firebase-overview-grid">
          <div className="surface nested-surface"><div className="surface-title"><div><h3>最近同步任务</h3><p>真实 sync-runs 返回；无返回时显示空态。</p></div><button className="text-button" onClick={() => setTab("runs")}>全部任务</button></div>
            {syncRuns.length ? <div className="firebase-recent-runs">{syncRuns.slice(0, 5).map((run) => <button key={run.runId} onClick={() => setTab("runs")}><span className={`run-state-dot ${statusTone(run.status)}`} /><div><strong>{projectLabel(run)} · {run.runType || "SYNC"}</strong><small>{formatTime(run.rangeStart)} → {formatTime(run.rangeEnd)}</small></div><div><b>{formatRows(run.adbRows)}</b><small>ADB行数</small></div><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></button>)}</div> : <EmptyRealState title="暂无真实同步任务" detail="后端返回 sync-runs 后这里会展示项目、范围、源行数、ADB行数和状态。" />}
          </div>
          <div className="surface nested-surface"><div className="surface-title"><div><h3>最近接口检查</h3><p>真实 check-logs 返回；用于判断权限和资源可读性。</p></div><button className="text-button" onClick={() => setTab("health")}>全部检查</button></div>
            {checkLogs.length ? <div className="firebase-recent-runs">{checkLogs.slice(0, 5).map((log) => <button key={log.logId} onClick={() => setTab("health")}><span className={`run-state-dot ${statusTone(log.status)}`} /><div><strong>{projectLabel(log)} · {log.checkType || "CHECK"}</strong><small>{log.firebaseProjectId || log.connectionName || "未返回资源"}</small></div><div><b>{formatDuration(log.durationMs)}</b><small>耗时</small></div><StatusBadge tone={statusTone(log.status)}>{statusLabel(log.status)}</StatusBadge></button>)}</div> : <EmptyRealState title="暂无真实检查日志" detail="后端返回 check-logs 后这里会展示认证、Firebase、BigQuery 和 Dataset 检查结果。" />}
          </div>
        </div>
      </div>}

      {!loading && tab === "resources" && <div className="config-tab-content">
        <div className="firebase-section-toolbar"><label>内部项目<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">全部项目</option>{projects.map((item) => <option key={item}>{item}</option>)}</select></label><div><button onClick={() => notify("资源发现专用接口待接入；当前只展示日志可推导资源")}>重新发现资源</button></div></div>
        {resources.length ? <div className="table-wrap"><table><thead><tr><th>内部项目</th><th>连接</th><th>Firebase Project</th><th>Firebase App</th><th>App / 包名</th><th>最近出现</th><th>来源</th></tr></thead><tbody>{resources.filter((item) => projectFilter === "all" || item.projectCode === projectFilter).map((item) => <tr key={`${item.connectionName}${item.firebaseProjectId}${item.firebaseAppId}${item.app}`}><td><strong>{item.projectCode}</strong></td><td>{item.connectionName}</td><td><code>{item.firebaseProjectId}</code></td><td><code>{item.firebaseAppId}</code></td><td>{item.app}</td><td>{formatTime(item.lastSeen)}</td><td><StatusBadge tone="blue">日志推导</StatusBadge></td></tr>)}</tbody></table></div> : <EmptyRealState title="连接与资源树接口待接入" detail="当前 sync-runs/check-logs 没有可推导的 Firebase Project/App 信息；不会展示旧的演示资源树。" action={<button className="primary-button" onClick={() => openDialog("firebase-connection")}>去配置连接</button>} />}
      </div>}

      {!loading && tab === "runs" && <div className="config-tab-content">
        <div className="firebase-section-toolbar"><label>内部项目<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">全部项目</option>{projects.map((item) => <option key={item}>{item}</option>)}</select></label><div><button onClick={() => setProjectFilter("all")}>全部</button><button onClick={() => openDialog("firebase-sync")}>立即同步</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>Run / 项目</th><th>类型</th><th>源范围</th><th>开始/结束</th><th>BigQuery源行</th><th>ADB写入</th><th>耗时</th><th>Firebase资源</th><th>状态</th><th>错误</th></tr></thead><tbody>{visibleRuns.length ? visibleRuns.map((run) => <tr key={run.runId} className={isFailedStatus(run.status) ? "row-warn" : ""}><td><strong>Run #{run.runId}</strong><small>{projectLabel(run)}</small></td><td><code>{run.runType || "SYNC"}</code></td><td><strong>{formatTime(run.rangeStart)}</strong><small>{formatTime(run.rangeEnd)}</small></td><td><strong>{formatTime(run.startedAt)}</strong><small>{formatTime(run.finishedAt)}</small></td><td>{formatRows(run.sourceRows)}</td><td>{formatRows(run.adbRows)}</td><td>{formatDuration(run.durationMs)}</td><td><strong>{run.firebaseProjectId || "—"}</strong><small>{run.firebaseAppId || run.firebaseAppIdentifier || run.packageName || "—"}</small></td><td><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></td><td>{run.errorMessage || "—"}</td></tr>) : <tr><td colSpan={10}><EmptyRealState title="暂无真实同步任务" detail={error ? "接口未返回任务日志。" : "当前筛选下没有 sync-runs 记录。"} /></td></tr>}</tbody></table></div>
      </div>}

      {!loading && tab === "latest" && <div className="config-tab-content">
        <div className="binding-notice"><span>i</span><div><strong>最新标准化事件明细接口尚未接入</strong><p>为了避免误导，这里不展示旧的 jk_ad_impression / event_id 演示行。当前只能从同步任务日志展示真实任务水位；需要后端补充 latest-events 接口后才能展示事件明细。</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>项目</th><th>任务类型</th><th>源数据范围</th><th>开始/结束</th><th>源行数</th><th>ADB行数</th><th>状态</th><th>错误</th></tr></thead><tbody>{visibleRuns.length ? visibleRuns.slice(0, 20).map((run) => <tr key={`latest-${run.runId}`} className={isFailedStatus(run.status) ? "row-warn" : ""}><td><strong>{projectLabel(run)}</strong><small>{run.packageName || run.appName || run.connectionName || "—"}</small></td><td><code>{run.runType || "SYNC"}</code></td><td><strong>{formatTime(run.rangeStart)}</strong><small>{formatTime(run.rangeEnd)}</small></td><td><strong>{formatTime(run.startedAt)}</strong><small>{formatTime(run.finishedAt)}</small></td><td>{formatRows(run.sourceRows)}</td><td>{formatRows(run.adbRows)}</td><td><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></td><td>{run.errorMessage || "—"}</td></tr>) : <tr><td colSpan={8}><EmptyRealState title="暂无真实水位记录" detail="sync-runs 无返回时无法判断最新事件水位；不会使用静态 8 分钟、15:32 这类假水位。" /></td></tr>}</tbody></table></div>
      </div>}

      {!loading && tab === "health" && <div className="config-tab-content">
        <div className="firebase-health-summary"><div><span className="status-dot" /><strong>{failedChecks ? "存在检查失败" : checkLogs.length ? "检查日志已返回" : "暂无检查记录"}</strong><small>只按真实 check-logs 判断</small></div><div><span>最近检查</span><strong>{formatTime(latestCheck?.checkedAt || latestCheck?.createdAt).slice(11) || "—"}</strong><small>{formatTime(latestCheck?.checkedAt || latestCheck?.createdAt).slice(0, 10) || "暂无"}</small></div><div><span>失败项</span><strong>{failedChecks}</strong><small>失败状态来自后端</small></div><div><span>检查总数</span><strong>{checkLogs.length || "—"}</strong><small>当前筛选返回</small></div></div>
        <div className="table-wrap"><table><thead><tr><th>检查项 / 日志ID</th><th>项目</th><th>Firebase资源</th><th>检查时间</th><th>耗时</th><th>结果</th><th>错误码</th><th>详情</th></tr></thead><tbody>{visibleChecks.length ? visibleChecks.map((item) => <tr key={item.logId} className={isFailedStatus(item.status) ? "row-warn" : ""}><td><strong>{item.checkType || "CHECK"}</strong><small>Log #{item.logId}</small></td><td><strong>{projectLabel(item)}</strong><small>{item.projectName || item.packageName || item.connectionName || "—"}</small></td><td><strong>{item.firebaseProjectId || "—"}</strong><small>{item.firebaseAppId || item.firebaseAppIdentifier || "—"}</small></td><td>{formatTime(item.checkedAt || item.createdAt)}</td><td>{formatDuration(item.durationMs)}</td><td><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td><td>{item.errorCode || "—"}</td><td>{item.message || "—"}</td></tr>) : <tr><td colSpan={8}><EmptyRealState title="暂无真实接口检查日志" detail="后端返回 check-logs 后才展示服务账号、Firebase App、BigQuery Dataset 和 events 表检查结果。" /></td></tr>}</tbody></table></div>
      </div>}

      {tab === "api" && <div className="config-tab-content api-reference">
        <div className="api-principles"><div><strong>页面原则</strong><code>无真实接口 = 空态</code></div><div><strong>已接真实接口</strong><code>sync-runs / check-logs</code></div><div><strong>项目主数据</strong><code>project_projects / firebase_connections</code></div><div><strong>凭证</strong><code>secret_ref only</code></div></div>
        <div className="table-wrap"><table><thead><tr><th>方法</th><th>接口</th><th>返回业务ID</th><th>用途</th><th>当前状态</th></tr></thead><tbody>{apiRows.map((row) => <tr key={row[1]}><td><span className={row[0] === "GET" ? "method-get" : "method-post"}>{row[0]}</span></td><td><code>{row[1]}</code></td><td><code>{row[2]}</code></td><td>{row[3]}</td><td>{row[4]}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
  );
}
