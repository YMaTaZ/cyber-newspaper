/**
 * 管线：归并去重 + 多源交叉标记 + 排序截断
 *
 * 核心产出：同一个事件在多个源出现时合并为一条，sources 数组记下所有来源。
 * 这是"同一件事在多个源出现 = 重要"这一判断的落地，也是编辑层的重要输入信号。
 */

/** URL 规范化：去掉协议、www、末尾斜杠、常见追踪参数、锚点 */
export function normalizeUrl(raw) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    // 常见追踪参数
    const drop = /^(utm_|ref|ref_src|source|fbclid|gclid|mc_cid|mc_eid|spm|from|share_)/i;
    const keep = [];
    for (const [k, v] of u.searchParams) {
      if (!drop.test(k)) keep.push(`${k}=${v}`);
    }
    keep.sort();
    const q = keep.length ? `?${keep.join("&")}` : "";
    return `${host}${path}${q}`.toLowerCase();
  } catch {
    return String(raw).trim().toLowerCase();
  }
}

/** 标题归一化：去标点、去停用词、压平，用于相似度比较 */
export function normalizeTitle(t) {
  return String(t ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    // 中英文标点
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "with", "at", "by",
  "from", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "new", "how", "why", "what", "when", "as", "into", "about", "after", "over",
]);

/**
 * 报道动词与通用名词。它们出现在几乎每条新闻里，不携带实体信息，
 * 计入实体集会抬高分母、把真正的同事件判成不同事件。
 */
const NOISE_WORDS = new Set([
  "launch", "launches", "launched", "release", "releases", "released",
  "ship", "ships", "shipped", "announce", "announces", "announced",
  "raise", "raises", "raised", "close", "closes", "closed", "acquire", "acquires",
  "introduce", "introduces", "unveil", "unveils", "debut", "debuts",
  "update", "updates", "updated", "report", "reports", "reported",
  "model", "models", "modeling", "system", "systems", "platform", "platforms",
  "tool", "tools", "service", "services", "feature", "features",
  "company", "companies", "startup", "startups", "team", "teams",
  "billion", "million", "b", "m", "round", "funding", "fund", "investment",
  "first", "best", "top", "next", "more", "most", "using", "use", "uses",
  "built", "build", "builds", "make", "makes", "made", "get", "gets", "got",
  "code", "coding", "data", "open", "source", "opensource",
]);

