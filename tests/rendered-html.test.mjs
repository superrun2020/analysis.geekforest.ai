import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function file(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Vite build emits a React app shell", async () => {
  const html = await file("dist/index.html");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /type="module"/);
  assert.match(html, /\/assets\/index-[^"']+\.js/);
  assert.match(html, /JKCL 漏斗分析中心/);
});

test("React/Vite/Ant Design entry is wired", async () => {
  const [main, packageJson, viteConfig] = await Promise.all([
    file("app/main.tsx"),
    file("package.json"),
    file("vite.config.ts"),
  ]);
  assert.match(main, /createRoot/);
  assert.match(main, /ConfigProvider/);
  assert.match(main, /antd\/dist\/reset\.css/);
  assert.match(main, /RouterShim/);
  assert.match(packageJson, /"build": "vite build"/);
  assert.match(packageJson, /"antd"/);
  assert.doesNotMatch(packageJson, /"vinext"/);
  assert.match(viteConfig, /@vitejs\/plugin-react/);
  assert.doesNotMatch(viteConfig, /from "vinext"/);
});

test("compiled bundle contains current product features", async () => {
  const assets = await readdir(new URL("dist/assets/", root));
  const jsFile = assets.find((name) => name.endsWith(".js"));
  assert.ok(jsFile, "missing compiled JS asset");
  const js = await file(`dist/assets/${jsFile}`);
  assert.match(js, /广告漏斗Overall/);
  assert.match(js, /诊断报表/);
  const version = JSON.parse(await file("public/version.json")).appVersion;
  assert.ok(js.includes(version), "compiled bundle matches published version manifest");
  assert.match(js, /sidebar-collapsed/);
  assert.match(js, /广告链路总表/);
});

