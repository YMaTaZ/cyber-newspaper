/**
 * 验证跟随的三层兜底链：
 *
 *   层1  --hana-*（theme-follow.js 搬运成功）      → 最高优先
 *   层2  --bg / --accent（宿主主题 CSS 直接命中）    → JS 挂掉时仍能跟随
 *   层3  写死的兜底色                                → 完全无宿主（导出件在外部打开）
 *
 * 层2 是这次修复的核心。真实宿主里 SDK 首屏不注入主题 CSS、也不设 data-theme，
 * JS 读不到值，页面就一直停在层3 的白底。
 * 现在样式写成 var(--hana-bg, var(--bg, 兜底))，只要主题 CSS 落地，
 * 浏览器自己就能解出宿主色，不再依赖 JS 的时序。
 *
 * 用法：node probe/verify-theme-layers.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");

// Chrome 的用户数据目录绝不能落在项目里：它会写 Cookies / Login Data / History，
// 而发布打包器会把整个目录打进 zip。一律丢到系统临时目录，用完即删。
const CUD = join(tmpdir(), `cyber-newspaper-cud-layer-${process.pid}`);
process.on("exit", () => {
  try {
    rmSync(CUD, { recursive: true, force: true });
  } catch {
    /* 删不掉不影响验证结果 */
  }
});
mkdirSync(OUT, { recursive: true });

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const c of cands) if (readOK(c)) return c;
  return null;
}
function readOK(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 宿主的真名变量（层2 用它） */
const HOST = {
  "midnight-真实深底": {
    "--bg": "#2A363E",
    "--bg-card": "#33424B",
    "--sidebar-bg": "#242F36",
    "--accent": "#7FB4C9",
    "--border": "#4A5C66",
    "--text": "#DCE7EE",
  },
  "coral-真实亮底": {
    "--bg": "#FFF7F2",
    "--bg-card": "#FFFFFF",
    "--sidebar-bg": "#FDEDE4",
    "--accent": "#C4553A",
    "--border": "#E8D5C9",
    "--text": "#3A2E28",
  },
};

/** 读一个元素最终落到的颜色，判断它来自哪一层 */
const READER = `
(function(){
  function px(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function rgbOf(sel, prop){
    var el = document.querySelector(sel);
    if (!el) return null;
    return getComputedStyle(el)[prop || "color"];
  }
  var out = {
    mirrorBg: px("--hana-bg") || null,
    hostBg: px("--bg") || null,
    bodyBg: rgbOf("body", "backgroundColor"),
    paperUsed: px("--paper"),
    accentUsed: px("--dg-accent"),
    titleColor: rgbOf("h1, .masthead h1, .page-title", "color"),
    dataTheme: document.documentElement.dataset.theme || null,
    colorMode: document.documentElement.dataset.colorMode || null,
  };
  var pre = document.createElement("pre");
  pre.id = "layer-report";
  pre.style.display = "none";
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();`;

/** 造一个最小页面，把 workbench 的 :root 变量表原样搬进去 */
function buildPage(caseName, decl, themeId) {
  const html = `<!DOCTYPE html><html lang="zh-CN"${themeId ? ` data-theme="${themeId}"` : ""}>
<head><meta charset="utf-8"><title>layer</title>
<style>
  /* 与 ui/workbench.html 的 :root 保持同一写法 */
  :root {
    --paper:     var(--hana-bg, var(--bg, #FFFFFF));
    --panel:     var(--hana-bg-card, var(--bg-card, var(--hana-bg, var(--bg, #FFFFFF))));
    --sidebar:   var(--hana-sidebar-bg, var(--sidebar-bg, var(--hana-bg, var(--bg, #FFFFFF))));
    --dg-accent:        var(--hana-accent, var(--accent, #2E5F80));
    --accent-text: color-mix(in srgb, var(--dg-accent) 70%, #000000);
    --rule-soft: var(--hana-border, var(--border, #C8C8C8));
  }
  body { background: var(--paper); color: #111111; }
  h1 { color: var(--dg-accent); }
</style>
<style>${decl}</style>
</head><body><h1>Layer Check</h1>${READER ? "" : ""}</body></html>`;
  const withReader = html.replace("</body>", `<script>${READER}</script></body>`);
  const file = join(OUT, `layer-${caseName}.html`);
  writeFileSync(file, withReader, "utf8");
  return file;
}

function readReport(dom) {
  const m = dom.match(/<pre[^>]*id="layer-report"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

const CHROME = findChrome();
if (!CHROME) {
  console.error("✗ 找不到无头浏览器，本验证跑不了（不能当成通过）");
  process.exit(1);
}

const cases = [
  { name: "L1-mirror", label: "层1 JS 搬运成功", decl: "", vars: null, expectLayer: "mirror" },
  { name: "L2-hostonly", label: "层2 JS 挂了、只有宿主变量", decl: "", vars: "host", expectLayer: "host" },
  { name: "L3-none", label: "层3 完全无宿主", decl: "", vars: null, expectLayer: "fallback" },
];

const rows = [];
for (const c of cases) {
  let decl = "";
  let themeId = "";
  if (c.vars === "host") {
    const host = HOST["midnight-真实深底"];
    // 模拟宿主主题 CSS：值写在 [data-theme] 上，且没有 --hana-*
    decl = `[data-theme="midnight"]{${Object.entries(host).map(([k, v]) => `${k}:${v}`).join(";")}}`;
    themeId = "midnight";
  } else if (c.expectLayer === "mirror") {
    const host = HOST["midnight-真实深底"];
    // 必须用真的 MIRROR_MAP，不要在这里自己拼名字：
    // 上一版拼成了 --hana / --hana-card，与运行时写入的 --hana-bg 不一致，
    // 测到的是不存在的变量，结论自然错。
    const { MIRROR_MAP } = await import("../ui/assets/theme-follow.js");
    const mirror = {};
    for (const [hostName, mirrorName] of Object.entries(MIRROR_MAP)) {
      if (host[hostName]) mirror[mirrorName] = host[hostName];
    }
    decl = `:root{${Object.entries(mirror).map(([k, v]) => `${k}:${v}`).join(";")}}`;
    themeId = "midnight";
  }

  const file = buildPage(c.name, decl, themeId);
  let dom = "";
  try {
    dom = execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
      `--user-data-dir=${CUD}`,
      "--window-size=900,400", "--virtual-time-budget=3000", "--dump-dom",
      `file:///${file.replace(/\\/g, "/")}`,
    ], { stdio: ["pipe", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).toString("utf8");
  } catch (e) {
    dom = String(e.stdout || "");
  }
  const rep = readReport(dom);
  rows.push({ ...c, rep });
  console.log(`\n=== ${c.label} ===`);
  if (!rep) {
    console.log("  ✗ 没读到报告（页面或探针没跑）");
    continue;
  }
  console.log(`  --paper   = ${rep.paperUsed}`);
  console.log(`  --dg-accent = ${rep.accentUsed}`);
  console.log(`  body 背景 = ${rep.bodyBg}`);
  console.log(`  data-theme = ${rep.dataTheme}  color-mode = ${rep.colorMode}`);
}

/** 判定：层2 必须解出宿主的 #2A363E，层3 必须是白 */
let fail = 0;
const want = {
  "L1-mirror": "#2A363E",
  "L2-hostonly": "#2A363E",
  "L3-none": "#FFFFFF",
};
console.log("\n=== 判定 ===");
for (const r of rows) {
  if (!r.rep) {
    console.log(`  ✗ ${r.name} 无数据`);
    fail++;
    continue;
  }
  const got = (r.rep.paperUsed || "").toUpperCase();
  const exp = want[r.name];
  // 层1/层2 都该落到深底，层3 该落到白底兜底
  const ok = exp === "#FFFFFF" ? got === "#FFFFFF" || got === "255, 255, 255" : got === exp;
  console.log(`  ${ok ? "✓" : "✗"} ${r.name}: --paper = ${r.rep.paperUsed}（期望 ${exp}）`);
  if (!ok) fail++;
}
console.log(fail === 0 ? "\n✓ 三层兜底链成立" : `\n✗ ${fail} 项不符`);
process.exit(fail ? 1 : 0);
