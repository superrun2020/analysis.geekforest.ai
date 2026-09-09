"use client";

import { useEffect, useMemo, useState } from "react";
import { trackingApiBaseUrl } from "./api-base-url";

type AnyRow = Record<string, any>;

type ShareMeta = {
  shareId: string;
  title: string;
  projectCode: string;
  appIdentifier: string;
  module: string;
  page: string;
  domain: string;
  unit: string;
  status: string;
  riskStatus: string;
  accessCount: number;
  createdAt: string;
  lastAccessedAt?: string;
  allowedEmailDomains?: string[];
  deviceNotice?: string;
};

type ShareReport = ShareMeta & {
  filters: AnyRow;
  snapshot: AnyRow;
  viewerEmail: string;
  riskReasons: string[];
  onlineViewers?: OnlineViewers;
  openedAt: string;
};

type OnlineViewers = {
  onlineCount: number;
  windowMinutes: number;
  viewers: Array<{ email: string; lastSeenAt: string; devicePlatform?: string; networkEffectiveType?: string }>;
};

type RenderedPageSnapshot = {
  html: string;
  capturedFromUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  documentWidth?: number;
  documentHeight?: number;
  capturedAt?: string;
  mode?: string;
};

type Envelope<T> = { code?: number; msg?: string; data?: T; error?: string };

function shareIdFromUrl() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("sid") ?? "";
}

async function publicApi<T>(path: string, body?: AnyRow): Promise<T> {
  const baseUrl = trackingApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.msg || payload.error || `接口返回 HTTP ${response.status}`);
  }
  if (!payload.data) throw new Error("接口未返回报告数据");
  return payload.data;
}

function collectDeviceInfo() {
  if (typeof window === "undefined") return {};
  const nav = window.navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    connection: nav.connection ? {
      effectiveType: nav.connection.effectiveType,
      downlink: nav.connection.downlink,
      rtt: nav.connection.rtt,
      saveData: nav.connection.saveData,
    } : undefined,
  };
}

