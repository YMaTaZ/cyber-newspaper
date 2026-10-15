/**
 * 检查改名后三个页面是否干净：
 *   - 不再有与宿主撞名的裸 --accent / --danger 定义
 *   - 三层兜底链是否真的补上了
 *   - JS 里引用的变量名有没有被误改
 */
import { readFileSync } from "node:fs";

const TARGETS = ["../ui/workbench.html", "../ui/settings.html", "../ui/status.html"];

let bad = 0;
for (const t of TARGETS) {
  const s = readFileSync(new URL(t, import.meta.url), "utf8");
  console.log(`\n=== ${t} ===`);

  const bareDefs = s.match(/(^|[^-\w])--(accent|danger|text|bg|border)\s*:/gm) || [];
  console.log(`  撞名裸定义: ${bareDefs.length}${bareDefs.length ? "  ✗" : "  ✓"}`);
  if (bareDefs.length) {
    bad++;
    bareDefs.forEach((d) => console.log(`      ${d.trim()}`));
  }

  const chain = s.match(/--dg-accent\s*:[^;]+;/g) || [];
  console.log(`  --dg-accent 定义: ${chain.length ? chain[0].slice(0, 120) : "无"}`);

  const paper = s.match(/--paper\s*:[^;]+;/g) || [];
  console.log(`  --paper 定义    : ${paper.length ? paper[0].slice(0, 130) : "无"}`);

  // on-accent 不该被牵连
  const wrong = /--dg-on-accent|--on-dg-accent/.test(s);
  console.log(`  --on-accent 误改: ${wrong ? "✗ 有" : "✓ 无"}`);
  if (wrong) bad++;

  // JS 侧引用
  const jsRefs = s.match(/setProperty\([^)]*\)|getPropertyValue\([^)]*\)/g) || [];
  jsRefs.forEach((r) => console.log(`      JS: ${r.slice(0, 110)}`));
}

console.log(bad === 0 ? "\n✓ 改名干净" : `\n✗ 有 ${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
