import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Analysis owns the single native daily-anomaly entry; deleted OA menus stay deleted", async () => {
  const workspace = await readFile(new URL("../app/operations-workspace.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /operationsEntries:[^=]+\= \[\{key:"overview",label:"每日异常"\}\]/);
  assert.doesNotMatch(workspace, /运营总览|项目管理|问题跟进|自动监控|项目与Owner|设置与采集/);
  assert.doesNotMatch(workspace, /iframe|embedded=1/);
  assert.match(page, /legacyOperationsEntries/);
  assert.match(page, /searchParams\.set\("operations", "overview"\)/);
});
