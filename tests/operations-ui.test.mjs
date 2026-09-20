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

test("legacy nine operations URLs map only to fixed Analysis destinations", async () => {
  const source = await readFile(new URL("../scripts/operations-bridge.mjs", import.meta.url), "utf8");
  for (const view of ["Overview", "Projects", "Issues", "Team", "Acceptance", "Rules", "Alerts", "Runs", "Status"]) assert.match(source, new RegExp(`operations${view}`));
  assert.doesNotMatch(source, /redirect(?:Url|To)\s*=\s*req/);
});
