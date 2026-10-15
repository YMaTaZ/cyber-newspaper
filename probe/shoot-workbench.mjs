/**
 * 把工作台预览渲染成 PNG，供市场投稿的 PR 正文使用。
 *
 * 为什么要单独出图而不是用现有的 theme-*.png：
 *   那些图是"主题跟随"的验证产物，重点是配色对比，尺寸与内容都为那个目的服务。
 *   PR 要展示的是「这个 App 长什么样、能做什么」，需要一张主界面大图。
 *
 * 出两套主题（浅色暖纸 + 深色午夜），让审核者一眼看到跟随效果。
 *
 * 用法：node probe/shoot-workbench.mjs
 * 产出：probe/out/shot-workbench-<theme>.png
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(CHROME)) {
  console.error("✗ 找不到 Chrome：" + CHROME);
  process.exit(1);
}

// Chrome 的用户数据目录不能落在项目里（会写 Cookies / Login Data 并被打包器打进包）
const CUD = join(tmpdir(), `cns-shot-${process.pid}`);
process.on("exit", () => {
  try { rmSync(CUD, { recursive: true, force: true }); } catch {}
});

const src = join(OUT, "workbench-preview.html");
if (!existsSync(src)) {
  console.error("✗ 先跑 node probe/preview-workbench.mjs 生成 workbench-preview.html");
  process.exit(1);
}

// 两套主题的宿主变量，模拟 theme-follow.js 从宿主搬过来的值
const THEMES = [
  {
    id: "light",
    label: "浅色（暖纸）",
    vars: { "--hana-bg": "#F8F4ED", "--hana-bg-card": "#FFFDF9", "--hana-sidebar-bg": "#F2EDE4", "--hana-accent": "#537D96", "--hana-border": "#D8D0C4" },
    mode: "light",
  },
  {
    id: "dark",
    label: "深色（午夜）",
    vars: { "--hana-bg": "#1A1D21", "--hana-bg-card": "#22262B", "--hana-sidebar-bg": "#16191D", "--hana-accent": "#5FA8C4", "--hana-border": "#3A4046" },
    mode: "dark",
  },
];

for (const t of THEMES) {
  const varsCss = Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(";");
  // 注入宿主变量 + data-color-mode + data-theme，模拟真实宿主首屏
  const html = readFileSync(src, "utf8").replace(
    "<head>",
    `<head><style>:root{${varsCss}}</style>`
  ).replace(
    /<html([^>]*)>/,
    `<html$1 data-color-mode="${t.mode}" data-theme="preview-${t.id}">`
  );

  const page = join(OUT, `shot-page-${t.id}.html`);
  writeFileSync(page, html, "utf8");

  const png = join(OUT, `shot-workbench-${t.id}.png`);
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", `--user-data-dir=${CUD}`,
    "--window-size=1440,1000",
    "--virtual-time-budget=4000",
    `--screenshot=${png}`,
    `file:///${page.replace(/\\/g, "/")}`,
  ], { stdio: "pipe" });

  const kb = (readFileSync(png).length / 1024).toFixed(0);
  console.log(`  ✓ ${t.label} → ${png.replace(ROOT + "\\", "")}  (${kb} KB)`);
}

console.log("\n完成。这两张图可直接拖进市场 PR 正文。");
