/**
 * 品牌改名：旧名 → 三层命名
 *
 * 命名分层：
 *   App 里显示的名字    → 日报
 *   项目名（报头/品牌）  → 赛博报纸
 *   市场与 GitHub 取名   → 赛博报纸的英文 = Cyber Newspaper / cyber-newspaper
 *
 * 落到字段上：
 *   manifest.name        → "Cyber Newspaper"   （市场条目用的就是它）
 *   卡片/设置页/导航标题  → "日报"              （App 内的显示名）
 *   日报正文报头、导出标题与文件名 → "赛博报纸"
 *   manifest.id、UA、包名、仓库名   → cyber-newspaper
 *
 * 内部路由 api/digest/* 与 --dg-* 变量前缀不动：零用户可见度，
 * 改了只增加回归面。宿主挂的前缀 /api/apps/<id>/routes 随 id 变，必须同步。
 *
 * 按文件分场景替换，不用全局串换——否则会分不清"日报"该出现在哪里。
 *
 * 用法：node probe/rename-brand.mjs --check   只看要改什么
 *       node probe/rename-brand.mjs           执行
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DRY = process.argv.includes("--check");

/** 每个文件一组精确规则 */
const PLAN = {
  "../manifest.json": [
    ['"name": "AI 热点日报"', '"name": "Cyber Newspaper"'],
    [
      '"description": "生成当天的 AI 热点简报：抓取多个公开数据源，归并去重后由你选定的模型整理成结构化日报，按日期归档、可搜索、可导出。"',
      '"description": "赛博报纸：抓取多个公开 AI 数据源，归并去重后由你选定的模型整理成当天的结构化日报，按日期归档、可搜索、可导出。"',
    ],
    [
      '"description": "生成当天的 AI 热点日报。抓取多个公开数据源，归并去重后由模型整理成结构化简报，归档并返回。在会话里被调用时会同时产出 PDF。"',
      '"description": "生成当天的赛博报纸。抓取多个公开 AI 数据源，归并去重后由模型整理成结构化日报，归档并返回。在会话里被调用时会同时产出 PDF。"',
    ],
    ['"title": "AI 热点日报"', '"title": "日报"'],
    [
      '"description": "生成当天的 AI 热点简报，按日期归档，可搜索、可导出。"',
      '"description": "当天的 AI 热点日报，按日期归档，可搜索、可导出。"',
    ],
  ],

  "../index.js": [
    ['export const name = "ai-daily-digest"', 'export const name = "cyber-newspaper"'],
    ['sdk.logger.info("ai-daily-digest loaded")', 'sdk.logger.info("cyber-newspaper loaded")'],
    ['sdk.logger.info("ai-daily-digest ready")', 'sdk.logger.info("cyber-newspaper ready")'],
    [
      '"生成当天的 AI 热点日报。抓取多个公开数据源，归并去重后由模型整理成结构化简报，归档并返回。在会话里被调用时会同时产出 PDF。",',
      '"生成当天的赛博报纸。抓取多个公开 AI 数据源，归并去重后由模型整理成结构化日报，归档并返回。在会话里被调用时会同时产出 PDF。",',
    ],
    [
      '「AI 热点日报」设置页打开「会话内触发」',
      '「日报」设置页打开「会话内触发」',
    ],
    ['`AI 热点日报 第 ', '`赛博报纸 第 '],
    ['`AI热点日报_${result.issue.date', '`赛博报纸_${result.issue.date'],
    ['"AI热点日报.pdf"', '"赛博报纸.pdf"'],
  ],

  "../lib/render/index.js": [
    ["<h1>AI 热点日报</h1>", "<h1>赛博报纸</h1>"],
    ["`AI 热点日报 ${issue?.date ?? \"\"}`", "`赛博报纸 ${issue?.date ?? \"\"}`"],
  ],

  "../lib/export/index.js": [["`AI热点日报_${String(issue.date)", "`赛博报纸_${String(issue.date)"]],
  "../lib/export/markdown.js": [["`# AI 热点日报`", "`# 赛博报纸`"]],
  "../lib/export/docx.js": [['runs("AI 热点日报"', 'runs("赛博报纸"']],

  "../lib/sources/index.js": [
    ["compatible; ai-daily-digest)", "compatible; cyber-newspaper)"],
  ],

  "../ui/workbench.html": [
    ["<title>AI 热点日报</title>", "<title>日报</title>"],
    ["<h1>AI 热点日报</h1>", "<h1>日报</h1>"],
    ["`AI热点日报_${date}.${fmt}`", "`赛博报纸_${date}.${fmt}`"],
    ["/api/apps/ai-daily-digest/routes", "/api/apps/cyber-newspaper/routes"],
  ],

  "../ui/settings.html": [
    ["<title>AI 热点日报 · 设置</title>", "<title>日报 · 设置</title>"],
    ["<h1>AI 热点日报</h1>", "<h1>日报</h1>"],
    ["/api/apps/ai-daily-digest/routes", "/api/apps/cyber-newspaper/routes"],
  ],

  "../ui/status.html": [
    ["/api/apps/ai-daily-digest/routes", "/api/apps/cyber-newspaper/routes"],
  ],

  "../ui/assets/theme-follow.js": [
    ["/api/apps/ai-daily-digest/routes", "/api/apps/cyber-newspaper/routes"],
  ],

  "../pack.ps1": [['Write-Host "打包 AI 热点日报"', 'Write-Host "打包 赛博报纸"']],

  "../probe/test-export.mjs": [
    ['md.includes("# AI 热点日报")', 'md.includes("# 赛博报纸")'],
  ],
  "../probe/sources-probe.mjs": [
    ["compatible; ai-daily-digest-probe)", "compatible; cyber-newspaper-probe)"],
  ],
};

let changed = 0;
let missing = 0;

for (const [f, rules] of Object.entries(PLAN)) {
  const url = new URL(f, import.meta.url);
  if (!existsSync(url)) {
    console.log(`  ⚠ 文件不存在：${f}`);
    missing++;
    continue;
  }
  let s = readFileSync(url, "utf8");
  const before = s;
  const hits = [];
  for (const [from, to] of rules) {
    const n = s.split(from).length - 1;
    if (n) {
      hits.push(`${n}`);
      s = s.split(from).join(to);
    } else {
      // 规则没命中要报出来：改了个不存在的东西等于没改
      console.log(`  ⚠ ${f} 规则未命中：${from.slice(0, 60)}`);
      missing++;
    }
  }
  if (s !== before) {
    changed++;
    if (!DRY) writeFileSync(url, s, "utf8");
    console.log(`  ${DRY ? "[改]" : "✓"} ${f}  (${hits.join("+")} 处)`);
  }
}

console.log(`\n${DRY ? "将改" : "已改"} ${changed} 个文件；规则未命中 ${missing} 条`);
if (!DRY && missing) console.log("⚠ 有规则没命中，请核对原文是否已变（不命中=那处名字没换）");
process.exit(missing ? 1 : 0);
