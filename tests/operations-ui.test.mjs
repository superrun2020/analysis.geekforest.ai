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
  // Overall replaces the old nested top-three/error modal with server-paginated
  // grouping. Actual counts, escaping, packages and complete CSV are exercised
  // by daily-overall-browser.py against the real SQLite-backed HTTP handler.
  for(const text of ['matrix-overall-config','overall-result-card','触发依据 / 样本','错误 category','错误 code','错误 message（已脱敏）','raw总量','含重试','request去重口径','checkedAt','errorCheckedAt','分子','分母','覆盖 / 来源新鲜度','受影响项目 / 包','来源缺失显示不可用'])assert.ok(source.includes(text),text);
  assert.match(source,/r\.semantics/);assert.match(source,/baselineNumerator/);assert.match(source,/baselineDenominator/);
  assert.match(source,/api\/anomalies\/details/);assert.match(source,/api\/anomalies\/export/);
});

test("daily anomalies fence stale requests and distinguish revocation from transient availability", async () => {
  const source = await readFile(new URL("../app/daily-anomalies.jsx", import.meta.url), "utf8");
  assert.match(source,/generation\.current/);
  assert.match(source,/abortAll/);
  assert.match(source,/\[401,403\]\.includes/);
  assert.match(source,/onAuthRevoked/);
  assert.match(source,/采集状态暂不可读取/);assert.match(source,/保留上次成功条件/);assert.match(source,/setSnapshot\(null\)/);
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
