import { getCompanyAuthToken } from "./company-auth";
import { trackingApiBaseUrl } from "./api-base-url";

export type CodexQueryLinkPayload = {
  projectCode: string;
  appIdentifier?: string;
  dateFrom: string;
  dateTo: string;
  platform?: "android" | "ios";
  country?: string;
  appVersion?: string;
};

export type CodexQueryLinks = {
  projectCode: string;
  dateFrom: string;
  dateTo: string;
  platform?: string | null;
  expiresAt: string;
  links: {
    ads?: { label: string; url: string; domain: "ads"; expiresAt: string };
    vpn?: { label: string; url: string; domain: "vpn"; expiresAt: string };
  };
  copyText: string;
};

export async function createCodexQueryLinks(payload: CodexQueryLinkPayload): Promise<CodexQueryLinks> {
  const baseUrl = trackingApiBaseUrl();
  if (!baseUrl) throw new Error("未配置 Codex 查询接口");
  const token = getCompanyAuthToken();
  if (!token) throw new Error("登录已失效，请重新登录");

  const response = await fetch(`${baseUrl}/api/v3/jkcl-funnel/codex-links`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...payload, apiBaseUrl: baseUrl }),
  });
  const result = await response.json().catch(() => ({})) as { code?: number; msg?: string; error?: string; data?: CodexQueryLinks };
  if (!response.ok || (result.code !== undefined && result.code !== 0)) {
    throw new Error(result.msg || result.error || `Codex 查询接口返回 HTTP ${response.status}`);
  }
  if (!result.data?.copyText) throw new Error("Codex 查询接口未返回可复制链接");
  return result.data;
}
