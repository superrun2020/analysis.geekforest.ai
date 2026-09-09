"use client";

import { useEffect, useState } from "react";
import { trackingApiBaseUrl } from "./api-base-url";
import { getCompanyAuthToken } from "./company-auth";

type AlertRow = {
  id: number;
  shareId: string;
  projectCode: string;
  title: string;
  alertType: string;
  alertLevel: string;
  message: string;
  evidence: Record<string, any>;
  status: string;
  shareStatus: string;
  riskStatus: string;
  createdByEmail: string;
  emailSent: boolean;
  emailError?: string;
  createdAt: string;
};

type AlertsResponse = {
  items: AlertRow[];
  total: number;
  summary?: { open: number; high: number };
};

type Envelope<T> = { code?: number; msg?: string; data?: T; error?: string };

async function internalApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");
  const response = await fetch(`${trackingApiBaseUrl()}${path}`, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) throw new Error(payload.msg || payload.error || `接口返回 HTTP ${response.status}`);
  if (!payload.data) throw new Error("接口未返回数据");
  return payload.data;
}

function typeLabel(type: string) {
  return {
    BAD_EMAIL: "非公司邮箱访问",
    SUSPICIOUS_ACCESS: "异常访问",
    REVOKED_ACCESS: "失效链接访问",
    MULTI_EMAIL: "多个邮箱访问",
    MULTI_IP: "多个 IP 访问",
  }[type] ?? type;
}

function riskReasonLabel(reason: string) {
  return {
    multiple_viewer_emails: "同一链接出现多个查看邮箱",
    multiple_access_ips: "同一链接出现多个访问 IP",
    multiple_device_platforms: "同一链接出现多个设备平台",
    non_company_email: "非公司邮箱尝试访问",
    revoked_or_expired_access: "终止/失效链接仍被访问",
  }[reason] ?? reason;
}

export function ShareAlertsPage({ projectCode, notify }: { projectCode: string; notify: (message: string) => void }) {
  const [status, setStatus] = useState("OPEN");
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status, pageSize: "50" });
      if (projectCode && projectCode !== "全部项目") params.set("projectCode", projectCode);
      setData(await internalApi<AlertsResponse>(`/api/v3/jkcl-funnel/project-report-shares/alerts?${params.toString()}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "异常报警读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(shareId: string) {
    try {
      await internalApi(`/api/v3/jkcl-funnel/project-report-shares/${encodeURIComponent(shareId)}/revoke`, { method: "POST", body: "{}" });
      notify(`已终止分享链接 ${shareId}`);
      void load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "终止链接失败");
    }
  }

  useEffect(() => { void load(); }, [status, projectCode]);

  return <div className="page-stack">
    <section className="surface share-alert-head">
      <div>
        <h2>异常报警</h2>
        <p>监控项目报告分享链接的异常访问：非公司邮箱、多邮箱、多 IP、多设备、失效链接访问。命中规则后会写入告警，并尝试邮件通知分享人与固定抄送人。</p>
      </div>
      <div className="share-alert-summary">
        <div><span>待处理</span><strong>{data?.summary?.open ?? 0}</strong></div>
        <div><span>高危</span><strong>{data?.summary?.high ?? 0}</strong></div>
        <button className="primary-button" onClick={() => void load()}>{loading ? "刷新中…" : "刷新告警"}</button>
      </div>
    </section>
    <section className="surface">
      <div className="surface-title">
        <div><h2>分享安全事件</h2><p>出现异常时优先终止链接，然后让分享人重新生成。</p></div>
        <div className="dimension-tabs"><button className={status === "OPEN" ? "active" : ""} onClick={() => setStatus("OPEN")}>待处理</button><button className={status === "ALL" ? "active" : ""} onClick={() => setStatus("ALL")}>全部</button></div>
      </div>
      {error && <div className="firebase-log-state warn"><strong>异常报警接口不可用</strong><p>{error}</p></div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>项目/报告</th><th>异常类型</th><th>访问证据</th><th>邮件</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{data?.items?.length ? data.items.map((item) => <tr key={item.id} className={item.alertLevel === "HIGH" ? "row-bad" : "row-warn"}>
            <td>{item.createdAt}</td>
            <td><strong>{item.projectCode || "—"}</strong><small>{item.title || item.shareId}</small></td>
            <td><strong>{typeLabel(item.alertType)}</strong><small>{item.message}</small></td>
            <td><div className="share-alert-evidence"><span>邮箱：{item.evidence?.viewerEmail || "—"}</span><span>IP：{item.evidence?.ip || "—"}</span><span>原因：{(item.evidence?.riskReasons ?? []).map(riskReasonLabel).join("、") || "—"}</span></div></td>
            <td>{item.emailSent ? "已发送" : item.emailError ? `失败：${item.emailError}` : "待发送/未配置"}</td>
            <td>{item.status === "OPEN" ? "待处理" : "已处理"} · 链接{item.shareStatus === "REVOKED" ? "已终止" : "可访问"}</td>
            <td><button className="danger-link-button" disabled={item.shareStatus === "REVOKED"} onClick={() => void revoke(item.shareId)}>终止链接</button></td>
          </tr>) : <tr><td colSpan={7}><div className="empty-table-state"><strong>暂无异常报警</strong><span>当前筛选下没有发现项目报告分享泄漏风险。</span></div></td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
