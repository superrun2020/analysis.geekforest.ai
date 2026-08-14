"use client";

import { useMemo, useState } from "react";
import type { DialogKey } from "./action-dialog";

type ConfigTab = "overview" | "resources" | "runs" | "latest" | "health" | "api";
type StatusTone = "good" | "warn" | "bad" | "blue" | "neutral";

const connections = [
  { id: "FBC-20260801-001", name: "增长业务 Firebase", auth: "服务账号", projects: 2, apps: 3, binding: "3/3", latest: "8分钟前", success: "99.8%", owner: "Oliver", status: "健康", tone: "good" as StatusTone },
  { id: "FBC-20260803-002", name: "Launcher Firebase", auth: "服务账号", projects: 1, apps: 1, binding: "0/1", latest: "11分钟前", success: "100%", owner: "数据平台", status: "待确认", tone: "warn" as StatusTone },
];

const bindings = [
  { project: "IRAN-VPN-01", name: "Iran Fast VPN", app: "Android · com.jkcl.iran.vpn", connection: "增长业务 Firebase", firebaseProject: "jkcl-growth-prod", firebaseApp: "…android:iranvpn01", dataset: "analytics_482910731", event: "8分钟前", delay: "8m", status: "正常", tone: "good" as StatusTone },
  { project: "IRAN-VPN-01", name: "Iran Fast VPN", app: "iOS · ai.geekforest.iranvpn", connection: "增长业务 Firebase", firebaseProject: "jkcl-growth-prod", firebaseApp: "…ios:iranvpn01", dataset: "analytics_482910731", event: "12分钟前", delay: "12m", status: "正常", tone: "good" as StatusTone },
  { project: "CLEAN-MAX-03", name: "Clean Max", app: "Android · com.jkcl.clean.max", connection: "增长业务 Firebase", firebaseProject: "clean-suite-prod", firebaseApp: "…android:cleanmax03", dataset: "analytics_497226510", event: "9分钟前", delay: "9m", status: "正常", tone: "good" as StatusTone },
  { project: "待关联", name: "Aivora Launcher", app: "Android · com.aivora.launcher", connection: "Launcher Firebase", firebaseProject: "aivora-launcher-prod", firebaseApp: "…android:aivora", dataset: "analytics_501832744", event: "11分钟前", delay: "—", status: "待绑定", tone: "warn" as StatusTone },
];

const runs = [
  { id: "FBR-20260813-1530", project: "IRAN-VPN-01", type: "INTRADAY", range: "今天 15:15–15:30", started: "15:31:02", duration: "2m18s", source: "2,140,682", oss: "2,140,682", adb: "2,138,941", quarantine: "1,741", watermark: "15:29:41", status: "成功", tone: "good" as StatusTone },
  { id: "FBR-20260813-1515", project: "CLEAN-MAX-03", type: "INTRADAY", range: "今天 15:00–15:15", started: "15:16:01", duration: "1m44s", source: "814,209", oss: "814,209", adb: "813,802", quarantine: "407", watermark: "15:14:52", status: "成功", tone: "good" as StatusTone },
  { id: "FBR-20260813-DAILY", project: "IRAN-VPN-01", type: "DAILY", range: "8月10日–8月12日", started: "03:15:00", duration: "8m09s", source: "26,802,411", oss: "26,802,411", adb: "26,799,830", quarantine: "2,581", watermark: "8月12日", status: "成功", tone: "good" as StatusTone },
  { id: "FBR-20260813-1445", project: "AIVORA-LAUNCHER", type: "INTRADAY", range: "今天 14:30–14:45", started: "14:46:00", duration: "12s", source: "0", oss: "0", adb: "0", quarantine: "0", watermark: "—", status: "跳过·未识别", tone: "warn" as StatusTone },
  { id: "FBR-20260813-1430", project: "IRAN-VPN-01", type: "INTRADAY", range: "今天 14:15–14:30", started: "14:31:02", duration: "3m12s", source: "2,032,801", oss: "2,032,801", adb: "1,841,226", quarantine: "0", watermark: "14:29:54", status: "ADB重试成功", tone: "blue" as StatusTone },
];

