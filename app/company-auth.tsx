"use client";

import { useEffect, useState } from "react";

const oaBaseUrl = (process.env.NEXT_PUBLIC_OA_API_BASE_URL ?? "https://oa.geekforest.ai").replace(/\/$/, "");
const tokenKey = "jkcl_funnel_oa_token";

type AuthUser = { email: string; employee?: { name?: string; status?: string } };
type AuthResult = { token?: string; user?: AuthUser; error?: string };

const errorMessages: Record<string, string> = {
  jkcl_company_email_required: "仅支持 @geekforest.ai 企业邮箱。",
  jkcl_employee_forbidden: "该邮箱不是极客主体在职员工，请联系 HRBP 核对员工档案。",
  business_entity_account_forbidden: "OA 未找到有效员工账号，请联系 HRBP。",
  verification_code_expired: "验证码已过期，请重新获取。",
  verification_code_incorrect: "验证码不正确，请检查后重试。",
  account_not_found: "OA 未找到该企业邮箱对应的员工账号。",
};

async function authRequest(path: string, body?: Record<string, unknown>, token?: string) {
  const response = await fetch(`${oaBaseUrl}${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as AuthResult;
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

export function useCompanyAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem(tokenKey);
    if (!token) {
      setChecking(false);
      return;
    }
    authRequest("/api/auth/me", undefined, token)
      .then((result) => setUser(result.user ?? null))
      .catch(() => sessionStorage.removeItem(tokenKey))
      .finally(() => setChecking(false));
  }, []);

  return {
    user,
    checking,
    signIn(result: AuthResult) {
      if (!result.token || !result.user) throw new Error("登录结果不完整");
      sessionStorage.setItem(tokenKey, result.token);
      setUser(result.user);
    },
    async signOut() {
      const token = sessionStorage.getItem(tokenKey) ?? "";
      sessionStorage.removeItem(tokenKey);
      setUser(null);
      if (token) await authRequest("/api/auth/logout", {}, token).catch(() => undefined);
    },
  };
}

export function CompanyLogin({ onSignedIn }: { onSignedIn: (result: AuthResult) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized.endsWith("@geekforest.ai")) {
      setMessage(errorMessages.jkcl_company_email_required);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await authRequest("/api/auth/request-code", { email: normalized, audience: "jkcl_funnel" });
      setEmail(normalized);
      setStep("code");
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "验证失败，请稍后重试或联系 HRBP。");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage("请输入企业邮箱收到的 6 位验证码。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await authRequest("/api/auth/login-code", { email, code, audience: "jkcl_funnel" });
      onSignedIn(result);
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return <main className="company-login-shell"><section className="company-login-card">
    <div className="company-login-brand"><span>JK</span><div><strong>JKCL 漏斗分析中心</strong><small>企业内部数据平台</small></div></div>
    <div className="company-login-copy"><h1>{step === "email" ? "使用企业邮箱登录" : "输入邮箱验证码"}</h1><p>{step === "email" ? "系统将通过 OA/HRBP 核验极客主体在职员工身份。" : `验证码已发送至 ${email}`}</p></div>
    {step === "email" ? <form onSubmit={submitEmail}><label>企业邮箱<input autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@geekforest.ai" required /></label><button disabled={loading}>{loading ? "正在验证…" : "获取登录验证码"}</button></form> : <form onSubmit={submitCode}><label>6 位验证码<input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required /></label><button disabled={loading}>{loading ? "正在登录…" : "登录漏斗分析中心"}</button><button type="button" className="login-back" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>更换邮箱</button></form>}
    {message && <div className="company-login-error" role="alert">{message}</div>}
    <div className="company-login-policy"><strong>身份验证规则</strong><span>@geekforest.ai 企业邮箱</span><span>极客主体员工</span><span>当前在职</span></div>
  </section></main>;
}
