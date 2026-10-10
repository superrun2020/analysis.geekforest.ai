import { createPool } from "mysql2/promise";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cacheDir = path.resolve(process.cwd(), ".local-cache");
const cacheFile = path.join(cacheDir, "vpn-node-scan.json");
const dateText = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() + offset * 86400000));

async function readCache() {
  try { return JSON.parse(await readFile(cacheFile, "utf8")); } catch { return { scannedAt: null, rows: [] }; }
}

function databaseConfig(env) {
  const host = env.LOCAL_VPN_SCAN_DB_HOST || env.ADB_HOST;
  const user = env.LOCAL_VPN_SCAN_DB_USER || env.ADB_USER;
  const password = env.LOCAL_VPN_SCAN_DB_PASSWORD || env.ADB_PASSWORD;
  const database = env.LOCAL_VPN_SCAN_DB_NAME || env.ADB_DATABASE;
  return host && user && password && database ? { host, user, password, database, port: Number(env.LOCAL_VPN_SCAN_DB_PORT || env.ADB_PORT || 3306), connectTimeout: 15000, dateStrings: true } : null;
}

async function scan(env) {
  const config = databaseConfig(env);
  if (!config) throw new Error("local_vpn_scan_database_not_configured");
  const detailTable = env.LOCAL_VPN_SCAN_DETAIL_TABLE || "dwd_app_tracking_event_v18";
  const aggregateTable = env.LOCAL_VPN_SCAN_AGGREGATE_TABLE || "dws_vpn_connection_quality_daily_v18";
  if (![detailTable, aggregateTable].every((name) => /^[A-Za-z0-9_]+$/.test(name))) throw new Error("local_vpn_scan_invalid_table_name");
  const startDate = dateText(-1), endDate = dateText(0);
  const pool = createPool({ ...config, connectionLimit: 2 });
  try {
    const [rawRows] = await pool.query(`SELECT event_date AS statDate, UPPER(project_code) AS projectCode, server_id AS serverId,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' THEN connection_id END) attempts,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' THEN connection_id END) results,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,''))='success' THEN connection_id END) successes,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,'')) IN ('failed','failure','timeout','cancelled') THEN connection_id END) failures
      FROM \`${detailTable}\` WHERE event_date BETWEEN ? AND ? AND NULLIF(project_code,'') IS NOT NULL AND NULLIF(server_id,'') IS NOT NULL
      AND event_name IN ('vpn_connection_start','vpn_connection_result') GROUP BY event_date,UPPER(project_code),server_id`, [startDate, endDate]);
    const [summaryRows] = await pool.query(`SELECT DISTINCT stat_date statDate,UPPER(project_code) projectCode,server_id serverId FROM \`${aggregateTable}\`
      WHERE stat_date BETWEEN ? AND ? AND NULLIF(server_id,'') IS NOT NULL`, [startDate, endDate]);
    const known = new Set(summaryRows.map((row) => `${String(row.statDate).slice(0, 10)}|${row.projectCode}|${row.serverId}`));
    const rows = rawRows.filter((row) => !known.has(`${String(row.statDate).slice(0, 10)}|${row.projectCode}|${row.serverId}`)).map((row) => {
      const attempts = Number(row.attempts || 0), results = Number(row.results || 0), successes = Number(row.successes || 0), failures = Number(row.failures || 0);
      return { statDate: String(row.statDate).slice(0, 10), projectCode: row.projectCode, serverId: row.serverId, attempts, results, successes, failures,
        connectionSuccessRate: results ? Math.round(successes / results * 10000) / 100 : null, resultCoverageRate: attempts ? Math.round(results / attempts * 10000) / 100 : null };
    });
    const missingKeys = new Set(rows.map((row) => `${row.projectCode}|${row.serverId}`));
    const [rawHourlyRows] = await pool.query(`SELECT DATE_FORMAT(DATE_ADD(event_time_utc,INTERVAL 8 HOUR),'%Y-%m-%d %H:00:00') statHour,
      UPPER(project_code) projectCode,server_id serverId,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' THEN connection_id END) attempts,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' THEN connection_id END) results,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,''))='success' THEN connection_id END) successes,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,'')) IN ('failed','failure','timeout','cancelled') THEN connection_id END) failures
      FROM \`${detailTable}\` WHERE event_date BETWEEN ? AND ? AND NULLIF(project_code,'') IS NOT NULL AND NULLIF(server_id,'') IS NOT NULL
      AND event_name IN ('vpn_connection_start','vpn_connection_result') GROUP BY statHour,UPPER(project_code),server_id`, [startDate, endDate]);
    const hourlyRows = rawHourlyRows.filter((row) => missingKeys.has(`${row.projectCode}|${row.serverId}`)).map((row) => {
      const attempts = Number(row.attempts || 0), results = Number(row.results || 0), successes = Number(row.successes || 0), failures = Number(row.failures || 0);
      return { statHour: row.statHour, projectCode: row.projectCode, serverId: row.serverId, attempts, results, successes, failures,
        connectionSuccessRate: results ? Math.round(successes / results * 10000) / 100 : null, resultCoverageRate: attempts ? Math.round(results / attempts * 10000) / 100 : null };
    });
    const payload = { scannedAt: new Date().toISOString(), startDate, endDate, rows, hourlyRows };
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf8");
    return payload;
  } finally { await pool.end(); }
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 16_384) reject(new Error("local_vpn_lifecycle_payload_too_large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("local_vpn_lifecycle_invalid_json")); }
    });
    req.on("error", reject);
  });
}

