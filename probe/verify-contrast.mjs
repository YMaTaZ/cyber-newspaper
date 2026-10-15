/**
 * 对比度实测验证
 *
 * 为什么需要它：主题跟随很容易「值搬进来了但没法读」。
 * 之前深色主题下出现过整页空白——深底深字，肉眼看图才发现。
 * 所以这里不靠看截图，而是让无头 Chrome 把渲染后的**真实计算色**跑一遍
 * WCAG 对比度，写回 DOM，再由本脚本解析断言。
 *
 * 判据（可算的，不是"看着还行"）：
 *   - 正文/标题 与背景：≥ 4.5（WCAG AA 正常文字）
 *   - 强调色小字（期号、编号、角标）：≥ 4.5，按正常文字要求
 *   - 主按钮上的文字 与其背景：≥ 4.5
 *
 * 伪元素测不了：querySelector 选不到 ::before，所以要点编号改用
 * getComputedStyle(el, "::before") 单独量，不能当成普通元素。
 *
 * 用法：node probe/verify-contrast.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

import { colorModeOf, onAccentColor } from "../ui/assets/theme-mode.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// Chrome 的用户数据目录绝不能落在项目里：它会写 Cookies / Login Data / History，
// 而发布打包器会把整个目录打进 zip。一律丢到系统临时目录，用完即删。
const CUD = join(tmpdir(), `cyber-newspaper-cud-contrast-${process.pid}`);
process.on("exit", () => {
  try {
    rmSync(CUD, { recursive: true, force: true });
  } catch {
    /* 删不掉不影响验证结果 */
  }
});

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** 三套真实宿主主题（值取自 artifacts/renderer/.../themes/*.css） */
const THEMES = {
  light: {
    label: "暖纸 warm-paper",
    vars: {
      "--hana-bg": "#F8F4ED",
      "--hana-bg-card": "#FCFAF5",
      "--hana-sidebar-bg": "#F4F0EA",
      "--hana-text": "#3B3D3F",
      "--hana-text-light": "#6B6F73",
      "--hana-text-muted": "#8E9196",
      "--hana-accent": "#537D96",
      "--hana-border": "rgba(122, 96, 88, 0.18)",
    },
  },
  dark: {
    label: "青夜 midnight",
    vars: {
      "--hana-bg": "#3B4A54",
      "--hana-bg-card": "#445560",
      "--hana-sidebar-bg": "#34424B",
      "--hana-text": "#E1EAF0",
      "--hana-text-light": "#B7C5CE",
      "--hana-text-muted": "#A3B5C0",
      "--hana-accent": "#C99AAF",
      "--hana-border": "rgba(170, 121, 141, 0.16)",
    },
  },
  contrast: {
    label: "高对比 high-contrast",
    vars: {
      "--hana-bg": "#FFFFFF",
      "--hana-bg-card": "#FFFFFF",
      "--hana-sidebar-bg": "#FFFFFF",
      "--hana-text": "#000000",
      "--hana-text-light": "#1A1A1A",
      "--hana-text-muted": "#333333",
      "--hana-accent": "#003B7E",
      "--hana-border": "#000000",
    },
  },
};

/**
 * 注入到页面里的探针：等日报渲染完，量真实计算色，写进 <pre id="contrast-report">
 *
 * 注意：这段代码**不能再包一层 <script>**。
 * 之前把它写成带 <script> 标签的字符串再插入另一个 <script> 里，
 * HTML 解析器会在第一个 </script> 处提前闭合，探针根本没跑。
 */
