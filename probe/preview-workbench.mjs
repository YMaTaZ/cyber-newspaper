/**
 * 工作台本地预览
 *
 * 目的：在浏览器里真实渲染 workbench.html，验证侧栏布局。
 * 做法：注入一个 fetch 拦截层，喂假数据，然后把 workbench.html 原样渲染。
 *
 * 用法：node probe/preview-workbench.mjs
 * 产出：probe/out/workbench-preview.html（用浏览器打开即可）
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const html = readFileSync(join(ROOT, "ui", "workbench.html"), "utf8");

// 假 Issue：多栏目，用于验证目录导航铺满
const issue = {
  schemaVersion: 1,
  date: "2026-10-14",
  issueNo: 7,
  generatedAt: new Date().toISOString(),
  lang: "zh",
  provider: "deepseek",
  model: "deepseek-v4",
  sources: [
    { id: "hn", name: "Hacker News", ok: true, count: 9 },
    { id: "github", name: "GitHub 新仓库", ok: true, count: 30 },
    { id: "arxiv", name: "arXiv cs.AI", ok: true, count: 30 },
    { id: "qbitai", name: "量子位", ok: true, count: 10 },
    { id: "infoq", name: "InfoQ 中国", ok: true, count: 20 },
    { id: "techcrunch", name: "TechCrunch AI", ok: true, count: 16 },
    { id: "ars", name: "Ars Technica AI", ok: false, count: 0, error: "超时" },
    { id: "openai", name: "OpenAI Blog", ok: true, count: 1 },
  ],
  highlights: [
    "Character.ai 申请破产，Disney 出价 2000 万美元只要它的聊天机器人技术",
    "Cloudflare 同一天发布 Python Workers 并让 Workers 支持入站 TCP",
    "Anthropic 仅用 7 人、5 个月重造版本控制系统，起因是 Claude 写代码太快",
    "国内 1T4R 1Gb RRAM 芯片完成流片",
  ],
  sections: [
    { id: "s1", title: "Agent 运行时与工程地基", lead: "今天的进展集中在同一件事：让 Agent 真正跑在生产环境里。", items: [
      { title: "Cloudflare Workers 支持入站 TCP，gRPC 成为首个基于此构建的协议", url: "https://blog.cloudflare.com/tcp", sources: ["infoq", "techcrunch"], note: "边缘函数开始能承接长连接与流式服务。" },
      { title: "Cloudflare 正式发布 Python Workers", url: "https://www.infoq.cn/python-workers", sources: ["infoq"], note: "冷启动与上游维护仍无明确答案。" },
      { title: "Anthropic 用 7 人 5 个月重造版本控制系统", url: "https://example.com/vcs", sources: ["hn"], points: 310, note: "AI 写代码倒逼底层工具链重构。" },
    ]},
    { id: "s2", title: "算力、芯片与机器人", lead: "硬件侧给出的都是具体进展，不是路线图。", items: [
      { title: "MemSilicon 完成国际首款 1T4R 1Gb RRAM 芯片流片", url: "https://www.qbitai.com/rram", sources: ["qbitai"], note: "边缘侧大容量存储的潜在解法。" },
      { title: "Science Corporation 植入视力恢复芯片", url: "https://techcrunch.com/vision", sources: ["techcrunch"], note: "通向新型脑机接口的一步。" },
      { title: "ChunkAct: Action Chunking for Agentic Robotics", url: "https://arxiv.org/abs/1", sources: ["arxiv"], note: "用动作分块缓解长序列决策的延迟。" },
    ]},
    { id: "s3", title: "Character.ai 破产与 AI 的责任账", items: [
      { title: "Character.ai Files for Bankruptcy", url: "https://news.example.com/charai", sources: ["hn"], points: 260, note: "消费级陪伴 AI 的商业模式被证伪。" },
      { title: "Disney offers $20M for Character.AI's chatbot tech", url: "https://arstechnica.com/disney", sources: ["ars", "hn"], note: "买资产不买责任。" },
    ]},
    { id: "s4", title: "端侧、消费级与个人 AI", items: [
      { title: "Pulse Local: a Mac budgeting app whose AI models run on device", url: "https://example.com/pulse", sources: ["hn"], points: 150, note: "隐私诉求正在变成产品卖点本身。" },
      { title: "ARahim3/DigUp", url: "https://github.com/ARahim3/DigUp", sources: ["github"], stars: 2985, note: "端侧按内容检索文件。" },
    ]},
    { id: "s5", title: "生成式内容与创意工具", items: [
      { title: "Higgsfield takes AI video from 1 minute to over 10", url: "https://openai.com/index/higgsfield", sources: ["openai"], note: "时长是这类工具最硬的瓶颈。" },
      { title: "《变形计》综艺赛博复活，AI 版 MrBeast 爆火", url: "https://www.qbitai.com/mrbeast", sources: ["qbitai"], note: "AI 在改写综艺的成本结构。" },
    ]},
    { id: "s6", title: "AI 安全与滥用", items: [
      { title: "I posted to HN, and then my website was flooded with AI bot traffic", url: "https://example.com/bots", sources: ["hn"], points: 323, note: "内容站正在被 AI 爬虫淹没。" },
    ]},
  ],
  closing: "今天最值得注意的暗线是「责任与承载」：行业开始为过去几年快速扩张的 AI 产品付账，与此同时基础设施在补齐长连接与低冷启动短板。",
  stats: { itemCount: 12, sectionCount: 6, sourceOk: 7, sourceTotal: 8, crossSource: 2 },
};

// 压力测试：DUP_SECTIONS=10 时把栏目复制到指定数量，
// 验证目录过长时归档不会被挤掉。
const dup = Number(process.env.DUP_SECTIONS || 0);
if (dup > issue.sections.length) {
  const base = issue.sections;
  const grown = [];
  for (let i = 0; i < dup; i++) {
    const s = base[i % base.length];
    grown.push({ ...s, id: `${s.id}-${i}`, title: `${s.title}（${i + 1}）` });
  }
  issue.sections = grown;
  issue.stats.sectionCount = grown.length;
}

const archiveIndex = {
  schemaVersion: 1,
  entries: [
    { date: "2026-10-14", issueNo: 7, title: "Character.ai 申请破产，Disney 出价 2000 万美元", itemCount: 12, sectionCount: 6, sourceOk: 7 },
    { date: "2026-10-13", issueNo: 6, title: "OpenAI 发布 GPT-6，上下文窗口显著拉长", itemCount: 18, sectionCount: 5, sourceOk: 8 },
    { date: "2026-10-12", issueNo: 5, title: "Meta 开源新一代推理模型", itemCount: 15, sectionCount: 4, sourceOk: 8 },
    { date: "2026-10-11", issueNo: 4, title: "欧盟 AI 法案首批执行细则落地", itemCount: 21, sectionCount: 6, sourceOk: 7 },
    { date: "2026-10-10", issueNo: 3, title: "NVIDIA 发布新一代推理芯片", itemCount: 16, sectionCount: 5, sourceOk: 8 },
    { date: "2026-10-09", issueNo: 2, title: "国产大模型集体降价", itemCount: 19, sectionCount: 5, sourceOk: 6 },
  ],
  nextIssueNo: 8,
};

const providers = [
  { provider: "deepseek", models: [
    { id: "deepseek-v4", name: "DeepSeek V4" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ]},
  { provider: "moonshot", models: [
    { id: "kimi-k3", name: "Kimi K3" },
  ]},
];

// 渲染 Issue 用的 HTML（复用真渲染器）
const { renderIssue } = await import("../lib/render/index.js");
const issueHtml = renderIssue(issue, { mode: "embed" });

// 主题模拟：用 PREVIEW_THEME 指定一套宿主变量，验证深色/浅色主题下的自适应。
// 真实环境里这些值由 theme-follow.js 从宿主窗口搬过来。
const HOST_THEMES = {
  // 默认（白底黑字，接近宿主「暖纸」）
  light: {
    "--hana-bg": "#F8F4ED",
    "--hana-bg-card": "#FCFAF5",
    "--hana-sidebar-bg": "#F4F0EA",
    "--hana-text": "#3B3D3F",
    "--hana-text-light": "#6B6F73",
    "--hana-text-muted": "#8E9196",
    "--hana-accent": "#537D96",
    "--hana-border": "rgba(122, 96, 88, 0.18)",
  },
  // 青夜（深青蓝底 + 柔粉主调）：瑞士风格的硬线在这里必须变浅才能看见
  dark: {
    "--hana-bg": "#3B4A54",
    "--hana-bg-card": "#445560",
    "--hana-sidebar-bg": "#34424B",
    "--hana-text": "#E1EAF0",
    "--hana-text-light": "#B7C5CE",
    "--hana-text-muted": "#A3B5C0",
    "--hana-accent": "#C99AAF",
    "--hana-border": "rgba(170, 121, 141, 0.16)",
  },
};
const themeName = process.env.PREVIEW_THEME || "none";
const themeVars = HOST_THEMES[themeName];
const themeInject = themeVars
  ? `Object.entries(${JSON.stringify(themeVars)}).forEach(([k, v]) =>
      document.documentElement.style.setProperty(k, v));`
  : "";

// 注入 mock：拦截 fetch，返回假数据
const mockScript = `
<script>
(function () {
  ${themeInject}
  const ISSUE = ${JSON.stringify(issue)};
  const ISSUE_HTML = ${JSON.stringify(issueHtml)};
  const ARCHIVE = ${JSON.stringify(archiveIndex)};
  const PROVIDERS = ${JSON.stringify(providers)};
  const CONFIG = { provider: "deepseek", model: "deepseek-v4", lang: "zh", maxCandidates: 40, windowHours: 24 };

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, init) {
    const u = String(url);
    const json = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { "content-type": "application/json" },
    });
    if (u.includes("/api/digest/providers")) return json({ ok: true, providers: PROVIDERS });
    if (u.includes("/api/digest/config")) return json({ ok: true, config: CONFIG });
    if (u.includes("/api/digest/archive")) return json({ ok: true, index: ARCHIVE });
    if (u.includes("/api/digest/issue/")) return json({ ok: true, issue: ISSUE, html: ISSUE_HTML });
    if (u.includes("/api/digest/search")) return json({ ok: true, results: [] });
    return realFetch(url, init);
  };

  // sdk.js 在本地跑不起来，用桩替代（workbench 只调 hana.ready()）
  window.__hanaStub = true;

  // 自动打开第一期，便于预览目录与正文。
  // 必须重试：归档列表是异步 loadArchive() 渲染的，一次 setTimeout 可能赶不上。
  window.addEventListener("load", () => {
    var tries = 0;
    var t = setInterval(function () {
      var first = document.querySelector(".entry");
      if (first) { first.click(); clearInterval(t); return; }
      if (++tries > 40) clearInterval(t);
    }, 50);
  });
})();
</script>
`;

// 把 SDK / theme-follow 的引入整体换成桩：本地没有宿主 iframe，
// 不换就回加载不到 sdk.js，整个 module 脚本会挂（页面看起来就是空白）。
const SDK_IMPORT_RE = /import\s*\{\s*hana\s*\}\s*from\s*["'][^"']*["'];\s*\n(?:import[^\n]*\n)*\s*hana\.ready\(\);\s*\n(?:followHostTheme\([^)]*\);\s*\n)?/;
if (!SDK_IMPORT_RE.test(html)) {
  console.error("⚠ 预览：没能定位到 SDK 引入块，页面会因加载不到 sdk.js 而空白。检查 workbench.html 的 import 写法。");
}
let out = html.replace(
  SDK_IMPORT_RE,
  `const hana = { ready: () => {}, surface: { getContext: () => null }, theme: { getSnapshot: () => null, subscribe: () => () => {} } };\n`
);

// mock 脚本要插在 workbench 的 module script 之前
// 同时把 theme-follow.js 的引入也换掉（它依赖宿主窗口）
out = out.replace(
  /import\s*\{\s*followHostTheme\s*\}\s*from\s*["'][^"']*["'];?/g,
  "const followHostTheme = () => {};"
);
out = out.replace("</head>", mockScript + "</head>");

writeFileSync(join(OUT, "workbench-preview.html"), out, "utf8");
console.log("产出：probe/out/workbench-preview.html");
console.log(`  主题模拟：${themeName}${themeVars ? `（已注入 ${Object.keys(themeVars).length} 个 --hana-* 变量）` : "（不注入，走兜底色）"}`);
console.log(`Issue：${issue.sections.length} 栏 / ${issue.stats.itemCount} 条`);
console.log(`归档：${archiveIndex.entries.length} 期`);
