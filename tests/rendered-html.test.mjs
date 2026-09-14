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
  assert.match(js, /V141/);
  assert.match(js, /sidebar-collapsed/);
  assert.match(js, /广告链路总表/);
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