const PROBE_FN = `
  // 全部用不含反斜杠的写法：这段代码住在模板字符串里，单反斜杠会被吃掉，
  // 上一版正则就是这么崩掉的（表现为整支探针静默失效）。
  function toRGB(c) {
    c = String(c).trim();
    var m = c.match(/^color[(]srgb[ ]+([-0-9.]+)[ ,/]+([-0-9.]+)[ ,/]+([-0-9.]+)(?:[ ,/]+([-0-9.]+))?[)]/i);
    if (m) return { r: clamp255(+m[1] * 255), g: clamp255(+m[2] * 255), b: clamp255(+m[3] * 255), a: m[4] === undefined ? 1 : +m[4] };
    m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var hx = m[1];
      if (hx.length === 3 || hx.length === 4) {
        return { r: parseInt(hx[0] + hx[0], 16), g: parseInt(hx[1] + hx[1], 16), b: parseInt(hx[2] + hx[2], 16), a: hx.length === 4 ? parseInt(hx[3] + hx[3], 16) / 255 : 1 };
      }
      return { r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16), a: hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1 };
    }
    m = c.match(/^(?:rgb|rgba)[(][ ]*([-0-9.]+)[ ,/]+([-0-9.]+)[ ,/]+([-0-9.]+)(?:[ ,/]+([-0-9.]+))?[)]/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function blend(fg, bg) {
    if (fg.a >= 1) return fg;
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1
    };
  }
  function chan(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function lum(c) { return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b); }
  function ratio(a, b) {
    var la = lum(a), lb = lum(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function rgbHex(c) {
    function h(v) { return ("0" + Math.round(v).toString(16)).slice(-2); }
    return "#" + h(c.r) + h(c.g) + h(c.b);
  }
  function effBg(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var c = toRGB(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.9) return c;
      n = n.parentElement;
    }
    return toRGB(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  }
  function measure(name, sel, pseudo) {
    var el = document.querySelector(sel);
    if (!el) return { name: name, missing: "no-element" };
    var host = pseudo ? el.parentElement || el : el;
    var bg = effBg(host);
    var style = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
    var raw = style.color;
    var fgRaw = toRGB(raw);
    if (!fgRaw) return { name: name, missing: "unparsed:" + raw };
    var fg = blend(fgRaw, bg);
    return { name: name, ratio: +ratio(fg, bg).toFixed(2), fg: rgbHex(fg), bg: rgbHex(bg) };
  }
  function report() {
    var out = [];
    out.push(measure("侧栏文字·日期", ".entry .d"));
    out.push(measure("侧栏文字·标题", ".entry .t"));
    out.push(measure("侧栏模型标签", ".side-foot .lbl"));
    out.push(measure("日报大标题", ".digest .masthead h1"));
    out.push(measure("日报 meta", ".digest .masthead .meta"));
    out.push(measure("期号强调色", ".digest .masthead .meta .issue"));
    out.push(measure("栏目标题", ".digest .section > h2"));
    out.push(measure("条目标题", ".digest .item .title"));
    out.push(measure("正文点评", ".digest .item .note"));
    out.push(measure("要点标题强调色", ".digest .highlights h2"));
    out.push(measure("要点编号强调色", ".digest .highlights li", "::before"));
    out.push(measure("角标强调色", ".digest .item .badge.cross"));
    out.push(measure("主按钮文字", "#btnRun"));
    out.push(measure("次按钮文字", "#btnExport"));
    var pre = document.getElementById("contrast-report");
    if (!pre) {
      pre = document.createElement("pre");
      pre.id = "contrast-report";
      pre.style.display = "none";
      document.body.appendChild(pre);
    }
    // 每轮覆写，不能写一次就定稿
    pre.textContent = JSON.stringify(out);
  }
  // 重试：日报要等渲染才测得到。不再依赖预览脚本的自动点击时序，
  // 探针自己动手：看到归档条目就点开一期。
  var tries = 0;
  function tick() {
    var digestReady = !!document.querySelector(".digest .item .note");
    if (!digestReady) {
      var first = document.querySelector(".entry");
      if (first) { try { first.click(); } catch (e) {} }
    }
    report();
    if (digestReady || ++tries > 60) return;
    setTimeout(tick, 100);
  }
`;

const base = readFileSync(join(OUT, "workbench-preview.html"), "utf8");

let fail = 0;
const rows = [];

