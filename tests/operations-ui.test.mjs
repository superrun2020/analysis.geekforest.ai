import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Analysis exposes only native daily anomalies and retains authenticated API session", async () => {
  const source = await readFile(new URL("../app/operations-workspace.tsx", import.meta.url), "utf8");
  assert.match(source,/DailyAnomalies/);assert.match(source,/每日异常/);
  assert.doesNotMatch(source,/<iframe|contentWindow|operations-subnav|embedded=1/);
  assert.doesNotMatch(source,/label:\s*["'](?:运营总览|项目管理|问题跟进|自动监控|项目与Owner|设置与采集)/);
  assert.match(source,/\/operations\/session/);assert.match(source,/getCompanyAuthToken/);
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/popstate/);assert.match(page,/legacyOperationsEntries/);
});

test("daily anomalies visibly explain package reasons, denominators, and coverage", async () => {
  const source = await readFile(new URL("../app/daily-anomalies.jsx", import.meta.url), "utf8");
  assert.match(source, /筛选依据 \/ 样本/);
  assert.match(source, /失败原因/);
  assert.match(source, /另.*类.*展开全部/);
  assert.match(source, /错误日志分布（事件口径）/);
  assert.match(source, /failureReasonDistribution/);
  assert.match(source, /raw event total/);
  assert.match(source, /all-source incl retries/);
  assert.match(source, /request\/final scope/);
  assert.match(source, /checkedAt/);
  assert.match(source, /来源不可用|无观测/);
  assert.match(source, /当前分子 \/ 分母/);
  assert.match(source, /identityCoverage/);
  assert.match(source, /sessionCoverage/);
  assert.match(source, /广告浏览者比例/);
  assert.match(source, /TCP明确握手低于.*或下降/);
  assert.match(source, /广告加载终态低于.*或下降/);
  assert.match(source, /VPN连接成功率（终态）=结果日成功终态/);
});

test("daily anomalies fence stale requests and distinguish revocation from transient availability", async () => {
  const source = await readFile(new URL("../app/daily-anomalies.jsx", import.meta.url), "utf8");
  assert.match(source,/generationRef/);
  assert.match(source,/abortAll/);
  assert.match(source,/\[401,403\]\.includes/);
  assert.match(source,/onAuthRevoked/);
  assert.match(source,/未获取数据 \/ 采集状态暂不可读取/);
  assert.match(source,/checkedAt/);
  const workspace = await readFile(new URL("../app/operations-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace,/method:\s*["']DELETE["']/);
  assert.match(workspace,/response\.status/);
});

test("legacy nine operations URLs map only to fixed Analysis destinations", async () => {
  const source = await readFile(new URL("../scripts/operations-bridge.mjs", import.meta.url), "utf8");
  for (const view of ["Overview", "Projects", "Issues", "Team", "Acceptance", "Rules", "Alerts", "Runs", "Status"]) assert.match(source, new RegExp(`operations${view}`));
  assert.doesNotMatch(source, /redirect(?:Url|To)\s*=\s*req/);
});
