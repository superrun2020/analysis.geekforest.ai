"use client";

import { useEffect, useState } from "react";

const oaBaseUrl = (process.env.NEXT_PUBLIC_OA_API_BASE_URL ?? "").replace(/\/$/, "");
export const companyAuthTokenKey = "jkcl_funnel_oa_token";
const companyAuthExpiresAtKey = "jkcl_funnel_oa_expires_at";

/** Return the device-scoped OA token while its server-issued expiry remains valid. */
export function getCompanyAuthToken() {
  if (typeof window === "undefined") return "";
  const token = localStorage.getItem(companyAuthTokenKey) ?? "";
  const expiresAt = Date.parse(localStorage.getItem(companyAuthExpiresAtKey) ?? "");
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    localStorage.removeItem(companyAuthTokenKey);
    localStorage.removeItem(companyAuthExpiresAtKey);
    return "";
  }
  return token;
}

type AuthUser = { email: string; mustChangePassword?: boolean; employee?: { name?: string; status?: string } };
type AuthResult = { token?: string; user?: AuthUser; expiresAt?: string; trustedDevice?: boolean; error?: string };

const errorMessages: Record<string, string> = {
  jkcl_company_email_required: "仅支持 @geekforest.ai 企业邮箱。",
  jkcl_employee_forbidden: "该邮箱不是极客主体在职员工，请联系 HRBP 核对员工档案。",
  business_entity_account_forbidden: "OA 未找到有效员工账号，请联系 HRBP。",
  verification_code_expired: "验证码已过期，请重新获取。",
  verification_code_incorrect: "验证码不正确，请检查后重试。",
  verification_code_send_failed: "验证码发送失败，请稍后重试或联系技术检查统一发信服务。",
  missing_email_or_code: "请输入企业邮箱和 6 位验证码。",
  account_not_found: "OA 未找到该企业邮箱对应的员工账号。",
  missing_email_or_password: "请输入企业邮箱和密码。",
  password_incorrect: "密码不正确。首次登录请使用企业邮箱作为初始密码。",
  old_password_incorrect: "原密码不正确，请重新登录后再修改。",
  password_too_short: "新密码至少 8 位，建议包含字母和数字。",
  password_same_as_email: "新密码不能继续使用企业邮箱，请换一个更安全的密码。",
  auth_network_error: "验证接口连接失败，请稍后重试；如果一直失败请联系技术检查 OA 登录代理。",
  auth_proxy_unavailable: "OA 登录代理暂时不可用，请稍后重试。",
};

