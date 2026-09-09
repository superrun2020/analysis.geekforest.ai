"use client";

import { useEffect, useMemo, useState } from "react";
import { queryFunnel } from "./funnel-analysis-api";

type DomainReportRow = {
  domain: string;
  isDomain: boolean;
  ips: string[];
  ip: string;
  eventCount: number;
  successRate: number | null;
  countryCount: number;
};

type DomainReportData = {
  available: boolean;
  projectCode: string;
  registeredProjects: string[];
  dimension: string;
  rows: DomainReportRow[];
  source?: string;
  notice?: string;
  reason?: string;
};

/** Only these packages are registered for domain -> IP resolution. */
const REPORT_PROJECTS = [
  { projectCode: "A003", appName: "RocketSpace: VPN Proxy", appIdentifier: "com.rocket.space.vpn" },
  { projectCode: "A005", appName: "A005", appIdentifier: "" },
  { projectCode: "C002", appName: "C002", appIdentifier: "" },
];

function dateRange(range: string) {
  const exactDate = range.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (exactDate) return { dateFrom: exactDate, dateTo: exactDate };
  const end = new Date();
  const start = new Date(end);
  if (range === "昨天") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (range === "近7天") { start.setDate(start.getDate() - 7); end.setDate(end.getDate() - 1); }
  if (range === "近30天") { start.setDate(start.getDate() - 30); end.setDate(end.getDate() - 1); }
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { dateFrom: iso(start), dateTo: iso(end) };
}

function numberValue(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "—";
}

function percentValue(value: unknown): string {
  const n = Number(value ?? null);
  return n === null || Number.isNaN(n) ? "—" : `${n.toFixed(1)}%`;
}

export function DomainReportPage({ range, refreshKey }: { range: string; refreshKey: number }) {
  const [projectCode, setProjectCode] = useState("A003");
  const [view, setView] = useState<"all" | "domain" | "ip">("all");
  const [data, setData] = useState<DomainReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const dates = dateRange(range);
    queryFunnel<{ domainReport: DomainReportData }>({
      page: "domain_report",
      ...dates,
      projectCode,
      platform: "android",
      dimension: "domain",
      unit: "users",
    }, controller.signal)
      .then((result) => { if (active) setData(result.domainReport ?? null); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "查询失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [projectCode, range, refreshKey]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (view === "domain") return all.filter((row) => row.isDomain);
    if (view === "ip") return all.filter((row) => !row.isDomain);
    return all;
  }, [data, view]);

  const domainCount = (data?.rows ?? []).filter((row) => row.isDomain).length;
  const ipCount = (data?.rows ?? []).filter((row) => !row.isDomain).length;

  return <div className="page-stack domain-report-page">
    <div className="domain-report-layout">
      <div className="domain-report-main">
        {loading && <div className="version-compare-loading">正在读取域名并解析 IP…</div>}
        {error && <div className="version-compare-loading warn">{error}</div>}
        {!loading && !error && <section className="surface"><div className="table-wrap"><table className="version-compare-table domain-report-table">
          <thead><tr>
            <th>域名 / IP</th>
            <th>类型</th>
            <th>解析出的 IP</th>
            <th>连接数</th>
            <th>成功率</th>
            <th>覆盖国家</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.domain}>
            <td><strong>{row.domain}</strong></td>
            <td>{row.isDomain ? <span className="domain-badge">域名</span> : <span className="ip-badge">IP</span>}</td>
            <td>{row.ips.length ? row.ips.join(", ") : <span className="muted">解析失败</span>}</td>
            <td>{numberValue(row.eventCount)}</td>
            <td>{percentValue(row.successRate)}</td>
            <td>{numberValue(row.countryCount)}</td>
          </tr>)}</tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={6}><strong>共 {rows.length} 条</strong><small>域名 {domainCount} 条 · 直接 IP {ipCount} 条</small></td></tr></tfoot>}
        </table></div><div className="version-compare-footnote">数据源：{data?.source ?? "—"}；{data?.notice ?? ""}</div></section>}
        {!loading && !error && rows.length === 0 && <section className="surface"><div className="empty-table-state"><strong>当前筛选范围没有可解析的域名</strong><span>请确认项目有上报数据，并选择包含数据的日期范围。</span></div></section>}
      </div>

      <aside className="version-compare-config surface domain-report-config">
        <div className="config-group">
          <div className="config-title">项目（特别注册）</div>
          <select className="config-select" value={projectCode} onChange={(event) => setProjectCode(event.target.value)}>
            {REPORT_PROJECTS.map((project) => <option key={project.projectCode} value={project.projectCode}>{project.projectCode}{project.appName !== project.projectCode ? ` · ${project.appName}` : ""}</option>)}
          </select>
          <small className="config-hint">仅 A003 / A005 / C002 参与本报表，不做全量项目。</small>
        </div>
        <div className="config-group">
          <div className="config-title">展示范围</div>
          <div className="config-options">
            {[["all", "全部"], ["domain", "仅域名"], ["ip", "仅 IP"]].map(([key, label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key as "all" | "domain" | "ip")}>{label}</button>)}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}