const healthChecks = [
  { layer: "认证", check: "服务账号凭证", endpoint: "Google OAuth Token", checked: "15:40:11", duration: "182ms", status: "成功", detail: "firebase-reader@…iam.gserviceaccount.com", tone: "good" as StatusTone },
  { layer: "资源发现", check: "Firebase项目列表", endpoint: "Firebase Management API", checked: "15:40:12", duration: "426ms", status: "成功", detail: "发现3个Project", tone: "good" as StatusTone },
  { layer: "资源发现", check: "Firebase App列表", endpoint: "Firebase Management API", checked: "15:40:13", duration: "515ms", status: "成功", detail: "发现4个App", tone: "good" as StatusTone },
  { layer: "原始事件", check: "BigQuery Dataset与Query", endpoint: "BigQuery API", checked: "15:40:15", duration: "1.82s", status: "成功", detail: "3个analytics_*可读", tone: "good" as StatusTone },
  { layer: "最新数据", check: "events_intraday_*", endpoint: "BigQuery API", checked: "15:40:17", duration: "1.31s", status: "成功", detail: "最大事件时间15:32:09", tone: "good" as StatusTone },
  { layer: "原始归档", check: "OSS写入与回读", endpoint: "OSS PutObject/HeadObject", checked: "15:34:27", duration: "624ms", status: "成功", detail: "manifest checksum一致", tone: "good" as StatusTone },
  { layer: "事实入库", check: "ADB批量写入", endpoint: "ADB Batch Upsert", checked: "15:35:09", duration: "4.18s", status: "成功", detail: "2,138,941行", tone: "good" as StatusTone },
  { layer: "实时对照", check: "GA4 Realtime", endpoint: "Analytics Data API", checked: "15:40:20", duration: "781ms", status: "未授权", detail: "不影响BigQuery原始事件同步", tone: "warn" as StatusTone },
];

const apiRows = [
  ["POST", "/api/v1/firebase/connections", "connection_id", "创建连接并异步验证", "Idempotency-Key + secret_ref"],
  ["POST", "/api/v1/firebase/connections/{id}/verify", "run_id", "验证凭证和全部读权限", "AUTH/BQ/GA4检查"],
  ["POST", "/api/v1/firebase/connections/{id}/discover", "run_id", "发现一个或多个Project/App", "幂等UPSERT远端资源"],
  ["GET", "/api/v1/firebase/connections/{id}/resources", "—", "读取连接资源树", "Project→App→Dataset→自动识别"],
  ["POST", "/api/v1/firebase/apps/resolve", "run_id", "按平台和包名识别内部项目", "歧义资源进入待确认清单"],
  ["POST", "/api/v1/firebase/sync-runs", "run_id", "单个或批量触发同步", "INTRADAY/DAILY/BACKFILL"],
  ["POST", "/api/v1/firebase/sync-runs/{id}/retry", "run_id", "重试失败Run", "保留parent_run_id"],
  ["GET", "/api/v1/firebase/overview", "—", "读取总览与水位", "连接、绑定、延迟、成功率"],
  ["GET", "/api/v1/firebase/latest-events", "—", "读取最新标准化事件", "默认100条、字段脱敏"],
  ["GET", "/api/v1/firebase/health-checks", "—", "读取各层接口健康", "认证/发现/BQ/OSS/ADB"],
];

