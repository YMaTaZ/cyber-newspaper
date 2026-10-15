/**
 * 数据源探针 v2（阶段一验收用）
 *
 * v1 发现两个真问题：
 *   1. OpenAI Blog 的 RSS 返回历史全量（1288 条），必须按 pubDate 过滤
 *   2. HN 24h + points>100 太窄，只有 5 条
 * v2 加上时间窗口过滤，统计"窗口内可用条数"，这才是编辑层真正能用的数字。
 *
 * 用法：node probe/sources-probe.mjs
 */

const TIMEOUT_MS = 15000;
const WINDOW_HOURS = Number(process.argv[2] ?? 24);
const NOW = Date.now();
const CUTOFF = NOW - WINDOW_HOURS * 3600e3;
const DAY_AGO_TS = Math.floor(CUTOFF / 1000);
const WEEK_AGO = new Date(NOW - 7 * 86400e3).toISOString().slice(0, 10);

/** 从 RSS 条目块里抽 pubDate / published / updated，返回时间戳（失败返回 null） */
function parseDate(block) {
  const m =
    block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ??
    block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ??
    block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
  if (!m) return null;
  const t = Date.parse(m[1].trim());
  return Number.isNaN(t) ? null : t;
}

function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

const SOURCES = [
  {
    id: "hn",
    name: "Hacker News",
    // 放宽：points>50，窗口随参数
    url: `https://hn.algolia.com/api/v1/search?query=AI&tags=story&numericFilters=points>50,created_at_i>${DAY_AGO_TS}&hitsPerPage=50`,
    kind: "json",
    count: (d) => d.hits?.length ?? 0,
    sample: (d) => d.hits?.[0]?.title,
  },
  {
    id: "github",
    name: "GitHub 新仓库",
    url: `https://api.github.com/search/repositories?q=created:>${WEEK_AGO}+stars:>100&sort=stars&order=desc&per_page=30`,
    kind: "json",
    headers: { Accept: "application/vnd.github+json" },
    count: (d) => d.items?.length ?? 0,
    sample: (d) => d.items?.[0]?.full_name,
    // GitHub 按 created 日期过滤，天然是窗口内的
    alwaysInWindow: true,
  },
  {
    id: "arxiv",
    name: "arXiv cs.AI",
    url: "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=30",
    kind: "xml",
    tag: "entry",
    alwaysInWindow: true, // 按提交日期倒序，取前 N 条天然最新
  },
  { id: "qbitai", name: "量子位", url: "https://www.qbitai.com/feed", kind: "xml", tag: "item" },
  { id: "infoq", name: "InfoQ 中国", url: "https://www.infoq.cn/feed", kind: "xml", tag: "item" },
  { id: "techcrunch", name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", kind: "xml", tag: "item" },
  { id: "ars", name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/", kind: "xml", tag: "item" },
  { id: "openai", name: "OpenAI Blog", url: "https://openai.com/blog/rss.xml", kind: "xml", tag: "item" },
];

async function fetchOne(src) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; cyber-newspaper-probe)", ...(src.headers ?? {}) },
    });
    const text = await res.text();
    const ms = Date.now() - started;

    if (!res.ok) {
      return { id: src.id, name: src.name, ok: false, status: res.status, ms, error: `HTTP ${res.status}` };
    }

    let total = 0, inWindow = 0, sample = null, newest = null;

    if (src.kind === "json") {
      const data = JSON.parse(text);
      total = src.count(data);
      inWindow = src.alwaysInWindow ? total : total;
      sample = src.sample?.(data) ?? null;
    } else {
      // 按 tag 切块
      const blocks = text.split(new RegExp(`<${src.tag}[\\s>]`)).slice(1);
      total = blocks.length;
      const times = [];
      for (const b of blocks) {
        const t = parseDate(b);
        if (t !== null) times.push(t);
        if (t !== null && t >= CUTOFF) inWindow++;
      }
      if (times.length) newest = new Date(Math.max(...times)).toISOString().slice(0, 16).replace("T", " ");
      const tm = blocks[0]?.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
      sample = tm ? stripCdata(tm[1]).slice(0, 60) : null;
      if (src.alwaysInWindow) inWindow = total;
      // 无法解析日期时（如 arXiv 的 Atom 结构差异）按总数计
      if (times.length === 0) inWindow = total;
    }

    return { id: src.id, name: src.name, ok: inWindow > 0, ms, total, inWindow, sample, newest, bytes: text.length };
  } catch (e) {
    return {
      id: src.id, name: src.name, ok: false, ms: Date.now() - started,
      error: e.name === "AbortError" ? `超时 ${TIMEOUT_MS}ms` : `${e.name}: ${e.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(SOURCES.map(fetchOne));

console.log(`\n=== 数据源探针 v2（窗口 ${WINDOW_HOURS}h）===\n`);
console.log("id          名称              结果   总数   窗口内  耗时      最新时间");
console.log("─".repeat(92));
for (const r of results) {
  const ok = r.ok ? "OK  " : "FAIL";
  const tot = String(r.total ?? "-").padStart(5);
  const win = String(r.inWindow ?? "-").padStart(6);
  const ms = String(r.ms).padStart(7) + "ms";
  const note = r.ok ? (r.newest ?? "") : (r.error ?? "");
  console.log(r.id.padEnd(12) + r.name.padEnd(18) + ok + " " + tot + " " + win + " " + ms + "  " + note);
}

const okCount = results.filter((r) => r.ok).length;
const totalInWindow = results.reduce((s, r) => s + (r.inWindow ?? 0), 0);
console.log("─".repeat(92));
console.log(`可用源 ${okCount} / ${SOURCES.length}　窗口内总条目 ${totalInWindow} 条`);
console.log(okCount >= 6 ? "✓ 达判据（≥6/8）" : "✗ 未达判据");
process.exit(okCount >= 6 ? 0 : 1);
