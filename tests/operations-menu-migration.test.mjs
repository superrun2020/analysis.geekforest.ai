import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analysisOperationsMenuGroup, legacyAnalysisDestinations, legacyOperationsAnalysisRedirect, operationsMenuForEnvironment, operationsMenuMigrationEnabled } from "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system/lib/operations-menu-migration.mjs";

test("OA one-entry operations menu migration is explicitly off by default", () => {
  const existing = { items: Array.from({ length: 9 }, (_, index) => ({ view: `old-${index}` })) };
  assert.equal(operationsMenuMigrationEnabled({}), false);
  assert.equal(operationsMenuMigrationEnabled({ OA_ANALYSIS_OPERATIONS_MENU_ENABLED: "true" }), false);
  assert.equal(operationsMenuForEnvironment(existing, {}), existing);
  assert.equal(legacyOperationsAnalysisRedirect("operationsAlerts", {}), "");
});

test("real OA server and frontend wire the default-off gate and fixed destinations", async () => {
  const root = "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system";
  const server = await readFile(`${root}/server.js`, "utf8");
  const frontend = await readFile(`${root}/frontend/oa/src/OaFrameworkApp.tsx`, "utf8");
  assert.match(server, /operationsMenuForEnvironment\(operationsMenuGroup\)/);
  assert.match(server, /legacyOperationsRedirectsForEnvironment\(process\.env\)/);
  assert.match(server, /registerOperationsIdentityApi\(app,/);
  assert.match(frontend, /legacyOperationsRedirects/);
  assert.match(frontend, /window\.location\.assign\(destination\)/);
});

test("enabled OA migration has one menu entry and exact allowlisted old-view destinations", () => {
  const env = { OA_ANALYSIS_OPERATIONS_MENU_ENABLED: "1" };
  assert.equal(operationsMenuForEnvironment({ items: [] }, env), analysisOperationsMenuGroup);
  assert.deepEqual(analysisOperationsMenuGroup.items, [{ view: "operationsAnalysis", title: "运营管理台", destination: "https://analysis.geekforest.ai/?operations=overview&operationsPage=overview" }]);
  assert.deepEqual(Object.keys(legacyAnalysisDestinations), ["operationsOverview", "operationsProjects", "operationsIssues", "operationsTeam", "operationsAcceptance", "operationsRules", "operationsAlerts", "operationsRuns", "operationsStatus"]);
  assert.match(legacyOperationsAnalysisRedirect("operationsAcceptance", env), /operationsPage=acceptance$/);
  assert.match(legacyOperationsAnalysisRedirect("operationsAlerts", env), /operationsPage=alerts$/);
  assert.equal(legacyOperationsAnalysisRedirect("https://evil.example", env), "");
});