for (const [key, theme] of Object.entries(THEMES)) {
  const mode = colorModeOf(theme.vars["--hana-bg"]);
  const onAccent = onAccentColor(theme.vars["--hana-accent"]);
  const decl = Object.entries(theme.vars).map(([k, v]) => `${k}:${v}`).join(";");

  // 注入：宿主变量 + 明暗模式 + 按钮反色，等价于 theme-follow.js 的成果。
  // 探针与设置脚本**写在同一个 <script> 里**，不再嵌套 script 标签。
  const inject = `<style>:root{${decl};--on-accent:${onAccent};}</style>
<script>
(function(){
  document.documentElement.dataset.colorMode = "${mode}";
  ${PROBE_FN}
  setTimeout(tick, 700);
})();
<\/script>`;

  const html = base.replace(/<\/head>/i, `${inject}\n</head>`);
  const file = join(OUT, `contrast-${key}.html`);
  writeFileSync(file, html, "utf8");

  let dom = "";
  try {
    dom = execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--no-sandbox",
      `--user-data-dir=${CUD}`,
      "--window-size=1400,1000", "--virtual-time-budget=8000",
      "--dump-dom",
      `file:///${file.replace(/\\/g, "/")}`,
    ], { stdio: ["pipe", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }).toString("utf8");
  } catch (e) {
    dom = String(e.stdout || "");
  }

  // 把运行时 DOM 落盘：缺哪个选择器直接查文件，不靠猜。
  writeFileSync(join(OUT, `contrast-dom-${key}.html`), dom, "utf8");

  // 探针到底跑没跑、日报开没开，单独报出来。
  // 不然“没测到”会伪装成“全通过”。
  const diag = {
    probeRan: dom.includes('id="contrast-report"'),
    digestOpened: dom.includes("digest"),
    hasNote: /class="note"/.test(dom),
  };

  // 注意：探针给 <pre> 设了 style="display:none"，所以标签上还有别的属性，
  // 不能写成 <pre id="contrast-report"> 这种死匹配。
  const m = dom.match(/<pre[^>]*id="contrast-report"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log(`\n${theme.label}: ✗ 未拿到测量结果（探针没跑到？）`);
    fail++;
    continue;
  }

  let report;
  try {
    report = JSON.parse(
      m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    );
  } catch (e) {
    console.log(`\n${theme.label}: ✗ 报告解析失败 ${e.message}`);
    fail++;
    continue;
  }

  console.log(`\n=== ${theme.label}  (mode=${mode}) ===`);
  let skipped = 0;
  for (const r of report) {
    if (r.missing) {
      skipped++;
      console.log(`    − ${r.name}（${r.missing}）`);
      continue;
    }
    const isAccent = r.name.includes("强调色");
    // 强调色多用于小字（期号、编号、角标），按正常文字的 4.5 要求，不降级
    const min = 4.5;
    const ok = r.ratio >= min;
    if (!ok) fail++;
    console.log(`    ${ok ? "✓" : "✗"} ${r.name.padEnd(18)} ${String(r.ratio).padStart(5)} : 1   (需 ≥${min})  ${r.fg} on ${r.bg}`);
    rows.push({ theme: key, name: r.name, ratio: r.ratio, min, ok });
  }

  // 日报正文相相项必须被真正测到，否则本次验证不算成立
  const mustHave = ["期号强调色", "要点标题强调色", "要点编号强调色", "角标强调色", "正文点评"];
  const gotNames = new Set(report.filter((r) => !r.missing).map((r) => r.name));
  const absent = mustHave.filter((n) => !gotNames.has(n));
  if (absent.length) {
    fail++;
    console.log(`    ✗ 以下项未测到，主题跟随的核心色没验过：${absent.join("、")}`);
    console.log(`      诊断：探针跑了=${diag.probeRan} 日报已打开=${diag.digestOpened} 有点评=${diag.hasNote} 跳过=${skipped}`);
  }
}

console.log(`\n${"=".repeat(52)}`);
const worst = rows.filter((r) => r.ok === false);
if (!rows.length) {
  console.log("✗ 一个测量项都没拿到，验证未生效（不要当成通过）");
  fail++;
} else if (worst.length) {
  console.log(`✗ ${worst.length} 项对比度不达标：`);
  worst.forEach((w) => console.log(`    [${w.theme}] ${w.name} = ${w.ratio}:1（需 ≥${w.min}）`));
} else if (fail > 0) {
  // 有硬失败时不得声称“全部达标”：未测到 ≠ 通过
  console.log(`⚠ 已测到的 ${rows.length} 项均达标，但本次验证不成立（${fail} 项硬失败）：未测到不等于通过。`);
} else {
  console.log(`✓ ${rows.length} 项测量全部达标（三套主题）`);
}
process.exit(fail === 0 ? 0 : 1);
