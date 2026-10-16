/**
 * 个人信息与凭据审计
 *
 * 为什么扫两个范围：
 *   1. 发布包（zip）—— 用户真正装到的东西，最要紧
 *   2. 仓库源码 —— 市场要求仓库公开可访问，probe/ 与注释同样会被看到
 * 只扫包不扫仓库，会漏掉注释里的名字；只扫仓库不扫包，会漏掉打包带进来的东西。
 *
 * 分三类报：
 *   - 必须清：个人身份、本机路径、凭据、私人服务名
 *   - 需确认：桥接/推送等与宿主功能相关但可能暴露使用习惯的词
 *   - 第三方：sdk/ 是官方 SDK 副本，其中的 bridge 是它自己的 API 名，不算泄漏
 *
 * 用法：node probe/audit-personal.mjs [zip 路径]
 */
import { readdirSync, statSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist-extensions"]);
// 第三方副本：官方 SDK。里面的 bridge / session 是它自己的 API 名，不是使用者痕迹。
const VENDOR = [/^sdk\//, /^ui\/assets\/sdk\.js$/];
// 第三方库的版权声明文件：里面的邮箱、URL 是上游作者的信息，不是本人的。
// 它们本来就该随包分发（法律要求保留声明），因此整份排除。
const NOTICE_FILES = /(THIRD_PARTY_NOTICES|LICENSE|COPYING|NOTICE)(\.txt)?$/i;
// 本文件自己：它的工作就是列出待查模式，不该被自己报一遍。
const SELF = /(^|\/)audit-personal\.mjs$/;
// 生成物目录：已在 .gitignore 里，不会进仓库也不会公开。
// 它存着投稿材料（带 GitHub 用户名与本机路径），扇它只会把注意力
// 从「真正会公开的文件」上引开。GitHub 账号名本身也不是秘密。
const GENERATED = /(^|\/)probe\/out\//;
const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md",
  ".ps1", ".py", ".txt", ".yml", ".yaml", ".sh", ".ts",
]);

const MUST = [
  { id: "本人姓名（拉丁）", re: new RegExp("\\b" + dec("TWFUYQ==") + "\\b", "i") },
  { id: "本人姓名（中文）", re: new RegExp(dec("6KKB54Oo")) },
  { id: "个人域名/ID", re: new RegExp(dec("eWFjaGlu"), "i") },
  // 上面那条不加词边界是对的：yachin 可能出现在路径或子域名里。
  // 姓名那条必须加：GitHub 账号本身就是公开信息，不应当成泄露报。
  { id: "本机用户目录编号", re: new RegExp(dec("MjA3Njk=")) },
  { id: "本机工作区路径", re: new RegExp(dec("T0gtV29ya1NwYWNl"), "i") },
  { id: "Windows 用户绝对路径", re: /[A-Za-z]:\\Users\\/i },
  { id: "私人文件引用", re: new RegExp(dec("aXNzdWUudHh0"), "i") },
  { id: "私人供应商名", re: new RegExp(dec("5bCP5b+G") + "|" + dec("6Zi/6YeM5LqR55m+54K8")) },
  { id: "私人中转/网关", re: new RegExp(dec("bWFncGll"), "i") },
  { id: "私人工具链", re: new RegExp(dec("ZHNoYW5h") + "|" + dec("RGVlcFNlZWsgSGFybmVzcw=="), "i") },
  { id: "邮箱", re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/ },
  { id: "疑似密钥", re: /(sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{24,})/ },
];

const CONFIRM = [
  { id: "微信", re: new RegExp(dec("5b6u5L+h") + "|wechat|weixin", "i") },
  { id: "飞书", re: new RegExp(dec("6aOe5Lmm") + "|feishu|lark", "i") },
  { id: "桥接推送", re: new RegExp(dec("5qGl5o6l") + "|bridge push|bridgePush", "i") },
];

/**
 * 本文件自己也会公开，所以待查的关键词不以明文存放 ——
 * 一个扫描器把要找的秘密写在自身源码里，等于又泄一次。
 * base64 只是避免明文出现在文本里，不是加密，也不用来隐藏逻辑。
 */
function dec(b64) {
  return Buffer.from(b64, "base64").toString("utf8");
}

let fail = 0;

// ---------- 1. 扫仓库 ----------
console.log("=== 一、仓库源码 ===");
const repoHits = scanDir(ROOT);
report(repoHits, false);

