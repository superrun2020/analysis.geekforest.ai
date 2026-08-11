"use client";

import { useState } from "react";
import type { DialogKey } from "./action-dialog";

type ConfigTab = "connections" | "bindings" | "api";

const apiRows = [
  ["POST", "/api/v1/diagnosis-tasks", "task_id", "创建诊断任务", "project_code, metric_code, scope, owner_user_id, due_at"],
  ["POST", "/api/v1/tracking-runs", "run_id", "创建打点验收Run", "project_code, internal_app_id, build_number, snapshot_scope"],
  ["POST", "/api/v1/reconciliation-runs", "reconciliation_run_id", "创建重新对账任务", "business_date, timezone, sources, metrics, metric_version"],
  ["POST", "/api/v1/config-versions", "config_version_id", "创建规范版本草稿", "base_spec_version, spec_version, schema_version, change_goal"],
  ["POST", "/api/v1/project-categories", "category_id", "创建项目主品类", "category_code, platform_scope, capability_packages, p0_gates"],
  ["POST", "/api/v1/alert-rules", "alert_rule_id", "创建告警规则", "metric_code, aggregation_window, trigger_threshold, cooldown"],
  ["POST", "/api/v1/firebase/connections", "connection_id", "创建Firebase凭证连接", "auth_type, credential_secret_ref, billing_project_id"],
  ["POST", "/api/v1/firebase/app-bindings", "binding_id", "关联Firebase App", "firebase_app_id, internal_app_id, environment, effective_from"],
  ["POST", "/api/v1/export-jobs", "export_job_id", "创建异步导出任务", "project_scope, date_range, timezone, metrics, file_format"],
];

const fieldRows = [
  ["connection_id", "string", "是", "Firebase连接ID", "FBC-20260811-001"],
  ["firebase_project_id", "string", "是", "Firebase/GCP Project ID", "jkcl-growth-prod"],
  ["firebase_app_id", "string", "是", "Firebase注册App唯一ID", "1:824193710:android:iranvpn01"],
  ["data_stream_id", "string", "是", "GA4数据流ID，系统发现后只读", "8241937101"],
  ["internal_app_id", "string", "是", "公司统一App档案ID", "app_iran_android"],
  ["project_code", "string", "是", "公司项目代号", "IRAN-VPN-01"],
  ["environment", "enum", "是", "production/staging/gray", "production"],
  ["bigquery_dataset_id", "string", "是", "Firebase Analytics导出Dataset", "analytics_482910731"],
  ["effective_from", "timestamp", "是", "关联生效时间，历史映射不可覆盖", "2026-08-11T16:00:00+08:00"],
  ["backfill_from", "date", "否", "需要回补的最早业务日期", "2026-08-01"],
];

