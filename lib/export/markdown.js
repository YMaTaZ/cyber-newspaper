/**
 * Issue → Markdown
 *
 * 纯文本，便于贴进笔记、邮件、issue 系统。
 * 不引入任何依赖，不需要转义特殊字符之外的额外处理。
 */

function esc(s) {
  return String(s ?? "")
    // Markdown 里可能造成结构破坏的字符做最小转义
    .replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1")
    .replace(/\n+/g, " ")
    .trim();
}

/** 标题里的链接文字不做转义，只清理换行 */
function plain(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export function issueToMarkdown(issue) {
  const L = [];
  const d = new Date(`${issue.date}T00:00:00`);
  const wd = Number.isNaN(d.getTime()) ? "" : `　星期${"日一二三四五六"[d.getDay()]}`;

  // 报头
  L.push(`# 赛博报纸`);
  L.push("");
  L.push(
    `**${issue.date}**${wd}　|　第 ${String(issue.issueNo ?? 1).padStart(3, "0")} 期　|　` +
      `${issue.stats?.itemCount ?? 0} 条 · ${issue.stats?.sectionCount ?? 0} 栏`
  );
  L.push("");

  // 源覆盖
  if (Array.isArray(issue.sources) && issue.sources.length) {
    const chips = issue.sources.map((s) => (s.ok ? `\`${s.name} ${s.count}\`` : `~~${s.name}~~`)).join(" ");
    L.push(chips);
    L.push("");
  }

  L.push("---");
  L.push("");

  // 今日要点
  if (Array.isArray(issue.highlights) && issue.highlights.length) {
    L.push("## 今日要点");
    L.push("");
    issue.highlights.forEach((h, i) => L.push(`${i + 1}. ${plain(h)}`));
    L.push("");
  }

  // 栏目
  for (const sec of issue.sections ?? []) {
    L.push(`## ${plain(sec.title)}`);
    L.push("");
    if (sec.lead) {
      L.push(`> ${plain(sec.lead)}`);
      L.push("");
    }
    for (const it of sec.items ?? []) {
      const title = plain(it.title);
      const url = /^https?:\/\//i.test(it.url ?? "") ? it.url : "";
      L.push(url ? `### [${title}](${url})` : `### ${title}`);

      const badges = [];
      if (Array.isArray(it.sources) && it.sources.length > 1) badges.push(`${it.sources.length} 源覆盖`);
      if (it.points) badges.push(`HN ${it.points}`);
      if (it.stars) badges.push(`${it.stars} 星`);
      if (badges.length) L.push(`<sub>${badges.join(" · ")}</sub>`);

      if (it.note) {
        L.push("");
        L.push(plain(it.note));
      }
      L.push("");
    }
  }

  // 收尾
  if (issue.closing) {
    L.push("---");
    L.push("");
    L.push(`**收尾**`);
    L.push("");
    L.push(plain(issue.closing));
    L.push("");
  }

  // 页脚
  L.push("---");
  L.push("");
  const foot = [];
  if (issue.provider && issue.model) foot.push(`本期由 ${issue.provider} / ${issue.model} 生成`);
  if (issue.generatedAt) {
    const t = new Date(issue.generatedAt);
    if (!Number.isNaN(t.getTime())) foot.push(t.toLocaleString("zh-CN", { hour12: false }));
  }
  foot.push("数据来自公开信息源，标题与链接均为原文");
  L.push(`<sub>${foot.join(" · ")}</sub>`);
  L.push("");

  return L.join("\n");
}