async function authRequest(path: string, body?: Record<string, unknown>, token?: string) {
  let response: Response;
  try {
    response = await fetch(`${oaBaseUrl}${path}`, {
      method: body ? "POST" : "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("auth_network_error");
  }
  const payload = await response.json().catch(() => ({})) as AuthResult;
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

export function useCompanyAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getCompanyAuthToken();
    if (!token) {
      setChecking(false);
      return;
    }
    authRequest("/api/auth/me", undefined, token)
      .then((result) => setUser(result.user ?? null))
      .catch(() => {
        localStorage.removeItem(companyAuthTokenKey);
        localStorage.removeItem(companyAuthExpiresAtKey);
      })
      .finally(() => setChecking(false));
  }, []);

  return {
    user,
    checking,
    signIn(result: AuthResult) {
      if (!result.token || !result.user) throw new Error("登录结果不完整");
      if (!result.expiresAt || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("登录有效期缺失");
      localStorage.setItem(companyAuthTokenKey, result.token);
      localStorage.setItem(companyAuthExpiresAtKey, result.expiresAt);
      setUser(result.user);
    },
    async signOut() {
      const token = localStorage.getItem(companyAuthTokenKey) ?? "";
      localStorage.removeItem(companyAuthTokenKey);
      localStorage.removeItem(companyAuthExpiresAtKey);
      setUser(null);
      if (token) await authRequest("/api/auth/logout", {}, token).catch(() => undefined);
    },
  };
}

export function CompanyLogin({ onSignedIn }: { onSignedIn: (result: AuthResult) => void }) {
  const [loginMode, setLoginMode] = useState<"code" | "password">("code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pendingResult, setPendingResult] = useState<AuthResult | null>(null);
  const [step, setStep] = useState<"login" | "changePassword">("login");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  function validateCompanyEmail() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.endsWith("@geekforest.ai")) {
      setMessage(errorMessages.jkcl_company_email_required);
      return "";
    }
    return normalized;
  }

  async function requestLoginCode() {
    if (sendingCode || codeCooldown > 0) return;
    const normalized = validateCompanyEmail();
    if (!normalized) return;
    setSendingCode(true);
    setMessage("");
    try {
      const result = await authRequest("/api/auth/request-code", { email: normalized, audience: "jkcl_funnel" }) as AuthResult & { expiresInMinutes?: number };
      setEmail(normalized);
      setCodeCooldown(60);
      setMessage(`验证码已发送到 ${normalized}，${Number(result.expiresInMinutes || 10)} 分钟内有效。`);
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "验证码发送失败，请稍后重试。");
    } finally {
      setSendingCode(false);
    }
  }

  async function submitCodeLogin(event: React.FormEvent) {
    event.preventDefault();
    const normalized = validateCompanyEmail();
    if (!normalized) return;
    const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6) {
      setMessage("请输入邮件中的 6 位验证码。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await authRequest("/api/auth/login-code", { email: normalized, code: normalizedCode, audience: "jkcl_funnel", trustedDevice: true });
      onSignedIn(result);
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "验证码登录失败，请稍后重试或联系 HRBP。");
    } finally {
      setLoading(false);
    }
  }

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized.endsWith("@geekforest.ai")) {
      setMessage(errorMessages.jkcl_company_email_required);
      return;
    }
    if (!password) {
      setMessage(errorMessages.missing_email_or_password);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await authRequest("/api/auth/login", { email: normalized, password, audience: "jkcl_funnel", trustedDevice: true });
      setEmail(normalized);
      if (result.user?.mustChangePassword) {
        setPendingResult(result);
        setStep("changePassword");
        setMessage("你当前仍在使用初始密码。为保护数据安全，请先修改密码。");
        return;
      }
      onSignedIn(result);
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "登录失败，请稍后重试或联系 HRBP。");
    } finally {
      setLoading(false);
    }
  }

  async function submitChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingResult?.token) {
      setMessage("登录状态不完整，请返回重新登录。");
      return;
    }
    if (newPassword.length < 8) {
      setMessage(errorMessages.password_too_short);
      return;
    }
    if (newPassword.trim().toLowerCase() === email.trim().toLowerCase()) {
      setMessage("新密码不能继续使用企业邮箱，请换一个更安全的密码。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致，请重新输入。");
      return;
    }
    setLoading(true);
    setMessage("正在保存新密码…");
    try {
      await authRequest("/api/auth/change-password", { oldPassword: password, newPassword }, pendingResult.token);
      onSignedIn({ ...pendingResult, user: pendingResult.user ? { ...pendingResult.user, mustChangePassword: false } : pendingResult.user });
    } catch (error) {
      const codeValue = error instanceof Error ? error.message : "unknown";
      setMessage(errorMessages[codeValue] ?? "密码修改失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return <main className="company-login-shell"><section className="company-login-card">
    <div className="company-login-brand"><span>GF</span><div><strong>GeekForest 产品大脑</strong><small>企业内部数据平台</small></div></div>
    <div className="company-login-copy"><h1>{step === "login" ? "使用企业账号登录" : "首次登录请修改密码"}</h1><p>{step === "login" ? "使用企业邮箱验证码或密码登录；系统会通过 OA/HRBP 核验极客主体在职员工身份。" : `当前账号：${email}`}</p></div>
    {step === "login" && <div className="company-login-tabs" role="tablist" aria-label="登录方式"><button type="button" role="tab" aria-selected={loginMode === "code"} className={loginMode === "code" ? "active" : ""} onClick={() => { setLoginMode("code"); setMessage(""); }}>验证码登录</button><button type="button" role="tab" aria-selected={loginMode === "password"} className={loginMode === "password" ? "active" : ""} onClick={() => { setLoginMode("password"); setMessage(""); }}>密码登录</button></div>}
    {step === "login" && loginMode === "code" ? <form onSubmit={submitCodeLogin}>
      <label>企业邮箱<input autoFocus type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@geekforest.ai" required /></label>
      <label>邮箱验证码<div className="company-code-row"><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入 6 位验证码" required /><button type="button" disabled={sendingCode || codeCooldown > 0} onClick={() => void requestLoginCode()}>{sendingCode ? "发送中…" : codeCooldown > 0 ? `${codeCooldown}s 后重发` : "获取验证码"}</button></div></label>
      <button disabled={loading}>{loading ? "正在验证…" : "登录漏斗分析中心"}</button>
    </form> : step === "login" ? <form onSubmit={submitLogin}>
      <label>企业邮箱<input autoFocus type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@geekforest.ai" required /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="首次登录请输入企业邮箱" required /></label>
      <button disabled={loading}>{loading ? "正在登录…" : "登录漏斗分析中心"}</button>
    </form> : <form onSubmit={submitChangePassword}>
      <label>新密码<input autoFocus type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位，不能等于邮箱" required /></label>
      <label>确认新密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" required /></label>
      <button disabled={loading}>{loading ? "正在保存…" : "保存新密码并进入系统"}</button>
      <button type="button" className="login-back" onClick={() => { setStep("login"); setPendingResult(null); setNewPassword(""); setConfirmPassword(""); setMessage(""); }}>返回登录</button>
    </form>}
    {message && <div className="company-login-error" role="alert">{message}</div>}
    <div className="company-login-policy"><strong>身份验证规则</strong><span>@geekforest.ai 企业邮箱</span><span>极客主体员工</span><span>当前在职</span><span>离职自动失效</span><span>本设备 30 天免登录</span></div>
  </section></main>;
}
