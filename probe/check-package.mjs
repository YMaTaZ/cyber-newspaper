/**
 * 发布包内容检查
 *
 * 验四件事：
 *   1. 该有的在：manifest.json、index.js、lib/、ui/、图标、封面
 *   2. 不该有的没：probe/、SPEC.md、pack.ps1、dist-extensions/、.git、node_modules
 *   3. 包内 manifest 的三层命名与 id 一致（改名后最容易漏的就是这个）
 *   4. 图片不是别的应用的原图 —— 本次就发现 icon.png 与 cover.png 与
 *      hana-excalidraw 里的文件 MD5 完全一致，那不能开源
 *
 * 为什么要单独一个脚本：0.6.0 那次打完包才发现 pack.ps1 自己进了包，
 * 而当时的"开发物检查"只匹配 probe/ 与 SPEC.md，看不见它。
 * 检查清单必须比犯错范围宽。
 *
 * 用法：node probe/check-package.mjs [zip 路径]
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const APP_ID = "cyber-newspaper";
const APP_NAME = "Cyber Newspaper";
const UI_TITLE = "日报";

/** 找最新的包；也可命令行指定 */
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
console.log(`\n=== 检查发布包 ===\n  ${basename(zip)}`);

let entries;
try {
  entries = execFileSync("tar", ["-tf", zip], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
} catch {
  console.error("✗ tar 不可用，读不了包内容");
  process.exit(1);
}

let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};

// ---------- 1. 必须有的 ----------
check("manifest.json", entries.includes("manifest.json"));
check("index.js", entries.includes("index.js"));
check("lib/ 齐全", entries.filter((e) => e.startsWith("lib/")).length >= 8);
check("ui/ 三页齐全", ["workbench", "settings", "status"].every((p) => entries.includes(`ui/${p}.html`)));
check(
  "跟随脚本在位",
  entries.includes("ui/assets/theme-follow.js") && entries.includes("ui/assets/theme-mode.js")
);
check("图标在位", entries.some((e) => e.endsWith("assets/icon.png")));
// face.image 相对 ui/ 解析；封面现为 .webp（PNG 容不下这张细节密的图）。
// 两种扩展名都容，换素材时不至于因为改格式而假报缺失。
check(
  "封面在位（webp 或 png）",
  entries.some((e) => /^ui\/assets\/cover\.(webp|png)$/.test(e))
);