// ---------- 2. 扫发布包 ----------
console.log("\n=== 二、发布包 ===");
const zip = process.argv[2] || findZip();
if (!zip) {
  console.log("  （找不到 zip，跳过；先跑 pack.ps1）");
} else {
  console.log(`  ${zip}`);
  const tmp = mkdtempSync(join(tmpdir(), "cns-audit-"));
  try {
    execFileSync("tar", ["-xf", zip, "-C", tmp], { stdio: "pipe" });
    const zipHits = scanDir(tmp);
    report(zipHits, true);
  } catch (e) {
    console.log("  ✗ 解压失败：" + e.message);
    fail++;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ---------- 3. 图片元数据 ----------
console.log("\n=== 三、图片元数据（EXIF / 文本块）===");
checkImageMeta();

console.log(fail === 0 ? "\n✓ 未发现个人信息残留" : `\n✗ ${fail} 处需要处理`);
process.exit(fail ? 1 : 0);

// ===================== 实现 =====================

function scanDir(base) {
  const hits = { must: [], confirm: [], vendor: 0, notice: 0 };
  walk(base, (file) => {
    const rel = relative(base, file).replace(/\\/g, "/");
    if (SELF.test(rel) || GENERATED.test(rel)) return;
    if (NOTICE_FILES.test(rel)) {
      hits.notice++;
      return;
    }
    const isVendor = VENDOR.some((re) => re.test(rel));
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    for (const p of MUST) {
      lines.forEach((l, i) => {
        if (p.re.test(l)) {
          if (isVendor) hits.vendor++;
          else hits.must.push({ file: rel, line: i + 1, id: p.id, text: l.trim().slice(0, 130) });
        }
      });
    }
    for (const p of CONFIRM) {
      lines.forEach((l, i) => {
        if (p.re.test(l)) {
          if (isVendor) hits.vendor++;
          else hits.confirm.push({ file: rel, line: i + 1, id: p.id, text: l.trim().slice(0, 130) });
        }
      });
    }
  }, base);
  return hits;
}

function walk(dir, cb, base, depth = 0) {
  if (depth > 12) return;
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of items) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, cb, base, depth + 1);
    } else if (TEXT_EXT.has(extname(e.name).toLowerCase())) {
      cb(p);
    }
  }
}

function report(hits, isZip) {
  if (hits.must.length) {
    fail += hits.must.length;
    console.log(`  ✗ 必须清理：${hits.must.length} 处`);
    const byFile = new Map();
    for (const h of hits.must) {
      if (!byFile.has(h.file)) byFile.set(h.file, []);
      byFile.get(h.file).push(h);
    }
    for (const [f, list] of byFile) {
      console.log(`      ${f}  (${list.length} 处)`);
      for (const h of list.slice(0, 4)) {
        console.log(`        [${h.line}] ${h.id}：${h.text}`);
      }
      if (list.length > 4) console.log(`        …另 ${list.length - 4} 处`);
    }
  } else {
    console.log("  ✓ 无个人身份 / 本机路径 / 凭据");
  }

  if (hits.confirm.length) {
    console.log(`  ⚠ 需确认（功能相关，但可能暴露使用习惯）：${hits.confirm.length} 处`);
    const byFile = new Map();
    for (const h of hits.confirm) {
      if (!byFile.has(h.file)) byFile.set(h.file, []);
      byFile.get(h.file).push(h);
    }
    for (const [f, list] of byFile) {
      console.log(`      ${f}  (${list.length} 处)`);
      for (const h of list.slice(0, 3)) {
        console.log(`        [${h.line}] ${h.id}：${h.text}`);
      }
      if (list.length > 3) console.log(`        …另 ${list.length - 3} 处`);
    }
  } else {
    console.log("  ✓ 无桥接/推送类词");
  }

  if (hits.vendor) {
    console.log(`  ℹ 第三方 SDK 副本内命中 ${hits.vendor} 处，已忽略（官方 SDK 自带 API 名）`);
  }
  if (hits.notice) {
    console.log(`  ℹ 第三方版权声明文件 ${hits.notice} 份，已忽略（上游作者信息，随包分发是法律要求）`);
  }
}

function findZip() {
  const dist = join(ROOT, "dist-extensions");
  if (!existsSync(dist)) return null;
  const zips = readdirSync(dist).filter((f) => f.endsWith(".zip"));
  if (!zips.length) return null;
  zips.sort((a, b) => statSync(join(dist, b)).mtimeMs - statSync(join(dist, a)).mtimeMs);
  return join(dist, zips[0]);
}

/** PNG/WebP 里的文本块（作者、软件名、时间戳） */
function checkImageMeta() {
  const imgs = [
    join(ROOT, "assets", "icon.png"),
    join(ROOT, "ui", "assets", "cover.webp"),
  ];
  let n = 0;
  for (const f of imgs) {
    if (!existsSync(f)) {
      console.log(`  - ${relative(ROOT, f)} 不存在`);
      continue;
    }
    const buf = readFileSync(f);
    const found = [];
    // PNG 的 tEXt/iTXt/zTXt 块
    if (buf.slice(1, 4).toString() === "PNG") {
      let off = 8;
      while (off + 8 < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.slice(off + 4, off + 8).toString();
        if (/^(tEXt|iTXt|zTXt|eXIf)$/.test(type)) {
          found.push(type + ": " + buf.slice(off + 8, off + 8 + Math.min(len, 120)).toString("utf8").replace(/[^\x20-\x7e]/g, "."));
        }
        if (type === "IEND") break;
        off += 12 + len;
        if (len > buf.length) break;
      }
    }
    // WebP 的 EXIF / XMP 块
    if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
      const s = buf.toString("latin1");
      if (/EXIF/.test(s)) found.push("含 EXIF 块");
      if (/<x:xmpmeta/i.test(s)) found.push("含 XMP 元数据");
      if (/http/i.test(s.slice(0, 2000))) found.push("头部含 URL 字符串");
    }
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (found.length) {
      console.log(`  ⚠ ${rel}：${found.join(" | ")}`);
    } else {
      console.log(`  ✓ ${rel} 无文本元数据`);
    }
    n++;
  }
  if (!n) console.log("  （无图片可查）");
}
