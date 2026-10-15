/**
 * 三层命名检查（改名防回退）
 *
 * 三层命名分层，混用即为错：
 *   层1  App 内显示名      → 日报        （侧边导航、卡片标题、设置页、页面 <title>）
 *   层2  项目名 / 报头品牌  → 赛博报纸    （日报正文报头、导出文件标题与文件名）
 *   层3  市场与 GitHub 取名 → cyber-newspaper / Cyber Newspaper（id、UA、仓库名）
 *
 * 用法：node probe/check-brand.mjs
 */
import { readFileSync } from "node:fs";

const t = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

let fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  [" + detail + "]" : ""}`);
  if (!ok) fail++;
}

console.log("=== 层1 App 显示名：日报 ===");
const manifest = t("../manifest.json");
// 卡片与设置页各有一处 title 必须是「日报」，且不能是品牌名
const cardTitles = [...manifest.matchAll(/"title": "([^"]*)"/g)].map((m) => m[1]);
check("manifest 内所有 title 都是「日报」", cardTitles.length >= 2 && cardTitles.every((x) => x === "日报"), cardTitles.join(" / "));

const wb = t("../ui/workbench.html");
const st = t("../ui/settings.html");
check("工作台 <title>日报</title>", wb.includes("<title>日报</title>"));
check("工作台侧栏 <h1>日报</h1>", wb.includes("<h1>日报</h1>"));
check("设置页 <title>日报 · 设置</title>", st.includes("<title>日报 · 设置</title>"));
check("设置页 <h1>日报</h1>", st.includes("<h1>日报</h1>"));

console.log("\n=== 层2 报头与导出：赛博报纸 ===");
const render = t("../lib/render/index.js");
check("日报报头 <h1>赛博报纸</h1>", render.includes("<h1>赛博报纸</h1>"));
check("导出 HTML 文档标题含赛博报纸", /title = `赛博报纸/.test(render));
check("Markdown 标题 # 赛博报纸", t("../lib/export/markdown.js").includes("# 赛博报纸"));
check("Word 标题 赛博报纸", t("../lib/export/docx.js").includes('runs("赛博报纸"'));
check("导出文件名前缀 赛博报纸_", t("../lib/export/index.js").includes("赛博报纸_"));
check("工作台下载名 赛博报纸_", wb.includes("赛博报纸_"));
check("会话内 PDF 文件名 赛博报纸", t("../index.js").includes("赛博报纸_"));

console.log("\n=== 层3 标识：cyber-newspaper ===");
check("manifest.id", manifest.includes('"id": "cyber-newspaper"'));
check("manifest.name = Cyber Newspaper", manifest.includes('"name": "Cyber Newspaper"'));
check("index.js 导出 name", t("../index.js").includes('export const name = "cyber-newspaper"'));
for (const [f, label] of [
  ["../ui/workbench.html", "workbench 路由前缀"],
  ["../ui/settings.html", "settings 路由前缀"],
  ["../ui/status.html", "status 路由前缀"],
  ["../ui/assets/theme-follow.js", "theme-follow 路由前缀"],
]) {
  check(label, t(f).includes("/api/apps/cyber-newspaper/routes"));
}
check("抓取 UA", t("../lib/sources/index.js").includes("compatible; cyber-newspaper)"));

console.log("\n=== 旧名不得残留在发布物中 ===");
const RELEASE = [
  "../manifest.json",
  "../index.js",
  "../lib/render/index.js",
  "../lib/render/styles.js",
  "../lib/export/index.js",
  "../lib/export/markdown.js",
  "../lib/export/docx.js",
  "../lib/export/zip.js",
  "../lib/export/html.js",
  "../lib/sources/index.js",
  "../lib/pipeline/dedupe.js",
  "../lib/editorial/index.js",
  "../lib/store/index.js",
  "../ui/workbench.html",
  "../ui/settings.html",
  "../ui/status.html",
  "../ui/assets/theme-follow.js",
  "../ui/assets/theme-mode.js",
  "../README.md",
];
// 旧名两种写法都要拦
for (const f of RELEASE) {
  let s;
  try {
    s = t(f);
  } catch {
    continue; // 文件不存在由其它检查负责
  }
  const bad = [];
  if (/AI ?热点日报/.test(s)) bad.push("AI热点日报");
  if (/ai-daily-digest/.test(s)) bad.push("ai-daily-digest");
  check(f.replace("../", ""), bad.length === 0, bad.join(","));
}

console.log(fail === 0 ? "\n✓ 三层命名一致，无旧名残留" : `\n✗ ${fail} 项不符`);
process.exit(fail ? 1 : 0);
