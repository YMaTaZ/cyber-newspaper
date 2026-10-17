/**
 * 市场规则门禁：把官方同步器里**机器会真拒**的那些约束，搬到本地跑一遍。
 *
 * 为什么要有这个：
 *   市场的规则分两半。CONTRIBUTING.md 是给人读的条款；真正会拒你的，
 *   是 hana-marketplace/scripts/extension-market-sync.mjs 里的 throw。
 *   同时长任务"踩线不自知" —— 校验器只有在维护者点了批准、工作流真跑起来之后
 *   才会判你，而那时候 PR 已经挂在外面了。
 *   这里把那些 throw 提前到打包阶段，用的是与同步器**逐字相同**的正则与上限。
 *
 * 依据（都抄自 extension-market-sync.mjs，改动时请对照上游）：
 *   L22  isSafeExtensionId       /^[a-z0-9][a-z0-9._-]{0,127}$/ 且不以 . - 结尾、不含 .. 与 --
 *   L771 REPOSITORY_RE           /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/
 *   L772 TAG_RE                  /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/
 *   L773 SHA256_RE               /^[0-9a-f]{64}$/
 *   L718 parsePluginVersion      ^v?(\d+)(\.(\d+))?(\.(\d+))?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$
 *   L37  MAX_MARKET_ARCHIVE_BYTES 300 MiB
 *   L38  MAX_MARKET_README_BYTES  2 MiB
 *   L767 MAX_ENTRY_BYTES          512 KiB
 *   L783/L790 registry  的 exactKeys
 *   L811/L829 approvals 的 exactKeys
 *   L870 assertVersion / L918-937 entry 校验 / L1061-1067 附件名与 sha 一致性
 *
 * 它不联网、不下载：只核对本地产物之间、以及与登记片段之间是否自洽。
 * 真正"下载回来再比对"的那一步由官方同步器做（见 probe/README 里的命令）。
 *
 * 用法：node probe/check-market-rules.mjs
 * 若还没打包或还没生成投稿片段，会明确说缺哪一步，而不是假装通过。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 与同步器逐字相同的常量 ----------
const EXTENSION_KINDS = ["app", "skill", "recipe", "connector", "role", "bundle"];
const REPOSITORY_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_MARKET_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MAX_MARKET_README_BYTES = 2 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;

let pass = 0;
let fail = 0;
const ok = (label, detail = "") => {
  pass++;
  console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`);
};
const bad = (label, detail = "") => {
  fail++;
  console.log(`  ✗ ${label}${detail ? "  " + detail : ""}`);
};
const check = (cond, label, detail = "") => (cond ? ok(label, detail) : bad(label, detail));

function isSafeExtensionId(id) {
  if (typeof id !== "string") return false;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) return false;
  if (id.endsWith(".") || id.endsWith("-")) return false;
  if (id.includes("..") || id.includes("--")) return false;
  return true;
}
const isSafeRepository = (r) => {
  if (typeof r !== "string" || !REPOSITORY_RE.test(r)) return false;
  const [owner, repo] = r.split("/");
  return OWNER_RE.test(owner) && owner !== "." && owner !== ".." && repo !== "." && repo !== "..";
};
const exactKeys = (obj, keys) => {
  const extra = Object.keys(obj).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in obj));
  return { extra, missing };
};

// ---------- 读产物 ----------
const manifestPath = join(ROOT, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("✗ 找不到 manifest.json");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const subDir = join(ROOT, "probe", "out", "market-submission");
const regPath = join(subDir, "registry-entry.json");
const apprPath = join(subDir, "approvals-entry.json");
if (!existsSync(regPath) || !existsSync(apprPath)) {
  console.error(
    "✗ 缺投稿片段（" +
      subDir +
      "）。先跑 pack.ps1，再跑 node probe/prepare-market-submission.mjs。"
  );
  process.exit(1);
}
const regEntry = JSON.parse(readFileSync(regPath, "utf8"));
const apprEntry = JSON.parse(readFileSync(apprPath, "utf8"));

const entryPath = join(
  ROOT,
  "dist-extensions",
  `app-${manifest.id}-${manifest.version}.entry.json`
);
const zipPath = join(ROOT, "dist-extensions", `app-${manifest.id}-${manifest.version}.zip`);
if (!existsSync(entryPath) || !existsSync(zipPath)) {
  console.error(`✗ 找不到打包产物。先跑 pack.ps1。缺：${existsSync(entryPath) ? "" : entryPath} ${existsSync(zipPath) ? "" : zipPath}`);
  process.exit(1);
}
const entry = JSON.parse(readFileSync(entryPath, "utf8"));

console.log("=== 一、registry 登记条目（同步器 L783/L790 的 exactKeys）===");
{
  const { extra, missing } = exactKeys(regEntry, ["kind", "id", "repository", "publisher"]);
  check(extra.length === 0, "没有多余字段", extra.length ? `多余: ${extra.join(", ")}` : "");
  check(missing.length === 0, "没有缺字段", missing.length ? `缺: ${missing.join(", ")}` : "");
  check(
    EXTENSION_KINDS.includes(regEntry.kind),
    "kind 合法",
    `kind=${JSON.stringify(regEntry.kind)}`
  );
  check(isSafeExtensionId(regEntry.id), "id 是安全扩展 id", `id=${JSON.stringify(regEntry.id)}`);
  check(
    isSafeRepository(regEntry.repository),
    "repository 是 owner/repository 形式（不是完整 URL）",
    `repository=${JSON.stringify(regEntry.repository)}`
  );
  check(
    typeof regEntry.publisher === "string" &&
      regEntry.publisher.trim().length > 0 &&
      regEntry.publisher.length <= 160,
    "publisher 非空且 ≤160 字符",
    `publisher=${JSON.stringify(regEntry.publisher)}`
  );
}

console.log("\n=== 二、approvals 批准条目（同步器 L811/L815/L821-824）===");
{
  const { extra, missing } = exactKeys(apprEntry, ["kind", "id", "tag", "sha256", "readme"]);
  check(extra.length === 0, "没有多余字段", extra.length ? `多余: ${extra.join(", ")}` : "");
  check(missing.length === 0, "没有缺字段", missing.length ? `缺: ${missing.join(", ")}` : "");
  check(TAG_RE.test(String(apprEntry.tag)), "tag 只用允许字符", `tag=${JSON.stringify(apprEntry.tag)}`);
  check(
    SHA256_RE.test(String(apprEntry.sha256)),
    "sha256 是 64 位小写十六进制（大写会被拒）",
    `sha256=${String(apprEntry.sha256).slice(0, 16)}…`
  );
  check(
    typeof apprEntry.readme === "string" && apprEntry.readme.trim().length > 0,
    "readme 是非空字符串"
  );
  const bytes = Buffer.byteLength(apprEntry.readme ?? "", "utf8");
  check(
    bytes <= MAX_MARKET_README_BYTES,
    `readme ≤ ${MAX_MARKET_README_BYTES} 字节`,
    `实际 ${bytes} 字节`
  );
  // CONTRIBUTING：「市场介绍不加载远程图片」。写进去也不会渲染，属于自欺。
  const remoteImg = /!\[[^\]]*\]\(\s*(?:https?:)?\/\//.test(apprEntry.readme ?? "");
  check(!remoteImg, "readme 不含远程图片（写了也不会加载）");
  // 同一 PR 里 approvals 必须有配对的 enrollment
  check(
    regEntry.kind === apprEntry.kind && regEntry.id === apprEntry.id,
    "approvals 与 registry 身份一致（否则同步器 L844 会拒）",
    `${apprEntry.kind}:${apprEntry.id}`
  );
}

console.log("\n=== 三、打包器产出的 entry.json（同步器 L870/L918-937）===");
{
  const entryBytes = statSync(entryPath).size;
  check(entryBytes <= MAX_ENTRY_BYTES, `entry.json ≤ ${MAX_ENTRY_BYTES} 字节`, `${entryBytes} 字节`);

  check(
    entry.kind === regEntry.kind && entry.id === regEntry.id,
    "entry 身份与登记一致",
    `${entry.kind}:${entry.id}`
  );
  check(
    entry.publisher === regEntry.publisher,
    "entry publisher 与登记逐字一致",
    `entry=${JSON.stringify(entry.publisher)} 登记=${JSON.stringify(regEntry.publisher)}`
  );
  check(VERSION_RE.test(String(entry.version)), "version 是可解析的语义版本", `${entry.version}`);

  const a = entry.archive ?? {};
  check(typeof a === "object" && a !== null, "archive 是对象");
  const wantUrl = `{{BASE_URL}}/${entry.kind}-${entry.id}-${entry.version}.zip`;
  check(
    a.url === wantUrl,
    "archive.url 指向本地 {{BASE_URL}} ZIP 且命名合规",
    a.url === wantUrl ? wantUrl : `实际 ${JSON.stringify(a.url)}`
  );
  check(SHA256_RE.test(String(a.sha256)), "archive.sha256 是 64 位小写十六进制");
  check(
    Number.isInteger(a.size) && a.size > 0 && a.size <= MAX_MARKET_ARCHIVE_BYTES,
    `archive.size 是正整数且 ≤ ${MAX_MARKET_ARCHIVE_BYTES} 字节`,
    `${a.size} 字节`
  );
  check(a.format === "zip", "archive.format 是 zip", `${a.format}`);
}

console.log("\n=== 四、zip 与声明是否逐字节自洽（同步器 L976-991）===");
{
  const size = statSync(zipPath).size;
  const buf = readFileSync(zipPath);
  const sha = createHash("sha256").update(buf).digest("hex");
  check(size === entry.archive.size, "zip 实际字节数 = entry.archive.size", `${size}`);
  check(sha === entry.archive.sha256, "zip 实际 sha256 = entry.archive.sha256", sha.slice(0, 16) + "…");
}

console.log("\n=== 五、跨文件一致性（同步器 L1061-1067）===");
{
  check(
    apprEntry.tag === `v${entry.version}`,
    "approvals.tag 指向本版本的 Release tag",
    `${apprEntry.tag}`
  );
  check(
    apprEntry.sha256 === entry.archive.sha256,
    "approvals.sha256 照抄自 entry.archive.sha256",
    apprEntry.sha256.slice(0, 16) + "…"
  );
  check(
    manifest.version === entry.version,
    "manifest.version 与 entry.version 一致",
    `${manifest.version}`
  );
  check(manifest.manifestVersion === 2, "manifestVersion = 2（v1 已冻结，不收新投稿）");
  check(manifest.id === regEntry.id, "manifest.id 与登记 id 一致");
  const rt = String(manifest.entry ?? "");
  check(
    rt.length > 0 && !rt.endsWith(".ts"),
    "运行时入口不是未编译的 .ts",
    rt
  );
  const wantEntryAsset = `${entry.kind}-${entry.id}-${entry.version}.entry.json`;
  check(
    existsSync(join(ROOT, "dist-extensions", wantEntryAsset)),
    `Release 附件名应为 ${wantEntryAsset}`
  );
}

console.log(`\n${fail === 0 ? "✓" : "✗"} 通过 ${pass} / 失败 ${fail}`);
if (fail === 0) {
  console.log("  本地自洽。剩下「下载回来再比对」那一步由官方同步器做：");
  console.log("  node hana-marketplace/scripts/extension-market-sync.mjs --registry … --approvals … --previous … --out … --check");
}
process.exit(fail ? 1 : 0);
