/**
 * 把 cyber-newspaper 追加到市场仓库的 registry.json 与 approvals.json。
 *
 * 为什么用脚本改而不是手编：
 *   这两个文件各 97 条记录，手改容易碰坏 JSON 或漏逗号。
 *   脚本保留原有全部条目与字段顺序，只在数组末尾追加，并把缩进还原成原样。
 *
 * 用法：node apply-market-entry.mjs <市场仓库目录>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const repoDir = process.argv[2];
if (!repoDir) {
  console.error("用法：node apply-market-entry.mjs <市场仓库目录>");
  process.exit(1);
}

const SUB = join(ROOT, "probe", "out", "market-submission");
const regEntry = JSON.parse(readFileSync(join(SUB, "registry-entry.json"), "utf8"));
const apprEntry = JSON.parse(readFileSync(join(SUB, "approvals-entry.json"), "utf8"));

// ---------- registry.json ----------
const regPath = join(repoDir, "registry.json");
const reg = JSON.parse(readFileSync(regPath, "utf8"));

if (reg.entries.some((e) => e.kind === regEntry.kind && e.id === regEntry.id)) {
  // 已存在就就地更新，不新增。字段虽然一般不变，但仓库地址或发布者改过就要跟上。
  const at = reg.entries.findIndex((e) => e.kind === regEntry.kind && e.id === regEntry.id);
  reg.entries[at] = { ...reg.entries[at], ...regEntry };
  console.log("registry.json: 条目已存在，就地更新");
} else {
  reg.entries.push(regEntry);
  console.log(`registry.json: 追加 1 条，现共 ${reg.entries.length} 条`);
}
// 原文件是 2 空格缩进、以换行结尾
writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");

// ---------- approvals.json ----------
const apprPath = join(repoDir, "approvals.json");
const appr = JSON.parse(readFileSync(apprPath, "utf8"));

if (appr.approvals.some((a) => a.kind === apprEntry.kind && a.id === apprEntry.id)) {
  // 版本更新走的就是这条路：同一个 id，tag 与 sha256 换成新包。
  // 不追第二条，否则市场会看见同一扩展两条互相矛盾的批准记录。
  const at = appr.approvals.findIndex((a) => a.kind === apprEntry.kind && a.id === apprEntry.id);
  const before = appr.approvals[at];
  appr.approvals[at] = { ...before, ...apprEntry };
  console.log("approvals.json: 条目已存在，就地更新");
  console.log(`  tag   : ${before.tag} → ${apprEntry.tag}`);
  console.log(`  sha256: ${String(before.sha256).slice(0, 12)}… → ${apprEntry.sha256.slice(0, 12)}…`);
} else {
  appr.approvals.push(apprEntry);
  console.log(`approvals.json: 追加 1 条，现共 ${appr.approvals.length} 条`);
}
writeFileSync(apprPath, JSON.stringify(appr, null, 2) + "\n", "utf8");

// ---------- 自检：只多了我们这一条，别的没动 ----------
const regAfter = JSON.parse(readFileSync(regPath, "utf8"));
const apprAfter = JSON.parse(readFileSync(apprPath, "utf8"));
const mine = regAfter.entries.filter((e) => e.id === "cyber-newspaper");
const mineA = apprAfter.approvals.filter((a) => a.id === "cyber-newspaper");
console.log("\n=== 自检 ===");
console.log("  registry 条目数:", regAfter.entries.length, "(原 97)");
console.log("  approvals 条目数:", apprAfter.approvals.length, "(原 97)");
console.log("  我们的 registry 条目:", JSON.stringify(mine[0]));
console.log("  我们的 approvals sha256:", mineA[0]?.sha256);
console.log("  approvals tag:", mineA[0]?.tag);
console.log("  approvals readme 长度:", mineA[0]?.readme?.length);
