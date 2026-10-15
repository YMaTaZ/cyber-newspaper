/**
 * 端到端验证（阶段一 + 阶段二的核心判据）
 *
 * 用真实数据 + 真实模型输出：
 *   候选池 → assembleIssue（ref 回填）→ renderIssue → HTML
 * 然后校验：
 *   1. Issue 通过 schema 校验
 *   2. 所有 Item.url 都能回溯到候选池，无一编造
 *   3. 渲染出的 HTML 里，链接与候选池一致
 *
 * 用法：node probe/e2e.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleIssue } from "../lib/editorial/index.js";
import { renderIssue } from "../lib/render/index.js";
import { TOKENS } from "../lib/render/styles.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const { date, report, stats, candidates } = JSON.parse(
  readFileSync(join(OUT, "candidates.json"), "utf8")
);

/**
 * 模模型的输出。**从候选池现场构造**，不读不可再生的 fixture。
 *
 * 为什么改：原先读 probe/out/editorial.json，那是某一次跑真模型留下的文件。
 * 目录一旦丢失或清理，e2e 就跑不了，而它测的是 ref 回填这条防编造红线，
 * 不该依赖一个手工产物。现在只依赖 candidates.json（run-pipeline 可再生）。
 *
 * 故意多放一条越界 ref：验证 assembleIssue 会丢弃它而不是编造。
 */
const pool = candidates.slice(0, 18);
const mid = Math.ceil(pool.length / 2);
// ref 必须取候选自带的 c.ref：assembleIssue 用 byRef = new Map(candidates.map(c => [c.ref, c]))，
// 不是数组下标。拿下标当 ref 会全部查不中，测面就空了。
const modelOutput = {
  highlights: pool.slice(0, 3).map((c, i) => `要点 ${i + 1}：${String(c.title).slice(0, 24)}`),
  sections: [
    {
      title: "模型与产品",
      items: pool.slice(0, mid).map((c, i) => ({ ref: c.ref, note: `点评 A${i}` })),
    },
    {
      title: "开源与研究",
      items: pool.slice(mid).map((c, i) => ({ ref: c.ref, note: `点评 B${i}` })),
    },
    // 越界引用：必须被丢弃，不能编出一条条目
    { title: "空栏位测试", items: [{ ref: 99999, note: "不应出现" }] },
  ],
  closing: "收尾测试。",
};

console.log(`\n=== 端到端验证 ===`);
console.log(`候选池 ${candidates.length} 条，模型输出 ${modelOutput.sections?.length} 栏\n`);

// ① ref 回填
const { issue, warnings, validItemCount } = assembleIssue(modelOutput, candidates, {
  date,
  issueNo: 7,
  provider: "test-provider",
  model: "test-model",
  sourceReport: report,
  generatedAt: new Date().toISOString(),
});

console.log("① ref 回填");
check("产出 Issue", !!issue);
check("有 highlights", issue.highlights.length > 0, `实际 ${issue.highlights.length}`);
check("有 sections", issue.sections.length > 0, `实际 ${issue.sections.length}`);
check("有效条目 ≥ 5", validItemCount >= 5, `实际 ${validItemCount}`);
if (warnings.length) {
  console.log(`    （警告 ${warnings.length} 条：${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "…" : ""}）`);
}

// ② 防编造：所有 URL 必须来自候选池
console.log("\n② 防编造校验（核心）");
const poolUrls = new Set(candidates.map((c) => c.url));
const poolByUrl = new Map(candidates.map((c) => [c.url, c]));
let fabricated = 0;
for (const sec of issue.sections) {
  for (const it of sec.items) {
    if (!poolUrls.has(it.url)) fabricated++;
  }
}
check("无编造 URL", fabricated === 0, `发现 ${fabricated} 条`);

// 标题与 URL 的对应关系也要一致
let mismatched = 0;
for (const sec of issue.sections) {
  for (const it of sec.items) {
    const src = poolByUrl.get(it.url);
    if (!src || src.title !== it.title) mismatched++;
  }
}
check("标题与 URL 对应正确", mismatched === 0, `${mismatched} 条不匹配`);

// ③ schema 校验
console.log("\n③ schema 校验");
check("有 schemaVersion", issue.schemaVersion === 1);
check("有 date", /^\d{4}-\d{2}-\d{2}$/.test(issue.date), issue.date);
check("有 issueNo", Number.isInteger(issue.issueNo));
check("有 generatedAt", !!issue.generatedAt);
check("stats.itemCount 与实际一致",
  issue.stats.itemCount === issue.sections.reduce((n, s) => n + s.items.length, 0));
check("stats.sectionCount 正确", issue.stats.sectionCount === issue.sections.length);
check("每个栏目都有 id", issue.sections.every((s) => !!s.id));

