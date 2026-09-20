import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Analysis exposes four operations entries while retaining one mounted iframe", async () => {
  const source = await readFile(new URL("../app/operations-workspace.tsx", import.meta.url), "utf8");
  for (const label of ["运营总览", "项目管理", "问题跟进", "自动监控"]) assert.match(source, new RegExp(label));
  for (const label of ["经营", "团队", "项目", "问题", "告警", "验收", "规则", "运行", "状态"]) assert.match(source, new RegExp(`label: "${label}"`));
  assert.equal((source.match(/<iframe/g) || []).length, 1);
  assert.match(source, /display:\s*active/);
  assert.match(source, /正在建立安全运营会话/);
  assert.match(source, /运营服务连接较慢/);
  assert.match(source, /运营服务暂不可用/);
  assert.match(source, /data-bootstrap-count/);
  assert.match(source, /retryGeneration/);
  assert.match(source, /src="\/operations\/\?embedded=1#\/overview"/);
  assert.doesNotMatch(source, /src=\{[^}]*page/);
});

test("legacy nine operations URLs map only to fixed Analysis destinations", async () => {
  const source = await readFile(new URL("../scripts/operations-bridge.mjs", import.meta.url), "utf8");
  for (const view of ["Overview", "Projects", "Issues", "Team", "Acceptance", "Rules", "Alerts", "Runs", "Status"]) assert.match(source, new RegExp(`operations${view}`));
  assert.doesNotMatch(source, /redirect(?:Url|To)\s*=\s*req/);
});
