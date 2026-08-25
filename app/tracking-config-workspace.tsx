"use client";

import { useMemo, useState } from "react";
import { defaultSelectedEventIds, trackingEventCatalog, type TrackingConfigRecord, type TrackingPriority } from "./tracking-config-data";
import { trackingDatabaseSource } from "./tracking-config-repository";

export type TrackingConfigSubmission = {
  name: string;
  version: string;
  category: string;
  projects: string[];
  platform: string;
  description: string;
  selectedEventIds: string[];
};

type ConfigSaveAction = "draft" | "publish";
type MasterView = "fields" | "events";
type SelectionView = "all" | "selected" | "unselected";

const projects = [
  { code: "A054", label: "A054 · VPN V1.8 项目", category: "套利 VPN" },
  { code: "IRAN-VPN-01", label: "IRAN-VPN-01 · Iran Fast VPN", category: "套利 VPN" },
  { code: "FAST-VPN-02", label: "FAST-VPN-02 · Fast VPN", category: "套利 VPN" },
  { code: "CLEAN-MAX-03", label: "CLEAN-MAX-03 · Clean Max", category: "清理" },
  { code: "TURBO-CLEAN-05", label: "TURBO-CLEAN-05 · Turbo Cleaner", category: "清理" },
  { code: "AIVORA-LAUNCHER", label: "AIVORA-LAUNCHER · Aivora Launcher", category: "Launcher" },
];

function nextVersion(version: string) {
  const match = version.match(/^V(\d+)\.(\d+)$/);
  return match ? `V${match[1]}.${Number(match[2]) + 1}` : "V1.0";
}

function priorityTone(priority: TrackingPriority) {
  return priority === "P0" ? "bad" : priority === "P1" ? "warn" : "neutral";
}

