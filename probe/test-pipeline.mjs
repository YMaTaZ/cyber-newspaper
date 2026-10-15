/**
 * 管线单元测试（阶段一）
 * 用法：node probe/test-pipeline.mjs
 */

import { normalizeUrl, normalizeTitle, similarity, entityOverlap, isSameEvent, dedupe, buildCandidatePool } from "../lib/pipeline/dedupe.js";
import { extractJson, assembleIssue } from "../lib/editorial/index.js";
import { parseFeed, parseDate } from "../lib/sources/index.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log("\n=== URL 规范化 ===");
check("去 www", normalizeUrl("https://www.example.com/a") === normalizeUrl("https://example.com/a"));
check("去末尾斜杠", normalizeUrl("https://a.com/b/") === normalizeUrl("https://a.com/b"));
check("去 utm", normalizeUrl("https://a.com/b?utm_source=x&id=1") === normalizeUrl("https://a.com/b?id=1"));
check("保留有效参数", normalizeUrl("https://a.com/b?id=1").includes("id=1"));
check("去锚点", normalizeUrl("https://a.com/b#top") === normalizeUrl("https://a.com/b"));

console.log("\n=== 标题相似度 ===");
const simCases = [
  ["Character.ai Files for Bankruptcy", "Character.ai files for bankruptcy", 0.9, "同事件大小写差异"],
  ["OpenAI launches GPT-6", "OpenAI releases GPT-6 model", 0.4, "同事件动词差异（实体层兼底）"],
  ["Cloudflare Workers 支持入站 TCP", "Cloudflare Workers 支持入站 TCP 协议", 0.7, "中文同事件"],
  ["Anthropic raises funding", "DeepMind publishes paper", 0.0, "不同事件应为低分"],
];
for (const [a, b, min, label] of simCases) {
  const s = similarity(a, b);
  check(`${label}（${s.toFixed(2)} vs 阈值 ${min}）`, s >= min, `实际 ${s.toFixed(3)}`);
}

console.log("\n=== 实体重合（跨源同事件判定）===");
const entCases = [
  ["OpenAI launches GPT-6", "OpenAI releases GPT-6 model", true, "同产品不同动词"],
  ["Anthropic raises $10B", "Anthropic closes $10 billion round", true, "同公司同金额"],
  ["Meta ships Llama 5", "Google ships Gemini 4", false, "不同公司不同产品"],
  ["OpenAI launches GPT-6", "Anthropic launches Claude 6", false, "不同公司同动词"],
];
for (const [a, b, want, label] of entCases) {
  const got = isSameEvent(a, b);
  check(`${label}（期望 ${want ? "合并" : "不合并"}）`, got === want, `实体重合 ${entityOverlap(a, b).toFixed(2)}`);
}

console.log("\n=== 已知边界：跨语言同事件不由管线处理 ===");
// 这是有意为之的边界（SPEC 6.3）：管线做机械去重，跨语言语义合并归编辑层。
// 模型同时懂中英文，它天然能看出这是同一件事；字符串匹配做不到，也不应该硬做。
const crossLang = isSameEvent("Character.ai Files for Bankruptcy", "Character.AI 申请破产保护");
check("中英文同事件不合并（归编辑层处理）", crossLang === false, `实体重合 ${entityOverlap("Character.ai Files for Bankruptcy", "Character.AI 申请破产保护").toFixed(2)}`);

console.log("\n=== 去重合并 ===");
const raw = [
  { title: "OpenAI launches GPT-6", url: "https://openai.com/index/gpt-6", sourceId: "openai", points: 100 },
  { title: "OpenAI launches GPT-6", url: "https://openai.com/index/gpt-6?utm_source=x", sourceId: "hn", points: 250 },
  { title: "Something totally different", url: "https://other.com/x", sourceId: "ars" },
];
const d = dedupe(raw);
check("同 URL 合并为一条", d.items.length === 2, `实际 ${d.items.length}`);
const merged = d.items.find((i) => i.url.includes("gpt-6"));
check("合并后记录两个来源", merged && merged.sources.length === 2, JSON.stringify(merged?.sources));
check("合并后取较大热度", merged && merged.points === 250, String(merged?.points));
check("统计多源交叉数", d.stats.crossSource === 1, String(d.stats.crossSource));