function number(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value === null || value === undefined || value === "" ? "—" : String(value);
  return parsed.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function text(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function metricRows(snapshot: AnyRow): AnyRow[] {
  const packageData = snapshot?.dataPackage ?? {};
  return Object.values(packageData).flatMap((section: any) => Array.isArray(section?.metrics) ? section.metrics : []);
}

function funnelRows(snapshot: AnyRow): AnyRow[] {
  const packageData = snapshot?.dataPackage ?? {};
  return Object.values(packageData).flatMap((section: any) => Array.isArray(section?.funnel) ? section.funnel : []);
}

function pageRows(snapshot: AnyRow): AnyRow[] {
  const packageData = snapshot?.dataPackage ?? {};
  return Object.values(packageData).flatMap((section: any) => {
    if (Array.isArray(section?.pages)) return section.pages;
    if (Array.isArray(section?.pageFunnel?.pages)) return section.pageFunnel.pages;
    if (Array.isArray(section?.adPageFunnel?.pages)) return section.adPageFunnel.pages;
    return [];
  });
}

function evidenceRows(snapshot: AnyRow): AnyRow[] {
  const packageData = snapshot?.dataPackage ?? {};
  return Object.values(packageData).flatMap((section: any) => Array.isArray(section?.items) ? section.items : []);
}

function metricValue(row: AnyRow) {
  return row.displayValue ?? row.value ?? row.metricValue ?? row.count ?? row.users ?? "—";
}

function rowCount(row: AnyRow) {
  const parsed = Number(row.count ?? row.value ?? row.users ?? row.subjectCount ?? row.pageUsers ?? row.page_users ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowName(row: AnyRow) {
  return text(row.name ?? row.stepName ?? row.label ?? row.metricName ?? row.metricKey ?? row.key);
}

function topInsightCards(snapshot: AnyRow) {
  const metrics = metricRows(snapshot);
  const funnel = funnelRows(snapshot);
  const pages = pageRows(snapshot);
  const biggestDrop = funnel.slice(1).map((row, index) => {
    const from = rowCount(funnel[index]);
    const to = rowCount(row);
    const loss = Math.max(0, from - to);
    const rate = from > 0 ? loss / from * 100 : 0;
    return { from: rowName(funnel[index]), to: rowName(row), loss, rate };
  }).sort((a, b) => b.rate - a.rate)[0];
  const worstPage = pages.map((row) => {
    const pageUsers = Number(row.pageUsers ?? row.page_users ?? row.users ?? 0);
    const impressionUsers = Number(row.impressionUsers ?? row.impression_users ?? row.avUsers ?? row.av_users ?? 0);
    return { name: text(row.screenName ?? row.screen_name), pageUsers, impressionUsers, rate: pageUsers > 0 ? impressionUsers / pageUsers * 100 : 0 };
  }).filter((row) => row.pageUsers > 0).sort((a, b) => a.rate - b.rate)[0];
  const viewerMetric = metrics.find((metric) => /浏览者|AV|viewer|impression/i.test(`${metric.name ?? ""} ${metric.metricKey ?? ""}`));
  return [
    { label: "关键指标", value: text(metricValue(viewerMetric ?? metrics[0] ?? {})), note: rowName(viewerMetric ?? metrics[0] ?? { name: "暂无指标" }), tone: "blue" },
    { label: "最大漏斗断点", value: biggestDrop ? `${biggestDrop.rate.toFixed(1)}%` : "—", note: biggestDrop ? `${biggestDrop.from} → ${biggestDrop.to}，流失 ${number(biggestDrop.loss)}` : "漏斗数据不足", tone: biggestDrop && biggestDrop.rate > 35 ? "bad" : "warn" },
    { label: "页面承接风险", value: worstPage ? `${worstPage.rate.toFixed(1)}%` : "—", note: worstPage ? `${worstPage.name} 页面到展示率最低` : "页面数据不足", tone: worstPage && worstPage.rate < 30 ? "bad" : "warn" },
  ];
}

function MarkdownLite({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).slice(0, 10);
  return <div className="public-ai-markdown">
    {blocks.length ? blocks.map((block, index) => {
      if (/^#{1,3}\s/.test(block)) return <h3 key={index}>{block.replace(/^#{1,3}\s*/, "")}</h3>;
      const lines = block.split("\n").filter(Boolean);
      if (lines.every((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))) {
        return <ul key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{line.replace(/^[-*]\s+|^\d+\.\s+/, "")}</li>)}</ul>;
      }
      return <p key={index}>{block.replace(/^[-*]\s+/, "")}</p>;
    }) : <p>暂无 AI 诊断内容。</p>}
  </div>;
}

function InsightCards({ snapshot }: { snapshot: AnyRow }) {
  return <section className="public-report-insights">
    {topInsightCards(snapshot).map((card) => <article key={card.label} className={`public-insight-card ${card.tone}`}>
      <span>{card.label}</span>
      <strong>{card.value}</strong>
      <small>{card.note}</small>
    </article>)}
  </section>;
}

function FunnelVisual({ rows }: { rows: AnyRow[] }) {
  const max = Math.max(1, ...rows.map(rowCount));
  return <div className="public-funnel-visual">
    {rows.slice(0, 10).map((row, index) => {
      const value = rowCount(row);
      const width = Math.max(4, value / max * 100);
      const previous = index > 0 ? rowCount(rows[index - 1]) : value;
      const lossRate = previous > 0 && index > 0 ? Math.max(0, (previous - value) / previous * 100) : 0;
      return <div key={index} className="public-funnel-row">
        <div><strong>{rowName(row)}</strong><small>{text(row.eventName ?? row.event ?? row.conditionText)}</small></div>
        <div className="public-funnel-bar"><i style={{ width: `${width}%` }} /></div>
        <b>{number(value)}</b>
        <em>{index === 0 ? "起点" : `流失 ${lossRate.toFixed(1)}%`}</em>
      </div>;
    })}
  </div>;
}

function PageDropVisual({ rows }: { rows: AnyRow[] }) {
  const mapped = rows.slice(0, 8).map((row) => {
    const pageUsers = Number(row.pageUsers ?? row.page_users ?? row.users ?? 0);
    const checkUsers = Number(row.eligibilityCheckUsers ?? row.eligibility_check_users ?? 0);
    const impressionUsers = Number(row.impressionUsers ?? row.impression_users ?? row.avUsers ?? row.av_users ?? 0);
    const reached = impressionUsers || checkUsers;
    const lossRate = pageUsers > 0 ? Math.max(0, (pageUsers - reached) / pageUsers * 100) : 0;
    return { name: text(row.screenName ?? row.screen_name), pageUsers, reached, lossRate };
  }).filter((row) => row.pageUsers > 0).sort((a, b) => b.lossRate - a.lossRate);
  const max = Math.max(1, ...mapped.map((row) => row.lossRate));
  return <div className="public-page-drop-visual">
    {mapped.length ? mapped.map((row) => <div key={row.name}>
      <span>{row.name}</span>
      <i><b style={{ width: `${Math.max(3, row.lossRate / max * 100)}%` }} /></i>
      <strong>{row.lossRate.toFixed(1)}%</strong>
      <small>页面UV {number(row.pageUsers)} · 到达 {number(row.reached)}</small>
    </div>) : <p>暂无页面流失图表数据。</p>}
  </div>;
}

function progressStatusLabel(value: string) {
  return { done: "已完成", loading: "查询中", retrying: "自动重拉中", error: "失败", pending: "排队中" }[value] ?? value;
}

function riskLabel(value: string) {
  return {
    multiple_viewer_emails: "同一链接出现多个查看邮箱",
    multiple_access_ips: "同一链接出现多个访问 IP",
    multiple_device_platforms: "同一链接出现多个设备平台",
    non_company_email: "非公司邮箱访问",
    revoked_or_expired_access: "失效链接仍被访问",
  }[value] ?? value;
}

const snapshotMenus = [
  { key: "funnel", index: "01", label: "广告漏斗分析中心", group: "经营分析" },
  { key: "vpn", index: "02", label: "VPN功能漏斗分析", group: "经营分析" },
  { key: "admob", index: "03", label: "AdMob 分析", group: "经营分析" },
  { key: "firebase", index: "04", label: "Firebase 数据", group: "经营分析" },
  { key: "reconcile", index: "05", label: "数据对账", group: "经营分析" },
  { key: "tracking", index: "06", label: "打点验收与配置", group: "质量治理" },
  { key: "tasks", index: "07", label: "任务与告警", group: "质量治理" },
  { key: "shareAlerts", index: "08", label: "异常报警", group: "质量治理" },
];

const snapshotPages = [
  { key: "overview", label: "多项目漏斗预览", hint: "只看问题项目" },
  { key: "workbench", label: "单项目分析工作台", hint: "漏斗·页面·流失原因" },
  { key: "evidence", label: "证据与事件明细", hint: "事件链与原始参数" },
  { key: "issues", label: "问题修复闭环", hint: "任务·重测·效果" },
];

function snapshotModuleTitle(module: string, domain: string) {
  if (module === "vpn" || domain === "vpn") return "VPN功能漏斗分析";
  return "广告漏斗分析中心";
}

function snapshotPageLabel(page: string) {
  return snapshotPages.find((item) => item.key === page)?.label ?? "单项目分析工作台";
}

function buildAiHighlights(snapshot: AnyRow) {
  const cards = topInsightCards(snapshot);
  return cards.map((card) => ({
    title: card.label,
    value: card.value,
    detail: card.note,
    tone: card.tone,
  }));
}

function AiVisualDiagnosis({ snapshot, markdown }: { snapshot: AnyRow; markdown: string }) {
  const highlights = buildAiHighlights(snapshot);
  const funnel = funnelRows(snapshot).slice(0, 7);
  const pages = pageRows(snapshot).slice(0, 6);
  return <section className="surface share-snapshot-ai">
    <div className="surface-title">
      <div><h2>AI 图文诊断</h2><p>用快照里的指标、漏斗和页面流失生成：先看图，再看结论和动作。</p></div>
      <span>固定快照 · 不重新查询</span>
    </div>
    <div className="share-ai-layout">
      <div className="share-ai-visuals">
        <div className="share-ai-highlight-grid">
          {highlights.map((item) => <article key={item.title} className={`public-insight-card ${item.tone}`}>
            <span>{item.title}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>)}
        </div>
        <div className="share-ai-chart-card">
          <h3>核心漏斗截图式摘要</h3>
          <FunnelVisual rows={funnel} />
        </div>
        <div className="share-ai-chart-card">
          <h3>页面流失截图式摘要</h3>
          <PageDropVisual rows={pages} />
        </div>
      </div>
      <div className="share-ai-text">
        <h3>AI 文字结论与建议</h3>
        <MarkdownLite markdown={markdown} />
      </div>
    </div>
  </section>;
}

function SnapshotReportShell({ report, meta, onlineViewers, packageErrors, metrics, funnel, pages, evidence, progress }: {
  report: ShareReport;
  meta: ShareMeta | null;
  onlineViewers: OnlineViewers | null;
  packageErrors: AnyRow;
  metrics: AnyRow[];
  funnel: AnyRow[];
  pages: AnyRow[];
  evidence: AnyRow[];
  progress: AnyRow[];
}) {
  const snapshot = report.snapshot ?? {};
  const module = text(snapshot.module ?? report.module ?? "funnel");
  const domain = text(snapshot.domain ?? report.domain ?? "ads");
  const page = text(snapshot.page ?? report.page ?? "workbench");
  const aiDiagnosis = snapshot?.aiDiagnosis && typeof snapshot.aiDiagnosis === "object" ? snapshot.aiDiagnosis : null;
  const activeMenu = module === "vpn" || domain === "vpn" ? "vpn" : "funnel";
  return <div className="app-shell share-snapshot-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">GF</span><span><strong>GeekForest 产品大脑</strong><small className="version-line"><span>质量分析中心 · V103</span><button type="button" disabled title="分享快照不刷新数据">快照</button></small></span></div>
      <div className="nav-group-label">经营分析</div>
      {snapshotMenus.filter((item) => item.group === "经营分析").map((item) => <button key={item.key} className={`main-nav-item ${activeMenu === item.key ? "active" : ""}`} disabled><span>{item.index}</span>{item.label}</button>)}
      <div className="nav-group-label">质量治理</div>
      {snapshotMenus.filter((item) => item.group === "质量治理").map((item) => <button key={item.key} className="main-nav-item" disabled><span>{item.index}</span>{item.label}</button>)}
      <div className="sidebar-foot"><span className="status-dot" />分享快照模式<small>数据固定为生成链接时的线上查询结果</small></div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumbs">分享报告 / {snapshotModuleTitle(module, domain)} / <strong>{snapshotPageLabel(page)}</strong></div>
        <div className="topbar-actions">
          <div className="share-snapshot-online"><span className="status-dot" /><strong>在线 {number(onlineViewers?.onlineCount ?? 1)} 人</strong></div>
          <button className="account-chip" title="当前查看邮箱"><span>{report.viewerEmail.slice(0, 1).toUpperCase()}</span><small>{report.viewerEmail}</small></button>
        </div>
      </header>

      <main className="main-content">
        <section className="page-heading">
          <div><h1>{text(meta?.title ?? report.title)}</h1><p>这是和线上页面一致的只读快照。筛选、漏斗、AI诊断、页面路径和证据均来自分享时保存的数据，不会因为后来重新查询而变化。</p></div>
          <div className="heading-actions"><button className="secondary-button" disabled>只读快照</button><button className="primary-button" disabled>分享项目报告</button></div>
        </section>

        <nav className="page-nav" aria-label="分享快照页面">
          {snapshotPages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} disabled><span>{item.label}</span><small>{item.hint}</small></button>)}
        </nav>

        <section className="filter-bar share-snapshot-filter">
          <label>项目<input readOnly value={text(report.projectCode || snapshot.projectCode)} /></label>
          <label>日期<input readOnly value={`${text(snapshot.dates?.dateFrom ?? report.filters?.dateFrom)} 至 ${text(snapshot.dates?.dateTo ?? report.filters?.dateTo)}`} /></label>
          <label>平台<input readOnly value={text(snapshot.platform ?? report.filters?.platform)} /></label>
          <label>国家<input readOnly value={text(snapshot.country ?? report.filters?.country)} /></label>
          <label>App版本<input readOnly value={text(snapshot.appVersion ?? report.filters?.appVersion)} /></label>
          <div className="data-state"><span className="status-dot" /><strong>快照已固定</strong><small>生成：{text(snapshot.capturedAt ?? meta?.createdAt)}</small></div>
        </section>

        <section className="context-toolbar">
          <div className="context-summary"><span className="badge badge-blue">{snapshotPageLabel(page)}</span><span>{text(report.projectCode || snapshot.projectCode)}</span><i /> <span>{text(report.appIdentifier)}</span><i /> <span>{text(domain)}</span><i /> <span>{text(snapshot.unit ?? report.unit)}</span></div>
          <div className="context-actions"><button disabled>保存视图</button><button disabled>导出报表</button></div>
        </section>

        <section className="freshness-note"><div><strong>分享访问提示：</strong>必须输入公司邮箱才能查看；系统记录访问邮箱、IP、设备/浏览器、网络和查看时间。当前页面只展示快照，不发起新的经营数据查询。</div></section>

        <section className="public-report-card public-online-viewers share-snapshot-viewers">
          <div><h2>当前谁在看</h2><p>按最近 {onlineViewers?.windowMinutes ?? 5} 分钟心跳计算，同一个邮箱只算 1 人。</p></div>
          <div className="public-online-list">{(onlineViewers?.viewers?.length ? onlineViewers.viewers : [{ email: report.viewerEmail, lastSeenAt: report.openedAt }]).map((viewer) => <span key={viewer.email}>{viewer.email}<small>{viewer.networkEffectiveType ? ` · ${viewer.networkEffectiveType}` : ""}</small></span>)}</div>
        </section>

        {report.riskReasons?.length ? <section className="surface public-report-warning"><h2>安全提示</h2><p>本次访问命中异常规则：{report.riskReasons.map(riskLabel).join("、")}。系统已记录并通知分享人核查。</p></section> : null}
        {Object.keys(packageErrors).length ? <section className="surface public-report-warning"><h2>部分数据包异常</h2>{Object.entries(packageErrors).map(([key, value]) => <p key={key}>{key}：{text(value)}</p>)}</section> : null}

        <section className="metric-grid">
          {topInsightCards(snapshot).map((card) => <div key={card.label} className="metric-card"><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div>)}
          <div className="metric-card"><span>在线查看</span><strong>{number(onlineViewers?.onlineCount ?? 1)} 人</strong><small>邮箱解锁后计入在线</small></div>
        </section>

        <AiVisualDiagnosis snapshot={snapshot} markdown={text(aiDiagnosis?.markdown)} />

        <section className="two-column wide-left">
          <div className="surface"><div className="surface-title"><div><h2>核心漏斗图</h2><p>和线上漏斗区保持同一阅读顺序，数量来自快照。</p></div><span>{funnel.length} 个节点</span></div><FunnelVisual rows={funnel} /></div>
          <div className="surface"><div className="surface-title"><div><h2>查询进度</h2><p>保留分享时每个数据包的加载结果。</p></div></div><div className="public-report-list">{progress.length ? progress.map((item: AnyRow) => <div key={text(item.key)}><strong>{text(item.label)}</strong><span>{progressStatusLabel(text(item.status))} · {text(item.dataCountLabel)} · {text(item.dateLabel)}</span></div>) : <p>无进度快照</p>}</div></div>
        </section>

        <section className="two-column">
          <div className="surface"><div className="surface-title"><div><h2>页面流失 Top</h2><p>用于看哪个页面承接到资格/机会/展示的流失最大。</p></div></div><PageDropVisual rows={pages} /></div>
          <div className="surface"><div className="surface-title"><div><h2>核心指标</h2><p>来自线上页面已加载的数据包。</p></div></div><div className="table-wrap"><table><tbody>{metrics.length ? metrics.map((row, index) => <tr key={index}><td>{text(row.name ?? row.metricName ?? row.metricKey ?? row.key)}</td><td>{text(row.displayValue ?? row.value ?? row.metricValue)}</td><td>{text(row.status ?? row.trend ?? row.detail)}</td></tr>) : <tr><td>暂无指标快照</td></tr>}</tbody></table></div></div>
        </section>

        <section className="surface"><div className="surface-title"><div><h2>漏斗快照</h2><p>节点、事件/字段、数量、转化/流失。</p></div></div><div className="table-wrap"><table><thead><tr><th>节点</th><th>事件/字段</th><th>数量</th><th>转化/流失</th></tr></thead><tbody>{funnel.length ? funnel.map((row, index) => <tr key={index}><td>{text(row.name ?? row.stepName ?? row.label)}</td><td>{text(row.eventName ?? row.event ?? row.conditionText)}</td><td>{number(row.count ?? row.value ?? row.users ?? row.subjectCount)}</td><td>{text(row.conversionRate ?? row.rate ?? row.lossRate ?? row.note)}</td></tr>) : <tr><td colSpan={4}>暂无漏斗快照</td></tr>}</tbody></table></div></section>

        <section className="surface"><div className="surface-title"><div><h2>页面与流失证据</h2><p>页面到资格、机会、请求、展示的关键断点。</p></div></div><div className="table-wrap"><table><thead><tr><th>页面</th><th>访问/起点</th><th>资格/机会</th><th>请求/展示</th><th>原因</th></tr></thead><tbody>{pages.length ? pages.map((row, index) => <tr key={index}><td>{text(row.screenName ?? row.screen_name)}</td><td>{number(row.pageUsers ?? row.page_users ?? row.users)}</td><td>{number(row.eligibilityCheckUsers ?? row.eligibility_check_users)} / {number(row.opportunityUsers ?? row.opportunity_users)}</td><td>{number(row.requestUsers ?? row.request_users)} / {number(row.impressionUsers ?? row.impression_users)}</td><td>{text(row.blockedReason ?? row.blocked_reason ?? row.worst?.label ?? row.reason)}</td></tr>) : <tr><td colSpan={5}>暂无页面快照</td></tr>}</tbody></table></div></section>

        <section className="surface"><div className="surface-title"><div><h2>事件证据样本</h2><p>用于研发核对 event、screen、result、error/block reason。</p></div></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>页面</th><th>结果</th><th>错误/拦截</th></tr></thead><tbody>{evidence.length ? evidence.map((row, index) => <tr key={index}><td>{text(row.eventTime ?? row.event_time_utc ?? row.eventDate)}</td><td>{text(row.eventName ?? row.event_name)}</td><td>{text(row.screenName ?? row.screen_name)}</td><td>{text(row.resultStatus ?? row.result_status ?? row.qualityStatus)}</td><td>{text(row.blockedReason ?? row.errorCode ?? row.errorMessage ?? row.error_category)}</td></tr>) : <tr><td colSpan={5}>暂无事件证据样本</td></tr>}</tbody></table></div></section>
      </main>
    </div>
  </div>;
}

function ExactRenderedSnapshot({ report }: { report: ShareReport }) {
  const rendered = report.snapshot?.renderedPageSnapshot as RenderedPageSnapshot | undefined;
  const height = Math.max(720, Number(rendered?.documentHeight ?? rendered?.viewportHeight ?? 0));
  return <main className="exact-share-snapshot-page">
    <iframe
      title={report.title || "项目报告页面快照"}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={rendered?.html ?? ""}
      style={{ minHeight: `${height}px` }}
    />
  </main>;
}

export default function ProjectReportSharePage() {
  const shareId = useMemo(shareIdFromUrl, []);
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [report, setReport] = useState<ShareReport | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [onlineViewers, setOnlineViewers] = useState<OnlineViewers | null>(null);

  useEffect(() => {
    if (!shareId) {
      setError("分享链接缺少 sid");
      setLoading(false);
      return;
    }
    publicApi<ShareMeta>(`/api/v3/jkcl-funnel/project-report-shares/${encodeURIComponent(shareId)}/meta`)
      .then(setMeta)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "分享链接读取失败"))
      .finally(() => setLoading(false));
  }, [shareId]);

  async function openReport() {
    setError("");
    const nextEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError("请输入自己的公司邮箱");
      return;
    }
    setOpening(true);
    try {
      const next = await publicApi<ShareReport>(`/api/v3/jkcl-funnel/project-report-shares/${encodeURIComponent(shareId)}/open`, {
        email: nextEmail,
        deviceInfo: collectDeviceInfo(),
      });
      setReport(next);
      setOnlineViewers(next.onlineViewers ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报告打开失败");
    } finally {
      setOpening(false);
    }
  }

  async function heartbeat() {
    if (!report?.viewerEmail) return;
    const next = await publicApi<OnlineViewers>(`/api/v3/jkcl-funnel/project-report-shares/${encodeURIComponent(shareId)}/heartbeat`, {
      email: report.viewerEmail,
      deviceInfo: collectDeviceInfo(),
    });
    setOnlineViewers(next);
  }

  useEffect(() => {
    if (!report?.viewerEmail) return;
    void heartbeat().catch(() => undefined);
    const interval = window.setInterval(() => void heartbeat().catch(() => undefined), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void heartbeat().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [report?.viewerEmail, shareId]);

  const snapshot = report?.snapshot ?? {};
  const metrics = metricRows(snapshot).slice(0, 18);
  const funnel = funnelRows(snapshot).slice(0, 16);
  const pages = pageRows(snapshot).slice(0, 20);
  const evidence = evidenceRows(snapshot).slice(0, 20);
  const progress = Array.isArray(snapshot?.progressItems) ? snapshot.progressItems : [];
  const packageErrors = snapshot?.packageErrors && typeof snapshot.packageErrors === "object" ? snapshot.packageErrors : {};

  if (loading) return <main className="public-report-shell"><section className="public-report-card">正在读取分享链接…</section></main>;
  if (report?.snapshot?.renderedPageSnapshot?.html) return <ExactRenderedSnapshot report={report} />;
  if (report) return <SnapshotReportShell report={report} meta={meta} onlineViewers={onlineViewers} packageErrors={packageErrors} metrics={metrics} funnel={funnel} pages={pages} evidence={evidence} progress={progress} />;

  return <main className="public-report-shell">
    <section className="public-report-card public-report-hero">
      <div>
        <span className="public-report-badge">GeekForest 产品大脑 · 项目报告快照</span>
        <h1>{text(meta?.title ?? report?.title)}</h1>
        <p>这是分享人固定保存的页面查询结果快照。打开报告不会重新查询线上数据，便于产品、运营、研发围绕同一份证据讨论。</p>
      </div>
      <dl>
        <div><dt>项目</dt><dd>{text(meta?.projectCode || report?.projectCode)}</dd></div>
        <div><dt>包名</dt><dd>{text(meta?.appIdentifier || report?.appIdentifier)}</dd></div>
        <div><dt>状态</dt><dd>{meta?.status === "ACTIVE" ? "可查看" : "已终止"}</dd></div>
        <div><dt>创建时间</dt><dd>{text(meta?.createdAt)}</dd></div>
      </dl>
    </section>

    {!report && <section className="public-report-card public-report-unlock">
      <h2>输入公司邮箱查看</h2>
      <p>系统会记录查看邮箱、IP、浏览器/设备信息、网络信息和查看时间。异常访问会通知分享人终止链接。</p>
      {meta?.allowedEmailDomains?.length ? <small>允许邮箱域名：{meta.allowedEmailDomains.join("、")}</small> : null}
      <div className="public-report-form">
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@geekforest.ai" onKeyDown={(event) => { if (event.key === "Enter") void openReport(); }} />
        <button onClick={() => void openReport()} disabled={opening}>{opening ? "验证中…" : "查看报告"}</button>
      </div>
      {meta?.deviceNotice && <p className="public-report-device-note">{meta.deviceNotice}</p>}
      {error && <div className="public-report-error">{error}</div>}
    </section>}

  </main>;
}
