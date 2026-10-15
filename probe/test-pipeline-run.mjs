/**
 * runPipeline 集成测试（用 mock sdk）
 *
 * 这是最接近真实运行的验证：跑完整管线，但网络与模型用 mock 替换。
 * 验证：抓取 → 归并 → 编辑层 → ref 回填 → 渲染 → 归档 全链路。
 *
 * 用法：node probe/test-pipeline-run.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPipeline, detectProviders } from "../index.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// ---------- mock 数据 ----------
const NOW = Date.now();
const RSS = (title, url, hoursAgo = 2) => `<item>
  <title><![CDATA[${title}]]></title>
  <link>${url}</link>
  <pubDate>${new Date(NOW - hoursAgo * 3600e3).toUTCString()}</pubDate>
  <description><![CDATA[摘要内容 ${title}]]></description>
</item>`;

const HN_JSON = JSON.stringify({
  hits: [
    { title: "OpenAI launches GPT-6 with longer context", url: "https://openai.com/index/gpt-6", created_at_i: Math.floor(NOW / 1000) - 3600, points: 420, num_comments: 180 },
    { title: "Anthropic ships a new version control system", url: "https://anthropic.com/vcs", created_at_i: Math.floor(NOW / 1000) - 7200, points: 310, num_comments: 95 },
    { title: "Character.ai files for bankruptcy", url: "https://news.example.com/charai", created_at_i: Math.floor(NOW / 1000) - 5400, points: 260, num_comments: 210 },
    { title: "A local-first budgeting app that runs models on device", url: "https://example.com/pulse", created_at_i: Math.floor(NOW / 1000) - 9000, points: 150, num_comments: 60 },
    { title: "Cloudflare adds inbound TCP to Workers", url: "https://blog.cloudflare.com/tcp", created_at_i: Math.floor(NOW / 1000) - 3000, points: 200, num_comments: 70 },
  ],
});

const GH_JSON = JSON.stringify({
  items: [
    { full_name: "acme/agent-toolkit", html_url: "https://github.com/acme/agent-toolkit", created_at: new Date(NOW - 86400e3).toISOString(), stargazers_count: 5200, description: "A toolkit for building agents" },
    { full_name: "beta/local-llm", html_url: "https://github.com/beta/local-llm", created_at: new Date(NOW - 172800e3).toISOString(), stargazers_count: 3100, description: "Run LLMs locally" },
  ],
});

const ARXIV_XML = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>ChunkAct: Action Chunking for Agentic Robotics</title>
<link rel="alternate" href="https://arxiv.org/abs/2026.11111"/>
<published>${new Date(NOW - 4 * 3600e3).toISOString()}</published>
<summary>We propose action chunking for robot control loops.</summary></entry>
<entry><title>Efficient Retrieval with Embedding Compression</title>
<link rel="alternate" href="https://arxiv.org/abs/2026.22222"/>
<published>${new Date(NOW - 8 * 3600e3).toISOString()}</published>
<summary>We compress embeddings for retrieval.</summary></entry>
</feed>`;

const QBIT_RSS = `<rss><channel>
${RSS("阶跃发布首款 Agent 手机 STEPX Neo", "https://www.qbitai.com/stepx", 3)}
${RSS("国内最年轻 AI 教授创业做世界模型", "https://www.qbitai.com/worldmodel", 5)}
${RSS("1T4R 1Gb RRAM 芯片完成流片", "https://www.qbitai.com/rram", 7)}
${RSS("AI 版 MrBeast 爆火，综艺成本结构被改写", "https://www.qbitai.com/mrbeast", 9)}
</channel></rss>`;

const INFOQ_RSS = `<rss><channel>
${RSS("Cloudflare 正式发布 Python Workers", "https://www.infoq.cn/python-workers", 4)}
${RSS("从大模型到 Agent 落地，这场大会讲透 AI 全链路", "https://www.infoq.cn/conf", 6)}
${RSS("前端工程化的下一步", "https://www.infoq.cn/fe", 10)}
</channel></rss>`;

const TC_RSS = `<rss><channel>
${RSS("Science Corporation implants vision chip", "https://techcrunch.com/vision", 5)}
${RSS("Google Play now lets anyone publish vibe-coded apps", "https://techcrunch.com/play", 8)}
${RSS("Cerebras CEO on personal AI assistants", "https://techcrunch.com/cerebras", 11)}
</channel></rss>`;

const ARS_RSS = `<rss><channel>
${RSS("Disney offers $20M for Character.AI tech", "https://arstechnica.com/disney", 6)}
${RSS("Google Play opens to AI-generated apps", "https://arstechnica.com/play", 9)}
${RSS("The state of open models in 2026", "https://arstechnica.com/open", 12)}
</channel></rss>`;

const OPENAI_RSS = `<rss><channel>
${RSS("Higgsfield takes AI video past 10 minutes", "https://openai.com/index/higgsfield", 7)}
</channel></rss>`;

const FEEDS = {
  "hn.algolia.com": HN_JSON,
  "api.github.com": GH_JSON,
  "export.arxiv.org": ARXIV_XML,
  "www.qbitai.com": QBIT_RSS,
  "www.infoq.cn": INFOQ_RSS,
  "techcrunch.com": TC_RSS,
  "arstechnica.com": ARS_RSS,
  "openai.com": OPENAI_RSS,
};

// 模型输出：引用真实存在的 ref，其中故意包含一个越界 ref
const MODEL_JSON = JSON.stringify({
  highlights: [
    "OpenAI 发布 GPT-6，上下文窗口显著拉长",
    "Character.ai 申请破产，消费级陪伴 AI 模式受挫",
    "Cloudflare 为 Workers 补齐入站 TCP，Agent 运行时地基在完善",
  ],
  sections: [
    { title: "模型与产品", lead: "新模型与基础设施同日出招。", items: [
      { ref: 1, note: "GPT-6 把上下文拉长，直接冲的是长文档与长会话场景。" },
      { ref: 5, note: "Workers 支持入站 TCP，边缘函数开始能承接长连接。" },
      { ref: 999, note: "这条引用了不存在的序号，应当被丢弃。" },
    ]},
    { title: "行业与资本", items: [
      { ref: 3, note: "陪伴型聊天机器人先行者走到破产，订阅制的情感粘性没能撑住商业模型。" },
      { ref: 2, note: "Anthropic 因为代码生成太快，重造了版本控制系统。" },
    ]},
    { title: "开源项目", items: [
      { ref: 6, note: "一个构建 agent 的工具箱，几天内冲到五千星。" },
    ]},
    { title: "研究前沿", items: [
      { ref: 8, note: "把 LLM agent 放进机器人控制回路，用动作分块缓解长序列抖动。" },
    ]},
  ],
  closing: "今天的暗线是「地基」：模型侧在拉长上下文，基础设施侧在补长连接，而商业模式侧开始为过去的扩张付账。",
});

// ---------- mock sdk ----------
function makeSdk(dataDir) {
  const storage = new Map();
  const stagedFiles = [];
  return {
    dataDir,
    logger: { info: async () => {}, warn: async () => {}, error: async () => {}, debug: async () => {} },
    network: {
      fetch: async (url) => {
        for (const [host, body] of Object.entries(FEEDS)) {
          if (String(url).includes(host)) {
            return { ok: true, status: 200, text: async () => body };
          }
        }
        return { ok: false, status: 404, text: async () => "" };
      },
    },
    models: {
      list: async () => ({
        models: [
          { id: "deepseek-v4", name: "DeepSeek V4", provider: "deepseek" },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek" },
          { id: "kimi-k3", name: "Kimi K3", provider: "moonshot" },
        ],
      }),
      stream: async () => {
        const enc = new TextEncoder();
        const chunks = [
          JSON.stringify({ type: "start", requestId: "x" }) + "\n",
          JSON.stringify({ type: "text-delta", requestId: "x", delta: MODEL_JSON.slice(0, 400) }) + "\n",
          JSON.stringify({ type: "text-delta", requestId: "x", delta: MODEL_JSON.slice(400) }) + "\n",
          JSON.stringify({ type: "done", requestId: "x", stopReason: "stop" }) + "\n",
        ];
        let i = 0;
        return {
          body: {
            getReader: () => ({
              read: async () => (i < chunks.length
                ? { done: false, value: enc.encode(chunks[i++]) }
                : { done: true, value: undefined }),
            }),
          },
        };
      },
      utility: async () => ({ text: "" }),
      cancel: async () => {},
    },
    storage: {
      global: {
        get: async (k, d) => (storage.has(k) ? storage.get(k) : d ?? null),
        getAll: async () => Object.fromEntries(storage),
        set: async (k, v) => { storage.set(k, v); },
        delete: async (k) => { storage.delete(k); },
        keys: async () => [...storage.keys()],
        onChanged: () => () => {},
      },
    },
    bus: { request: async () => ({ file: { fileId: "f1", name: "x.pdf" } }) },
    tools: { register: async () => ({}) },
    routes: { register: async () => ({}) },
    _staged: stagedFiles,
    _storage: storage,
  };
}

// ---------- 跑 ----------
const dir = mkdtempSync(join(tmpdir(), "digest-test-"));
console.log(`\n=== runPipeline 集成测试 ===\n临时目录：${dir}\n`);

const sdk = makeSdk(dir);
const progress = [];

try {
  console.log("① 供应商检测");
  const providers = await detectProviders(sdk);
  check("检测到 2 个供应商", providers.length === 2, `实际 ${providers.length}`);
  check("deepseek 下有 2 个模型", providers.find((p) => p.provider === "deepseek")?.models.length === 2);
  check("不接触凭证（只返回 id/name）",
    !JSON.stringify(providers).includes("apiKey"));

  console.log("\n② 完整管线");
  const result = await runPipeline(sdk, {
    config: {
      provider: "deepseek", model: "deepseek-v4", lang: "zh",
      maxCandidates: 40, windowHours: 24, enabledSources: null,
      keepHtmlSnapshot: true,
    },
    onProgress: (p) => progress.push(p.phase),
  });

  check("产出 Issue", !!result.issue);
  check("进度回调被触发", progress.length > 0, `实际 ${progress.length} 次`);
  check("进度包含 fetch/editorial/render/archive",
    ["fetch", "editorial", "render", "archive"].every((p) => progress.includes(p)),
    progress.join(","));

  console.log("\n③ Issue 内容");
  const issue = result.issue;
  check("期号分配", issue.issueNo === 1, `实际 ${issue.issueNo}`);
  check("栏目数 = 4", issue.sections.length === 4, `实际 ${issue.sections.length}`);
  check("越界 ref 被丢弃（栏目1 只剩 2 条）",
    issue.sections[0].items.length === 2, `实际 ${issue.sections[0].items.length}`);
  check("有警告记录越界", result.warnings.some((w) => w.includes("999")), JSON.stringify(result.warnings));
  check("有 highlights", issue.highlights.length === 3);
  check("有 closing", !!issue.closing);
  check("stats 正确", issue.stats.itemCount === 6, `实际 ${issue.stats.itemCount}`);

  console.log("\n④ 防编造");
  const urls = issue.sections.flatMap((s) => s.items.map((i) => i.url));
  check("所有 URL 是真实链接", urls.every((u) => /^https?:\/\//.test(u)));
  check("URL 不重复", new Set(urls).size === urls.length);
  check("无 999 号条目的残留", !JSON.stringify(issue).includes("999"));

  console.log("\n⑤ 归档");
  const { readFileSync, existsSync } = await import("node:fs");
  check("Issue 文件已写入", existsSync(join(dir, "archive", `${issue.date}.json`)));
  check("HTML 快照已写入", existsSync(join(dir, "archive", `${issue.date}.html`)));
  const saved = JSON.parse(readFileSync(join(dir, "archive", `${issue.date}.json`), "utf8"));
  check("落盘内容与内存一致", saved.date === issue.date && saved.stats.itemCount === issue.stats.itemCount);
  check("索引已更新", sdk._storage.get("archiveIndex")?.entries?.length === 1);

  console.log("\n⑥ 多源交叉检测");
  const crossItems = issue.sections.flatMap((s) => s.items).filter((i) => i.sources.length > 1);
  check("识别出跨源条目（Google Play 被 TC+Ars 覆盖）", crossItems.length >= 1,
    `实际 ${crossItems.length}`);

  console.log("\n⑦ 重复生成（同一天应为修订，期号不增）");
  const r2 = await runPipeline(sdk, {
    config: { provider: "deepseek", model: "deepseek-v4", lang: "zh", maxCandidates: 40, windowHours: 24, keepHtmlSnapshot: true },
  });
  check("同一天期号不变", r2.issue.issueNo === 1, `实际 ${r2.issue.issueNo}`);
  check("标记为修订", r2.isRevision === true);
  check("归档仍只有 1 期", sdk._storage.get("archiveIndex").entries.length === 1);

  console.log("\n⑧ 错误处理");
  let threw = "";
  try {
    await runPipeline(sdk, { config: { provider: null, model: null, enabledSources: null } });
  } catch (e) { threw = e.message; }
  check("未选模型时明确报错", threw.includes("供应商") || threw.includes("模型"), threw);

} catch (e) {
  console.log(`\n✗ 管线异常：${e.message}\n${e.stack}`);
  fail++;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${"=".repeat(40)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
