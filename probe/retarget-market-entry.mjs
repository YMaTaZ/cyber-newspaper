/**
 * 把市场仓库里的 cyber-newspaper 条目改指向新版本（0.6.2 -> 0.6.3）。
 *
 * 为什么是"替换"而不是"追加"：
 *   第一次投稿登记的 tag/sha256 已经过时（那个包带着误导性报错的 bug）。
 *   PR 还没合并，直接改掉同一条即可，不需要留两条。
 *   规则里的「禁止同版本替换安装包」针对的是已上架版本，
 *   这里是换一个新版本号，合规。
 *
 * 用法：node retarget-market-entry.mjs <市场仓库目录>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = process.argv[2];
if (!repoDir) {
  console.error("用法：node probe/retarget-market-entry.mjs <市场仓库目录>");
  process.exit(1);
}

const SUB = join(ROOT, "probe", "out", "market-submission");
const newReg = JSON.parse(readFileSync(join(SUB, "registry-entry.json"), "utf8"));
const newAppr = JSON.parse(readFileSync(join(SUB, "approvals-entry.json"), "utf8"));

// registry.json：同 id 覆盖（本次其实没变，但幂等处理更稳）
const regPath = join(repoDir, "registry.json");
const reg = JSON.parse(readFileSync(regPath, "utf8"));
const ri = reg.entries.findIndex((e) => e.kind === newReg.kind && e.id === newReg.id);
if (ri >= 0) {
  reg.entries[ri] = newReg;
  console.log(`registry.json: 覆盖第 ${ri} 条（共 ${reg.entries.length}）`);
} else {
  reg.entries.push(newReg);
  console.log(`registry.json: 追加（现共 ${reg.entries.length}）`);
}
writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");

// approvals.json：同 id 覆盖成新 tag / 新 sha256
const apprPath = join(repoDir, "approvals.json");
const appr = JSON.parse(readFileSync(apprPath, "utf8"));
const ai = appr.approvals.findIndex((a) => a.kind === newAppr.kind && a.id === newAppr.id);
if (ai < 0) {
  console.error("✗ approvals.json 里找不到该条目，不该发生");
  process.exit(1);
}
const before = { tag: appr.approvals[ai].tag, sha: appr.approvals[ai].sha256 };
appr.approvals[ai] = newAppr;
writeFileSync(apprPath, JSON.stringify(appr, null, 2) + "\n", "utf8");

console.log(`\napprovals.json: 覆盖第 ${ai} 条`);
console.log(`  tag    : ${before.tag}  ->  ${newAppr.tag}`);
console.log(`  sha256 : ${before.sha.slice(0, 16)}…  ->  ${newAppr.sha256.slice(0, 16)}…`);
console.log(`  readme : ${newAppr.readme.length} 字符`);
console.log(`  总数仍为 ${appr.approvals.length}（没有新增条目）`);
