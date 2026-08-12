"use client";

import { useMemo, useRef, useState } from "react";
import { defaultSelectedEventIds, trackingConfigs, trackingEventCatalog, type TrackingConfigRecord } from "./tracking-config-data";

export type DialogKey =
  | "project-report"
  | "diagnosis"
  | "admob-report"
  | "version-diff-report"
  | "event-dictionary"
  | "reconcile-run"
  | "tracking-run"
  | "retest-run"
  | "config-version"
  | "project-category"
  | "publish-approval"
  | "alert-rule"
  | "firebase-connection"
  | "firebase-binding";

export type DialogResult = {
  id: string;
  idLabel: string;
  title: string;
  message: string;
  endpoint: string;
  payload: Record<string, string | string[]>;
};

type DialogMeta = {
  title: string;
  description: string;
  submit: string;
  endpoint: string;
  idLabel: string;
  prefix: string;
};

const dialogMeta: Record<DialogKey, DialogMeta> = {
  "project-report": { title: "导出项目日报", description: "选择数据范围、口径版本、字段和接收方式", submit: "创建导出任务", endpoint: "POST /api/v1/export-jobs", idLabel: "export_job_id", prefix: "EXP" },
  diagnosis: { title: "新建诊断任务", description: "冻结异常快照、证据范围、负责人和处理时限", submit: "创建诊断任务", endpoint: "POST /api/v1/diagnosis-tasks", idLabel: "task_id", prefix: "DIA" },
  "admob-report": { title: "导出 AdMob 报表", description: "按结算日期、广告维度和统一口径生成报表", submit: "创建导出任务", endpoint: "POST /api/v1/export-jobs", idLabel: "export_job_id", prefix: "ADM" },
  "version-diff-report": { title: "导出版本差异", description: "选择对比版本、影响范围和输出内容", submit: "创建导出任务", endpoint: "POST /api/v1/export-jobs", idLabel: "export_job_id", prefix: "DIF" },
  "event-dictionary": { title: "Firebase 事件字典", description: "查看已发布事件、优先级、参数与移动端可得性", submit: "关闭", endpoint: "GET /api/v1/event-dictionary", idLabel: "", prefix: "" },
  "reconcile-run": { title: "发起重新对账", description: "冻结日期边界、数据源、指标和口径版本", submit: "开始重新对账", endpoint: "POST /api/v1/reconciliation-runs", idLabel: "reconciliation_run_id", prefix: "REC" },
  "tracking-run": { title: "新建验收 Run", description: "选择已发布打点配置，并冻结项目、App、构建、设备和应收事件快照", submit: "按配置创建验收", endpoint: "POST /api/v1/tracking-runs", idLabel: "run_id", prefix: "RUN" },
  "retest-run": { title: "发起失败项重测", description: "继承原快照并只验证选中的失败事件和关联链", submit: "创建重测 Run", endpoint: "POST /api/v1/tracking-runs/retest", idLabel: "run_id", prefix: "RET" },
  "config-version": { title: "新建打点配置", description: "从全量事件库选择本版本应测打点，并生成可供验收引用的发布快照", submit: "校验并发布快照", endpoint: "POST /api/v1/tracking-configs", idLabel: "config_id", prefix: "CFG" },
  "project-category": { title: "新增项目主品类", description: "定义品类、平台、默认能力包、漏斗与P0门禁", submit: "创建主品类", endpoint: "POST /api/v1/project-categories", idLabel: "category_id", prefix: "CAT" },
  "publish-approval": { title: "提交发布审批", description: "提交门禁结果、灰度范围、风险和回滚方案", submit: "提交审批", endpoint: "POST /api/v1/release-approvals", idLabel: "approval_id", prefix: "APP" },
  "alert-rule": { title: "新建告警规则", description: "配置计算窗口、触发/恢复阈值、降噪与通知范围", submit: "创建告警规则", endpoint: "POST /api/v1/alert-rules", idLabel: "alert_rule_id", prefix: "ALT" },
  "firebase-connection": { title: "新建 Firebase 连接", description: "保存凭证引用并自动发现可访问的 Project 与 App", submit: "验证并创建连接", endpoint: "POST /api/v1/firebase/connections", idLabel: "connection_id", prefix: "FBC" },
  "firebase-binding": { title: "关联 Firebase App", description: "将 Firebase App 绑定到公司App档案并验证数据可用性", submit: "验证并创建关联", endpoint: "POST /api/v1/firebase/app-bindings", idLabel: "binding_id", prefix: "FBB" },
};

const firebaseInventory = {
  "conn-growth": {
    name: "增长业务 Firebase",
    projects: {
      "jkcl-growth-prod": {
        name: "JKCL Growth Production",
        property: "properties/482910731",
        dataset: "jkcl-growth-prod.analytics_482910731",
        apps: [
          { id: "1:824193710:android:iranvpn01", name: "Iran Fast VPN Android", platform: "Android", packageName: "com.jkcl.iran.vpn", streamId: "8241937101" },
          { id: "1:824193710:ios:iranvpn01", name: "Iran Fast VPN iOS", platform: "iOS", packageName: "ai.geekforest.iranvpn", streamId: "8241937102" },
        ],
      },
      "clean-suite-prod": {
        name: "Cleaner Suite",
        property: "properties/497226510",
        dataset: "clean-suite-prod.analytics_497226510",
        apps: [{ id: "1:938271004:android:cleanmax03", name: "Clean Max Android", platform: "Android", packageName: "com.jkcl.clean.max", streamId: "9382710041" }],
      },
    },
  },
  "conn-launcher": {
    name: "Launcher Firebase",
    projects: {
      "aivora-launcher-prod": {
        name: "Aivora Launcher",
        property: "properties/501832744",
        dataset: "aivora-launcher-prod.analytics_501832744",
        apps: [{ id: "1:715203894:android:aivora", name: "Aivora Launcher Android", platform: "Android", packageName: "com.aivora.launcher", streamId: "7152038941" }],
      },
    },
  },
} as const;

const internalAppCatalog = [
  { projectCode: "IRAN-VPN-01", id: "app_iran_android", name: "Iran Fast VPN Android", platform: "Android", appIdentifier: "com.jkcl.iran.vpn" },
  { projectCode: "IRAN-VPN-01", id: "app_iran_ios", name: "Iran Fast VPN iOS", platform: "iOS", appIdentifier: "ai.geekforest.iranvpn" },
  { projectCode: "CLEAN-MAX-03", id: "app_clean_android", name: "Clean Max Android", platform: "Android", appIdentifier: "com.jkcl.clean.max" },
  { projectCode: "AIVORA-LAUNCHER", id: "app_aivora_android", name: "Aivora Launcher Android", platform: "Android", appIdentifier: "com.aivora.launcher" },
] as const;

const runAppProfiles: Record<string, { category: string; platform: string; appIdentifier: string; appVersion: string; buildNumber: string }> = {
  "IRAN-VPN-01": { category: "套利 VPN", platform: "Android", appIdentifier: "com.jkcl.iran.vpn", appVersion: "1.8.1", buildNumber: "109" },
  "FAST-VPN-02": { category: "套利 VPN", platform: "Android", appIdentifier: "com.jkcl.fast.vpn", appVersion: "2.3.1", buildNumber: "231" },
  "CLEAN-MAX-03": { category: "清理", platform: "Android", appIdentifier: "com.jkcl.clean.max", appVersion: "3.2.0", buildNumber: "320" },
  "AIVORA-LAUNCHER": { category: "Launcher", platform: "Android", appIdentifier: "com.aivora.launcher", appVersion: "1.4.0", buildNumber: "140" },
};

