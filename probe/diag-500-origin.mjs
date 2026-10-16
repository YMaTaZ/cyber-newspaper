/**
 * 最后一次取证：那条裸 500 到底由谁抛出。
 *
 * 已知：
 *   · 宿主 Hono 默认错误处理 = console.error(err) + 纯文本 "Internal Server Error" 500
 *   · 我的每个路由都有 try/catch，失败必写日志；17:29 之后日志里没有任何 app 错误
 *   · 归档里 NO.003 是 17:31:13 成功写入的
 * 所以要么「请求根本没进我的代码」，要么「宿主先断了我还在跑」。
 *
 * 这个脚本横扫所有可能留下痕迹的文件，找 callback.routes.fetch / RPC 超时 / 500。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/20769/.hanako/logs",
  "C:/Users/20769/.hanako/diagnostics",
  "C:/Users/20769/.hanako/.ephemeral",
];

const NEEDLES = [
  "callback.routes.fetch",
  "CallbackRoutesFetch",
  "Internal Server Error",
  "digest/run",
  "RPC ",
  "timed out",
  "APP_RPC",
];

function walk(dir, depth = 0) {
  const out = [];
  if (depth > 3) return out;
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, depth + 1));
    else if (/\.(log|jsonl|json|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
console.log(`扫描 ${files.length} 个文件\n`);

for (const f of files) {
  let text;
  try {
    if (statSync(f).size > 40 * 1024 * 1024) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const hits = NEEDLES.filter((n) => text.includes(n));
  if (!hits.length) continue;

  console.log(`=== ${f.replace("C:/Users/20769/.hanako", "~")} ===`);
  const lines = text.split(/\r?\n/);
  for (const n of hits) {
    const found = lines.filter((l) => l.includes(n));
    console.log(`  [${n}] ${found.length} 条`);
    for (const l of found.slice(0, 4)) console.log(`      ${l.slice(0, 200)}`);
  }
  console.log("");
}