// ④ 渲染
console.log("\n④ 渲染");
const htmlStandalone = renderIssue(issue, { mode: "standalone" });
const htmlPrint = renderIssue(issue, { mode: "print" });
const htmlEmbed = renderIssue(issue, { mode: "embed" });

check("standalone 是完整文档", htmlStandalone.startsWith("<!DOCTYPE html>"));
// 主题跟随的设计：背景与主色跟宿主；文字色不跟（宿主 --text 是为它自己 UI 选的，
// 拿来当正文会拉低对比度），而是按宿主背景的明暗取高对比值。
check("standalone 跟随宿主背景", htmlStandalone.includes("var(--hana-bg,"), "未接上 --hana-bg");
check("standalone 跟随宿主主色", htmlStandalone.includes("var(--hana-accent,"), "未接上 --hana-accent");
check("standalone 跟随宿主分隔线", htmlStandalone.includes("var(--hana-border,"));
check("文字色不直接跟宿主 --text", !htmlStandalone.includes("var(--hana-text,"));
check("带深色模式高对比覆盖", htmlStandalone.includes('data-color-mode="dark"'));
check("standalone 带兜底色", htmlStandalone.includes(TOKENS.paperFallback) && htmlStandalone.includes(TOKENS.accentFallback));
check("内部变量不与宿主同名（避免循环）", !/\n\s*--accent:\s*var\(--accent[,)]/.test(htmlStandalone));
check("print 含 @page A4", htmlPrint.includes("@page") && htmlPrint.includes("A4"));
check("print 含分栏起新页", htmlPrint.includes("break-before: page"));
check("embed 不含 html 外壳", !htmlEmbed.includes("<!DOCTYPE"));
check("embed 含样式", htmlEmbed.includes("<style>"));

// 渲染出的链接必须与 Issue 一致。
// 注意：HTML 里 & 会被转义成 &amp;，比较前要把转义还原。
const unesc = (s) => String(s).replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const renderedUrls = [...htmlStandalone.matchAll(/href="([^"]+)"/g)].map((m) => unesc(m[1]));
const issueUrls = issue.sections.flatMap((s) => s.items.map((i) => i.url));
check("渲染链接数与条目数一致", renderedUrls.length === issueUrls.length,
  `渲染 ${renderedUrls.length} / 条目 ${issueUrls.length}`);
check("渲染链接全部来自 Issue", renderedUrls.every((u) => issueUrls.includes(u)));

// ⑤ 动态结构容错（SPEC 8.5）
console.log("\n⑤ 动态结构容错");
const variants = [
  { name: "单栏", sections: [{ id: "a", title: "唯一栏目", items: issue.sections[0].items.slice(0, 2) }] },
  { name: "八栏", sections: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `栏目 ${i}`, items: [] })) },
  { name: "缺 note/lead/badges", sections: [{ id: "x", title: "极简", items: [{ title: "只有标题", url: "https://a.com/1", sources: ["hn"] }] }] },
  { name: "空 sections", sections: [] },
  { name: "长栏目名", sections: [{ id: "y", title: "这是一个非常非常长的栏目名称用来测试渲染器是否会崩掉或者溢出容器边界", items: issue.sections[0].items.slice(0, 1) }] },
];
for (const v of variants) {
  let ok = true, err = "";
  try {
    const h = renderIssue({ ...issue, ...v }, { mode: "standalone" });
    ok = typeof h === "string" && h.length > 0;
  } catch (e) { ok = false; err = e.message; }
  check(`渲染不崩：${v.name}`, ok, err);
}

// ⑥ XSS 防护
console.log("\n⑥ 转义防护");
const evil = renderIssue({
  ...issue,
  sections: [{ id: "z", title: '<script>alert(1)</script>', items: [
    { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', sources: ["hn"], note: '<b>粗体</b>' },
  ] }],
  highlights: ['<script>bad</script>'],
}, { mode: "standalone" });
check("栏目名被转义", !evil.includes("<script>alert(1)</script>"));
check("条目标题被转义", !evil.includes("<img src=x"));
check("javascript: 链接被挡", !evil.includes('href="javascript:'));
check("要点被转义", !evil.includes("<script>bad</script>"));

// 落盘
writeFileSync(join(OUT, "issue.json"), JSON.stringify(issue, null, 2), "utf8");
writeFileSync(join(OUT, "issue.html"), htmlStandalone, "utf8");
writeFileSync(join(OUT, "issue-print.html"), htmlPrint, "utf8");

console.log(`\n产出：probe/out/issue.json、issue.html、issue-print.html`);
console.log(`${"=".repeat(40)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
