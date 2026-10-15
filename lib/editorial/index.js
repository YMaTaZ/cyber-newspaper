/**
 * 编辑层：候选池 → Issue
 *
 * 这是全 App 唯一调用模型的地方。
 *
 * 核心设计（SPEC 7.3）：模型只输出 ref（候选池序号）+ note（点评），
 * 标题和 URL 由 App 按 ref 回填。这样模型在结构上无法编造链接与数字。
 */

export const EDITORIAL_SYSTEM_PROMPT = `你是一位中文科技编辑，为中文读者编写每日 AI 热点简报。

## 你的任务

从给定的候选条目池中筛选、分栏、点评，产出一份当天的简报。

## 输出格式（严格遵守）

只输出一个 JSON 对象，不要 markdown 代码块包裹，不要任何解释文字。结构：

{
  "highlights": ["要点一", "要点二", "要点三"],
  "sections": [
    {
      "title": "栏目名",
      "lead": "可选的栏目导语，一句话",
      "items": [
        { "ref": 3, "note": "这条的一句话点评" }
      ]
    }
  ],
  "closing": "收尾段落"
}

## 关于 ref（最重要）

- ref 是候选条目的序号，你只能引用池子里已有的序号。
- 不要输出标题、链接、星数或任何数字，这些由系统按 ref 自动回填。
- 不要编造序号。不确定的条目宁可不选。
- 每个 ref 只能出现一次，不要重复引用同一条。

## 关于栏目

- 栏目数量和名称由你根据今天的内容自己决定，不要套用固定分类。
- 如果今天某类内容特别多，就为它单独开一个栏目；如果某类内容很少，不要为了凑数硬开。
- 栏目建议 3 到 5 个，但不强制。单栏也可以，只要能说清今天发生了什么。
- 每个栏目下的条目按重要性排序。

## 关于今日要点

- 3 到 5 条，是当天最值得知道的几件事。
- 读者只看这几条就该有收获。

## 关于收尾

- 把今天的几条线串起来，点出暗线或趋势。
- 不要复述条目，要给读者一个"今天整体在发生什么"的判断。
- 一到三句话。

## 语言

- 全部用中文。
- 专有名词保留原文：模型名、公司名、开源仓库名、论文标题中的术语、代码标识符。
- 英文条目的标题，在点评里自然地用中文说明它在说什么。

## 判断标准

- 重要性优先于新奇度。
- 具体的进展优先于观点和预测。
- 同一件事的多个侧面归到一起说，不要分散在不同栏目。`;

/**
 * 构造用户消息：把候选池转成模型可读的文本。
 * 每条给：序号、标题、来源、热度、摘要。
 */
export function buildEditorialInput(candidates, { date, lang = "zh" } = {}) {
  const lines = [];
  lines.push(`日期：${date}`);
  lines.push(`候选条目共 ${candidates.length} 条。`);
  lines.push("");
  lines.push("以下是候选条目，请按系统提示的 JSON 格式输出：");
  lines.push("");

  for (const c of candidates) {
    const parts = [`[${c.ref}] ${c.title}`];
    const meta = [];
    meta.push(`来源：${c.sources.join("+")}`);
    if (c.points) meta.push(`HN ${c.points} 分`);
    if (c.comments) meta.push(`${c.comments} 评论`);
    if (c.stars) meta.push(`${c.stars} 星`);
    if (c.sources.length > 1) meta.push("多源覆盖");
    parts.push(`    ${meta.join(" · ")}`);
    if (c.rawSummary) {
      parts.push(`    摘要：${String(c.rawSummary).slice(0, 200)}`);
    }
    lines.push(parts.join("\n"));
  }

  return lines.join("\n");
}

/** 从模型返回里剥出 JSON。容忍 markdown 包裹与前后杂字。 */
export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();

  // 去掉 markdown 代码块
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 直接尝试
  try {
    return JSON.parse(s);
  } catch {}

  // 找第一个 { 到最后一个 }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const body = s.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch {}
    // 常见问题：尾随逗号
    try {
      return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
    } catch {}
  }
  return null;
}

/**
 * 把模型输出解析成 Issue。
 *
 * ref 回填在这里：模型给的 ref → 候选池里的真实 title / url / sources / 数值。
 * 越界的 ref 丢弃并记录，不中止整次生成。
 *
 * @returns {{ issue, warnings, validItemCount }}
 */
export function assembleIssue(
  modelOutput,
  candidates,
  { date, issueNo, provider, model, sourceReport, generatedAt }
) {
  const warnings = [];
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const usedRefs = new Set();

  const sections = [];
  for (const sec of modelOutput?.sections ?? []) {
    const title = String(sec?.title ?? "").trim();
    if (!title) {
      warnings.push("跳过无标题的栏目");
      continue;
    }
    const items = [];
    for (const raw of sec?.items ?? []) {
      const ref = Number(raw?.ref);
      if (!Number.isInteger(ref)) {
        warnings.push(`栏目「${title}」有非整数 ref：${raw?.ref}`);
        continue;
      }
      const c = byRef.get(ref);
      if (!c) {
        warnings.push(`栏目「${title}」引用了不存在的 ref：${ref}`);
        continue;
      }
      if (usedRefs.has(ref)) {
        warnings.push(`ref ${ref} 被重复引用，已跳过`);
        continue;
      }
      usedRefs.add(ref);

      items.push({
        title: c.title,
        url: c.url,
        sources: [...c.sources],
        points: c.points,
        comments: c.comments,
        stars: c.stars,
        note: raw?.note ? String(raw.note).trim() : undefined,
      });
    }
    if (items.length === 0) {
      warnings.push(`栏目「${title}」没有有效条目，已移除`);
      continue;
    }
    sections.push({
      id: slugify(title),
      title,
      lead: sec?.lead ? String(sec.lead).trim() : undefined,
      items,
    });
  }

  const highlights = (modelOutput?.highlights ?? [])
    .map((h) => String(h ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const issue = {
    schemaVersion: 1,
    date,
    issueNo,
    generatedAt,
    lang: "zh",
    provider,
    model,
    sources: sourceReport,
    highlights,
    sections,
    closing: String(modelOutput?.closing ?? "").trim(),
    stats: {
      itemCount: sections.reduce((n, s) => n + s.items.length, 0),
      sectionCount: sections.length,
      sourceOk: sourceReport.filter((s) => s.ok).length,
      sourceTotal: sourceReport.length,
      crossSource: sections.reduce(
        (n, s) => n + s.items.filter((i) => new Set(i.sources).size > 1).length,
        0
      ),
    },
  };

  return { issue, warnings, validItemCount: issue.stats.itemCount };
}

/** 栏目名 → 稳定 id。中文保留，空白转连字符。 */
export function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .slice(0, 40) || "section";
}
