/**
 * 把 app 子进程（cyber-newspaper）在 17:29 之后的全部输出捞出来。
 *
 * 为什么要单独捞：宿主把 app 子进程的 stderr 记成
 *   [HH:MM:SS] [WARN] [cyber-newspaper] <原文>
 * 我先前按「同一行必须含 ERROR/WARN」过滤，会把不含这些词的
 * 错误原文（例如 Hono 默认处理打出的栈）整片漏掉。
 *
 * 目标：找出那条裸 500 到底由谁抛出。
 */
import { readFileSync } from "node:fs";

const LOG = "C:/Users/20769/.hanako/logs/2026-10-16_09-32-15.log";
const lines = readFileSync(LOG, "utf8").split(/\r?\n/);

let cur = null;
const groups = new Map();
for (const l of lines) {
  const m = l.match(/^\[(\d{2}:\d{2}:\d{2})/);
  if (m) cur = m[1];
  if (/cyber-newspaper/.test(l)) {
    if (!groups.has(cur)) groups.set(cur, []);
    groups.get(cur).push(l);
  }
}

console.log("=== 所有含 cyber-newspaper 的时间点 ===");
for (const [t, ls] of groups) {
  console.log(`  ${t}  ×${ls.length}`);
}

console.log("\n=== 17:29 之后的逐行 ===");
for (const [t, ls] of groups) {
  if (t < "17:29") continue;
  for (const l of ls) console.log(`  ${l.slice(0, 240)}`);
}

// 关键：找 Hono 打出的栈（含 at ... route / handler）
console.log("\n=== 全文里像「未捕获异常栈」的片段 ===");
const idxs = [];
lines.forEach((l, i) => {
  if (/^\s+at\s+.*(?:hono|dispatch|routeApp|fetch)/i.test(l)) idxs.push(i);
});
console.log(`  命中 ${idxs.length} 处`);
for (const i of idxs.slice(-12)) {
  console.log(`  --- L${i + 1} ---`);
  for (let k = Math.max(0, i - 6); k <= Math.min(lines.length - 1, i + 3); k++) {
    console.log(`    ${lines[k].slice(0, 210)}`);
  }
}
