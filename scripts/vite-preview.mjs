#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const normalized = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--hostname") {
    normalized.push("--host", args[index + 1] ?? "127.0.0.1");
    index += 1;
  } else if (arg.startsWith("--hostname=")) {
    normalized.push(`--host=${arg.slice("--hostname=".length)}`);
  } else {
    normalized.push(arg);
  }
}
if (!normalized.some((arg) => arg === "--host" || arg.startsWith("--host="))) normalized.push("--host", "127.0.0.1");
if (!normalized.some((arg) => arg === "--port" || arg.startsWith("--port="))) normalized.push("--port", "3020");

const child = spawn("npx", ["vite", "preview", ...normalized], { stdio: "inherit", shell: false });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