/** 关键词集合（去停用词） */
function keywords(title) {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

/**
 * 实体集合：专有名词类信号。
 * 包含：含数字的词（gpt-6、workers-ai）、连续大写词、CJK 二字以上的词、非停用词的长词。
 *
 * 为什么需要它：跨源报道同一事件时动词往往不同（launches / releases / ships），
 * 纯 Jaccard 抓不到这种同义差异。而实体（公司名、产品名、版本号）是稳定的，
 * 重合度高就意味着说的是同一件事。
 */
function entities(title) {
  const raw = String(title ?? "");
  const out = new Set();

  const isNoise = (t) => STOPWORDS.has(t) || NOISE_WORDS.has(t);

  // 含数字的 token（版本号、型号、金额）
  for (const m of raw.matchAll(/[A-Za-z\u4e00-\u9fa5]*\d[A-Za-z0-9.\-]*/g)) {
    const t = m[0].toLowerCase().replace(/^[^a-z0-9\u4e00-\u9fa5]+|[^a-z0-9\u4e00-\u9fa5]+$/g, "");
    if (t.length >= 2 && !isNoise(t)) out.add(t);
    // 数值核心：让 "$10B" 与 "$10 billion" 能对上
    const core = t.match(/^\d+(?:\.\d+)?/)?.[0];
    if (core && core.length >= 2 && core !== t) out.add(core);
  }
  // 连续大写词（GPT、LLM、API）与首字母大写的专名
  for (const m of raw.matchAll(/\b([A-Z][A-Za-z0-9]{1,15})\b/g)) {
    const t = m[1].toLowerCase();
    if (t.length >= 3 && !isNoise(t)) out.add(t);
  }
  // CJK 词：按 2 字滑窗取片段（无分词器时的近似）
  for (const seg of raw.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  // 长实词
  for (const w of normalizeTitle(raw).split(" ")) {
    if (w.length >= 5 && !isNoise(w)) out.add(w);
  }
  return out;
}

/** 两个集合的 Jaccard */
function jaccard(A, B) {
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Jaccard 相似度（词级） */
export function similarity(a, b) {
  return jaccard(keywords(a), keywords(b));
}

/** 实体重合度 */
export function entityOverlap(a, b) {
  return jaccard(entities(a), entities(b));
}

const TITLE_SIM_THRESHOLD = 0.62;
const ENTITY_OVERLAP_THRESHOLD = 0.6;

/**
 * 强实体：专有名词类信号。
 *
 * 为什么单独分一层：实测坑——量子位对同一事件发了两条
 * 「阶跃终端首款「Agent手机」STEPX Neo正式发布」
 * 「STEPX首款大模型原生智能体手机STEPX Neo正式发布」
 * 中文滑窗产生的噪声实体把真正有区分度的 stepx / neo 稀释掉了，
 * 导致通用实体重合度只有 0.29 而不合并。强实体层只看专名，噪声少。
 */
function strongEntities(title) {
  const raw = String(title ?? "");
  const out = new Set();
  const isNoise = (t) => STOPWORDS.has(t) || NOISE_WORDS.has(t);

  // 首字母大写的专名（STEPX / Neo / Agent）
  for (const m of raw.matchAll(/\b([A-Z][A-Za-z0-9]{1,15})\b/g)) {
    const t = m[1].toLowerCase();
    if (t.length >= 3 && !isNoise(t)) out.add(t);
  }
  // 含数字的型号 / 版本号（GPT-6 / 1T4R）
  for (const m of raw.matchAll(/[A-Za-z]*\d[A-Za-z0-9.\-]*/g)) {
    const t = m[0].toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (t.length >= 2 && !isNoise(t)) out.add(t);
  }
  return out;
}

/** 两个强实体集的重合度 */
export function strongOverlap(a, b) {
  const A = strongEntities(a);
  const B = strongEntities(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** 共享的强实体个数 */
function sharedStrongCount(a, b) {
  const A = strongEntities(a);
  const B = strongEntities(b);
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n;
}

/**
 * 是否判定为同一事件。
 *   1. 词级相似度够高，或
 *   2. 通用实体重合度够高，或
 *   3. 共享 ≥ 2 个强实体且重合度够高
 *      （至少 2 个是为了防误合并：只共享一个 openai 不能说明是同一件事）
 */
export function isSameEvent(a, b) {
  if (similarity(a, b) >= TITLE_SIM_THRESHOLD) return true;
  if (entityOverlap(a, b) >= ENTITY_OVERLAP_THRESHOLD) return true;
  if (sharedStrongCount(a, b) >= 2 && strongOverlap(a, b) >= 0.5) return true;
  return false;
}

/**
 * 去重 + 多源交叉合并。
 *
 * 判定同一事件：
 *   1. 规范化 URL 完全一致
 *   2. 标题相似度 ≥ 阈值
 *
 * @returns {{ items: MergedItem[], stats: object }}
 */
export function dedupe(rawItems) {
  const byUrl = new Map();
  const merged = [];

  for (const it of rawItems) {
    const nu = normalizeUrl(it.url);
    if (!nu) continue;

    // 规则 1：URL 命中
    if (byUrl.has(nu)) {
      mergeInto(byUrl.get(nu), it);
      continue;
    }

    // 规则 2：标题相似或实体高度重合
    let hit = null;
    for (const cand of merged) {
      if (isSameEvent(cand.title, it.title)) {
        hit = cand;
        break;
      }
    }
    if (hit) {
      mergeInto(hit, it);
      byUrl.set(nu, hit);
      continue;
    }

    const item = {
      title: it.title,
      url: it.url,
      sources: [it.sourceId],
      publishedAt: it.publishedAt ?? null,
      points: it.points,
      comments: it.comments,
      stars: it.stars,
      rawSummary: it.rawSummary,
      lang: it.lang,
      _simKeys: [normalizeTitle(it.title)],
    };
    byUrl.set(nu, item);
    merged.push(item);
  }

  const crossSource = merged.filter((m) => new Set(m.sources).size > 1).length;

  return {
    items: merged,
    stats: {
      rawCount: rawItems.length,
      mergedCount: merged.length,
      removed: rawItems.length - merged.length,
      crossSource,
    },
  };
}

/** 把一条并入已有的：补来源、取更大的热度数值、补缺失摘要 */
function mergeInto(target, src) {
  if (!target.sources.includes(src.sourceId)) target.sources.push(src.sourceId);

  if ((src.points ?? 0) > (target.points ?? 0)) target.points = src.points;
  if ((src.comments ?? 0) > (target.comments ?? 0)) target.comments = src.comments;
  if ((src.stars ?? 0) > (target.stars ?? 0)) target.stars = src.stars;

  if (!target.rawSummary && src.rawSummary) target.rawSummary = src.rawSummary;
  if (!target.publishedAt && src.publishedAt) target.publishedAt = src.publishedAt;

  // 标题取更长的那个（通常信息更全）
  if ((src.title?.length ?? 0) > (target.title?.length ?? 0)) target.title = src.title;
}

/**
 * 排序 + 多样性保障。
 *
 * 纯热度排序会让 GitHub（星数）和 HN（分数）淹没没有热度指标的中文源。
 * 实测：纯热度排时 40 条池子里中文只剩 1 条，直接违背"中文优先"。
 *
 * 因此改为：先保每个源的代表名额，再按热度填充剩余。
 */
export function rank(items, { perSourceQuota = 0 } = {}) {
  const byHeat = (a, b) => {
    const ca = new Set(a.sources).size;
    const cb = new Set(b.sources).size;
    if (ca !== cb) return cb - ca;
    const ha = heat(a);
    const hb = heat(b);
    if (ha !== hb) return hb - ha;
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  };

  const sorted = [...items].sort(byHeat);
  if (perSourceQuota <= 0) return sorted;

  // 多源交叉的条目无条件优先（它们是跨源验证过的信号）
  const crossSource = sorted.filter((it) => new Set(it.sources).size > 1);

  // 其余按主源分组，每组内部已按热度排好
  const groups = new Map();
  for (const it of sorted) {
    if (new Set(it.sources).size > 1) continue;
    const key = it.sources[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  // 轮询交错：每轮每个源取一条，保证小源不被淹没
  const interleaved = [];
  let round = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const list of groups.values()) {
      if (round < list.length) {
        interleaved.push(list[round]);
        progressed = true;
      }
    }
    round++;
  }

  return [...crossSource, ...interleaved];
}

/** 热度综合分：把不同源的量纲压到可比范围 */
function heat(it) {
  let s = 0;
  if (it.points) s += Math.log10(it.points + 1) * 10;
  if (it.stars) s += Math.log10(it.stars + 1) * 6;
  if (it.comments) s += Math.log10(it.comments + 1) * 4;
  return s;
}

/**
 * 完整管线：原始条目 → 去重排序 → 截断。
 */
export function buildCandidatePool(rawItems, { maxCandidates = 40, perSourceQuota = 4 } = {}) {
  const { items, stats } = dedupe(rawItems);
  const sorted = rank(items, { perSourceQuota });
  const picked = sorted.slice(0, maxCandidates);

  // 给编辑层用的序号，从 1 开始
  picked.forEach((it, i) => {
    it.ref = i + 1;
  });

  const sourceCounts = {};
  for (const it of picked) {
    for (const s of it.sources) sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  }

  return {
    candidates: picked,
    stats: {
      ...stats,
      poolSize: picked.length,
      truncated: Math.max(0, sorted.length - picked.length),
      sourceCounts,
    },
  };
}
