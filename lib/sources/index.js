/**
 * 数据源定义与并发抓取调度
 *
 * 设计要点：
 *   - 不依赖 Hana 运行时。fetcher 由调用方注入（App 里是 sdk.network.fetch 的包装，测试里是全局 fetch）
 *   - 每个源独立失败，互不影响
 *   - 时间窗口过滤是强制的：部分源的 RSS 返回历史全量（OpenAI Blog 约 1288 条），
 *     不过滤会把几年前的文章喂给编辑层
 */

/** 去掉 CDATA 包裹、解码 HTML 实体、压平空白 */
export function stripCdata(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // 数字实体：&#8217; / &#x2019;
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    // 命名实体
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    // &amp; 必须最后（否则 &amp;lt; 会被二次解码）
    .replace(/&amp;/g, "&")
    .trim();
}

function safeFromCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** 去掉 HTML 标签，压平空白 */
export function stripTags(s) {
  return stripCdata(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 判断一段摘要是否真的携带信息。
 * 实测坑：InfoQ 的 RSS description 就是「点击查看原文>」，
 * 这类噪声摘要喂给模型会稀释信号，直接丢掉。
 */
export function isMeaningfulSummary(s) {
  const t = String(s ?? "").trim();
  if (t.length < 12) return false;
  if (/^(点击|查看|阅读)(查看)?原文[>》\s]*$/.test(t)) return false;
  if (/^(read|view|click)\s+(more|the\s+full|original)/i.test(t)) return false;
  if (t.replace(/[\s\p{P}]/gu, "").length < 8) return false;
  return true;
}

/**
 * 从一块 XML 里抽时间戳。兼容 RSS 的 pubDate 与 Atom 的 published/updated。
 * 返回毫秒时间戳，抽不到返回 null。
 */
export function parseDate(block) {
  const m =
    block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ??
    block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ??
    block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) ??
    block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
  if (!m) return null;
  const t = Date.parse(stripCdata(m[1]));
  return Number.isNaN(t) ? null : t;
}

/**
 * 通用 RSS / Atom 条目解析器。
 * 同时处理：
 *   - RSS: <item><title>..</title><link>..</link>
 *   - Atom: <entry><title>..</title><link href=".."/></entry>
 */
export function parseFeed(xml, { itemTag = "item" } = {}) {
  const blocks = xml.split(new RegExp(`<${itemTag}[\\s>]`, "i")).slice(1);
  const out = [];
  for (const raw of blocks) {
    const block = raw.split(new RegExp(`</${itemTag}>`, "i"))[0] ?? raw;

    const tm = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = tm ? stripTags(tm[1]) : "";
    if (!title) continue;

    // link：RSS 是文本节点，Atom 是 href 属性
    let url = "";
    const linkText = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkText && stripCdata(linkText[1])) {
      url = stripCdata(linkText[1]);
    } else {
      const linkHref =
        block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ??
        block.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i) ??
        block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (linkHref) url = stripCdata(linkHref[1]);
    }
    // Atom 的 id 兜底
    if (!url) {
      const idm = block.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
      if (idm) url = stripCdata(idm[1]);
    }

    const sm =
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ??
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ??
      block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);

    const summaryText = sm ? stripTags(sm[1]).slice(0, 400) : "";
    out.push({
      title,
      url,
      publishedAt: parseDate(block),
      rawSummary: isMeaningfulSummary(summaryText) ? summaryText : undefined,
    });
  }
  return out;
}

