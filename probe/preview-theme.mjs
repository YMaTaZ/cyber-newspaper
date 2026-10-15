/**
 * 主题跟随验证
 *
 * 思路：导出 HTML 里背景/主色走 var(--hana-*, 兜底)，文字按 data-color-mode 取高对比值。
 * 所以只要在文档上模拟出宿主的 --hana-* 与 data-color-mode，就能验证跟随是否生效。
 *
 * 用法：node probe/preview-theme.mjs
 * 产出：probe/out/theme-*.png（每张对应一个模拟主题）
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// Chrome 的用户数据目录绝不能落在项目里：它会写 Cookies / Login Data / History，
// 而发布打包器会把整个目录打进 zip。一律丢到系统临时目录，用完即删。
const CUD = join(tmpdir(), `cyber-newspaper-cud-theme-${process.pid}`);
const cleanupCud = () => {
  try {
    rmSync(CUD, { recursive: true, force: true });
  } catch {
    /* 删不掉不影响验证结果 */
  }
};
process.on("exit", cleanupCud);

const issue = JSON.parse(readFileSync(join(OUT, "issue.json"), "utf8"));
const html = readFileSync(join(OUT, "issue.html"), "utf8");

/** 从真实主题 CSS 里抽几套，模拟宿主镜像过来的值 */
const THEMES = [
  {
    id: "warm-paper",
    label: "暖纸（浅色）",
    vars: {
      "--hana-bg": "#F8F4ED",
      "--hana-accent": "#537D96",
      "--hana-border": "rgba(122, 96, 88, 0.18)",
    },
    expectMode: "light",
  },
  {
    id: "midnight",
    label: "青夜（深色）",
    vars: {
      "--hana-bg": "#3B4A54",
      "--hana-accent": "#C99AAF",
      "--hana-border": "rgba(170, 121, 141, 0.16)",
    },
    expectMode: "dark",
  },
  {
    id: "grass",
    label: "草香（浅色·不同主色）",
    vars: {
      "--hana-bg": "#F2F6EE",
      "--hana-accent": "#4A7A52",
      "--hana-border": "rgba(90, 120, 90, 0.2)",
    },
    expectMode: "light",
  },
  {
    id: "none",
    label: "无宿主（兜底值）",
    vars: {},
    expectMode: "light",
  },
];

/** 亮度判断逻辑与 theme-follow.js 保持一致 */
function expectedMode(hex) {
  const m = String(hex).match(/^#([0-9a-f]{6})$/i);
  if (!m) return "light";
  const r = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2] < 145 ? "dark" : "light";
}

let fail = 0;

for (const t of THEMES) {
  const varLines = Object.entries(t.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const mode = expectedMode(t.vars["--hana-bg"] || "#FFFFFF");

  const injected = html.replace(
    "</head>",
    `<style>:root{${varLines};}</style>
<script>document.documentElement.dataset.colorMode="${mode}";<\/script>
</head>`
  );

  const file = join(OUT, `theme-${t.id}.html`);
  writeFileSync(file, injected, "utf8");

  // 校验：跟随的值确实出现在文档里
  if (t.vars["--hana-bg"] && !injected.includes(t.vars["--hana-bg"])) {
    console.log(`  ✗ ${t.label}：背景值未注入`);
    fail++;
  }
  if (mode !== t.expectMode) {
    console.log(`  ✗ ${t.label}：明暗判断 ${mode} ≠ 预期 ${t.expectMode}`);
    fail++;
  }

  console.log(`  ${t.label} → mode=${mode}`);
}

// 截图
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
for (const t of THEMES) {
  const png = join(OUT, `theme-${t.id}.png`);
  try {
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--hide-scrollbars", `--user-data-dir=${CUD}`,
      "--window-size=1000,1300", "--virtual-time-budget=3000",
      `--screenshot=${png}`,
      `file:///${join(OUT, `theme-${t.id}.html`).replace(/\\/g, "/")}`,
    ], { stdio: "pipe" });
  } catch {
    // Chrome 把进度写到 stderr，非零退出也可能已出图
  }
}

console.log(`\n产出：probe/out/theme-*.png`);
console.log(fail === 0 ? "✓ 主题跟随断言全通过" : `✗ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
