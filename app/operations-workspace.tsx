"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { getCompanyAuthToken } from "./company-auth";

export type OperationsEntry = "overview" | "projects" | "issues" | "monitoring";
export type OperationsPage = "overview" | "team" | "projects" | "issues" | "alerts" | "acceptance" | "rules" | "runs" | "status";

export const operationsEntries: Array<{ key: OperationsEntry; label: string; pages: Array<{ key: OperationsPage; label: string }> }> = [
  { key: "overview", label: "运营总览", pages: [{ key: "overview", label: "经营" }, { key: "team", label: "团队" }] },
  { key: "projects", label: "项目管理", pages: [{ key: "projects", label: "项目" }] },
  { key: "issues", label: "问题跟进", pages: [{ key: "issues", label: "问题" }, { key: "alerts", label: "告警" }, { key: "acceptance", label: "验收" }] },
  { key: "monitoring", label: "自动监控", pages: [{ key: "rules", label: "规则" }, { key: "runs", label: "运行" }, { key: "status", label: "状态" }] },
];

const allPages = new Set(operationsEntries.flatMap((entry) => entry.pages.map((page) => page.key)));

export function OperationsWorkspace({ active, entry, initialPage }: { active: boolean; entry: OperationsEntry; initialPage?: string | null }) {
  const [state, setState] = useState<"idle" | "opening" | "ready" | "failed">("idle");
  const [slow, setSlow] = useState(false);
  const [bootstrapCount, setBootstrapCount] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const initial = initialPage && allPages.has(initialPage as OperationsPage) ? initialPage as OperationsPage : null;
  const [page, setPage] = useState<OperationsPage>(initial ?? operationsEntries.find((item) => item.key === entry)?.pages[0].key ?? "overview");
  const iframe = useRef<HTMLIFrameElement>(null);
  const opened = useRef(false);
  const previousEntry = useRef(entry);
  const selectedEntry = operationsEntries.find((item) => item.key === entry) ?? operationsEntries[0];

  useEffect(() => {
    if (previousEntry.current === entry) return;
    previousEntry.current = entry;
    setPage(selectedEntry.pages[0].key);
  }, [entry, selectedEntry.pages]);

  useEffect(() => {
    if (!active || opened.current) return;
    opened.current = true; setState("opening"); setBootstrapCount((count) => count + 1);
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => setSlow(true), 2500);
    fetch("/operations/session", { method: "POST", credentials: "include", signal: controller.signal, headers: { Authorization: `Bearer ${getCompanyAuthToken()}` } })
      .then((response) => { if (!response.ok) throw new Error(`HTTP_${response.status}`); setState("ready"); })
      .catch((error) => { if (error?.name !== "AbortError") { opened.current = false; setState("failed"); } })
      .finally(() => { window.clearTimeout(slowTimer); setSlow(false); });
    return () => { window.clearTimeout(slowTimer); controller.abort(); };
  }, [active, retryGeneration]);

  useEffect(() => {
    if (state !== "ready" || !iframe.current?.contentWindow) return;
    try { iframe.current.contentWindow.location.hash = `/${page}`; } catch { /* same-origin frame becomes available on load */ }
  }, [page, state]);

  return <section className="operations-workspace" style={{ display: active ? "block" : "none" }} data-bootstrap-count={bootstrapCount}>
    {state === "opening" && <div className="operations-state">正在建立安全运营会话…{slow && <small>运营服务连接较慢，请稍候；不会重复初始化。</small>}</div>}
    {state === "failed" && <div className="operations-state error"><strong>运营服务暂不可用</strong><span>可能是权限已变更或服务暂时离线。</span><Button onClick={() => { opened.current = false; setState("idle"); setRetryGeneration((value) => value + 1); }}>重试</Button></div>}
    {state === "ready" && <>
      <nav className="operations-subnav" aria-label={`${selectedEntry.label}子页面`}>
        {selectedEntry.pages.map((item) => <Button key={item.key} type={page === item.key ? "primary" : "default"} aria-current={page === item.key ? "page" : undefined} onClick={() => setPage(item.key)}>{item.label}</Button>)}
      </nav>
      <iframe ref={iframe} title="运营管理" src="/operations/?embedded=1#/overview" onLoad={() => { try { if (iframe.current?.contentWindow) iframe.current.contentWindow.location.hash = `/${page}`; } catch {} }} />
    </>}
  </section>;
}