export function FirebaseConfiguration({ openDialog }: { openDialog: (dialog: DialogKey) => void }) {
  const [tab, setTab] = useState<ConfigTab>("connections");

  return (
    <section className="surface firebase-config-v5">
      <div className="surface-title firebase-config-head">
        <div><div className="eyebrow">V5 · 外部数据源治理</div><h2>Firebase 多账户与 App 关联</h2><p>连接凭证 → Firebase Project → Firebase App → 公司App档案 → 项目代号</p></div>
        <div className="config-actions"><button className="secondary-button" onClick={() => openDialog("firebase-connection")}>＋ 新建连接</button><button className="primary-button" onClick={() => openDialog("firebase-binding")}>＋ 关联 Firebase App</button></div>
      </div>

      <div className="config-tabbar" role="tablist">
        <button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}>Firebase连接</button>
        <button className={tab === "bindings" ? "active" : ""} onClick={() => setTab("bindings")}>App关联</button>
        <button className={tab === "api" ? "active" : ""} onClick={() => setTab("api")}>接口字段说明</button>
      </div>

      {tab === "connections" && <div className="config-tab-content">
        <div className="firebase-hierarchy"><div><span>2</span><strong>Firebase连接</strong><small>凭证均有效</small></div><i>→</i><div><span>3</span><strong>Firebase Project</strong><small>全部已发现</small></div><i>→</i><div><span>4</span><strong>Firebase App</strong><small>Android 3 · iOS 1</small></div><i>→</i><div><span>3</span><strong>已关联项目</strong><small>待关联 1</small></div></div>
        <div className="table-wrap"><table><thead><tr><th>连接</th><th>认证方式</th><th>可访问Project</th><th>App</th><th>BigQuery</th><th>最近同步</th><th>负责人</th><th>状态</th><th>操作</th></tr></thead><tbody>
          <tr><td><strong>增长业务 Firebase</strong><small>FBC-20260801-001</small></td><td>服务账号</td><td>2</td><td>3</td><td>正常</td><td>8分钟前</td><td>Oliver</td><td><span className="badge badge-good">健康</span></td><td><button className="table-link" onClick={() => openDialog("firebase-binding")}>查看资源</button></td></tr>
          <tr><td><strong>Launcher Firebase</strong><small>FBC-20260803-002</small></td><td>Google OAuth</td><td>1</td><td>1</td><td>正常</td><td>11分钟前</td><td>数据平台</td><td><span className="badge badge-good">健康</span></td><td><button className="table-link" onClick={() => openDialog("firebase-binding")}>查看资源</button></td></tr>
        </tbody></table></div>
        <div className="connection-checks"><div><span>✓</span><p><strong>项目发现权限</strong><small>Firebase Viewer / Project Browser</small></p></div><div><span>✓</span><p><strong>原始事件权限</strong><small>BigQuery Data Viewer + Job User</small></p></div><div><span>✓</span><p><strong>分析报表权限</strong><small>GA4 Property Viewer</small></p></div><div><span>✓</span><p><strong>密钥安全</strong><small>仅保存Secret引用，不保存JSON明文</small></p></div></div>
      </div>}

      {tab === "bindings" && <div className="config-tab-content">
        <div className="binding-notice"><span>i</span><div><strong>唯一关联规则</strong><p>同一个 Firebase App 同一时间只能关联一个公司App；公司项目可以拥有多个平台或环境的Firebase App。包名只用于校验，主键使用 firebase_app_id。</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>公司项目 / App</th><th>Firebase连接</th><th>Firebase Project</th><th>Firebase App ID</th><th>平台</th><th>包名/Bundle ID</th><th>Dataset</th><th>最近事件</th><th>状态</th></tr></thead><tbody>
          <tr><td><strong>IRAN-VPN-01</strong><small>app_iran_android · 正式</small></td><td>增长业务 Firebase</td><td>jkcl-growth-prod</td><td>…android:iranvpn01</td><td>Android</td><td>com.jkcl.iran.vpn</td><td>analytics_482910731</td><td>8分钟前</td><td><span className="badge badge-good">已验证</span></td></tr>
          <tr><td><strong>IRAN-VPN-01</strong><small>app_iran_ios · 正式</small></td><td>增长业务 Firebase</td><td>jkcl-growth-prod</td><td>…ios:iranvpn01</td><td>iOS</td><td>ai.geekforest.iranvpn</td><td>analytics_482910731</td><td>12分钟前</td><td><span className="badge badge-good">已验证</span></td></tr>
          <tr><td><strong>CLEAN-MAX-03</strong><small>app_clean_android · 正式</small></td><td>增长业务 Firebase</td><td>clean-suite-prod</td><td>…android:cleanmax03</td><td>Android</td><td>com.jkcl.clean.max</td><td>analytics_497226510</td><td>9分钟前</td><td><span className="badge badge-good">已验证</span></td></tr>
          <tr className="row-warn"><td><strong>待关联</strong><small>Aivora Launcher Android</small></td><td>Launcher Firebase</td><td>aivora-launcher-prod</td><td>…android:aivora</td><td>Android</td><td>com.aivora.launcher</td><td>analytics_501832744</td><td>11分钟前</td><td><button className="table-link" onClick={() => openDialog("firebase-binding")}>立即关联</button></td></tr>
        </tbody></table></div>
        <div className="binding-quality"><div><span>绑定完整率</span><strong>75%</strong><small>3 / 4 App已关联</small></div><div><span>包名一致率</span><strong>100%</strong><small>3 / 3 已验证</small></div><div><span>24h数据可用</span><strong>100%</strong><small>4 / 4 有事件</small></div><div><span>未知App事件</span><strong>0.02%</strong><small>进入隔离区</small></div></div>
      </div>}

      {tab === "api" && <div className="config-tab-content api-reference">
        <div className="api-principles"><div><strong>统一响应</strong><code>{`{ ok, data, error, request_id }`}</code></div><div><strong>幂等创建</strong><code>Idempotency-Key</code></div><div><strong>权限</strong><code>服务端RBAC</code></div><div><strong>审计</strong><code>actor / source / before / after</code></div></div>
        <div className="table-wrap"><table><thead><tr><th>方法</th><th>接口</th><th>返回业务ID</th><th>用途</th><th>核心请求字段</th></tr></thead><tbody>{apiRows.map((row) => <tr key={row[1]}><td><span className="method-post">{row[0]}</span></td><td><code>{row[1]}</code></td><td><code>{row[2]}</code></td><td>{row[3]}</td><td>{row[4]}</td></tr>)}</tbody></table></div>
        <div className="surface-title api-fields-title"><div><h3>Firebase App关联字段</h3><p>前端、接口与数据库统一命名</p></div><span className="badge badge-blue">application/json</span></div>
        <div className="table-wrap"><table><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th><th>示例</th></tr></thead><tbody>{fieldRows.map((row) => <tr key={row[0]}><td><code>{row[0]}</code></td><td>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td><td><code>{row[4]}</code></td></tr>)}</tbody></table></div>
        <div className="api-response-example"><div><strong>成功响应</strong><pre>{`{
  "ok": true,
  "data": {
    "binding_id": "FBB-20260811-004",
    "status": "VERIFYING",
    "verification_job_id": "JOB-8241"
  },
  "request_id": "req_91a8"
}`}</pre></div><div><strong>失败响应</strong><pre>{`{
  "ok": false,
  "error": {
    "code": "FIREBASE_APP_ALREADY_BOUND",
    "message": "该Firebase App已有有效关联",
    "field": "firebase_app_id"
  },
  "request_id": "req_91a9"
}`}</pre></div></div>
      </div>}
    </section>
  );
}