// ---------- 2. 不该有的（清单比犯错范围宽） ----------
const DEV = [
  { re: /^probe\//, label: "probe/" },
  { re: /^SPEC\.md$/, label: "SPEC.md" },
  { re: /^pack\.ps1$/, label: "pack.ps1" },
  { re: /^dist-extensions\//, label: "dist-extensions/" },
  { re: /(^|\/)\.git/, label: ".git" },
  { re: /(^|\/)node_modules\//, label: "node_modules/" },
];
for (const d of DEV) {
  const hit = entries.filter((e) => d.re.test(e));
  check(`不含 ${d.label}`, hit.length === 0, hit.length ? `发现 ${hit.length} 项，如 ${hit[0]}` : "");
}

// ---------- 2b. 隐私与凭据 ----------
//
// 为什么单列一组：开发期跑无头 Chrome 做截图/对比度验证时，
// 浏览器会往 --user-data-dir 里写 Cookies、Login Data、History、Web Data。
// 如果那个目录落在项目内，打包器会把它们原样打进发布包 ——
// 那不是"多带了几个文件"，是把开发者本机的登录态和浏览记录公开出去。
// 本次真发生过：probe/out/cud-*/ 里躺着 Cookies 与 Login Data。
//
// 判据按「文件名特征」而不是某个固定目录名：Chrome 换版本会改目录结构，
// 但 Cookies / Login Data 这类文件名是稳定的，抓住它们比盯目录靠谱。
const PRIVATE = [
  { re: /(^|\/)(cud-|user-data|chrome-profile)/i, label: "浏览器用户数据目录" },
  { re: /(^|\/)(Cookies|Login Data|Web Data|History|Top Sites)(-journal)?$/i, label: "浏览器隐私数据文件" },
  { re: /(^|\/)(Local State|Secure Preferences|Preferences)$/, label: "浏览器状态文件" },
  { re: /(^|\/)(Cookies|Login Data)[^/]*$/, label: "浏览器隐私数据文件" },
  { re: /\.(pem|key|p12|pfx|jks|keystore)$/i, label: "私钥/证书" },
  { re: /(^|\/)(\.env|credentials|secrets?)\.(json|ya?ml|txt)$/i, label: "凭据文件" },
  { re: /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.netrc|\.git-credentials)$/i, label: "凭据文件" },
];
for (const d of PRIVATE) {
  const hit = entries.filter((e) => d.re.test(e));
  check(`不含 ${d.label}`, hit.length === 0, hit.length ? `发现 ${hit.length} 项，如 ${hit[0]}` : "");
}

// 包内文本文件不得出现本机绝对路径或私人标识。
// 模式本身用 base64 存：本文件要公开，把待查字符串明文写进扫描器等于又泄一次。
const dec = (b) => Buffer.from(b, "base64").toString("utf8");
const LEAK = [
  { re: new RegExp(dec("RjpcXE9ILVdvcmtTcGFjZQ=="), "i"), label: "本机工作区绝对路径" },
  { re: /[A-Za-z]:\\Users\\[A-Za-z0-9_]+/i, label: "本机用户目录绝对路径" },
  { re: new RegExp(dec("aXNzdWUudHh0"), "i"), label: "私人文件引用" },
];
for (const d of LEAK) {
  const hit = entries.filter((e) => /^(index\.js|manifest\.json|lib\/|ui\/)/.test(e) && /\.(js|mjs|json|html|css|md)$/i.test(e));
  const bad = [];
  for (const name of hit) {
    const text = readZipTextQuiet(zip, name);
    if (text && d.re.test(text)) bad.push(name);
  }
  check(`源码不含${d.label}`, bad.length === 0, bad.length ? `出现在 ${bad.slice(0, 3).join(", ")}` : "");
}

// ---------- 3. 素材不得与本机其它 App 同哈希 ----------
//
// 为什么要拿整台机器的 apps 作比：脚手架复制、从旁边项目抓图都会造成
// "包里带着别人的原图"，而图是二进制，文本扫描完全发现不了。
// 一次进程调用读完全部图片哈希：逐个条目 spawn PowerShell 会慢到不能用。
const foreign = collectForeignHashes();
const zipHashes = readZipImageHashes(zip);
if (zipHashes === null) {
  check("包内图片哈希可读", false, "PowerShell 未能列出");
} else {
  const checked = zipHashes.filter(([name]) => !name.includes("rice-paper"));
  check(`包内图片已比对（共 ${checked.length} 张）`, checked.length > 0);
  for (const [name, hex] of checked) {
    check(`${name} 非其它 App 原图`, !foreign.has(hex), foreign.get(hex) || "");
  }
}

// ---------- 4. 包内 manifest 的一致性 ----------
const manifestRaw = readZipText(zip, "manifest.json");
let m = null;
try {
  m = JSON.parse(manifestRaw);
} catch {
  console.log("  ⚠ manifest 解析失败，跳过一致性检查");
  fail++;
}
if (m) {
  check(`id = ${APP_ID}`, m.id === APP_ID, m.id);
  check(`name = ${APP_NAME}`, m.name === APP_NAME, m.name);

  // App 内显示名直接读字段，不用正则扫 JSON 字符串。
  // 早期版本写的是 /"title": "([^"]*)"/，但 JSON.stringify 的输出**没有空格**
  // （"title":"日报"），一个都抓不到，length>=2 永远为假 ——
  // 检查器自己错，报出来的却是"命名不对"的假失败。
  const shown = [];
  for (const c of m.contributes?.cards ?? []) {
    if (c.title) shown.push([`cards[${c.id}].title`, c.title]);
  }
  if (m.contributes?.settings?.title) shown.push(["settings.title", m.contributes.settings.title]);
  const bad = shown.filter(([, v]) => v !== UI_TITLE);
  check(
    `App 内显示名都是「${UI_TITLE}」（共 ${shown.length} 项）`,
    shown.length >= 2 && bad.length === 0,
    shown.map(([k, v]) => `${k}=${v}`).join(" ")
  );

  check("包名与 id 对齐", basename(zip).includes(APP_ID), basename(zip));
  check("无旧 id 残留", !JSON.stringify(m).includes("ai-daily-digest"));
  check("无旧品牌名残留", !JSON.stringify(m).includes("AI 热点日报"));
}

console.log(fail === 0 ? "\n✓ 发布包干净" : `\n✗ ${fail} 项不合格`);
process.exit(fail ? 1 : 0);

// ===================== 工具函数 =====================

/** 收集本机其它已装 App 的图片 MD5（排除本项目自己） */
function collectForeignHashes() {
  const home = process.env.HANA_HOME || join(process.env.USERPROFILE || process.env.HOME, ".hanako");
  const appsDir = join(home, "apps");
  const map = new Map();
  if (!existsSync(appsDir)) return map;
  for (const name of readdirSync(appsDir)) {
    if (name === APP_ID) continue; // 自己不算
    const dir = join(appsDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    walkImages(dir, (file) => {
      try {
        const hex = createHash("md5").update(readFileSync(file)).digest("hex");
        if (!map.has(hex)) map.set(hex, `${name}/${file.slice(dir.length + 1)}`);
      } catch {}
    });
  }
  return map;
}

function walkImages(dir, cb, depth = 0) {
  if (depth > 6) return;
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of items) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkImages(p, cb, depth + 1);
    else if (/\.(png|jpe?g|webp)$/i.test(e.name)) cb(p);
  }
}

/** 一次调用列出包内所有图片及其 MD5，返回 [[name, hex], …] */
function readZipImageHashes(zipPath) {
  const ps =
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${esc(zipPath)}');` +
    `$md5=[System.Security.Cryptography.MD5]::Create();` +
    `foreach($e in $z.Entries){` +
    `  if($e.FullName -match '\\.(png|jpe?g|webp)$'){` +
    `    $s=$e.Open();$m=New-Object System.IO.MemoryStream;$s.CopyTo($m);$s.Close();` +
    `    Write-Output ($e.FullName + [char]9 + (([BitConverter]::ToString($md5.ComputeHash($m.ToArray())) -replace '-','').ToLower()))` +
    `  }` +
    `}` +
    `$z.Dispose()`;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.split(String.fromCharCode(9)))
      .filter((p) => p.length === 2 && /^[0-9a-f]{32}$/.test(p[1]));
  } catch {
    return null;
  }
}

/** 读包内一个文本文件，失败返回 null（用于批量扫描，不打断流程） */
function readZipTextQuiet(zipPath, entry) {
  try {
    return readZipText(zipPath, entry);
  } catch {
    return null;
  }
}

/** 读包内一个文本文件 */
function readZipText(zipPath, entry) {
  const ps =
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${esc(zipPath)}');` +
    `$e=$z.GetEntry('${esc(entry)}');` +
    `if(-not $e){$z.Dispose();exit 3}` +
    `$r=New-Object System.IO.StreamReader($e.Open());` +
    `$t=$r.ReadToEnd();$r.Close();$z.Dispose();` +
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;Write-Output $t`;
  return execFileSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** PowerShell 单引号字符串里的单引号要写成两个 */
function esc(s) {
  return String(s).replace(/'/g, "''");
}