async function queryLifecycle(env, input) {
  const config = databaseConfig(env);
  if (!config) throw new Error("local_vpn_scan_database_not_configured");
  const detailTable = env.LOCAL_VPN_SCAN_DETAIL_TABLE || "dwd_app_tracking_event_v18";
  if (!/^[A-Za-z0-9_]+$/.test(detailTable)) throw new Error("local_vpn_scan_invalid_table_name");
  const projectCode = String(input.projectCode || "").toUpperCase();
  const dateFrom = String(input.dateFrom || "");
  const dateTo = String(input.dateTo || "");
  if (!/^[A-Z][A-Z0-9]{2,15}$/.test(projectCode) || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) throw new Error("local_vpn_lifecycle_invalid_filter");
  const rangeDays = Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(rangeDays) || rangeDays < 0 || rangeDays > 31) throw new Error("local_vpn_lifecycle_range_too_large");
  const pool = createPool({ ...config, connectionLimit: 1 });
  try {
    const [rows] = await pool.query(`SELECT
      COUNT(DISTINCT CASE WHEN event_name='app_foreground' THEN NULLIF(my_user_id,'') END) dauUsers,
      SUM(CASE WHEN event_name='app_foreground' THEN 1 ELSE 0 END) foregroundEventCount,
      COUNT(DISTINCT CASE WHEN event_name='screen_view' AND screen_name='MainVpnActivity' THEN NULLIF(my_user_id,'') END) vpnHomeUsers,
      SUM(CASE WHEN event_name='screen_view' AND screen_name='MainVpnActivity' THEN 1 ELSE 0 END) vpnHomeEventCount,
      COUNT(DISTINCT CASE WHEN event_name='element_click' AND (LOWER(COALESCE(element_name,'')) LIKE '%connect%' OR LOWER(COALESCE(action_name,'')) LIKE '%connect%') THEN NULLIF(my_user_id,'') END) vpnConnectButtonClickUsers,
      COUNT(DISTINCT CASE WHEN event_name='core_action' AND action_name='vpn_connect' THEN NULLIF(my_user_id,'') END) vpnCoreConnectActionUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,'')) IN ('granted','already_granted','not_required') THEN NULLIF(my_user_id,'') END) vpnPermissionAvailableUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,''))='granted' THEN NULLIF(my_user_id,'') END) vpnPermissionGrantedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,''))='already_granted' THEN NULLIF(my_user_id,'') END) vpnPermissionAlreadyGrantedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,''))='not_required' THEN NULLIF(my_user_id,'') END) vpnPermissionNotRequiredUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,''))='denied' THEN NULLIF(my_user_id,'') END) vpnPermissionDeniedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,''))='error' THEN NULLIF(my_user_id,'') END) vpnPermissionErrorUsers,
      SUM(CASE WHEN event_name='vpn_permission_result' THEN 1 ELSE 0 END) vpnPermissionEventCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_node_selected' AND NULLIF(server_id,'') IS NOT NULL THEN NULLIF(my_user_id,'') END) vpnNodeSelectedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_node_selected' AND LOWER(COALESCE(selection_mode,''))='auto' THEN NULLIF(my_user_id,'') END) vpnNodeAutoSelectedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_node_selected' AND LOWER(COALESCE(selection_mode,''))='manual' THEN NULLIF(my_user_id,'') END) vpnNodeManualSelectedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_node_selected' AND LOWER(COALESCE(selection_mode,''))='fallback' THEN NULLIF(my_user_id,'') END) vpnNodeFallbackSelectedUsers,
      SUM(CASE WHEN event_name='vpn_node_selected' THEN 1 ELSE 0 END) vpnNodeSelectionCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' THEN NULLIF(my_user_id,'') END) vpnConnectionStartUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' THEN NULLIF(vpn_session_id,'') END) vpnSessionCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' THEN NULLIF(connection_id,'') END) connectionAttemptCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_start' AND LOWER(COALESCE(trigger_type,''))='auto_reconnect' THEN NULLIF(my_user_id,'') END) autoReconnectUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' THEN NULLIF(my_user_id,'') END) vpnConnectionResultUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='success' THEN NULLIF(my_user_id,'') END) vpnConnectionSuccessUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,'')) IN ('failed','failure') THEN NULLIF(my_user_id,'') END) connectionFailedUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='timeout' THEN NULLIF(my_user_id,'') END) connectionTimeoutUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='cancelled' THEN NULLIF(my_user_id,'') END) connectionCancelledUsers,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' THEN NULLIF(connection_id,'') END) connectionResultCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='success' THEN NULLIF(connection_id,'') END) connectionSuccessCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,'')) IN ('failed','failure') THEN NULLIF(connection_id,'') END) connectionFailedCount,
      COUNT(DISTINCT CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='success' THEN NULLIF(vpn_session_id,'') END) vpnSuccessSessionCount,
      COUNT(DISTINCT CASE WHEN event_name='ad_opportunity' AND vpn_active=1 THEN NULLIF(my_user_id,'') END) postConnectOpportunityUsers,
      COUNT(DISTINCT CASE WHEN event_name='ad_show_attempt' AND vpn_active=1 THEN NULLIF(my_user_id,'') END) postConnectShowUsers,
      COUNT(DISTINCT CASE WHEN event_name='ad_impression' AND vpn_active=1 THEN NULLIF(my_user_id,'') END) impressionUsers,
      COUNT(DISTINCT CASE WHEN event_name='ad_paid_event' AND vpn_active=1 THEN NULLIF(my_user_id,'') END) paidUsers,
      SUM(CASE WHEN event_name='ad_show_attempt' AND vpn_active=1 THEN 1 ELSE 0 END) postConnectShowCount,
      SUM(CASE WHEN event_name='ad_show_success' AND vpn_active=1 THEN 1 ELSE 0 END) adShowSuccessCount,
      SUM(CASE WHEN event_name IN ('ad_show_failed','ad_show_blocked') AND vpn_active=1 THEN 1 ELSE 0 END) adShowFailedCount,
      SUM(CASE WHEN event_name='ad_cache_hit' AND vpn_active=1 THEN 1 ELSE 0 END) cacheHitCount,
      SUM(CASE WHEN event_name='ad_cache_miss' AND vpn_active=1 THEN 1 ELSE 0 END) cacheMissCount,
      SUM(CASE WHEN event_name='ad_request' AND vpn_active=1 THEN 1 ELSE 0 END) adRequestCount,
      SUM(CASE WHEN event_name='ad_load_success' AND vpn_active=1 THEN 1 ELSE 0 END) adLoadSuccessCount,
      SUM(CASE WHEN event_name='ad_load_failed' AND vpn_active=1 THEN 1 ELSE 0 END) adLoadFailedCount,
      SUM(CASE WHEN event_name='ad_impression' AND vpn_active=1 THEN 1 ELSE 0 END) impressionCount,
      SUM(CASE WHEN event_name='ad_paid_event' AND vpn_active=1 THEN 1 ELSE 0 END) paidEventCount,
      COUNT(DISTINCT CASE WHEN event_name='ad_impression' AND vpn_active=1 AND NULLIF(ad_source,'') IS NOT NULL AND NULLIF(ad_format,'') IS NOT NULL THEN event_id END) impressionSourceFormatCount,
      COUNT(DISTINCT CASE WHEN event_name='ad_impression' AND vpn_active=1 AND NULLIF(response_id,'') IS NOT NULL THEN event_id END) impressionResponseIdCount,
      COUNT(DISTINCT CASE WHEN event_name='ad_paid_event' AND vpn_active=1 AND NULLIF(ad_instance_id,'') IS NOT NULL THEN event_id END) paidInstanceLinkedCount,
      SUM(CASE WHEN event_name='ad_paid_event' AND vpn_active=1 THEN COALESCE(value_micros,0) ELSE 0 END) revenueMicros
      FROM \`${detailTable}\` WHERE event_date BETWEEN ? AND ? AND UPPER(project_code)=?`, [dateFrom, dateTo, projectCode]);
    const [missingRows] = await pool.query(`SELECT COUNT(*) unreturnedConnectionCount FROM (
      SELECT connection_id,MAX(event_name='vpn_connection_start') has_start,MAX(event_name='vpn_connection_result') has_result
      FROM \`${detailTable}\` WHERE event_date BETWEEN ? AND ? AND UPPER(project_code)=? AND NULLIF(connection_id,'') IS NOT NULL
      AND event_name IN ('vpn_connection_start','vpn_connection_result') GROUP BY connection_id
    ) connection_states WHERE has_start=1 AND has_result=0`, [dateFrom, dateTo, projectCode]);
    const aggregateTable = env.LOCAL_VPN_SCAN_AGGREGATE_TABLE || "dws_vpn_connection_quality_daily_v18";
    if (!/^[A-Za-z0-9_]+$/.test(aggregateTable)) throw new Error("local_vpn_scan_invalid_table_name");
    const [dwsRows] = await pool.query(`SELECT
      SUM(vpn_session_count) vpnSessionCount,
      SUM(connection_attempt_count) connectionAttemptCount,
      SUM(connection_result_count) connectionResultCount,
      SUM(connection_success_count) connectionSuccessCount,
      SUM(connection_failed_count) connectionFailedCount,
      SUM(permission_attempt_count) vpnPermissionAttemptCount,
      SUM(permission_success_count) vpnPermissionSuccessCount,
      SUM(node_selection_count) vpnNodeSelectionCount,
      SUM(valid_node_selection_count) vpnValidNodeSelectionCount,
      MAX(duration_p95_ms) vpnConnectionP95Ms,
      SUM(post_connect_opportunity_count) postConnectOpportunityCount,
      SUM(post_connect_impression_count) postConnectImpressionCount
      FROM \`${aggregateTable}\` WHERE stat_date BETWEEN ? AND ? AND UPPER(project_code)=?
      AND COALESCE(phase_name,'')='' AND COALESCE(protocol,'')='' AND COALESCE(server_id,'')=''`, [dateFrom, dateTo, projectCode]);
    const [sequentialRows] = await pool.query(`SELECT
      SUM(dau=1) dauUsers,
      SUM(dau=1 AND home=1) vpnHomeUsers,
      SUM(dau=1 AND home=1 AND intent=1) connectIntentUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1) permissionAvailableUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1) nodeReadyUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1) connectionStartUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1) connectionResultUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1 AND succeeded=1) connectionSuccessUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1 AND succeeded=1 AND opportunity_at>=success_at) postConnectOpportunityUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1 AND succeeded=1 AND opportunity_at>=success_at AND show_at>=opportunity_at) adShowUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1 AND succeeded=1 AND opportunity_at>=success_at AND show_at>=opportunity_at AND impression_at>=show_at) impressionUsers,
      SUM(dau=1 AND home=1 AND intent=1 AND permission_ok=1 AND node_ok=1 AND started=1 AND resulted=1 AND succeeded=1 AND opportunity_at>=success_at AND show_at>=opportunity_at AND impression_at>=show_at AND paid_at>=impression_at) paidUsers
      FROM (
        SELECT my_user_id,
          MAX(event_name='app_foreground') dau,
          MAX(event_name='screen_view' AND screen_name='MainVpnActivity') home,
          MAX(event_name='core_action' AND action_name='vpn_connect') intent,
          MAX(event_name='vpn_permission_result' AND LOWER(COALESCE(permission_status,'')) IN ('granted','already_granted','not_required')) permission_ok,
          MAX(event_name='vpn_node_selected' AND NULLIF(server_id,'') IS NOT NULL) node_ok,
          MAX(event_name='vpn_connection_start') started,
          MAX(event_name='vpn_connection_result') resulted,
          MAX(event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='success') succeeded,
          MIN(CASE WHEN event_name='vpn_connection_result' AND LOWER(COALESCE(result_status,vpn_status,''))='success' THEN event_time_utc END) success_at,
          MIN(CASE WHEN event_name='ad_opportunity' AND vpn_active=1 THEN event_time_utc END) opportunity_at,
          MIN(CASE WHEN event_name='ad_show_attempt' AND vpn_active=1 THEN event_time_utc END) show_at,
          MIN(CASE WHEN event_name='ad_impression' AND vpn_active=1 THEN event_time_utc END) impression_at,
          MIN(CASE WHEN event_name='ad_paid_event' AND vpn_active=1 THEN event_time_utc END) paid_at
        FROM \`${detailTable}\`
        WHERE event_date BETWEEN ? AND ? AND UPPER(project_code)=? AND NULLIF(my_user_id,'') IS NOT NULL
        GROUP BY my_user_id
      ) user_steps`, [dateFrom, dateTo, projectCode]);
    const row = rows[0] || {};
    const data = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
    data.vpnConnectButtonClickAvailable = data.vpnConnectButtonClickUsers > 0;
    data.vpnValidNodeSelectedUsers = data.vpnNodeSelectedUsers;
    data.connectionSuccessUsers = data.vpnConnectionSuccessUsers;
    data.vpnHomeCoverageRate = data.dauUsers ? data.vpnHomeUsers / data.dauUsers * 100 : null;
    data.unreturnedConnectionCount = Number(missingRows[0]?.unreturnedConnectionCount || 0);
    data.impressionSourceFormatCoverageRate = data.impressionCount ? data.impressionSourceFormatCount / data.impressionCount * 100 : null;
    data.responseIdCoverageRate = data.impressionCount ? data.impressionResponseIdCount / data.impressionCount * 100 : null;
    data.pageVisibilityCoverageRate = 0;
    data.paidCallbackCoverageRate = data.impressionCount ? data.paidEventCount / data.impressionCount * 100 : null;
    data.adInstanceAssociationRate = data.paidEventCount ? data.paidInstanceLinkedCount / data.paidEventCount * 100 : null;
    data.revenue = Math.round(data.revenueMicros || 0) / 1000000;
    data.ecpm = data.impressionCount ? data.revenue / data.impressionCount * 1000 : null;
    delete data.revenueMicros;
    const dws = Object.fromEntries(Object.entries(dwsRows[0] || {}).map(([key, value]) => [key, value === null ? null : Number(value)]));
    const sequential = Object.fromEntries(Object.entries(sequentialRows[0] || {}).map(([key, value]) => [key, value === null ? null : Number(value)]));
    return { projectCode, dateFrom, dateTo, source: "local_dwd_dws", data, dws, sequential };
  } finally { await pool.end(); }
}

export function localVpnNodeScanPlugin(env) {
  return { name: "local-vpn-node-scan", configureServer(server) {
    server.middlewares.use("/api/local/vpn-node-scan", async (req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try { res.statusCode = 200; res.end(JSON.stringify(req.method === "POST" ? await scan(env) : await readCache())); }
      catch (error) { res.statusCode = 503; res.end(JSON.stringify({ error: error instanceof Error ? error.message : "local_vpn_scan_failed" })); }
    });
    server.middlewares.use("/api/local/vpn-lifecycle", async (req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "method_not_allowed" })); return; }
        res.statusCode = 200;
        res.end(JSON.stringify(await queryLifecycle(env, await readJsonBody(req))));
      } catch (error) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "local_vpn_lifecycle_failed" }));
      }
    });
  } };
}