/** 源清单。buildUrl 接收窗口起点（毫秒），返回请求 URL。 */
export const SOURCES = [
  {
    id: "hn",
    name: "Hacker News",
    lang: "en",
    windowAware: true,
    buildUrl: (sinceMs) =>
      `https://hn.algolia.com/api/v1/search?query=AI&tags=story` +
      `&numericFilters=points>50,created_at_i>${Math.floor(sinceMs / 1000)}&hitsPerPage=50`,
    parse: (text) => {
      const data = JSON.parse(text);
      return (data.hits ?? []).map((h) => ({
        title: h.title,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        publishedAt: h.created_at_i ? h.created_at_i * 1000 : null,
        points: h.points,
        comments: h.num_comments,
        rawSummary: h.story_text ? stripTags(h.story_text).slice(0, 300) : undefined,
      }));
    },
  },
  {
    id: "github",
    name: "GitHub 新仓库",
    lang: "en",
    windowAware: false, // 按 created 日期查询，天然在窗口内
    // GitHub 搜索的 created 是日期粒度：用 24h 窗口会退化成"今天创建的仓库"，
    // 实测返回 0 条。SPEC 5.1 定的是 7 天窗口。
    windowDays: 7,
    buildUrl: (sinceMs) => {
      const d = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
      return `https://api.github.com/search/repositories?q=created:>${d}+stars:>100` +
        `&sort=stars&order=desc&per_page=30`;
    },
    headers: { Accept: "application/vnd.github+json" },
    parse: (text) => {
      const data = JSON.parse(text);
      return (data.items ?? []).map((r) => ({
        title: r.full_name,
        url: r.html_url,
        publishedAt: r.created_at ? Date.parse(r.created_at) : null,
        stars: r.stargazers_count,
        rawSummary: r.description ? stripTags(r.description).slice(0, 300) : undefined,
      }));
    },
  },
  {
    id: "arxiv",
    name: "arXiv cs.AI",
    lang: "en",
    windowAware: false, // 按提交日期倒序，取前 N 条即最新
    buildUrl: () =>
      "http://export.arxiv.org/api/query?search_query=cat:cs.AI" +
      "&sortBy=submittedDate&sortOrder=descending&max_results=30",
    parse: (text) => parseFeed(text, { itemTag: "entry" }),
  },
  {
    id: "qbitai",
    name: "量子位",
    lang: "zh",
    windowAware: true,
    buildUrl: () => "https://www.qbitai.com/feed",
    parse: (text) => parseFeed(text, { itemTag: "item" }),
  },
  {
    id: "infoq",
    name: "InfoQ 中国",
    lang: "zh",
    windowAware: true,
    buildUrl: () => "https://www.infoq.cn/feed",
    parse: (text) => parseFeed(text, { itemTag: "item" }),
  },
  {
    id: "techcrunch",
    name: "TechCrunch AI",
    lang: "en",
    windowAware: true,
    buildUrl: () => "https://techcrunch.com/category/artificial-intelligence/feed/",
    parse: (text) => parseFeed(text, { itemTag: "item" }),
  },
  {
    id: "ars",
    name: "Ars Technica AI",
    lang: "en",
    windowAware: true,
    buildUrl: () => "https://arstechnica.com/ai/feed/",
    parse: (text) => parseFeed(text, { itemTag: "item" }),
  },
  {
    id: "openai",
    name: "OpenAI Blog",
    lang: "en",
    windowAware: true,
    // 注意：该源 RSS 返回历史全量（约 1288 条），必须靠窗口过滤
    buildUrl: () => "https://openai.com/blog/rss.xml",
    parse: (text) => parseFeed(text, { itemTag: "item" }),
  },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 抓一个源。
 * @returns {{ id, name, ok, count, error?, items }}
 */
export async function fetchSource(src, { sinceMs, fetcher, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const started = Date.now();
  try {
    const text = await fetcher(src.buildUrl(sinceMs), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; cyber-newspaper)",
        ...(src.headers ?? {}),
      },
      timeoutMs,
    });

    let items = src.parse(text) ?? [];

    // 窗口过滤：无法判定时间且源标记为 windowAware 时，保守丢弃
    if (src.windowAware) {
      items = items.filter((it) => it.publishedAt != null && it.publishedAt >= sinceMs);
    }

    items = items.filter((it) => it.title && it.url);
    items.forEach((it) => {
      it.sourceId = src.id;
    });

    return {
      id: src.id,
      name: src.name,
      ok: true,
      count: items.length,
      ms: Date.now() - started,
      items,
    };
  } catch (e) {
    return {
      id: src.id,
      name: src.name,
      ok: false,
      count: 0,
      ms: Date.now() - started,
      error: e?.name === "AbortError" ? `超时 ${timeoutMs}ms` : `${e?.name ?? "Error"}: ${e?.message ?? e}`,
      items: [],
    };
  }
}

/**
 * 并发抓取所有启用的源。
 *
 * 窗口策略（SPEC 5.2）：先按 24h 抓；某源不足 3 条时，对该源单独放宽到 48h 重抓一次。
 */
export async function fetchAll(
  { enabledIds = SOURCE_IDS, windowHours = 24, fetcher, timeoutMs, onProgress } = {}
) {
  const active = SOURCES.filter((s) => enabledIds.includes(s.id));
  const now = Date.now();
  const since24 = now - windowHours * 3600e3;
  const since48 = now - 48 * 3600e3;

  const first = await Promise.all(
    active.map((s) => fetchSource(s, { sinceMs: since24, fetcher, timeoutMs }))
  );
  onProgress?.({ phase: "first-pass", results: first });

  // 不足 3 条的 windowAware 源，放宽到 48h 重试
  const needRetry = active.filter((s) => {
    if (!s.windowAware) return false;
    const r = first.find((x) => x.id === s.id);
    return r && r.ok && r.count < 3;
  });

  const retried = await Promise.all(
    needRetry.map(async (s) => {
      const r = await fetchSource(s, { sinceMs: since48, fetcher, timeoutMs });
      return { ...r, widened: true };
    })
  );

  const merged = first.map((r) => {
    const w = retried.find((x) => x.id === r.id);
    // 只在放宽后确实拿到更多时采用
    return w && w.ok && w.count > r.count ? w : r;
  });

  const items = merged.flatMap((r) => r.items ?? []);
  const report = merged.map((r) => ({
    id: r.id,
    name: r.name,
    ok: r.ok && r.count > 0,
    count: r.count ?? 0,
    widened: !!r.widened,
    error: r.error,
  }));

  return { items, report };
}
