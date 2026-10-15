/**
 * 管线运行器（阶段一验收用）
 *
 * 跑：抓取 → 归并去重 → 候选池 → 编辑层输入
 * 产出：probe/out/candidates.json、probe/out/prompt.txt
 *
 * 用法：node probe/run-pipeline.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAll } from "../lib/sources/index.js";
import { buildCandidatePool } from "../lib/pipeline/dedupe.js";
import { buildEditorialInput, EDITORIAL_SYSTEM_PROMPT } from "../lib/editorial/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

/** App 里换成 sdk.network.fetch 的包装；这里用全局 fetch */
async function fetcher(url, { headers, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.name = "HttpError";
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const t0 = Date.now();

console.log("① 抓取…");
const { items, report } = await fetchAll({ fetcher, windowHours: 24 });

console.log("\n  源报告：");
for (const r of report) {
  const flag = r.ok ? "OK  " : "FAIL";
  console.log(`    ${flag} ${r.id.padEnd(12)} ${String(r.count).padStart(3)} 条${r.widened ? "  (已放宽到48h)" : ""}${r.error ? "  " + r.error : ""}`);
}
console.log(`  原始条目合计：${items.length}`);

console.log("\n② 归并去重…");
const { candidates, stats } = buildCandidatePool(items, { maxCandidates: 40 });
console.log(`  原始 ${stats.rawCount} → 合并后 ${stats.mergedCount} → 池内 ${stats.poolSize}（截断 ${stats.truncated}）`);
console.log(`  多源交叉：${stats.crossSource} 条`);

console.log("\n③ 生成编辑层输入…");
const date = new Date().toISOString().slice(0, 10);
const input = buildEditorialInput(candidates, { date });

writeFileSync(join(OUT, "candidates.json"), JSON.stringify({ date, report, stats, candidates }, null, 2), "utf8");
writeFileSync(join(OUT, "prompt.txt"), `===== SYSTEM =====\n${EDITORIAL_SYSTEM_PROMPT}\n\n===== USER =====\n${input}\n`, "utf8");

console.log(`  写入 probe/out/candidates.json`);
console.log(`  写入 probe/out/prompt.txt`);

console.log("\n④ 候选池预览（前 12 条）：");
for (const c of candidates.slice(0, 12)) {
  const heat = [c.points && `HN${c.points}`, c.stars && `★${c.stars}`, c.sources.length > 1 && `多源(${c.sources.join("+")})`]
    .filter(Boolean).join(" ");
  console.log(`  [${String(c.ref).padStart(2)}] ${String(c.title).slice(0, 62).padEnd(64)} ${heat}`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n耗时 ${elapsed}s（判据 ≤120s）`);

const okSources = report.filter((r) => r.ok).length;
const pass = okSources >= 6 && candidates.length >= 5;
console.log(`\n判据：源 ${okSources}/8 ≥6　池 ${candidates.length} ≥5`);
console.log(`参考：多源交叉 ${stats.crossSource} 条（不阻塞。跨源重叠取决于当天新闻，
      实测多数日子中英文源报道的事件并不重叠，0 是正常值）`);
console.log(pass ? "✓ 管线通过" : "✗ 管线未达判据");
process.exit(pass ? 0 : 1);
