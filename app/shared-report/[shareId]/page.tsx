"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackingApiBaseUrl } from "../../api-base-url";

type PageProps = { params: { shareId: string } };
type ShareMeta = {
  shareId: string;
  title: string;
  projectCode?: string;
  domain?: string;
  unit?: string;
  status?: string;
  accessCount?: number;
  maxAccessCount?: number;
  remainingAccessCount?: number;
  createdAt?: string;
  lastAccessedAt?: string;
};
type ShareReport = ShareMeta & {
  markdown: string;
  openedAt?: string;
};

async function publicApi<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const baseUrl = trackingApiBaseUrl();
  if (!baseUrl) throw new Error("报告服务地址未配置");
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.msg || payload.error || `报告接口 HTTP ${response.status}`);
  }
  return payload.data ?? payload;
}

function domainLabel(domain?: string) {
  if (domain === "vpn") return "VPN 功能";
  if (domain === "quality") return "数据质量";
  return "广告漏斗";
}

function formatTime(value?: string) {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d+Z?$/, "").slice(0, 19);
}

export default function SharedReportPage({ params }: PageProps) {
  const shareId = params.shareId;
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [password, setPassword] = useState("");
  const [report, setReport] = useState<ShareReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");
  const autoOpened = useRef(false);

  const passwordFromUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("password") ?? "";
  }, []);

  async function loadMeta() {
    setLoading(true);
    setMessage("");
    try {
      const next = await publicApi<ShareMeta>(`/api/v3/jkcl-funnel/shared-reports/${encodeURIComponent(shareId)}/meta`);
      setMeta(next);
      if ((next.status ?? "").toUpperCase() === "EXPIRED") {
        setMessage("这个分享链接已经失效，请让报告创建人重新生成。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "报告链接不可用");
    } finally {
      setLoading(false);
    }
  }

  async function openReport(nextPassword = password) {
    if (!nextPassword.trim()) {
      setMessage("请输入访问密码。");
      return;
    }
    setOpening(true);
    setMessage("");
    try {
      const next = await publicApi<ShareReport>(`/api/v3/jkcl-funnel/shared-reports/${encodeURIComponent(shareId)}/open`, { password: nextPassword.trim() });
      setReport(next);
      setMeta(next);
      if (typeof window !== "undefined" && window.location.search.includes("password=")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? error.message : "报告打开失败");
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, [shareId]);

  useEffect(() => {
    if (autoOpened.current || loading || !passwordFromUrl) return;
    autoOpened.current = true;
    setPassword(passwordFromUrl);
    void openReport(passwordFromUrl);
  }, [loading, passwordFromUrl]);

  return <main className="shared-report-shell">
    <section className="shared-report-card">
      <header className="shared-report-header">
        <div className="shared-report-brand"><span>GF</span><strong>GeekForest 产品大脑</strong></div>
        <div>
          <h1>{meta?.title || "AI 诊断报告"}</h1>
          <p>外部分享报告无需系统登录，但需要访问密码；每个链接最多成功打开 3 次。</p>
        </div>
      </header>

      {loading && <div className="shared-report-state">正在读取报告状态…</div>}

      {!loading && meta && <div className="shared-report-meta">
        <div><span>项目</span><strong>{meta.projectCode || "—"}</strong></div>
        <div><span>报告类型</span><strong>{domainLabel(meta.domain)}</strong></div>
        <div><span>剩余次数</span><strong>{meta.remainingAccessCount ?? 0}/{meta.maxAccessCount ?? 3}</strong></div>
        <div><span>生成时间</span><strong>{formatTime(meta.createdAt)}</strong></div>
      </div>}

      {!report && !loading && <form className="shared-report-unlock" onSubmit={(event) => { event.preventDefault(); void openReport(); }}>
        <label>
          访问密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入复制链接时附带的密码" autoComplete="off" />
        </label>
        <button className="primary-button" disabled={opening || (meta?.status ?? "").toUpperCase() === "EXPIRED"}>{opening ? "正在打开…" : "打开报告"}</button>
        <small>密码错误不会扣次数；报告成功打开一次才扣 1 次。</small>
      </form>}

      {message && <div className="shared-report-message">{message}</div>}

      {report && <article className="shared-report-content">
        <div className="shared-report-opened">
          <span>已打开：{report.accessCount}/{report.maxAccessCount}</span>
          <span>剩余：{report.remainingAccessCount}</span>
          <span>打开时间：{formatTime(report.openedAt)}</span>
        </div>
        <pre>{report.markdown}</pre>
      </article>}
    </section>
  </main>;
}
