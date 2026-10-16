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
import { join } from "node:path";

const repoDir = process.argv[2];
if (!repoDir) {
  console.error("用法：node apply-market-entry.mjs <市场仓库目录>");
  process.exit(1);
}

const SUB = "F:/OH-WorkSpace/04_Hana与工具开发/cyber-newspaper/probe/out/market-submission";
const regEntry = JSON.parse(readFileSync(join(SUB, "registry-entry.json"), "utf8"));
const apprEntry = JSON.parse(readFileSync(join(SUB, "approvals-entry.json"), "utf8"));

// ---------- registry.json ----------
const regPath = join(repoDir, "registry.json");
const reg = JSON.parse(readFileSync(regPath, "utf8"));

if (reg.entries.some((e) => e.kind === regEntry.kind && e.id === regEntry.id)) {
  console.log("registry.json 已存在该条目，跳过");
} else {
  reg.entries.push(regEntry);
  // 原文件是 2 空格缩进、以换行结尾
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");
  console.log(`registry.json: 追加 1 条，现共 ${reg.entries.length} 条`);
}

// ---------- approvals.json ----------
const apprPath = join(repoDir, "approvals.json");
const appr = JSON.parse(readFileSync(apprPath, "utf8"));

if (appr.approvals.some((a) => a.kind === apprEntry.kind && a.id === apprEntry.id)) {
  console.log("approvals.json 已存在该条目，跳过");
} else {
  appr.approvals.push(apprEntry);
  writeFileSync(apprPath, JSON.stringify(appr, null, 2) + "\n", "utf8");
  console.log(`approvals.json: 追加 1 条，现共 ${appr.approvals.length} 条`);
}

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