console.log("\n=== ref 回填（防编造）===");
const candidates = [
  { ref: 1, title: "真实标题一", url: "https://real.com/1", sources: ["hn"], points: 100 },
  { ref: 2, title: "真实标题二", url: "https://real.com/2", sources: ["ars"] },
];
const modelOut = {
  highlights: ["要点"],
  sections: [
    { title: "测试栏目", items: [{ ref: 1, note: "点评" }, { ref: 999, note: "越界" }] },
    { title: "空栏目", items: [{ ref: 888 }] },
  ],
  closing: "收尾",
};
const { issue, warnings } = assembleIssue(modelOut, candidates, {
  date: "2026-10-14", issueNo: 1, provider: "p", model: "m",
  sourceReport: [{ id: "hn", name: "HN", ok: true, count: 5 }],
  generatedAt: new Date().toISOString(),
});
check("URL 来自候选池，非模型编造", issue.sections[0].items[0].url === "https://real.com/1");
check("标题来自候选池", issue.sections[0].items[0].title === "真实标题一");
check("越界 ref 被丢弃", issue.sections[0].items.length === 1, `实际 ${issue.sections[0].items.length}`);
check("空栏目被移除", issue.sections.length === 1, `实际 ${issue.sections.length}`);
check("越界产生警告", warnings.some((w) => w.includes("999")), JSON.stringify(warnings));
check("统计正确", issue.stats.itemCount === 1 && issue.stats.sectionCount === 1);

console.log("\n=== 重复 ref 防护 ===");
const dup = assembleIssue(
  { sections: [{ title: "A", items: [{ ref: 1 }, { ref: 1 }] }], highlights: [], closing: "" },
  candidates, { date: "x", issueNo: 1, provider: "p", model: "m", sourceReport: [], generatedAt: "" }
);
check("同一 ref 只出现一次", dup.issue.sections[0].items.length === 1, `实际 ${dup.issue.sections[0].items.length}`);

console.log("\n=== JSON 提取容错 ===");
check("纯 JSON", extractJson('{"a":1}')?.a === 1);
check("markdown 包裹", extractJson('```json\n{"a":2}\n```')?.a === 2);
check("前后杂字", extractJson('好的，这是结果：{"a":3} 希望有帮助')?.a === 3);
check("尾随逗号", extractJson('{"a":4,}')?.a === 4);
check("非法输入返回 null", extractJson("完全不是 JSON") === null);

console.log("\n=== RSS 解析 ===");
const rss = `<rss><channel>
<item><title><![CDATA[标题一]]></title><link>https://a.com/1</link><pubDate>Tue, 13 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>标题二</title><link>https://a.com/2</link><pubDate>Mon, 12 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
const parsed = parseFeed(rss);
check("解析出 2 条", parsed.length === 2, `实际 ${parsed.length}`);
check("CDATA 标题正确", parsed[0].title === "标题一", parsed[0].title);
check("链接正确", parsed[0].url === "https://a.com/1");
check("日期解析", parsed[0].publishedAt === Date.parse("Tue, 13 Oct 2026 12:00:00 GMT"));

const atom = `<feed><entry><title>Atom 标题</title><link rel="alternate" href="https://b.com/1"/><published>2026-10-13T12:00:00Z</published></entry></feed>`;
const a1 = parseFeed(atom, { itemTag: "entry" });
check("Atom 解析出 1 条", a1.length === 1, `实际 ${a1.length}`);
check("Atom href 链接", a1[0]?.url === "https://b.com/1", a1[0]?.url);

console.log("\n=== 窗口过滤（关键防坑）===");
const oldRss = `<rss><channel>
<item><title>很旧的新闻</title><link>https://a.com/old</link><pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate></item>
</channel></rss>`;
const oldItems = parseFeed(oldRss);
const cutoff = Date.now() - 48 * 3600e3;
check("旧条目能被时间戳识别", oldItems[0].publishedAt < cutoff, String(oldItems[0].publishedAt));

console.log(`\n${"=".repeat(40)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