test("server VPN Overall is restricted to internal node projects", async () => {
  const [page, source, api, request, service] = await Promise.all([
    file("app/page.tsx"),
    file("app/operational-funnel.tsx"),
    file("app/funnel-analysis-api.ts"),
    file("backend/app/Http/Requests/Admin/FunnelAnalyticsQueryRequest.php"),
    file("backend/app/Services/FunnelAnalyticsService.php"),
  ]);

  assert.match(page, /serverVpn/);
  assert.match(page, /服务器VPN Overall/);
  assert.match(source, /SERVER_VPN_PROJECTS/);
  assert.match(source, /A003/);
  assert.match(source, /A005/);
  assert.match(source, /A007/);
  assert.match(source, /ServerVpnOverall/);
  assert.match(source, /SERVER_VPN_DIMENSIONS/);
  assert.match(source, /SERVER_VPN_METRICS/);
  assert.match(source, /serverVpnDraft/);
  assert.match(source, /serverVpnHasQueried/);
  assert.match(source, /导出 CSV/);
  assert.match(source, /safeCsvCell/);
  assert.match(source, /缩小范围后导出/);
  assert.match(source, /serverVpnQueryIdentity/);
  assert.match(source, /配置已修改，当前结果已隐藏/);
  assert.match(source, /showReportData/);
  assert.match(source, /dimensionOptionMeta/);
  assert.match(source, /选项已限制为前 250 项/);
  assert.match(source, /入口国家/);
  assert.match(source, /VPN出口国家/);
  assert.match(source, /App版本/);
  assert.match(source, /ASN暂不可用/);
  assert.match(source, /区域屏蔽与网络标记分析/);
  assert.match(source, /疑似被入口国家屏蔽/);
  assert.match(source, /IP段可能被标记/);
  assert.match(source, /ASN可能被标记/);
  assert.match(source, /证据型风险提示/);
  assert.match(source, /riskReady/);
  assert.match(source, /当前响应未包含V173风险分析结果/);
  assert.match(source, /已排除多IP域名映射/);
  assert.match(source, /serverVpnDataMatches/);
  assert.match(source, /forceRefresh: serverVpnQueryKey > 0/);
  assert.match(api, /server_vpn_overall/);
  assert.match(api, /nodeCountry\?: string/);
  assert.match(request, /server_vpn_overall/);
  assert.match(request, /服务器VPN Overall必须选择项目/);
  assert.match(request, /服务器VPN Overall不能同时提交 dimension 和 dimensions/);
  assert.match(request, /服务器VPN Overall的ASN维度暂不可用/);
  assert.match(request, /服务器VPN Overall不支持维度/);
  assert.match(service, /serverVpnOverallPage/);
  assert.match(service, /serverVpnDimensions/);
  assert.match(service, /服务器VPN Overall不能同时提交 dimension 和 dimensions/);
  assert.match(service, /服务器VPN Overall至少需要一个有效维度/);
  assert.match(service, /dimensionOptions/);
  assert.match(service, /dimensionOptionMeta/);
  assert.match(service, /dimensionCoverage/);
  assert.match(service, /totalGroupedRows/);
  assert.match(service, /omittedRows/);
  assert.match(service, /fromSub\(clone \$query/);
  assert.match(service, /\$value === '\(unknown\)'/);
  assert.match(service, /array_chunk\(\$serverIds, 250\)/);
  assert.match(service, /TRIM\(CAST\(\{\$column\} AS CHAR\)\) = ''/);
  assert.match(service, /UPPER\(NULLIF\(TRIM\(CAST\(country_code AS CHAR\)\), ''\)\)/);
  assert.match(service, /LOWER\(NULLIF\(TRIM\(CAST\(platform AS CHAR\)\), ''\)\)/);
  assert.match(service, /'node_country' => \"COALESCE/);
  assert.match(service, /'stat_date' => 'stat_date'/);
  assert.match(service, /ASN维度未进入VPN质量汇总表/);
  assert.match(service, /v2_ip_pool/);
  assert.match(service, /node_project_groups/);
  assert.match(service, /inventoryAvailable/);
  assert.match(service, /connection\('ad_revenue'\)/);
  assert.match(service, /服务器VPN Overall仅支持 A003、A005、A007/);
  assert.match(service, /serverVpnRiskAnalysis/);
  assert.match(service, /country_node_blocking/);
  assert.match(service, /ip_range_flagged/);
  assert.match(service, /asn_flagged/);
  assert.match(service, /jkcl_vpn_domain_asn/);
  assert.match(service, /connection_failed_count/);
  assert.match(service, /connection_result_count/);
  assert.match(service, /server_vpn_overall.*v173/s);
  assert.match(service, /validOutcomeRows/);
  assert.match(service, /knownCountryRows/);
  assert.match(service, /\$countryRows = \(clone \$riskBaseQuery\)\s*->whereRaw\(\$validOutcomeCondition\)/);
  assert.match(service, /excludedInvalidOutcomeRowCount/);
  assert.match(service, /ambiguous_domain_ip_mapping_excluded/);
  assert.match(service, /ambiguous_ip_asn_mapping_excluded/);
});

test("VPN comparison and Launcher Overall stay separate", async () => {
  const [page, source, api, request, service] = await Promise.all([
    file("app/page.tsx"),
    file("app/operational-funnel.tsx"),
    file("app/funnel-analysis-api.ts"),
    file("backend/app/Http/Requests/Admin/FunnelAnalyticsQueryRequest.php"),
    file("backend/app/Services/FunnelAnalyticsService.php"),
  ]);

  assert.match(page, /vpnVersions/);
  assert.match(page, /launcherVersions/);
  assert.match(page, /VPN版本对比/);
  assert.match(page, /Launcher Overall/);
  assert.match(source, /versionProduct/);
  assert.match(source, /startsWith\("L"\)/);
  assert.match(source, /setVersionFilter\(nextVersion\)/);
  assert.match(source, /paidAttributedNewUsers/);
  assert.match(source, /vpnSessionCount/);
  assert.match(source, /LAUNCHER_OVERALL_DIMENSIONS/);
  assert.match(source, /Launcher打点缺少：/);
  assert.match(api, /versionProduct\?: "vpn" \| "launcher"/);
  assert.match(api, /asn\?: string/);
  assert.match(api, /serverId\?: string/);
  assert.match(api, /protocol\?: string/);
  assert.match(request, /versionProduct/);
  assert.match(request, /Launcher Overall必须使用VPN诊断域/);
  assert.match(request, /dimensions.*max:8/);
  assert.match(request, /dimension.*network_type/);
  assert.match(request, /dimension.*asn/);
  assert.match(request, /dimension.*server_id/);
  assert.match(request, /dimension.*protocol/);
  assert.match(service, /launcherVersionComparisonFromEvents/);
  assert.match(service, /versionProduct/);
  assert.match(service, /versionComparisonFromA003VpnSummary/);
  assert.match(service, /'network_type' => 'network_type'/);
  assert.match(service, /'asn' => 'asn'/);
  assert.match(service, /'server_id' => 'server_id'/);
  assert.match(service, /'protocol' => 'protocol'/);
  assert.match(service, /dimensionCoverage/);
  assert.match(service, /unset\(\$optionParams\[\$filterKey\]\)/);
  assert.match(service, /NULLIF\(TRIM\(network_type\), ''\)/);
  assert.match(service, /TRIM\(\{\$column\}\) AS normalized_value/);
  assert.match(service, /whereRaw\("TRIM\(\{\$column\}\) = \?", \[trim\(\(string\) \$params\[\$key\]\)\]\)/);
  assert.doesNotMatch(service, /unset\(\$queryParams\[/);
  assert.match(service, /launcher_guide_page/);
  assert.match(service, /launcher_page/);
  assert.match(service, /trackingIssues/);
  assert.match(source, /打点状态/);
  assert.match(service, /设置结果未上报/);
  assert.match(source, /row\.trackingIssues/);
  assert.match(service, /launcherSettingResultCoverageComplete/);
  assert.match(source, /hasObservedRate/);
  assert.match(source, /denominatorRows\.every/);
  assert.match(source, /draftDimensions/);
  assert.match(source, /setDimensions\(draftDimensions\)/);
  assert.match(source, /dimensionOptions: \{\}/);
  assert.match(source, /dimensionCoverage: \{\}/);
  assert.match(source, /setNetworkTypeFilter\(""\)/);
  assert.match(source, /setVersionFilter\(""\)/);
  assert.match(source, /missingLauncherDimensions/);
});

test("deep-dive stage counts ignore ratio metric cards", async () => {
  const source = await file("app/operational-funnel.tsx");
  assert.match(source, /unit === \"ratio\"/);
  assert.match(source, /display\.includes\(\"%\"\)/);
  assert.doesNotMatch(source, /\[\"value\", \"count\", \"users\", \"displayValue\"/);
});


test("tracked pages no longer render native button elements", async () => {
  const files = [
    "app/action-dialog.tsx",
    "app/company-auth.tsx",
    "app/domain-report.tsx",
    "app/firebase-configuration.tsx",
    "app/metric-dictionary.tsx",
    "app/online-module-page.tsx",
    "app/operational-funnel.tsx",
    "app/page.tsx",
    "app/project-report-share-page.tsx",
    "app/share-alerts-page.tsx",
    "app/shared-report/page.tsx",
    "app/shared-report/[shareId]/page.tsx",
    "app/tracking-acceptance-center.tsx",
    "app/tracking-config-workspace.tsx",
    "app/tracking-module-test-config.tsx",
  ];
  const contents = await Promise.all(files.map((path) => file(path)));
  for (const [index, content] of contents.entries()) {
    assert.doesNotMatch(content, /<\/?button\b/, `${files[index]} still contains native button`);
  }
});


test("all analysis login actions submit their forms", async () => {
  const source = await file("app/company-auth.tsx");
  const submitButtons = source.match(/<Button htmlType="submit" disabled=\{loading\}>/g) ?? [];
  assert.equal(submitButtons.length, 3, "code, password, and password-change actions must submit their forms");
});


test("analysis login exposes copyable privacy-safe diagnostics beside every submit action", async () => {
  const [source, diagnostics, css] = await Promise.all([
    file("app/company-auth.tsx"),
    file("app/login-diagnostics.ts"),
    file("app/globals.css"),
  ]);
  assert.match(source, /复制登录日志/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /legacyCopyDiagnosticText/);
  assert.match(source, /catch \{\s*legacyCopyDiagnosticText\(text\)/);
  assert.match(source, /diagnosticsRef/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /knownAuthDiagnosticErrors\.has/);
  assert.match(source, /request_started/);
  assert.match(source, /request_completed/);
  assert.match(source, /company-login-actions/);
  assert.match(css, /\.company-login-actions/);
  assert.match(diagnostics, /SENSITIVE_KEY/);
  assert.doesNotMatch(source, /details:\s*\{[^}]*password/);
  assert.doesNotMatch(source, /details:\s*\{[^}]*code/);
});


test("oa workspace visual style token is shipped", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /OA workspace inspired light dashboard polish/);
  assert.match(css, /--canvas: #f6f7fb/);
  assert.match(css, /grid-template-columns: 252px minmax/);
});


test("sidebar serial numbers are not rendered", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<span>\{item\.index\}<\/span>/);
  assert.match(source, /<b>\{item\.label\}<\/b>/);
});


test("diagnostic submenu items are explicitly left aligned", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /V140: left align diagnostic submenu items/);
  assert.match(css, /align-items: flex-start !important/);
  assert.match(css, /text-align: left !important/);
});


test("sidebar is narrowed and submenu stays left", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /V141: narrower sidebar and flush-left submenu/);
  assert.match(css, /grid-template-columns: 212px minmax/);
  assert.match(css, /\.nav-submenu-list \{ padding: 4px 0 8px 10px; \}/);
});


test("branched funnel is simplified into main sequence and compact path details", async () => {
  const [source, css] = await Promise.all([file("app/operational-funnel.tsx"), file("app/globals.css")]);
  assert.match(source, /simplified-funnel/);
  assert.match(source, /履约路径明细/);
  assert.doesNotMatch(source, /branch-split-line/);
  assert.match(css, /V142: simplify ad core funnel readability/);
  assert.match(css, /\.simplified-funnel \.vertical-flow-line/);
});


test("multi-project ad DNS report is registered in frontend and backend", async () => {
  const [api, page, source, request, service] = await Promise.all([
    file("app/funnel-analysis-api.ts"),
    file("app/page.tsx"),
    file("app/operational-funnel.tsx"),
    file("backend/app/Http/Requests/Admin/FunnelAnalyticsQueryRequest.php"),
    file("backend/app/Services/FunnelAnalyticsService.php"),
  ]);
  assert.match(api, /ad_dns_report/);
  assert.match(page, /广告DNS诊断/);
  assert.match(source, /AdDnsReport/);
  assert.match(source, /dns_provider/);
  assert.match(source, /matched_route/);
  assert.match(source, /jk_vpn_network_diagnostic/);
  assert.match(source, /DNS解析成功率/);
  assert.match(service, /dnsSuccessRate/);
  assert.match(request, /ad_dns_report/);
  assert.match(request, /dns_server/);
  assert.match(service, /vpn_network_diagnostic/);
  assert.match(service, /adDnsReport/);
  assert.doesNotMatch(source, /A012 DNS/);
  assert.doesNotMatch(service, /A012 广告 DNS 诊断报表/);
});

test("exit IP quality links IP aggregates to bounded session evidence", async () => {
  const [api, page, source, request, service] = await Promise.all([
    file("app/funnel-analysis-api.ts"),
    file("app/page.tsx"),
    file("app/operational-funnel.tsx"),
    file("backend/app/Http/Requests/Admin/FunnelAnalyticsQueryRequest.php"),
    file("backend/app/Services/FunnelAnalyticsService.php"),
  ]);
  assert.match(api, /exit_ip_quality/);
  assert.match(page, /出口IP质量/);
  assert.match(source, /ExitIpQualityReport/);
  assert.match(source, /疑似受限/);
  assert.match(source, /独立Session/);
  assert.match(request, /exit_ip_quality/);
  assert.match(request, /ipKey/);
  assert.match(request, /ipTarget/);
  assert.match(request, /matched_route/);
  assert.match(service, /exitIpQualityPage/);
  assert.match(service, /vpn_ip_probe_result/);
  assert.match(service, /ip_after_connect/);
  assert.match(service, /COUNT\(DISTINCT.*vpn_session_id/s);
  assert.match(service, /isPublicExitIp/);
  assert.match(service, /same-target peer IP comparison/i);
  assert.match(service, /publicExitIpSql\('ip_after_connect'\)/);
  assert.match(service, /GROUP_CONCAT\(TRIM\(ip_after_connect\)/);
  assert.match(service, /COUNT\(DISTINCT TRIM\(ip_after_connect\)\)/);
  assert.match(service, /peerAttempts >= 20/);
  assert.match(service, /peerSessions >= 10/);
  assert.doesNotMatch(service, /出口IP质量查询失败：['" ]*\.\s*\$exception->getMessage/);
  assert.match(service, /stable_session_count/);
  assert.match(service, /maskEvidenceIdentifier\(\$row->session_key\)/);
  assert.match(service, /sanitizeEvidenceText\(\$this->normalizeExitIpLabel/);
  assert.doesNotMatch(source, /title=\{text\(session\.sessionId\)\}/);
  assert.doesNotMatch(source, /title=\{\(session\.connectionIds/);
});

test("exit IP quality uses Overall-style configuration and explicit server filters", async () => {
  const [source, request, service] = await Promise.all([
    file("app/operational-funnel.tsx"),
    file("backend/app/Http/Requests/Admin/FunnelAnalyticsQueryRequest.php"),
    file("backend/app/Services/FunnelAnalyticsService.php"),
  ]);
  assert.match(source, /EXIT_IP_COLUMNS/);
  assert.match(source, /统计字段/);
  assert.match(source, /日期范围/);
  assert.match(source, /项目代号/);
  assert.match(source, /Session数量 &gt;/);
  assert.match(source, /最小失败Session/);
  assert.match(source, /TCP成功率上限/);
  assert.match(source, /广告加载成功率上限/);
  assert.match(source, /IP状态/);
  assert.match(source, /小段（172\.22\.22\.XX）/);
  assert.match(source, /大段（172\.22\.XX\.XX）/);
  assert.match(source, /ipGranularity/);
  assert.match(source, /exitIpHasQueried/);
  assert.match(source, /配置筛选条件后点击查询/);
  assert.match(source, /出口国家/);
  assert.match(source, /探测目标/);
  assert.match(source, /未上报目标/);
  const exitReport = source.slice(source.indexOf("function ExitIpQualityReport"), source.indexOf("function readInitialOperationalView"));
  const resultCardIndex = exitReport.indexOf('<section className="surface overall-result-card">');
  assert.match(exitReport, /className="vpn-overall-report exit-ip-overall-report"/);
  assert.ok(resultCardIndex > 0);
  assert.doesNotMatch(exitReport.slice(0, resultCardIndex), /surface-title|summary-grid/);
  assert.match(exitReport.slice(resultCardIndex), /summary-grid/);
  assert.match(request, /minSessionCount/);
  assert.match(request, /minFailedSessionCount/);
  assert.match(request, /maxTcpSuccessRate/);
  assert.match(request, /maxAdLoadSuccessRate/);
  assert.match(request, /ipQualityStatus/);
  assert.match(request, /ipGranularity/);
  assert.match(request, /forceRefresh/);
  assert.match(service, /filterExitIpQualityRows/);
  assert.match(service, /exitIpGroupSql/);
  assert.match(service, /proxy_provider_variant_count/);
  assert.match(service, /forceRefresh/);
  assert.doesNotMatch(service, /array_slice\(\$allRows, 0, \$pageSize\)/);
  assert.match(service, /normalizedExitIpTargetSql/);
  assert.match(service, /redacted_target/);
  assert.match(service, /google_ads_host/);
  assert.match(service, /other_host/);
  assert.match(service, /session_small_ip_count/);
  assert.match(service, /session_large_ip_count/);
  assert.match(service, /session_group_count/);
  assert.match(service, /COALESCE\(NULLIF\(LOWER\(TRIM\(ip_ctx\.proxy_provider\)\), ''\), 'unknown'\)/);
});
