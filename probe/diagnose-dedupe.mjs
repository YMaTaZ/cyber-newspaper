/**
 * 诊断：真实数据里有没有该合并的条目？
 * 输出相似度最高的若干对，人工判断该不该合并。
 */
import { readFileSync } from "node:fs";
import { similarity, entityOverlap, normalizeTitle } from "../lib/pipeline/dedupe.js";

const { candidates } = JSON.parse(readFileSync(new URL("./out/candidates.json", import.meta.url), "utf8"));

const pairs = [];
for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const s = similarity(candidates[i].title, candidates[j].title);
    const e = entityOverlap(candidates[i].title, candidates[j].title);
    pairs.push({ s, e, a: candidates[i], b: candidates[j] });
  }
}
pairs.sort((x, y) => Math.max(y.s, y.e) - Math.max(x.s, x.e));

console.log("\n=== 真实数据中相似度最高的 12 对 ===\n");
for (const p of pairs.slice(0, 12)) {
  console.log(`词级 ${p.s.toFixed(2)}  实体 ${p.e.toFixed(2)}`);
  console.log(`  A [${p.a.ref}][${p.a.sources.join("+")}] ${p.a.title.slice(0, 70)}`);
  console.log(`  B [${p.b.ref}][${p.b.sources.join("+")}] ${p.b.title.slice(0, 70)}`);
  console.log("");
}

console.log("=== 各源标题语言分布 ===");
const bySrc = {};
for (const c of candidates) {
  for (const s of c.sources) {
    bySrc[s] = bySrc[s] ?? [];
    bySrc[s].push(c.title);
  }
}
for (const [k, v] of Object.entries(bySrc)) {
  const zh = v.filter((t) => /[\u4e00-\u9fa5]/.test(t)).length;
  console.log(`  ${k.padEnd(12)} ${String(v.length).padStart(3)} 条，其中中文标题 ${zh} 条`);
}