function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function FirebaseConfiguration({ openDialog, notify }: { openDialog: (dialog: DialogKey) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<ConfigTab>("overview");
  const [projectFilter, setProjectFilter] = useState("all");
  const visibleRuns = useMemo(() => runs.filter((item) => projectFilter === "all" || item.project === projectFilter), [projectFilter]);

  const tabs: Array<[ConfigTab, string]> = [
    ["overview", "接入总览"], ["resources", "连接与资源"], ["runs", "同步任务"], ["latest", "最新数据"], ["health", "接口健康"], ["api", "接口说明"],
  ];

  return (
    <section className="surface firebase-config-v5 firebase-integration-v13">
      <div className="surface-title firebase-config-head">
        <div><div className="eyebrow">Firebase 分析内置数据源控制面</div><h2>Firebase 数据源设置</h2><p>凭证连接 → 多Firebase项目 → 多App自动识别 → OSS → ADB</p></div>
        <div className="config-actions"><button className="secondary-button" onClick={() => openDialog("firebase-sync")}>立即同步</button><button className="primary-button" onClick={() => openDialog("firebase-connection")}>＋ 新建连接</button></div>
      </div>

      <div className="config-tabbar firebase-main-tabs" role="tablist">
        {tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
      </div>

      <div className="firebase-demo-banner" role="status"><span>演示数据</span><p><strong>页面流程、字段和接口契约已完成，当前数字不代表真实 Firebase 状态。</strong>接入密钥引用、Firebase Project 权限及 project_projects 实际表结构后，才会切换为真实资源、最新事件和接口健康结果。</p></div>

      {tab === "overview" && <div className="config-tab-content">
        <div className="firebase-overview-metrics">
          <button onClick={() => setTab("resources")}><span>有效连接</span><strong>2</strong><small>凭证有效 · 3个Firebase项目</small></button>
          <button onClick={() => setTab("resources")}><span>Firebase App</span><strong>4</strong><small>Android 3 · iOS 1</small></button>
          <button onClick={() => setTab("resources")}><span>App 自动识别</span><strong>3/4</strong><small>按平台＋包名匹配 · 待确认1</small></button>
          <button onClick={() => setTab("latest")}><span>最新源事件</span><strong>8分钟前</strong><small>BigQuery Intraday 15:32</small></button>
          <button onClick={() => setTab("runs")}><span>24h同步成功率</span><strong>99.8%</strong><small>287成功 · 1已恢复</small></button>
          <button onClick={() => setTab("health")}><span>接口异常</span><strong>1</strong><small>GA4 Realtime未授权</small></button>
        </div>
        <div className="firebase-pipeline-v13">
          {[["1","密钥引用","2个只读连接","good"],["2","Firebase资源","3 Project · 4 App","good"],["3","BigQuery Export","日表+Intraday可读","good"],["4","OSS Raw","最近归档15:34","good"],["5","ADB事实表","水位15:31","good"],["6","面板与验收","延迟8分钟","good"]].map(([no,title,detail,tone], index) => <div key={title}><span className={tone}>{no}</span><strong>{title}</strong><small>{detail}</small>{index < 5 && <i>→</i>}</div>)}
        </div>
        <div className="firebase-overview-grid">
          <div className="surface nested-surface"><div className="surface-title"><div><h3>接入资源</h3><p>一个连接可访问一个或多个Firebase项目</p></div><button className="text-button" onClick={() => setTab("resources")}>查看资源树</button></div>
            <div className="firebase-account-cards">{connections.map((item) => <button key={item.id} onClick={() => setTab("resources")}><header><strong>{item.name}</strong><StatusBadge tone={item.tone}>{item.status}</StatusBadge></header><small>{item.id} · {item.auth}</small><div><span><b>{item.projects}</b> Project</span><span><b>{item.apps}</b> App</span><span><b>{item.binding}</b> 已识别</span></div><footer>最新数据 {item.latest} · 同步 {item.success}</footer></button>)}</div>
          </div>
          <div className="surface nested-surface"><div className="surface-title"><div><h3>最近同步</h3><p>同时显示接口成功与数据落库结果</p></div><button className="text-button" onClick={() => setTab("runs")}>全部任务</button></div>
            <div className="firebase-recent-runs">{runs.slice(0,4).map((run) => <button key={run.id} onClick={() => setTab("runs")}><span className={`run-state-dot ${run.tone}`} /><div><strong>{run.project} · {run.type}</strong><small>{run.range} · {run.duration}</small></div><div><b>{run.adb}</b><small>ADB行数</small></div><StatusBadge tone={run.tone}>{run.status}</StatusBadge></button>)}</div>
          </div>
        </div>
        <div className="binding-notice"><span>i</span><div><strong>项目配置与 Firebase 数据源解耦</strong><p>系统按平台＋包名与 project_projects 自动匹配 App；无法唯一识别的资源只标记“待确认”，不再单独提供项目绑定菜单。</p></div></div>
      </div>}

      {tab === "resources" && <div className="config-tab-content">
        <div className="firebase-section-toolbar"><div><strong>连接与远端资源</strong><span>重新发现会更新 Project、App、Dataset，并按平台＋包名自动识别内部项目</span></div><button onClick={() => notify("演示模式：接入后将调用资源发现接口")}>重新发现全部资源</button></div>
        <div className="firebase-resource-tree-v13">
          <article><header><div><span className="resource-icon">F</span><p><strong>增长业务 Firebase</strong><small>FBC-20260801-001 · firebase-reader@…iam.gserviceaccount.com</small></p></div><StatusBadge tone="good">连接健康</StatusBadge></header>
            <section><div className="tree-line" /><div className="resource-project"><header><div><span>Project</span><p><strong>jkcl-growth-prod</strong><small>JKCL Growth Production · properties/482910731</small></p></div><StatusBadge tone="good">READY</StatusBadge></header><div className="resource-dataset"><b>BigQuery</b><code>jkcl-growth-prod.analytics_482910731</code><span>US · events_* + events_intraday_*</span></div><div className="resource-app-grid"><button onClick={() => notify("Android Iran Fast VPN 已自动识别为 IRAN-VPN-01")}><strong>Android · Iran Fast VPN</strong><small>com.jkcl.iran.vpn</small><span>自动识别 IRAN-VPN-01 · 最新8分钟前</span></button><button onClick={() => notify("iOS Iran Fast VPN 已自动识别为 IRAN-VPN-01")}><strong>iOS · Iran Fast VPN</strong><small>ai.geekforest.iranvpn</small><span>自动识别 IRAN-VPN-01 · 最新12分钟前</span></button></div></div>
            <div className="resource-project"><header><div><span>Project</span><p><strong>clean-suite-prod</strong><small>Cleaner Suite · properties/497226510</small></p></div><StatusBadge tone="good">READY</StatusBadge></header><div className="resource-dataset"><b>BigQuery</b><code>clean-suite-prod.analytics_497226510</code><span>US · events_* + events_intraday_*</span></div><div className="resource-app-grid"><button onClick={() => notify("Clean Max 已自动识别为 CLEAN-MAX-03")}><strong>Android · Clean Max</strong><small>com.jkcl.clean.max</small><span>自动识别 CLEAN-MAX-03 · 最新9分钟前</span></button></div></div></section>
          </article>
          <article><header><div><span className="resource-icon">F</span><p><strong>Launcher Firebase</strong><small>FBC-20260803-002 · launcher-reader@…iam.gserviceaccount.com</small></p></div><StatusBadge tone="warn">1个App待确认</StatusBadge></header>
            <section><div className="tree-line" /><div className="resource-project"><header><div><span>Project</span><p><strong>aivora-launcher-prod</strong><small>Aivora Launcher · properties/501832744</small></p></div><StatusBadge tone="good">READY</StatusBadge></header><div className="resource-dataset"><b>BigQuery</b><code>aivora-launcher-prod.analytics_501832744</code><span>US · events_* + events_intraday_*</span></div><div className="resource-app-grid"><button className="unbound" onClick={() => notify("com.aivora.launcher 未唯一匹配，请先补全 project_projects 平台与包名")}><strong>Android · Aivora Launcher</strong><small>com.aivora.launcher</small><span>自动识别待确认 · 检查 project_projects</span></button></div></div></section>
          </article>
        </div>
      </div>}

      {tab === "runs" && <div className="config-tab-content">
        <div className="firebase-section-toolbar"><label>内部项目<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">全部项目</option>{Array.from(new Set(runs.map((item) => item.project))).map((item) => <option key={item}>{item}</option>)}</select></label><div><button onClick={() => notify("失败任务筛选已应用")}>只看失败</button><button onClick={() => openDialog("firebase-sync")}>立即同步</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>Run / 项目</th><th>类型</th><th>源范围</th><th>开始/耗时</th><th>BigQuery源行</th><th>OSS</th><th>ADB写入</th><th>隔离</th><th>事件水位</th><th>状态</th><th>操作</th></tr></thead><tbody>{visibleRuns.map((run) => <tr key={run.id}><td><strong>{run.id}</strong><small>{run.project}</small></td><td><code>{run.type}</code></td><td>{run.range}</td><td><strong>{run.started}</strong><small>{run.duration}</small></td><td>{run.source}</td><td>{run.oss}</td><td>{run.adb}</td><td>{run.quarantine}</td><td>{run.watermark}</td><td><StatusBadge tone={run.tone}>{run.status}</StatusBadge></td><td><button className="table-link" onClick={() => notify(`${run.id}阶段日志已展开`)}>详情</button></td></tr>)}</tbody></table></div>
        <div className="firebase-run-legend"><span><i className="good" />INTRADAY：当天每15分钟</span><span><i className="blue" />DAILY：每天重刷最近3天</span><span><i className="warn" />BACKFILL：首次或人工历史回补</span><span>日表落地后替换同日Intraday临时结果</span></div>
      </div>}

      {tab === "latest" && <div className="config-tab-content">
        <div className="firebase-latest-watermarks">{bindings.filter((item) => item.project !== "待关联").map((item) => <button key={`${item.project}${item.app}`} onClick={() => notify(`${item.project}最新事件明细已筛选`)}><header><strong>{item.project}</strong><StatusBadge tone={item.tone}>FRESH</StatusBadge></header><small>{item.app}</small><div><span>源事件<b>{item.event}</b></span><span>ADB入库<b>{item.delay}</b></span><span>24h事件<b>{item.project === "IRAN-VPN-01" ? "8.42M" : "2.16M"}</b></span><span>事件名<b>{item.project === "IRAN-VPN-01" ? "46" : "39"}</b></span></div></button>)}</div>
        <div className="surface nested-surface"><div className="surface-title"><div><h3>最新标准化事件</h3><p>来自ADB事实表；原始完整参数保存在OSS，不在页面展示敏感字段</p></div><StatusBadge tone="blue">自动刷新30秒</StatusBadge></div><div className="table-wrap"><table><thead><tr><th>事件时间</th><th>项目</th><th>Firebase App</th><th>事件</th><th>event_id</th><th>版本</th><th>国家</th><th>质量</th><th>入库延迟</th></tr></thead><tbody>{[["15:32:09.418","IRAN-VPN-01","Android","jk_ad_paid_event","evt…2a23","1.8.1 (109)","IR","通过","7m52s"],["15:32:09.401","IRAN-VPN-01","Android","jk_ad_impression","evt…2a22","1.8.1 (109)","IR","通过","7m52s"],["15:32:08.972","IRAN-VPN-01","iOS","jk_ad_show_attempt","evt…b019","1.8.0 (42)","TR","P1缺失","7m53s"],["15:32:08.146","CLEAN-MAX-03","Android","jk_ad_opportunity","evt…0d18","3.2.0 (320)","EG","通过","8m11s"],["15:32:07.884","IRAN-VPN-01","Android","jk_ad_request","evt…2a10","1.8.1 (109)","IR","通过","7m54s"]].map((row) => <tr key={`${row[0]}${row[4]}`}>{row.map((cell,index) => <td key={index}>{index === 7 ? <StatusBadge tone={cell === "通过" ? "good" : "warn"}>{cell}</StatusBadge> : index === 3 || index === 4 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div></div>
        <div className="binding-notice"><span>i</span><div><strong>当天数据为什么能看见</strong><p>有events_intraday_*时可读取当天原始事件，通常延迟数分钟至数十分钟；没有Streaming Export时只能等待events_*日表。页面必须展示真实水位，不能把“同步接口成功”误写成“数据已最新”。</p></div></div>
      </div>}

      {tab === "health" && <div className="config-tab-content">
        <div className="firebase-health-summary"><div><span className="status-dot" /><strong>核心链路可用</strong><small>认证→BigQuery→OSS→ADB全部成功</small></div><div><span>最近检查</span><strong>15:40:20</strong><small>每5分钟自动检查</small></div><div><span>成功项</span><strong>7 / 8</strong><small>GA4 Realtime为可选项</small></div><div><span>数据水位</span><strong>15:32:09</strong><small>当前延迟8分钟</small></div></div>
        <div className="table-wrap"><table><thead><tr><th>层级</th><th>检查项</th><th>接口</th><th>最近检查</th><th>耗时</th><th>结果</th><th>详情/错误</th><th>操作</th></tr></thead><tbody>{healthChecks.map((item) => <tr key={item.check} className={item.status !== "成功" ? "row-warn" : ""}><td>{item.layer}</td><td><strong>{item.check}</strong></td><td><code>{item.endpoint}</code></td><td>{item.checked}</td><td>{item.duration}</td><td><StatusBadge tone={item.tone}>{item.status}</StatusBadge></td><td>{item.detail}</td><td><button className="table-link" onClick={() => notify(`${item.check}已重新检查`)}>重新检查</button></td></tr>)}</tbody></table></div>
        <div className="connection-checks"><div><span>✓</span><p><strong>凭证安全</strong><small>数据库只保存secret_ref</small></p></div><div><span>✓</span><p><strong>任务幂等</strong><small>Idempotency-Key + Run锁</small></p></div><div><span>✓</span><p><strong>事件不静默丢弃</strong><small>缺ID/未知事件进入质量标记</small></p></div><div><span>✓</span><p><strong>全链路审计</strong><small>request_id、操作人、错误阶段</small></p></div></div>
      </div>}

      {tab === "api" && <div className="config-tab-content api-reference">
        <div className="api-principles"><div><strong>统一响应</strong><code>{`{ ok, data, error, request_id }`}</code></div><div><strong>幂等创建</strong><code>Idempotency-Key</code></div><div><strong>项目主数据</strong><code>project_projects</code></div><div><strong>凭证</strong><code>secret_ref only</code></div></div>
        <div className="table-wrap"><table><thead><tr><th>方法</th><th>接口</th><th>返回业务ID</th><th>用途</th><th>规则</th></tr></thead><tbody>{apiRows.map((row) => <tr key={row[1]}><td><span className={row[0] === "GET" ? "method-get" : "method-post"}>{row[0]}</span></td><td><code>{row[1]}</code></td><td><code>{row[2]}</code></td><td>{row[3]}</td><td>{row[4]}</td></tr>)}</tbody></table></div>
        <div className="api-response-example"><div><strong>连接创建响应</strong><pre>{`{
  "ok": true,
  "data": {
    "connection_id": "FBC_01J...",
    "status": "VERIFYING",
    "verification_run_id": "FBR_01J..."
  },
  "error": null,
  "request_id": "req_01J..."
}`}</pre></div><div><strong>失败响应</strong><pre>{`{
  "ok": false,
  "data": null,
  "error": {
    "code": "FIREBASE_BIGQUERY_DATASET_NOT_FOUND",
    "message": "未检测到Analytics导出Dataset",
    "retryable": false
  },
  "request_id": "req_01J..."
}`}</pre></div></div>
      </div>}
    </section>
  );
}
