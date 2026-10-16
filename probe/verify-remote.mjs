/**
 * 核对远程 main 是否真的收到了本地改动。
 *
 * 为什么单独查：经 API 推送是压缩提交，不能只看命令返回成功 ——
 * 要确认远程那份 index.js 与本地逐字一致、修复确实在里面。
 *
 * 用法：node probe/verify-remote.mjs <owner/repo>
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.argv[2] || "YMaTaZ/cyber-newspaper";
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const H = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "User-Agent": "cyber-newspaper",
};

async function raw(path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main`, { headers: H });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.text();
}

const h = (s) => createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

console.log(`=== 远程 ${repo}:main 与本地比对（行尾符已归一）===`);
for (const f of ["index.js", "manifest.json", "pack.ps1"]) {
  const remote = await raw(f);
  const local = readFileSync(join(ROOT, f), "utf8");
  const same = h(remote) === h(local);
  console.log(`  ${same ? "✓" : "✗"} ${f.padEnd(14)} 远程 ${h(remote)}  本地 ${h(local)}`);
}

const idx = await raw("index.js");
console.log("\n=== 远程 index.js 里该有的东西 ===");
for (const [name, re] of [
  ["瞬时故障重试", /streamWithTransientRetry/],
  ["截断抢救", /salvageTruncatedJson/],
  ["HTTP 状态码透传", /模型调用失败：HTTP/],
  ["salvaged 标记", /salvaged: true/],
]) {
  console.log(`  ${re.test(idx) ? "✓" : "✗"} ${name}`);
}
console.log("  版本:", JSON.parse(await raw("manifest.json")).version);

const head = JSON.parse(
  execFileSync("gh", ["api", `repos/${repo}/commits/main`, "--jq", "{sha:.sha,msg:.commit.message}"], {
    encoding: "utf8",
  })
);
console.log(`\n  远程 HEAD: ${head.sha.slice(0, 7)}`);
console.log(`  提交首行 : ${String(head.msg).split("\n")[0]}`);
