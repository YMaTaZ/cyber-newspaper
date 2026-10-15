/**
 * 校验 entry.json 声明的 size / sha256 与实际 zip 一致。
 *
 * 为什么必须有这道门禁：
 *   市场安装时会按索引里声明的 archive.size 和 archive.sha256 校验下载到的字节。
 *   任何一个对不上，安装直接失败并报「包已损坏或索引过期」——而用户看到的
 *   是一个装不上的包，看不出是打包环节的错。
 *
 *   本项目真发生过：旧 pack.ps1 先用官方打包器算好 size/sha256 写进 entry.json，
 *   再用另一个脚本从 zip 里删开发文件。zip 被改小了，声明值却停在删除前 ——
 *   声明 6144448 字节，实际 3089432，正好差一倍。
 *
 * 判据是等号，不是"差不多"：这两个值要么精确相等，要么这个包不能发。
 *
 * 用法：node probe/check-entry-integrity.mjs [zip 路径]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function findZip() {
  if (process.argv[2]) return process.argv[2];
  const dist = join(ROOT, "dist-extensions");
  if (!existsSync(dist)) return null;
  const zips = readdirSync(dist).filter((f) => f.endsWith(".zip"));
  if (!zips.length) return null;
  zips.sort((a, b) => statSync(join(dist, b)).mtimeMs - statSync(join(dist, a)).mtimeMs);
  return join(dist, zips[0]);
}

const zip = findZip();
if (!zip) {
  console.error("✗ 找不到发布包（先跑 pack.ps1）");
  process.exit(1);
}

// entry.json 与 zip 同目录、同主名
const entryPath = zip.replace(/\.zip$/, ".entry.json");
if (!existsSync(entryPath)) {
  console.error(`✗ 找不到配套的 entry.json：${basename(entryPath)}`);
  console.error("  官方打包器会同时产出两个文件，缺一个市场都不认。");
  process.exit(1);
}

console.log("\n=== 校验声明值 ===");
console.log(`  ${basename(zip)}`);

let entry;
try {
  entry = JSON.parse(readFileSync(entryPath, "utf8"));
} catch (e) {
  console.error(`  ✗ entry.json 解析失败：${e.message}`);
  process.exit(1);
}

const bytes = readFileSync(zip);
const actualSize = statSync(zip).size;
const actualSha = createHash("sha256").update(bytes).digest("hex");

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};

const declaredSize = entry?.archive?.size;
const declaredSha = entry?.archive?.sha256;

check(
  "archive.size 与实际字节一致",
  declaredSize === actualSize,
  declaredSize === actualSize
    ? `${actualSize}`
    : `声明 ${declaredSize}，实际 ${actualSize}（差 ${actualSize - declaredSize}）`
);

check(
  "archive.sha256 与实际一致",
  declaredSha === actualSha,
  declaredSha === actualSha ? `${actualSha.slice(0, 16)}…` : `声明 ${String(declaredSha).slice(0, 16)}…，实际 ${actualSha.slice(0, 16)}…`
);

// 顺手核一下别的必填项：市场索引 schema 要求这些非空
check("publisher 非空", typeof entry.publisher === "string" && entry.publisher.trim().length > 0, entry.publisher);
check("id 与文件名一致", basename(zip).includes(entry.id), entry.id);
check("version 非空", typeof entry.version === "string" && entry.version.length > 0, entry.version);
check(
  "archive.url 仍是占位符",
  typeof entry?.archive?.url === "string" && entry.archive.url.startsWith("{{BASE_URL}}"),
  entry?.archive?.url
);
check("format 是 zip", entry?.archive?.format === "zip", entry?.archive?.format);

// 市场对 zip 有 300 MiB 上限
const LIMIT = 314572800;
check(`体积在上限内（${(LIMIT / 1024 / 1024).toFixed(0)} MiB）`, actualSize <= LIMIT, `${(actualSize / 1024 / 1024).toFixed(2)} MiB`);

console.log(fail === 0 ? "\n✓ 声明值与实际字节一致" : `\n✗ ${fail} 项不合格，这个包不能发`);
process.exit(fail ? 1 : 0);
