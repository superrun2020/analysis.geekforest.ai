const scanDateKey = "jkcl_local_vpn_node_scan_date";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

/** Trigger one non-blocking local scan after the first successful login of each day. */
export async function scanVpnNodesOnceToday() {
  if (localStorage.getItem(scanDateKey) === today()) return;
  const response = await fetch("/api/local/vpn-node-scan", { method: "POST" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP_${response.status}`);
  localStorage.setItem(scanDateKey, today());
  window.dispatchEvent(new CustomEvent("jkcl:vpn-node-scan-complete", { detail: result }));
}

type SupplementalRow = { statDate: string; projectCode: string; serverId: string; attempts: number; results: number; successes: number; failures: number; connectionSuccessRate: number | null; resultCoverageRate: number | null };

/** Add locally calculated rows only when the remote aggregate has not produced that date/node yet. */
export async function mergeLocalVpnRows<T extends Record<string, any>>(result: T, config: { projectCode: string; dateFrom: string; dateTo: string; dimensions: string[] }): Promise<T> {
  if (config.dimensions.some((item) => !["stat_date", "server_id"].includes(item))) return result;
  const response = await fetch("/api/local/vpn-node-scan");
  if (!response.ok) return result;
  const cache = await response.json().catch(() => ({ rows: [] }));
  const report = result.serverVpnOverall;
  if (!report || !Array.isArray(report.rows)) return result;
  const existing = new Set(report.rows.map((row: any) => `${row.dimensionValues?.stat_date || ""}|${row.serverId || row.dimensionValues?.server_id || ""}`));
  const additions = (cache.rows as SupplementalRow[]).filter((row) => row.projectCode === config.projectCode && row.statDate >= config.dateFrom && row.statDate <= config.dateTo && !existing.has(`${row.statDate}|${row.serverId}`)).map((row) => ({
    rowKey: `local-${row.statDate}-${row.serverId}`, dimensions: config.dimensions,
    dimensionValues: Object.fromEntries(config.dimensions.map((key) => [key, key === "stat_date" ? row.statDate : row.serverId])),
    dimensionLabel: config.dimensions.map((key) => key === "stat_date" ? row.statDate : row.serverId).join(" × "),
    serverId: row.serverId, nodeName: row.serverId, nodeHost: row.serverId, inventoryMatched: false, poolMatched: false,
    vpnSessionCount: 0, connectionAttemptCount: row.attempts, connectionResultCount: row.results,
    connectionSuccessCount: row.successes, connectionFailedCount: row.failures,
    connectionSuccessRate: row.connectionSuccessRate, resultCoverageRate: row.resultCoverageRate,
    status: row.results === 0 ? "unavailable" : (row.connectionSuccessRate ?? 0) < 30 ? "bad" : (row.connectionSuccessRate ?? 0) < 60 ? "warn" : "good",
    localSupplement: true,
  }));
  if (!additions.length) return result;
  const extra = additions.reduce((sum, row) => ({ attempts: sum.attempts + row.connectionAttemptCount, results: sum.results + row.connectionResultCount, successes: sum.successes + row.connectionSuccessCount, failures: sum.failures + row.connectionFailedCount }), { attempts: 0, results: 0, successes: 0, failures: 0 });
  const totals = { ...(report.totals || {}) };
  totals.nodeCount = new Set([...report.rows, ...additions].map((row: any) => row.serverId || row.dimensionValues?.server_id).filter(Boolean)).size;
  totals.connectionAttemptCount = Number(totals.connectionAttemptCount || 0) + extra.attempts;
  totals.connectionResultCount = Number(totals.connectionResultCount || 0) + extra.results;
  totals.connectionSuccessCount = Number(totals.connectionSuccessCount || 0) + extra.successes;
  totals.connectionFailedCount = Number(totals.connectionFailedCount || 0) + extra.failures;
  totals.connectionSuccessRate = totals.connectionResultCount ? Math.round(totals.connectionSuccessCount / totals.connectionResultCount * 10000) / 100 : null;
  totals.resultCoverageRate = totals.connectionAttemptCount ? Math.round(totals.connectionResultCount / totals.connectionAttemptCount * 10000) / 100 : null;
  return { ...result, serverVpnOverall: { ...report, available: true, rows: [...report.rows, ...additions], totals, totalGroupedRows: Number(report.totalGroupedRows || report.rows.length) + additions.length,
    source: `${report.source} + 本地首次登录扫描`, notice: `${report.notice || ""} 新节点缺失数据由本地只读扫描临时补充。` } };
}

export async function mergeLocalVpnHourlyRows<T extends Record<string, any>>(result: T, config: { projectCode: string; dateFrom: string; dateTo: string; serverId?: string }): Promise<T> {
  const response = await fetch("/api/local/vpn-node-scan");
  if (!response.ok) return result;
  const cache = await response.json().catch(() => ({ hourlyRows: [] }));
  const report = result.serverVpnHourlyOverall;
  if (!report) return result;
  const current = Array.isArray(report.rows) ? report.rows : [];
  const existing = new Set(current.map((row: any) => `${row.statHour}|${row.serverId}`));
  const additions = (cache.hourlyRows || []).filter((row: any) => row.projectCode === config.projectCode && (!config.serverId || row.serverId === config.serverId) && row.statHour.slice(0, 10) >= config.dateFrom && row.statHour.slice(0, 10) <= config.dateTo && !existing.has(`${row.statHour}|${row.serverId}`)).map((row: any) => ({
    rowKey: `local-${row.statHour}-${row.serverId}`, statHour: row.statHour, serverId: row.serverId,
    connectionAttemptCount: row.attempts, connectionResultCount: row.results, connectionSuccessCount: row.successes,
    connectionFailedCount: row.failures, connectionSuccessRate: row.connectionSuccessRate, resultCoverageRate: row.resultCoverageRate,
    localSupplement: true,
  }));
  if (!additions.length) return result;
  return { ...result, serverVpnHourlyOverall: { ...report, available: true, rows: [...current, ...additions], source: `${report.source || ""} + 本地首次登录扫描` } };
}