export function TrackingConfigWorkspace({ editingConfig, onCancel, onSave }: {
  editingConfig: TrackingConfigRecord | null;
  onCancel: () => void;
  onSave: (submission: TrackingConfigSubmission, action: ConfigSaveAction) => void;
}) {
  const copyingPublished = editingConfig?.status === "PUBLISHED";
  const [name, setName] = useState(editingConfig ? `${editingConfig.name}${copyingPublished ? " - 新版本" : ""}` : "VPN 新版本打点配置");
  const [version, setVersion] = useState(editingConfig ? copyingPublished ? nextVersion(editingConfig.version) : editingConfig.version : "V1.9");
  const [category, setCategory] = useState(editingConfig?.category ?? "套利 VPN");
  const [selectedProjects, setSelectedProjects] = useState<string[]>(editingConfig?.projects ?? ["IRAN-VPN-01"]);
  const [platform, setPlatform] = useState(editingConfig?.platform ?? "Android+iOS");
  const [description, setDescription] = useState(`基于 V1.8「01_事件字段总表」配置本版本需要实现和验收的标准事件。`);
  const [selectedIds, setSelectedIds] = useState<string[]>(editingConfig?.selectedEventIds ?? defaultSelectedEventIds);
  const [moduleFilter, setModuleFilter] = useState("all");
  const [standardNameFilter, setStandardNameFilter] = useState("");
  const [displayNameFilter, setDisplayNameFilter] = useState("");
  const [generalKeyword, setGeneralKeyword] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectionView, setSelectionView] = useState<SelectionView>("all");
  const [masterView, setMasterView] = useState<MasterView>("fields");
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const modules = useMemo(() => Array.from(new Set(trackingEventCatalog.map((event) => event.stage))), []);
  const selectedEvents = trackingEventCatalog.filter((event) => selectedIds.includes(event.id));
  const priorityCounts = {
    P0: selectedEvents.filter((event) => event.priority === "P0").length,
    P1: selectedEvents.filter((event) => event.priority === "P1").length,
    P2: selectedEvents.filter((event) => event.priority === "P2").length,
  };

  const filteredEvents = trackingEventCatalog.filter((event) => {
    const keywordHaystack = `${event.stage} ${event.name} ${event.displayName} ${event.analysisGoal} ${event.trackingLocation} ${event.metricPurpose} ${event.parameters.map((parameter) => `${parameter.name} ${parameter.displayName}`).join(" ")}`.toLowerCase();
    return (moduleFilter === "all" || event.stage === moduleFilter)
      && (!standardNameFilter || event.name.toLowerCase().includes(standardNameFilter.toLowerCase()))
      && (!displayNameFilter || event.displayName.includes(displayNameFilter))
      && (!generalKeyword || keywordHaystack.includes(generalKeyword.toLowerCase()))
      && (priorityFilter === "all" || event.priority === priorityFilter)
      && (selectionView === "all" || (selectionView === "selected" ? selectedIds.includes(event.id) : !selectedIds.includes(event.id)));
  });

  const fieldRows = filteredEvents.flatMap((event) => event.parameters.map((parameter) => ({ event, parameter })));
  const visibleEventIds = filteredEvents.map((event) => event.id);
  const allVisibleSelected = visibleEventIds.length > 0 && visibleEventIds.every((id) => selectedIds.includes(id));

  function toggleEvent(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleModule(module: string) {
    const ids = trackingEventCatalog.filter((event) => event.stage === module).map((event) => event.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids])));
  }

  function toggleVisible() {
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleEventIds.includes(id)) : Array.from(new Set([...current, ...visibleEventIds])));
  }

  function toggleProject(code: string) {
    setSelectedProjects((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  function resetFilters() {
    setModuleFilter("all");
    setStandardNameFilter("");
    setDisplayNameFilter("");
    setGeneralKeyword("");
    setPriorityFilter("all");
    setSelectionView("all");
  }

  function save(action: ConfigSaveAction) {
    const nextErrors: string[] = [];
    if (!name.trim()) nextErrors.push("请填写配置名称");
    if (!/^V\d+\.\d+$/.test(version)) nextErrors.push("配置版本应使用 V1.0 格式");
    if (selectedProjects.length === 0) nextErrors.push("请至少关联一个项目");
    if (selectedIds.length === 0) nextErrors.push("请至少选择一个标准事件");
    if (action === "publish" && !publishConfirmed) nextErrors.push("发布前请确认生成不可变快照");
    if (nextErrors.length) {
      setErrors(nextErrors);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    onSave({ name: name.trim(), version, category, projects: selectedProjects, platform, description, selectedEventIds: selectedIds }, action);
  }

  return (
    <div className="config-workspace-page">
      <section className="config-workspace-head">
        <div>
          <button className="back-link" onClick={onCancel}>← 返回配置列表</button>
          <div className="eyebrow">V1.8 · 广告与 VPN 资格检查更新版</div>
          <h1>{editingConfig?.status === "DRAFT" ? "编辑打点配置草稿" : copyingPublished ? "复制为新配置版本" : "新建打点配置"}</h1>
          <p>事件、字段和统计按最新 V1.8 执行表读取；广告以 session_id 串联，VPN 以 vpn_session_id 串联。</p>
        </div>
        <div className="config-source-proof">
          <span>{trackingDatabaseSource.sourceType === "database" ? "数据库已连接" : "预览数据源"}</span>
          <strong>{trackingDatabaseSource.eventCount} 个标准事件</strong>
          <small>{trackingDatabaseSource.fieldCount} 条字段 · {trackingDatabaseSource.schemaVersion} · {trackingDatabaseSource.sourceLabel}</small>
        </div>
      </section>

      {errors.length > 0 && <section className="config-page-errors"><strong>请完成以下内容</strong>{errors.map((error) => <span key={error}>• {error}</span>)}</section>}

      <section className="config-basic-panel surface">
        <div className="surface-title"><div><h2>配置基本信息</h2><p>草稿可继续编辑；发布后事件范围冻结为 snapshot_id。</p></div><span className={`badge badge-${editingConfig?.status === "DRAFT" ? "warn" : "blue"}`}>{editingConfig?.status === "DRAFT" ? "编辑草稿" : "新版本"}</span></div>
        <div className="config-basic-grid">
          <label className="wide"><span>配置名称 *</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
          <label><span>版本 *</span><input value={version} onChange={(event) => setVersion(event.target.value)} /></label>
          <label><span>适用品类 *</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>套利 VPN</option><option>清理</option><option>Launcher</option></select></label>
          <label><span>平台 *</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option>Android+iOS</option><option>Android</option><option>iOS</option></select></label>
          <label className="projects-field"><span>关联项目 *</span><div>{projects.map((item) => <button type="button" key={item.code} className={selectedProjects.includes(item.code) ? "selected" : ""} onClick={() => toggleProject(item.code)}><i>{selectedProjects.includes(item.code) ? "✓" : ""}</i>{item.label}</button>)}</div></label>
          <label className="description-field"><span>配置说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
      </section>

      <section className="event-master surface">
        <div className="event-master-head">
          <div><div className="eyebrow">{trackingDatabaseSource.schemaVersion} · {trackingDatabaseSource.eventTable} + {trackingDatabaseSource.fieldTable}</div><h2>标准事件选择</h2><p>选择粒度是“标准事件”；字段明细直接按事件主键关联字段表，核对属性、类型、触发时机和打点位置。</p></div>
          <div className="config-selection-summary"><div><span>已选事件</span><strong>{selectedIds.length}/{trackingEventCatalog.length}</strong></div><div><span>P0 / P1 / P2</span><strong>{priorityCounts.P0} / {priorityCounts.P1} / {priorityCounts.P2}</strong></div><div><span>链路主键</span><strong>广告 session_id · VPN vpn_session_id</strong></div><div><span>已选字段</span><strong>{selectedEvents.reduce((sum, event) => sum + event.parameterCount, 0)}</strong></div></div>
        </div>

        <div className="module-selection-grid">{modules.map((module) => {
          const events = trackingEventCatalog.filter((event) => event.stage === module);
          const selectedCount = events.filter((event) => selectedIds.includes(event.id)).length;
          const state = selectedCount === events.length ? "selected" : selectedCount > 0 ? "partial" : "";
          return <button type="button" key={module} className={state} onClick={() => toggleModule(module)}><i>{state === "selected" ? "✓" : state === "partial" ? "−" : ""}</i><span><strong>{module}</strong><small>{selectedCount}/{events.length} · {state === "selected" ? "已全选" : state === "partial" ? "部分选择" : "未选择"}</small></span></button>;
        })}</div>

        <div className="event-master-filters">
          <label className="general-search"><span>全表搜索</span><input value={generalKeyword} onChange={(event) => setGeneralKeyword(event.target.value)} placeholder="搜索分析目标、字段名、打点位置、指标用途" /></label>
          <label><span>事件模块</span><select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option value="all">全部事件模块</option>{modules.map((module) => <option key={module}>{module}</option>)}</select></label>
          <label><span>标准事件名</span><input value={standardNameFilter} onChange={(event) => setStandardNameFilter(event.target.value)} placeholder="例如 ad_impression" /></label>
          <label><span>事件显示名</span><input value={displayNameFilter} onChange={(event) => setDisplayNameFilter(event.target.value)} placeholder="例如 广告产生展示" /></label>
          <label><span>优先级</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">全部</option><option>P0</option><option>P1</option><option>P2</option></select></label>
          <button className="reset-filter" onClick={resetFilters}>重置筛选</button>
        </div>

        <div className="event-master-toolbar">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /> 全选当前筛选结果（{filteredEvents.length}个事件）</label>
          <div className="event-master-segments"><button className={selectionView === "all" ? "active" : ""} onClick={() => setSelectionView("all")}>全部</button><button className={selectionView === "selected" ? "active" : ""} onClick={() => setSelectionView("selected")}>只看已选</button><button className={selectionView === "unselected" ? "active" : ""} onClick={() => setSelectionView("unselected")}>只看未选</button></div>
          <div className="event-master-segments view-toggle"><button className={masterView === "fields" ? "active" : ""} onClick={() => setMasterView("fields")}>字段明细 {fieldRows.length}</button><button className={masterView === "events" ? "active" : ""} onClick={() => setMasterView("events")}>事件汇总 {filteredEvents.length}</button></div>
        </div>

        <div className="event-master-count"><strong>当前展示 {masterView === "fields" ? fieldRows.length : filteredEvents.length} 条</strong><span>不分页、不截断；筛选只改变显示，不改变已选结果。</span></div>

        <div className={`event-master-table ${masterView === "fields" ? "field-view" : "event-view"}`}>
          {masterView === "fields" ? <table><thead><tr><th>选择</th><th>事件模块</th><th>标准事件名</th><th>链路主键</th><th>事件显示名</th><th>分析目标</th><th>标准属性名</th><th>属性显示名</th><th>数据类型</th><th>入库方式</th><th>属性说明 / 枚举</th><th>适用端</th><th>具体打点位置</th><th>触发时机</th><th>中台指标 / 用途</th></tr></thead><tbody>{fieldRows.map(({ event, parameter }, index) => {
            const firstParameter = index === 0 || fieldRows[index - 1].event.id !== event.id;
            return <tr key={`${event.id}-${parameter.name}`} className={`${selectedIds.includes(event.id) ? "selected-row" : ""} ${firstParameter ? "event-start-row" : ""}`}><td>{firstParameter && <input type="checkbox" checked={selectedIds.includes(event.id)} onChange={() => toggleEvent(event.id)} aria-label={`选择 ${event.name}`} />}</td><td>{firstParameter && <strong>{event.stage}</strong>}</td><td>{firstParameter && <><code>{event.name}</code><small>{event.id} · <span className={`badge badge-${priorityTone(event.priority)}`}>{event.priority}</span></small></>}</td><td>{firstParameter && <code>{event.chainKey}</code>}</td><td>{firstParameter && <strong>{event.displayName}</strong>}</td><td>{firstParameter && event.analysisGoal}</td><td><code>{parameter.name}</code></td><td>{parameter.displayName}</td><td>{parameter.dataType}</td><td>{parameter.reportingMode}</td><td>{parameter.description}</td><td>{firstParameter && event.platform}</td><td>{firstParameter && event.trackingLocation}</td><td>{firstParameter && event.triggerTiming}</td><td>{firstParameter && event.metricPurpose}</td></tr>;
          })}</tbody></table> : <table><thead><tr><th>选择</th><th>事件模块</th><th>标准事件名</th><th>链路主键</th><th>事件显示名</th><th>分析目标</th><th>字段数</th><th>优先级</th><th>适用端</th><th>具体打点位置</th><th>触发时机</th><th>中台指标 / 用途</th></tr></thead><tbody>{filteredEvents.map((event) => <tr key={event.id} className={selectedIds.includes(event.id) ? "selected-row" : ""}><td><input type="checkbox" checked={selectedIds.includes(event.id)} onChange={() => toggleEvent(event.id)} aria-label={`选择 ${event.name}`} /></td><td><strong>{event.stage}</strong></td><td><code>{event.name}</code><small>{event.id}</small></td><td><code>{event.chainKey}</code></td><td><strong>{event.displayName}</strong></td><td>{event.analysisGoal}</td><td>{event.parameterCount}</td><td><span className={`badge badge-${priorityTone(event.priority)}`}>{event.priority}</span></td><td>{event.platform}</td><td>{event.trackingLocation}</td><td>{event.triggerTiming}</td><td>{event.metricPurpose}</td></tr>)}</tbody></table>}
          {(masterView === "fields" ? fieldRows.length : filteredEvents.length) === 0 && <div className="event-master-empty"><strong>没有符合条件的数据</strong><span>请清空部分筛选条件后重试。</span></div>}
        </div>
      </section>

      <section className="config-publish-review surface">
        <div><span>最终配置范围</span><strong>{selectedIds.length} 个标准事件 · {selectedEvents.reduce((sum, event) => sum + event.parameterCount, 0)} 条事件字段</strong><small>验收分母按所选标准事件计算；字段完整率按事件字段规则单独计算。</small></div>
        <label><input type="checkbox" checked={publishConfirmed} onChange={(event) => setPublishConfirmed(event.target.checked)} /> 我确认发布后生成不可变快照；后续修改必须复制为新版本</label>
      </section>

      <footer className="config-workspace-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="secondary-button" onClick={() => save("draft")}>保存草稿</button><button className="primary-button" onClick={() => save("publish")}>校验并发布配置快照</button></footer>
    </div>
  );
}
