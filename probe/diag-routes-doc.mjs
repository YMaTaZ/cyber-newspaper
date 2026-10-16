import { readFileSync } from "node:fs";
const F = "C:/Users/20769/.hanako/artifacts/server/1.1.7-beta-win32-x64-4460b4c2a6bae210-gcd7ced270b9802f6/APPS.md";
const lines = readFileSync(F, "utf8").split("\n");

// 路由节 L1613 - L2767
const S = 1612, E = 2766;
console.log("=== 路由节里含 超时/秒/流式/长任务/后台 的行 ===");
for (let i = S; i <= E && i < lines.length; i++) {
  const l = lines[i];
  if (/超时|timeout|30 ?秒|60 ?秒|流式|stream|后台|长任务|轮询|poll|SSE|EventSource/i.test(l)) {
    console.log(`  L${i + 1}: ${l.trim().slice(0, 220)}`);
  }
}

// 按需激活与流式路由节
const heads = [];
lines.forEach((l, i) => { if (/^#{2,4}\s/.test(l)) heads.push({ i, t: l.trim() }); });
const st = heads.find((h) => /按需激活与流式路由/.test(h.t));
if (st) {
  const nx = heads.find((h) => h.i > st.i);
  const end = nx ? nx.i : lines.length;
  console.log(`\n=== ${st.t}（L${st.i + 1}–${end}）===`);
  console.log(lines.slice(st.i, Math.min(end, st.i + 80)).map((l) => `  ${l.slice(0, 210)}`).join("\n"));
}
