import fs from "node:fs";

const input = "/Users/oliver/Documents/Codex/outputs/launcher-v18-20260816/feishu-tsv/01.tsv";
const output = new URL("../app/launcher-v18-catalog.ts", import.meta.url);
const lines = fs.readFileSync(input, "utf8").split(/\r?\n/).map((line) => line.split("\t"));
const headerIndex = lines.findIndex((row) => row[0] === "事件模块" && row[1] === "标准事件名");
if (headerIndex < 0) throw new Error("Launcher TSV header not found");
const headers = lines[headerIndex];
const index = Object.fromEntries(headers.map((name, position) => [name, position]));
const eventMap = new Map();
for (const row of lines.slice(headerIndex + 1)) {
  const name = row[index["标准事件名"]]?.trim();
  const fieldName = row[index["标准属性名"]]?.trim();
  if (!name || !fieldName) continue;
  if (!eventMap.has(name)) eventMap.set(name, {
    id: `launcher:${name}`,
    name,
    displayName: row[index["事件显示名"]]?.trim() || name,
    stage: row[index["事件模块"]]?.trim() || "Launcher",
    priority: "P2",
    trackingLocation: row[index["具体打点位置"]]?.trim() || "按规范接入",
    triggerTiming: row[index["上报时机"]]?.trim() || "按规范触发",
    metricPurpose: row[index["中台指标/用途"]]?.trim() || row[index["分析目标"]]?.trim() || "事件覆盖验收",
    parameters: [],
  });
  const event = eventMap.get(name);
  const rawPriority = row[index["参数优先级"]]?.trim() || "P2";
  if (rawPriority.includes("P0")) event.priority = "P0";
  else if (rawPriority.includes("P1") && event.priority !== "P0") event.priority = "P1";
  event.parameters.push({
    name: fieldName,
    displayName: row[index["属性显示名"]]?.trim() || fieldName,
    dataType: row[index["Firebase类型"]]?.trim() || "String",
    reportingMode: `${rawPriority}｜${row[index["是否必须"]]?.trim() || "可选"}`,
    description: row[index["枚举/校验规则"]]?.trim() || row[index["字段设置原因"]]?.trim() || "按 Launcher V1.8 规范上报",
  });
}
const events = [...eventMap.values()];
const source = `// Generated from the verified Feishu TSV snapshot.\nexport const launcherV18Source = ${JSON.stringify({ version: "V1.8-Launcher.2", eventCount: events.length, fieldCount: events.reduce((sum, event) => sum + event.parameters.length, 0), sourceUrl: "https://geekforest.feishu.cn/wiki/HQiGwOyNUibgw9kKaQ4c06bZnHc" }, null, 2)} as const;\n\nexport const launcherV18Events = ${JSON.stringify(events, null, 2)} as const;\n`;
fs.writeFileSync(output, source);
console.log(JSON.stringify({ output: output.pathname, events: events.length, fields: events.reduce((sum, event) => sum + event.parameters.length, 0) }));