function Field({ label, required, help, span, children }: { label: string; required?: boolean; help?: string; span?: boolean; children: React.ReactNode }) {
  return <label className={span ? "span-2" : undefined}><span className="field-label">{label}{required && <em>*</em>}</span>{children}{help && <small className="field-help">{help}</small>}</label>;
}

function Checks({ name, items }: { name: string; items: Array<{ value: string; label: string; checked?: boolean }> }) {
  return <div className="checkbox-grid">{items.map((item) => <span key={item.value}><input type="checkbox" name={name} value={item.value} defaultChecked={item.checked} /> {item.label}</span>)}</div>;
}

function normalizeForm(form: HTMLFormElement) {
  const payload: Record<string, string | string[]> = {};
  for (const [key, rawValue] of new FormData(form).entries()) {
    const value = rawValue instanceof File ? rawValue.name : String(rawValue);
    const current = payload[key];
    if (current === undefined) payload[key] = value;
    else payload[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return payload;
}

function makeResultId(prefix: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function nextConfigVersion(version: string) {
  const match = version.match(/^V(\d+)\.(\d+)$/);
  return match ? `V${match[1]}.${Number(match[2]) + 1}` : "V1.0";
}

function configCategoryCode(category?: string) {
  if (category === "清理") return "clean";
  if (category === "Launcher") return "launcher";
  return "vpn";
}

export function ActionDialog({ dialog, project, configs = trackingConfigs, editingConfig = null, onClose, onSubmit }: { dialog: DialogKey; project: string; configs?: TrackingConfigRecord[]; editingConfig?: TrackingConfigRecord | null; onClose: () => void; onSubmit: (result: DialogResult) => void }) {
  const meta = dialogMeta[dialog];
  const isDictionary = dialog === "event-dictionary";
  const isEditingDraft = dialog === "config-version" && editingConfig?.status === "DRAFT";
  const isCopyingPublished = dialog === "config-version" && editingConfig?.status === "PUBLISHED";
  const formRef = useRef<HTMLFormElement>(null);
  const [phase, setPhase] = useState<"form" | "submitting" | "success">("form");
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<DialogResult | null>(null);
  const [dateRange, setDateRange] = useState("last_7_days");
  const [authType, setAuthType] = useState("service_account");
  const [dictionaryKeyword, setDictionaryKeyword] = useState("");
  const [dictionaryPriority, setDictionaryPriority] = useState("all");
  const [configStep, setConfigStep] = useState(1);
  const [configKeyword, setConfigKeyword] = useState("");
  const [configCapability, setConfigCapability] = useState("all");
  const [configSelectionView, setConfigSelectionView] = useState<"all" | "selected" | "warning">("all");
  const [selectedConfigEventIds, setSelectedConfigEventIds] = useState<string[]>(editingConfig?.selectedEventIds ?? defaultSelectedEventIds);
  const [runProject, setRunProject] = useState(project);
  const firstRunConfig = configs.find((config) => config.status === "PUBLISHED" && config.projects.includes(project)) ?? configs.find((config) => config.status === "PUBLISHED")!;
  const [runConfigId, setRunConfigId] = useState(firstRunConfig?.id ?? "");
  const [connectionId, setConnectionId] = useState<keyof typeof firebaseInventory>("conn-growth");
  const initialProject = Object.keys(firebaseInventory[connectionId].projects)[0];
  const [firebaseProjectId, setFirebaseProjectId] = useState(initialProject);

  const selectedConnection = firebaseInventory[connectionId];
  const projectOptions = Object.entries(selectedConnection.projects);
  const selectedFirebaseProject = selectedConnection.projects[firebaseProjectId as keyof typeof selectedConnection.projects] ?? projectOptions[0][1];
  const appOptions = selectedFirebaseProject.apps;
  const [firebaseAppId, setFirebaseAppId] = useState<string>(appOptions[0].id);
  const selectedApp = appOptions.find((item) => item.id === firebaseAppId) ?? appOptions[0];
  const initialInternalMatch = internalAppCatalog.find((item) => item.projectCode === project) ?? internalAppCatalog[0];
  const [internalProjectCode, setInternalProjectCode] = useState(initialInternalMatch.projectCode);
  const [internalAppId, setInternalAppId] = useState<string>(initialInternalMatch.id);
  const internalAppOptions = internalAppCatalog.filter((item) => item.projectCode === internalProjectCode);
  const selectedInternalApp = internalAppOptions.find((item) => item.id === internalAppId) ?? internalAppOptions[0];
  const packageMatches = selectedInternalApp?.platform === selectedApp.platform && selectedInternalApp?.appIdentifier === selectedApp.packageName;

  const compatibleRunConfigs = configs.filter((config) => config.status === "PUBLISHED" && config.projects.includes(runProject));
  const selectedRunConfig = compatibleRunConfigs.find((config) => config.id === runConfigId) ?? compatibleRunConfigs[0] ?? firstRunConfig;
  const selectedRunApp = runAppProfiles[runProject] ?? runAppProfiles["IRAN-VPN-01"];
  const selectedConfigEvents = trackingEventCatalog.filter((event) => selectedConfigEventIds.includes(event.id));
  const selectedPriorityCounts = {
    P0: selectedConfigEvents.filter((event) => event.priority === "P0").length,
    P1: selectedConfigEvents.filter((event) => event.priority === "P1").length,
    P2: selectedConfigEvents.filter((event) => event.priority === "P2").length,
  };
  const visibleConfigEvents = trackingEventCatalog.filter((event) => {
    const matchesKeyword = !configKeyword || `${event.name} ${event.stage} ${event.capability} ${event.provider}`.toLowerCase().includes(configKeyword.toLowerCase());
    const matchesCapability = configCapability === "all" || event.capability === configCapability;
    const matchesView = configSelectionView === "all" || (configSelectionView === "selected" && selectedConfigEventIds.includes(event.id)) || (configSelectionView === "warning" && event.state === "WARNING");
    return matchesKeyword && matchesCapability && matchesView;
  });
  const visibleConfigEventPage = visibleConfigEvents.slice(0, 20);
  const visibleIds = visibleConfigEvents.map((event) => event.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedConfigEventIds.includes(id));
  const capabilityGroups = Array.from(new Set(trackingEventCatalog.map((event) => event.capability))).map((capability) => {
    const eventIds = trackingEventCatalog.filter((event) => event.capability === capability).map((event) => event.id);
    const selectedCount = eventIds.filter((id) => selectedConfigEventIds.includes(id)).length;
    return { capability, eventIds, totalCount: eventIds.length, selectedCount, allSelected: selectedCount === eventIds.length, partial: selectedCount > 0 && selectedCount < eventIds.length };
  });

  const dictionaryRows = useMemo(() => [
    ["jk_ad_request", "广告请求", "P0", "13", "稳定可得", "V1.7"],
    ["jk_ad_impression", "广告展示", "P0", "11", "广告SDK回调", "V1.7"],
    ["connect_success", "VPN连接", "P0", "10", "业务模块", "V1.7"],
    ["app_background", "生命周期", "P1", "8", "推断可得", "V1.6"],
    ["jk_ad_paid_event", "收入回调", "条件P0", "9", "广告SDK回调", "V1.7"],
  ], []);
  const visibleDictionaryRows = dictionaryRows.filter((row) => {
    const matchesKeyword = !dictionaryKeyword || row.join(" ").toLowerCase().includes(dictionaryKeyword.toLowerCase());
    const matchesPriority = dictionaryPriority === "all" || row[2].includes(dictionaryPriority);
    return matchesKeyword && matchesPriority;
  });

  function validate(payload: Record<string, string | string[]>, saveAction: "draft" | "publish" = "publish") {
    const nextErrors: string[] = [];
    const requireOne = (key: string, message: string) => { if (!payload[key] || (Array.isArray(payload[key]) && payload[key].length === 0)) nextErrors.push(message); };
    if (["project-report", "admob-report"].includes(dialog)) {
      requireOne("metrics", "请至少选择一个导出指标");
      if (dateRange === "custom" && (!payload.date_from || !payload.date_to)) nextErrors.push("自定义日期需要同时填写开始和结束日期");
    }
    if (dialog === "version-diff-report") requireOne("diff_scope", "请至少选择一种差异内容");
    if (dialog === "reconcile-run") requireOne("metrics", "请至少选择一个对账指标");
    if (dialog === "project-category") requireOne("capability_packages", "请至少选择一个默认能力包");
    if (dialog === "alert-rule") requireOne("notification_targets", "请至少选择一个通知对象");
    if (dialog === "publish-approval" && payload.risk_accepted !== "1") nextErrors.push("存在发布提醒，必须确认已接受风险");
    if (dialog === "config-version") {
      if (selectedConfigEventIds.length === 0) nextErrors.push("请至少选择一个应测事件");
      if (selectedPriorityCounts.P0 === 0) nextErrors.push("当前配置至少需要一个 P0 事件");
      requireOne("project_codes", "请至少关联一个项目");
      if (saveAction === "publish" && payload.confirm_immutable_snapshot !== "1") nextErrors.push("请确认发布快照不可直接修改");
    }
    if (dialog === "tracking-run") {
      if (!selectedRunConfig) nextErrors.push("当前项目没有可用的已发布打点配置，请先发布配置快照");
      if (!payload.tracking_config_id) nextErrors.push("请选择已发布的打点配置");
    }
    if (dialog === "firebase-binding" && !packageMatches) nextErrors.push("Firebase App与公司App档案的包名或平台不一致");
    if (dialog === "firebase-binding" && payload.confirm_package_match !== "1") nextErrors.push("请确认包名、平台和公司App档案匹配");
    return nextErrors;
  }

  function buildConfigPayload(payload: Record<string, string | string[]>, saveAction: "draft" | "publish") {
    payload.event_ids = selectedConfigEventIds;
    payload.selected_event_count = String(selectedConfigEventIds.length);
    payload.p0_event_count = String(selectedPriorityCounts.P0);
    payload.p1_event_count = String(selectedPriorityCounts.P1);
    payload.p2_event_count = String(selectedPriorityCounts.P2);
    payload.snapshot_mode = "immutable_on_publish";
    payload.save_action = saveAction;
    if (isEditingDraft && editingConfig) payload.existing_config_id = editingConfig.id;
    if (isCopyingPublished && editingConfig) payload.base_config_id = editingConfig.id;
    return payload;
  }

  function completeSubmission(payload: Record<string, string | string[]>, saveAction: "draft" | "publish" = "publish") {
    const nextErrors = validate(payload, saveAction);
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }
    setErrors([]);
    setPhase("submitting");
    window.setTimeout(() => {
      const actionTitle = dialog === "config-version" ? (saveAction === "draft" ? "打点配置草稿" : "打点配置快照") : meta.title;
      const created: DialogResult = {
        id: isEditingDraft && editingConfig ? editingConfig.id : makeResultId(meta.prefix),
        idLabel: meta.idLabel,
        title: actionTitle,
        message: saveAction === "draft" ? `${actionTitle}已保存，可继续编辑` : `${actionTitle}已创建`,
        endpoint: meta.endpoint,
        payload,
      };
      setResult(created);
      setPhase("success");
      onSubmit(created);
    }, 520);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDictionary) return onClose();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    let payload = normalizeForm(form);
    if (dialog === "config-version") {
      payload = buildConfigPayload(payload, "publish");
    }
    if (dialog === "tracking-run" && selectedRunConfig) {
      payload.tracking_config_id = selectedRunConfig.id;
      payload.tracking_config_version = selectedRunConfig.version;
      payload.config_snapshot_id = selectedRunConfig.snapshotId ?? "";
      payload.expected_event_count = String(selectedRunConfig.selectedCount);
      payload.p0_event_count = String(selectedRunConfig.p0Count);
      payload.expected_scene_count = String(selectedRunConfig.sceneCount);
    }
    completeSubmission(payload);
  }

  function saveConfigDraft() {
    const form = formRef.current;
    if (!form) return;
    const basicFields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name="config_name"], [name="config_version"], [name="category_code"], [name="project_codes"], [name="platform_scope"]'));
    const invalid = basicFields.find((input) => input.required && !input.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    const payload = buildConfigPayload(normalizeForm(form), "draft");
    completeSubmission(payload, "draft");
  }

  function nextConfigStep() {
    if (configStep === 1) {
      const form = document.querySelector<HTMLFormElement>(".modal-panel form");
      const requiredInputs = Array.from(form?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(".config-step-panel:not(.config-step-hidden) [required]") ?? []);
      const invalid = requiredInputs.find((input) => !input.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      const checkedProjects = form?.querySelectorAll<HTMLInputElement>('input[name="project_codes"]:checked').length ?? 0;
      if (!checkedProjects) {
        setErrors(["请至少关联一个项目"]);
        return;
      }
    }
    if (configStep === 2 && selectedConfigEventIds.length === 0) {
      setErrors(["请至少选择一个应测事件"]);
      return;
    }
    setErrors([]);
    setConfigStep((step) => Math.min(4, step + 1));
  }

  function switchConnection(next: keyof typeof firebaseInventory) {
    const nextProjectId = Object.keys(firebaseInventory[next].projects)[0];
    const nextProject = Object.values(firebaseInventory[next].projects)[0];
    setConnectionId(next);
    setFirebaseProjectId(nextProjectId);
    selectFirebaseApp(nextProject.apps[0]);
  }

  function switchFirebaseProject(next: string) {
    const nextProject = selectedConnection.projects[next as keyof typeof selectedConnection.projects];
    setFirebaseProjectId(next);
    if (nextProject) selectFirebaseApp(nextProject.apps[0]);
  }

  function selectFirebaseApp(app: { id: string; platform: string; packageName: string }) {
    setFirebaseAppId(app.id);
    const match = internalAppCatalog.find((item) => item.platform === app.platform && item.appIdentifier === app.packageName);
    if (match) {
      setInternalProjectCode(match.projectCode);
      setInternalAppId(match.id);
    }
  }

  function switchInternalProject(next: string) {
    const firstApp = internalAppCatalog.find((item) => item.projectCode === next);
    setInternalProjectCode(next as typeof internalProjectCode);
    if (firstApp) setInternalAppId(firstApp.id);
  }

  function switchRunProject(next: string) {
    setRunProject(next);
    const nextConfig = configs.find((config) => config.status === "PUBLISHED" && config.projects.includes(next));
    setRunConfigId(nextConfig?.id ?? "");
  }

  function toggleConfigEvent(eventId: string) {
    setSelectedConfigEventIds((current) => current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId]);
  }

  function toggleVisibleConfigEvents() {
    setSelectedConfigEventIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])));
  }

  function toggleCapability(capability: string) {
    const group = capabilityGroups.find((item) => item.capability === capability);
    if (!group) return;
    setSelectedConfigEventIds((current) => group.allSelected
      ? current.filter((id) => !group.eventIds.includes(id))
      : Array.from(new Set([...current, ...group.eventIds])));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel modal-panel-v5 ${dialog === "config-version" ? "modal-panel-config-wizard" : ""}`} role="dialog" aria-modal="true" aria-labelledby="action-dialog-title">
        <header><div><div className="dialog-version">V10 · 分类配置与操作验收</div><h2 id="action-dialog-title">{phase === "success" ? `${result?.title ?? meta.title}成功` : dialog === "config-version" ? isEditingDraft ? "编辑打点配置草稿" : isCopyingPublished ? "复制为新配置版本" : meta.title : meta.title}</h2><p>{phase === "success" ? "系统已返回业务ID，后续状态可在对应任务或配置页面追踪。" : meta.description}</p></div><button type="button" aria-label="关闭弹窗" onClick={onClose}>×</button></header>

        {phase === "success" && result ? (
          <div className="dialog-result">
            <div className="result-mark">✓</div>
            <h3>{result.message}</h3>
            <p>请求已通过前端校验并进入系统处理流程。</p>
            <div className="result-id"><span>{result.idLabel}</span><strong>{result.id}</strong><button type="button" onClick={() => navigator.clipboard?.writeText(result.id)}>复制</button></div>
            <div className="result-status-grid"><div><span>当前状态</span><strong>{result.idLabel === "export_job_id" ? "QUEUED" : "CREATED"}</strong></div><div><span>接口</span><strong>{result.endpoint}</strong></div><div><span>提交人</span><strong>Oliver</strong></div><div><span>审计记录</span><strong>已生成</strong></div></div>
            <div className="result-summary"><strong>已提交字段</strong><div>{Object.entries(result.payload).slice(0, 8).map(([key, value]) => <span key={key}><em>{key}</em><b>{Array.isArray(value) ? value.join(", ") : value || "—"}</b></span>)}</div></div>
            <footer><button type="button" className="secondary-button" onClick={onClose}>关闭</button><button type="button" className="primary-button" onClick={onClose}>进入详情页</button></footer>
          </div>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate={false}>
            <div className="modal-body">
              {errors.length > 0 && <div className="form-errors" role="alert"><strong>请完成以下内容</strong>{errors.map((error) => <p key={error}>• {error}</p>)}</div>}

              {dialog === "config-version" && <div className="config-wizard-steps" aria-label="打点配置创建步骤">{[
                [1, "基本信息"], [2, "选择打点"], [3, "规则确认"], [4, "校验发布"],
              ].map(([step, label]) => <button type="button" key={step} className={configStep === step ? "active" : configStep > Number(step) ? "done" : ""} onClick={() => setConfigStep(Number(step))}><span>{configStep > Number(step) ? "✓" : step}</span><strong>{label}</strong></button>)}</div>}

              {dialog === "diagnosis" && <div className="modal-form-grid">
                <Field label="项目" required help="提交后不可更换项目"><select name="project_code" defaultValue={project} required><option>{project}</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></Field>
                <Field label="任务类型" required><select name="task_type" required><option value="funnel_anomaly">漏斗异常诊断</option><option value="data_quality">数据质量诊断</option><option value="revenue_drop">收入下降诊断</option></select></Field>
                <Field label="任务名称" required span><input name="task_name" defaultValue="Opportunity 覆盖率异常诊断" maxLength={80} required /></Field>
                <Field label="优先级" required><select name="priority" required><option>P0</option><option>P1</option><option>P2</option></select></Field>
                <Field label="负责人" required><select name="owner_user_id" required><option value="u_oliver">Oliver / 客户端增长组</option><option value="team_data">数据平台</option><option value="team_ads">广告变现组</option></select></Field>
                <Field label="异常指标" required><select name="metric_code" required><option value="opportunity_coverage">Opportunity覆盖率</option><option value="viewer_ratio">广告浏览者比例</option><option value="revenue">收入</option></select></Field>
                <Field label="来源告警"><select name="source_alert_id"><option value="ALT-20260811-024">ALT-20260811-024</option><option value="">无，手工创建</option></select></Field>
                <Field label="异常开始时间" required><input name="anomaly_started_at" type="datetime-local" defaultValue="2026-08-11T10:32" required /></Field>
                <Field label="处理截止时间" required><input name="due_at" type="datetime-local" defaultValue="2026-08-12T18:00" required /></Field>
                <Field label="当前值" required><input name="current_value" defaultValue="28.4%" pattern="^[0-9.]+%?$" required /></Field>
                <Field label="目标/基线值" required><input name="baseline_value" defaultValue="40.9%" pattern="^[0-9.]+%?$" required /></Field>
                <Field label="诊断范围" required span><input name="scope" defaultValue="伊朗 · Android 1.8.0 · Eligible → Opportunity" required /></Field>
                <Field label="证据链接" span help="可关联事件时间线、对账或报表快照"><input name="evidence_url" type="url" defaultValue="https://pm.geekforest.ai/evidence/EVT-8241" /></Field>
                <Field label="问题说明" required span><textarea name="description" defaultValue="广告浏览者比例下降，但AdMob匹配率与展示率正常，优先排查请求前用户覆盖。" maxLength={1000} required /></Field>
              </div>}

              {(dialog === "project-report" || dialog === "admob-report") && <div className="modal-form-grid">
                <Field label="任务名称" required span><input name="job_name" defaultValue={dialog === "admob-report" ? "AdMob结算分析报表" : "项目经营日报"} required /></Field>
                <Field label="项目范围" required><select name="project_scope" required><option value="all">全部项目</option><option value={project}>{project}</option><option value="vpn_group">VPN增长组</option></select></Field>
                <Field label="日期范围" required><select name="date_range" value={dateRange} onChange={(event) => setDateRange(event.target.value)} required><option value="yesterday">昨天</option><option value="last_7_days">近7天</option><option value="last_30_days">近30天</option><option value="custom">自定义</option></select></Field>
                {dateRange === "custom" && <><Field label="开始日期" required><input name="date_from" type="date" required /></Field><Field label="结束日期" required><input name="date_to" type="date" required /></Field></>}
                <Field label="数据时区" required><select name="timezone" required><option value="Asia/Shanghai">Asia/Shanghai</option><option value="UTC">UTC</option><option value="Asia/Tehran">Asia/Tehran</option></select></Field>
                <Field label="口径版本" required><select name="metric_version" required><option value="V1.7">V1.7 当前执行权威</option><option value="V1.6">V1.6</option></select></Field>
                <Field label="报表粒度" required><select name="granularity" required><option value="project_date">项目 × 日期</option><option value="project_country">项目 × 国家</option><option value="project_ad_unit">项目 × 广告位</option></select></Field>
                <Field label="平台"><select name="platform"><option value="all">全部</option><option>Android</option><option>iOS</option></select></Field>
                <Field label="包含指标" required span><Checks name="metrics" items={[{value:"dau_av",label:"DAU / AV",checked:true},{value:"request_impression",label:"请求 / 展示",checked:true},{value:"revenue_ecpm",label:"收入 / eCPM",checked:true},{value:"roas_profit",label:"ROAS / 利润",checked:true}]} /></Field>
                <Field label="文件格式" required><select name="file_format" required><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></Field>
                <Field label="完成通知" required><select name="delivery" required><option value="task_center">任务中心下载</option><option value="task_center_feishu">任务中心＋飞书通知</option></select></Field>
              </div>}

              {dialog === "version-diff-report" && <div className="modal-form-grid">
                <Field label="基准版本" required><select name="base_version_id" required><option value="cfg_v16">V1.6</option><option value="cfg_v15">V1.5</option></select></Field>
                <Field label="目标版本" required><select name="target_version_id" required><option value="cfg_v17">V1.7（当前执行权威）</option></select></Field>
                <Field label="差异内容" required span><Checks name="diff_scope" items={[{value:"events_fields",label:"新增事件/字段",checked:true},{value:"rules",label:"规则调整",checked:true},{value:"deprecated",label:"删除与废弃",checked:true},{value:"projects",label:"影响项目",checked:true}]} /></Field>
                <Field label="项目范围"><select name="project_scope"><option value="all">全部影响项目</option><option value={project}>{project}</option></select></Field>
                <Field label="文件格式" required><select name="file_format" required><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF</option></select></Field>
                <Field label="完成通知" required span><select name="delivery" required><option value="task_center_feishu">任务中心＋飞书通知</option><option value="task_center">仅任务中心</option></select></Field>
              </div>}

              {dialog === "event-dictionary" && <div className="dictionary-dialog"><div className="dictionary-search"><input name="keyword" value={dictionaryKeyword} onChange={(event) => setDictionaryKeyword(event.target.value)} placeholder="搜索事件名、业务阶段或参数" /><select name="priority" value={dictionaryPriority} onChange={(event) => setDictionaryPriority(event.target.value)}><option value="all">全部优先级</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>阶段</th><th>优先级</th><th>参数数</th><th>可得性</th><th>版本</th></tr></thead><tbody>{visibleDictionaryRows.map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{index===2?<span className="badge badge-warn">{cell}</span>:cell}</td>)}</tr>)}</tbody></table>{visibleDictionaryRows.length === 0 && <div className="empty-search">没有匹配的事件</div>}</div></div>}

              {dialog === "reconcile-run" && <div className="modal-form-grid">
                <Field label="任务名称" required span><input name="run_name" defaultValue={`${project} 核心指标重新对账`} required /></Field>
                <Field label="项目范围" required><select name="project_scope" required><option value={project}>{project}</option><option value="anomaly">全部异常项目</option><option value="all">全部项目</option></select></Field>
                <Field label="对账日期" required><input name="business_date" type="date" defaultValue="2026-08-08" required /></Field>
                <Field label="时区/自然日边界" required><select name="timezone" required><option>Asia/Shanghai</option><option>UTC</option><option>Asia/Tehran</option></select></Field>
                <Field label="口径版本" required><select name="metric_version" required><option>V1.7</option><option>V1.6</option></select></Field>
                <Field label="数据源" required span><Checks name="sources" items={[{value:"firebase",label:"Firebase",checked:true},{value:"admob",label:"AdMob",checked:true},{value:"adb",label:"ADB",checked:true},{value:"middle",label:"中台",checked:true}]} /></Field>
                <Field label="指标" required span><Checks name="metrics" items={[{value:"dau",label:"DAU",checked:true},{value:"av",label:"AV",checked:true},{value:"impression",label:"Impression",checked:true},{value:"revenue",label:"Revenue",checked:true}]} /></Field>
                <Field label="统计粒度" required><select name="granularity" required><option value="project">项目</option><option value="country">项目 × 国家</option><option value="app_version">项目 × App版本</option></select></Field>
                <Field label="结果处理" required><select name="result_mode" required><option value="new_revision">保留历史并生成新批次</option><option value="replace">覆盖当前结果</option></select></Field>
                <Field label="发起原因" required span><textarea name="reason" defaultValue="DAU差异超过2%阈值，需要重跑源数据与标准化结果。" required /></Field>
              </div>}

              {(dialog === "tracking-run" || dialog === "retest-run") && <div className="modal-form-grid">
                <Field label="Run名称" required span><input name="run_name" defaultValue={dialog === "retest-run" ? "IRAN-VPN-01 失败项重测" : "IRAN-VPN-01 V1.8.1 打点验收"} required /></Field>
                {dialog === "retest-run" && <Field label="原Run ID" required span><input name="parent_run_id" value="RUN-20260811-IRAN-001" readOnly required /></Field>}
                <Field label="项目" required><select name="project_code" value={runProject} onChange={(event) => switchRunProject(event.target.value)} required><option>IRAN-VPN-01</option><option>FAST-VPN-02</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></Field>
                <Field label="项目品类" required help="由项目档案自动带出，只用于筛选兼容配置"><input name="category_name" value={selectedRunApp.category} readOnly required /></Field>
                {dialog === "tracking-run" && <Field label="打点配置" required span help="只显示与当前项目兼容且已发布的配置；验收分母来自配置快照，不再使用品类总数"><select name="tracking_config_id" value={selectedRunConfig?.id ?? ""} onChange={(event) => setRunConfigId(event.target.value)} required disabled={compatibleRunConfigs.length === 0}>{compatibleRunConfigs.length ? compatibleRunConfigs.map((config) => <option key={config.id} value={config.id}>{config.name} {config.version} · {config.selectedCount}/{config.totalCount}个事件</option>) : <option value="">没有已发布配置</option>}</select></Field>}
                <Field label="平台" required><input name="platform" value={selectedRunApp.platform} readOnly required /></Field>
                <Field label="包名/Bundle ID" required><input name="app_identifier" value={selectedRunApp.appIdentifier} readOnly required /></Field>
                <Field label="App版本" required><input name="app_version" defaultValue={selectedRunApp.appVersion} key={`${runProject}-version`} required /></Field>
                <Field label="构建号" required><input name="build_number" defaultValue={selectedRunApp.buildNumber} key={`${runProject}-build`} inputMode="numeric" required /></Field>
                <Field label="测试设备" required><select name="device_id" required><option value="device_pixel8">Pixel 8 · Android 15</option><option value="device_s23">Samsung S23 · Android 14</option></select></Field>
                <Field label="测试负责人" required><select name="tester_user_id" required><option value="u_oliver">Oliver</option><option value="team_qa">QA值班人</option></select></Field>
                <Field label="环境" required><select name="environment" required><option value="production_test">Production Test</option><option value="staging">Staging</option></select></Field>
                <Field label="采集截止时间" required><input name="collect_until" type="datetime-local" defaultValue="2026-08-12T18:00" required /></Field>
                <Field label="测试范围" required span><select name="snapshot_scope" required><option value={dialog === "retest-run" ? "failed_items" : "published_config_snapshot"}>{dialog === "retest-run" ? "继承原Run的3个失败项与关联链" : `所选配置快照中的全部 ${selectedRunConfig?.selectedCount ?? 0} 个事件`}</option></select></Field>
                {dialog === "retest-run" && <Field label="失败项" required span><Checks name="failed_items" items={[{value:"jk_ad_impression.opportunity_id",label:"impression缺opportunity_id",checked:true},{value:"jk_ad_dismiss",label:"dismiss未收到",checked:true},{value:"background_reason",label:"background_reason缺失",checked:true}]} /></Field>}
                <div className="snapshot-preview span-2"><span>{dialog === "retest-run" ? "继承原验收快照" : "即将冻结为 Run 应收快照"}</span><strong>{dialog === "retest-run" ? "SNP-VPN-180-001 · 只重测原失败项" : `${selectedRunConfig?.name ?? "—"} ${selectedRunConfig?.version ?? ""} · snapshot_id ${selectedRunConfig?.snapshotId ?? "—"}`}</strong>{dialog === "tracking-run" && selectedRunConfig && <div className="snapshot-detail-row"><b>{selectedRunConfig.selectedCount} 应收事件</b><b>{selectedRunConfig.p0Count} P0</b><b>{selectedRunConfig.sceneCount} 必测场景</b><b>P0 100%门禁</b></div>}</div>
              </div>}

              {dialog === "config-version" && <>
                <div className={`modal-form-grid config-step-panel ${configStep === 1 ? "" : "config-step-hidden"}`}>
                  <Field label="配置名称" required span><input name="config_name" defaultValue={editingConfig ? `${editingConfig.name}${isCopyingPublished ? " - 新版本" : ""}` : "VPN 正式版打点配置"} maxLength={80} required /></Field>
                  <Field label="配置版本" required help="同一品类内唯一"><input name="config_version" defaultValue={editingConfig ? isCopyingPublished ? nextConfigVersion(editingConfig.version) : editingConfig.version : "V1.8"} pattern="^V[0-9]+\.[0-9]+$" required /></Field>
                  <Field label="适用品类" required><select name="category_code" defaultValue={configCategoryCode(editingConfig?.category)} required><option value="vpn">套利 VPN</option><option value="clean">清理</option><option value="launcher">Launcher</option></select></Field>
                  <Field label="关联项目" required span help="发布后，只有这些项目可以在验收Run中选择该配置"><Checks name="project_codes" items={[{value:"IRAN-VPN-01",label:"IRAN-VPN-01",checked:editingConfig ? editingConfig.projects.includes("IRAN-VPN-01") : true},{value:"FAST-VPN-02",label:"FAST-VPN-02",checked:editingConfig ? editingConfig.projects.includes("FAST-VPN-02") : true},{value:"CLEAN-MAX-03",label:"CLEAN-MAX-03",checked:editingConfig?.projects.includes("CLEAN-MAX-03")},{value:"AIVORA-LAUNCHER",label:"AIVORA-LAUNCHER",checked:editingConfig?.projects.includes("AIVORA-LAUNCHER")}]} /></Field>
                  <Field label="适用平台" required><select name="platform_scope" defaultValue={editingConfig?.platform === "Android" || editingConfig?.platform === "android" ? "android" : editingConfig?.platform === "iOS" || editingConfig?.platform === "ios" ? "ios" : "android_ios"} required><option value="android_ios">Android＋iOS</option><option value="android">仅Android</option><option value="ios">仅iOS</option></select></Field>
                  <Field label="基础配置"><select name="base_config_id" defaultValue={editingConfig?.id ?? "CFG-VPN-1.7-PROD"}><option value={editingConfig?.id ?? "CFG-VPN-1.7-PROD"}>{editingConfig ? `${editingConfig.name} ${editingConfig.version}` : "VPN 正式版 V1.7（复制80项）"}</option><option value="blank">空白配置</option></select></Field>
                  <Field label="负责人" required><select name="owner_user_id" required><option value="u_oliver">数据产品 / Oliver</option><option value="team_client_arch">客户端架构组</option></select></Field>
                  <Field label="计划发布时间" required><input name="planned_release_date" type="date" defaultValue="2026-08-18" required /></Field>
                  <Field label="配置说明" required span><textarea name="description" defaultValue={`从全量100个事件中选择本版本必须实现并验收的${editingConfig?.selectedCount ?? 80}个事件。`} required /></Field>
                </div>
                <div className={`config-event-picker config-step-panel ${configStep === 2 ? "" : "config-step-hidden"}`}>
                  <div className="picker-summary"><div><span>全量事件库</span><strong>100</strong></div><div className="selected"><span>本配置已选</span><strong>{selectedConfigEventIds.length}</strong></div><div><span>P0</span><strong>{selectedPriorityCounts.P0}</strong></div><div><span>P1</span><strong>{selectedPriorityCounts.P1}</strong></div><div><span>P2</span><strong>{selectedPriorityCounts.P2}</strong></div></div>
                  <div className="capability-selector" aria-label="按分类选择事件">{capabilityGroups.map((group) => <button type="button" key={group.capability} className={`capability-card ${group.allSelected ? "selected" : group.partial ? "partial" : ""}`} onClick={() => toggleCapability(group.capability)} aria-pressed={group.allSelected}><span className="capability-check" aria-hidden="true">{group.allSelected ? "✓" : group.partial ? "−" : ""}</span><strong>{group.capability}</strong><small>{group.selectedCount}/{group.totalCount}</small><em>{group.allSelected ? "已全选" : group.partial ? "部分选择" : "未选择"}</em></button>)}</div>
                  <div className="picker-tools"><input value={configKeyword} onChange={(event) => setConfigKeyword(event.target.value)} placeholder="搜索事件名、阶段或Provider" /><select value={configCapability} onChange={(event) => setConfigCapability(event.target.value)}><option value="all">全部能力包</option>{Array.from(new Set(trackingEventCatalog.map((event) => event.capability))).map((capability) => <option key={capability}>{capability}</option>)}</select><div className="dimension-tabs"><button type="button" className={configSelectionView === "all" ? "active" : ""} onClick={() => setConfigSelectionView("all")}>全部</button><button type="button" className={configSelectionView === "selected" ? "active" : ""} onClick={() => setConfigSelectionView("selected")}>只看已选</button><button type="button" className={configSelectionView === "warning" ? "active" : ""} onClick={() => setConfigSelectionView("warning")}>只看冲突</button></div></div>
                  <div className="picker-bulk"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleConfigEvents} /> 全选当前筛选结果（{visibleConfigEvents.length}）</label><span>当前显示第 1–{Math.min(20, visibleConfigEvents.length)} 条，共 {visibleConfigEvents.length} 条</span></div>
                  <div className="table-wrap picker-table"><table><thead><tr><th>选择</th><th>事件名</th><th>阶段 / 能力包</th><th>级别</th><th>参数</th><th>场景</th><th>Provider</th><th>状态</th></tr></thead><tbody>{visibleConfigEventPage.map((event) => <tr key={event.id} className={selectedConfigEventIds.includes(event.id) ? "row-selected" : ""}><td><input type="checkbox" checked={selectedConfigEventIds.includes(event.id)} onChange={() => toggleConfigEvent(event.id)} aria-label={`选择${event.name}`} /></td><td><strong>{event.name}</strong><small>{event.id}</small></td><td><strong>{event.stage}</strong><small>{event.capability}</small></td><td><span className={`badge badge-${event.priority === "P0" ? "bad" : event.priority === "P1" ? "warn" : "neutral"}`}>{event.priority}</span></td><td>{event.parameterCount}</td><td>{event.scene}</td><td>{event.provider}</td><td><span className={`badge badge-${event.state === "READY" ? "good" : "warn"}`}>{event.state === "READY" ? "可用" : "待补配置"}</span></td></tr>)}</tbody></table></div>
                </div>
                <div className={`config-rule-review config-step-panel ${configStep === 3 ? "" : "config-step-hidden"}`}>
                  <div className="rule-review-grid"><div><span>本配置事件</span><strong>{selectedConfigEventIds.length}/100</strong><small>只验收已选事件</small></div><div><span>P0 / P1 / P2</span><strong>{selectedPriorityCounts.P0} / {selectedPriorityCounts.P1} / {selectedPriorityCounts.P2}</strong><small>可逐事件覆盖默认级别</small></div><div><span>业务场景</span><strong>12</strong><small>场景必须先标记执行</small></div><div><span>关联链</span><strong>8 条</strong><small>广告、VPN、订阅主链</small></div></div>
                  <div className="table-wrap"><table><thead><tr><th>规则层</th><th>本配置规则</th><th>验收方式</th><th>失败结论</th></tr></thead><tbody>{[["事件","选中的事件均纳入应收快照","按event_name匹配","NOT_RECEIVED"],["场景","未执行场景不判定未收到","测试员先确认场景执行","SCENE_NOT_EXECUTED"],["参数","P0必填；P1告警；P2可省略","按事件参数规则校验","PARAM_INVALID"],["关联链","同一Context ID按顺序完整","request/opportunity/instance关联","CHAIN_INVALID"]].map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
                  <div className="modal-warning"><strong>必须确认的关键口径</strong><p>验收分母是本配置所选 {selectedConfigEventIds.length} 个事件，不是事件主库100个，也不是品类默认数量。配置发布后生成不可变快照；后续修改必须新建版本。</p></div>
                </div>
                <div className={`config-validation config-step-panel ${configStep === 4 ? "" : "config-step-hidden"}`}>
                  <div className="validation-head"><div><span>配置校验结果</span><strong>可以发布</strong><small>已选事件、参数规则、场景和关联链均可生成快照</small></div><span className="badge badge-good">PASSED</span></div>
                  <div className="validation-list"><div><span>✓</span><p><strong>已选择 {selectedConfigEventIds.length}/100 个事件</strong><small>未选事件不会进入本配置的验收分母</small></p></div><div><span>✓</span><p><strong>{selectedPriorityCounts.P0} 个 P0 事件均有必填参数规则</strong><small>P0事件、P0参数、P0关联链必须100%</small></p></div><div><span>✓</span><p><strong>12 个场景已绑定事件</strong><small>场景未执行与事件未收到分开统计</small></p></div><div><span>✓</span><p><strong>发布后生成不可变 snapshot_id</strong><small>历史Run不受后续配置修改影响</small></p></div></div>
                  <Field label="发布备注" required span><textarea name="release_note" defaultValue="完成80个必测事件选择与规则校验，发布后供V1.8客户端验收使用。" required /></Field>
                  <label className="publish-confirm"><input type="checkbox" name="confirm_immutable_snapshot" value="1" required /> 我确认发布后事件范围不可直接修改，变更时必须创建新配置版本</label>
                </div>
              </>}

              {dialog === "project-category" && <div className="modal-form-grid">
                <Field label="品类名称" required span><input name="category_name" placeholder="例如：文件管理" maxLength={40} required /></Field>
                <Field label="品类代号" required help="小写字母、数字和下划线"><input name="category_code" placeholder="file_manager" pattern="^[a-z][a-z0-9_]{2,31}$" required /></Field>
                <Field label="品类版本" required><input name="category_version" defaultValue="1.0" pattern="^[0-9]+\.[0-9]+$" required /></Field>
                <Field label="适用平台" required><select name="platform_scope" required><option value="android_ios">Android＋iOS</option><option value="android">仅Android</option><option value="ios">仅iOS</option></select></Field>
                <Field label="负责人" required><select name="owner_team_id" required><option value="team_product_platform">产品平台组</option><option value="team_vpn">VPN增长组</option><option value="team_clean">清理产品组</option></select></Field>
                <Field label="默认漏斗模板" required><select name="funnel_template_id" required><option value="funnel_general">通用激活→变现漏斗</option><option value="funnel_vpn">VPN连接→广告漏斗</option><option value="funnel_clean">扫描→清理→广告漏斗</option></select></Field>
                <Field label="默认能力包" required span><Checks name="capability_packages" items={[{value:"base",label:"公共基础",checked:true},{value:"ads",label:"广告",checked:true},{value:"subscription",label:"订阅"},{value:"attribution",label:"归因"}]} /></Field>
                <Field label="P0发布门禁" required span><Checks name="p0_gates" items={[{value:"events_100",label:"P0事件100%",checked:true},{value:"params_100",label:"P0参数100%",checked:true},{value:"chain_100",label:"关联链100%",checked:true},{value:"unknown_lt_1",label:"Unknown率<1%",checked:true}]} /></Field>
                <Field label="品类说明" required span><textarea name="description" placeholder="描述核心业务阶段、适用项目和特殊打点要求" required /></Field>
              </div>}

              {dialog === "publish-approval" && <div className="modal-form-grid">
                <Field label="发布版本" required><select name="config_version_id" required><option value="cfg_v18">V1.8 草稿</option></select></Field>
                <Field label="计划生效时间" required><input name="effective_at" type="datetime-local" defaultValue="2026-08-18T10:00" required /></Field>
                <Field label="产品审批人" required><select name="product_approver_id" required><option value="u_oliver">Oliver / 数据产品</option><option value="team_product_platform">产品平台负责人</option></select></Field>
                <Field label="技术审批人" required><select name="technical_approver_id" required><option value="team_client_arch">客户端架构组</option><option value="team_data">数据平台负责人</option></select></Field>
                <Field label="灰度范围" required><select name="rollout_scope" required><option value="vpn_10_percent">VPN项目10%</option><option value="selected_projects">指定项目</option><option value="all">全部项目</option></select></Field>
                <Field label="观察时长" required><select name="observation_window" required><option value="24h">24小时</option><option value="48h">48小时</option><option value="72h">72小时</option></select></Field>
                <Field label="变更摘要" required span><textarea name="change_summary" defaultValue="完成事件、参数、Provider、Firebase关联与验收门禁规则更新。" required /></Field>
                <Field label="回滚方案" required span><textarea name="rollback_plan" defaultValue="门禁或数据质量异常时，将执行权威回滚至 V1.7，并停止新版本项目关联。" required /></Field>
                <div className="modal-warning span-2"><strong>发布前提醒</strong><p>订阅 Provider 有1个P1未配置。提交人必须接受风险，审批日志将永久保留。</p><label className="risk-check"><input type="checkbox" name="risk_accepted" value="1" /> 我已确认门禁结果并接受上述风险</label></div>
              </div>}

              {dialog === "alert-rule" && <div className="modal-form-grid">
                <Field label="规则名称" required span><input name="rule_name" defaultValue="广告浏览者比例低于目标" maxLength={80} required /></Field>
                <Field label="监控项目" required><select name="project_scope" required><option value={project}>{project}</option><option value="vpn_all">全部VPN项目</option><option value="all">全部项目</option></select></Field>
                <Field label="数据源" required><select name="data_source" required><option value="firebase_realtime">Firebase实时</option><option value="admob_settled">AdMob结算</option><option value="adb">ADB标准化</option></select></Field>
                <Field label="监控指标" required><select name="metric_code" required><option value="viewer_ratio">广告浏览者比例</option><option value="opportunity_coverage">Opportunity覆盖率</option><option value="dau_diff">DAU对账差异</option><option value="job_latency">任务延迟</option></select></Field>
                <Field label="计算窗口" required><select name="aggregation_window" required><option value="15m">15分钟</option><option value="1h">1小时</option><option value="1d">自然日</option></select></Field>
                <Field label="判断条件" required><select name="operator" required><option value="lt">低于</option><option value="gt">高于</option><option value="drop_gt">环比下降超过</option></select></Field>
                <Field label="触发阈值" required><input name="trigger_threshold" defaultValue="25" type="number" min="0" step="0.1" required /></Field>
                <Field label="恢复阈值" required><input name="recovery_threshold" defaultValue="30" type="number" min="0" step="0.1" required /></Field>
                <Field label="连续满足" required><select name="duration" required><option value="15m">15分钟</option><option value="30m">30分钟</option><option value="1h">1小时</option></select></Field>
                <Field label="冷却时间" required><select name="cooldown" required><option value="1h">1小时</option><option value="3h">3小时</option><option value="1d">1天</option></select></Field>
                <Field label="告警等级" required><select name="severity" required><option>P0</option><option>P1</option><option>P2</option></select></Field>
                <Field label="负责人" required><select name="owner_user_id" required><option value="u_oliver">Oliver</option><option value="team_ads">广告变现组</option><option value="team_data">数据平台</option></select></Field>
                <Field label="通知对象" required span><Checks name="notification_targets" items={[{value:"feishu_project",label:"飞书项目群",checked:true},{value:"owner",label:"项目负责人",checked:true},{value:"on_call",label:"数据值班人"},{value:"email",label:"邮件"}]} /></Field>
                <Field label="延迟数据策略" required span><select name="freshness_policy" required><option value="suppress">源数据延迟时抑制指标告警，仅发数据延迟告警</option><option value="evaluate">仍按当前数据计算</option></select></Field>
              </div>}

              {dialog === "firebase-connection" && <div className="modal-form-grid">
                <Field label="连接名称" required span><input name="connection_name" placeholder="例如：增长业务 Firebase" maxLength={60} required /></Field>
                <Field label="认证方式" required><select name="auth_type" value={authType} onChange={(event) => setAuthType(event.target.value)} required><option value="service_account">服务账号</option><option value="oauth">Google OAuth</option></select></Field>
                <Field label="负责人" required><select name="owner_user_id" required><option value="u_oliver">Oliver</option><option value="team_data">数据平台</option></select></Field>
                {authType === "service_account" ? <Field label="凭证密钥引用" required span help="只保存密钥管理系统引用，禁止在系统数据库保存JSON明文"><input name="credential_secret_ref" placeholder="secret://firebase/jkcl-growth-prod" pattern="^secret://.+" required /></Field> : <div className="oauth-placeholder span-2"><strong>Google OAuth授权</strong><p>创建后跳转到Google授权页；系统仅保存可撤销的授权引用。</p><input type="hidden" name="oauth_requested" value="1" /></div>}
                <Field label="默认BigQuery计费项目" required span><input name="billing_project_id" placeholder="jkcl-data-platform" pattern="^[a-z][a-z0-9-]{4,28}[a-z0-9]$" required /></Field>
                <Field label="可发现范围" required><select name="discovery_scope" required><option value="accessible_projects">全部可访问Project</option><option value="specified_projects">仅指定Project</option></select></Field>
                <Field label="凭证有效期"><input name="credential_expires_at" type="date" /></Field>
                <Field label="连接说明" span><textarea name="description" placeholder="说明账号归属、使用范围和变更联系人" /></Field>
                <div className="modal-warning span-2"><strong>创建时自动检查</strong><p>Firebase项目只读、BigQuery Data Viewer、BigQuery Job User、GA4 Viewer以及项目枚举权限。</p></div>
              </div>}

              {dialog === "firebase-binding" && <div className="modal-form-grid">
                <Field label="Firebase连接" required><select name="connection_id" value={connectionId} onChange={(event) => switchConnection(event.target.value as keyof typeof firebaseInventory)} required>{Object.entries(firebaseInventory).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></Field>
                <Field label="Firebase Project" required><select name="firebase_project_id" value={firebaseProjectId} onChange={(event) => switchFirebaseProject(event.target.value)} required>{projectOptions.map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></Field>
                <Field label="Firebase App" required span><select name="firebase_app_id" value={firebaseAppId} onChange={(event) => { const app = appOptions.find((item) => item.id === event.target.value); if (app) selectFirebaseApp(app); }} required>{appOptions.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.packageName}</option>)}</select></Field>
                <Field label="平台"><input name="platform" value={selectedApp.platform} readOnly /></Field>
                <Field label="包名/Bundle ID"><input name="app_identifier" value={selectedApp.packageName} readOnly /></Field>
                <Field label="GA4 Property"><input name="ga4_property_id" value={selectedFirebaseProject.property} readOnly /></Field>
                <Field label="Data Stream ID"><input name="data_stream_id" value={selectedApp.streamId} readOnly /></Field>
                <Field label="BigQuery Dataset" span><input name="bigquery_dataset_id" value={selectedFirebaseProject.dataset} readOnly /></Field>
                <Field label="公司项目" required><select name="project_code" value={internalProjectCode} onChange={(event) => switchInternalProject(event.target.value)} required>{Array.from(new Set(internalAppCatalog.map((item) => item.projectCode))).map((code) => <option key={code}>{code}</option>)}</select></Field>
                <Field label="公司App档案" required><select name="internal_app_id" value={internalAppId} onChange={(event) => setInternalAppId(event.target.value)} required>{internalAppOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.appIdentifier}</option>)}</select></Field>
                <Field label="环境" required><select name="environment" required><option value="production">正式</option><option value="staging">测试</option><option value="gray">灰度</option></select></Field>
                <Field label="数据时区" required><select name="timezone" required><option>UTC</option><option>Asia/Shanghai</option><option>Asia/Tehran</option></select></Field>
                <Field label="历史回补开始日期"><input name="backfill_from" type="date" defaultValue="2026-08-01" /></Field>
                <Field label="生效时间" required><input name="effective_from" type="datetime-local" defaultValue="2026-08-11T16:00" required /></Field>
                <Field label="规范版本" required><select name="spec_version" required><option>V1.7</option><option>V1.6</option></select></Field>
                <Field label="负责人" required><select name="owner_user_id" required><option value="u_oliver">Oliver</option><option value="team_data">数据平台</option></select></Field>
                <div className={`binding-check span-2 ${packageMatches ? "" : "mismatch"}`}><div><span>{packageMatches ? "✓" : "!"}</span><p><strong>{packageMatches ? "包名与平台匹配" : "包名或平台不匹配"}</strong><small>{selectedApp.packageName} ↔ {selectedInternalApp?.appIdentifier}</small></p></div><div><span>✓</span><p><strong>最近24小时有数据</strong><small>最新事件 8分钟前 · 2.14M events</small></p></div><label className="risk-check"><input type="checkbox" name="confirm_package_match" value="1" disabled={!packageMatches} /> 我已确认公司App档案与Firebase App的包名、平台和环境一致</label></div>
              </div>}
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={onClose}>取消</button>
              {dialog === "config-version" && <button type="button" className="secondary-button" onClick={saveConfigDraft}>{phase === "submitting" ? "正在保存…" : isEditingDraft ? "保存草稿修改" : "保存草稿"}</button>}
              {dialog === "config-version" && configStep > 1 && <button type="button" className="secondary-button" onClick={() => setConfigStep((step) => Math.max(1, step - 1))}>上一步</button>}
              {dialog === "config-version" && configStep < 4 ? <button type="button" className="primary-button" onClick={nextConfigStep}>{configStep === 1 ? "下一步：选择打点" : configStep === 2 ? `下一步：确认 ${selectedConfigEventIds.length} 个事件` : "下一步：校验发布"}</button> : <button type="submit" className="primary-button" disabled={phase === "submitting"}>{phase === "submitting" ? "正在提交…" : meta.submit}</button>}
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
