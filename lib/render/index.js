/**
 * 唯一渲染器（SPEC 8.1）
 *
 * Issue → HTML。三种投影（工作台 / HTML 导出 / PDF）共用这一个函数，
 * 差异只在 opts.mode。禁止为 PDF 另写一套模板（实现红线）。
 *
 * 关键：渲染器必须容忍动态结构（SPEC 8.5）：
 *   - sections 长度 1~8
 *   - 栏目名为任意字符串
 *   - lead / note / points / stars 任一缺失
 */

import { baseCss, pageCss, printCss } from "./styles.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 只允许 http/https 链接，挡掉 javascript: 之类 */
function safeUrl(u) {
  const s = String(u ?? "").trim();
  if (/^https?:\/\//i.test(s)) return esc(s);
  return "";
}

function fmtDate(date) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${date}　星期${WEEKDAYS[d.getDay()]}`;
}

function renderSources(report) {
  if (!Array.isArray(report) || report.length === 0) return "";
  const chips = report
    .map((s) => {
      const cls = s.ok ? "chip" : "chip fail";
      const n = s.ok ? `<span class="n">${s.count}</span>` : "";
      const title = s.error ? ` title="${esc(s.error)}"` : "";
      return `<span class="${cls}"${title}>${esc(s.name)}${n}</span>`;
    })
    .join("");
  return `<div class="sources">${chips}</div>`;
}

function renderBadges(item) {
  const b = [];
  if (Array.isArray(item.sources) && item.sources.length > 1) {
    b.push(`<span class="badge cross">${item.sources.length} 源覆盖</span>`);
  }
  if (item.points) b.push(`<span class="badge">HN ${item.points}</span>`);
  if (item.stars) b.push(`<span class="badge">${item.stars} 星</span>`);
  if (b.length === 0) return "";
  return `<div class="badges">${b.join("")}</div>`;
}

function renderItem(item) {
  const url = safeUrl(item.url);
  const title = url
    ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`
    : esc(item.title);
  const note = item.note ? `<p class="note">${esc(item.note)}</p>` : "";
  return `<div class="item">
      <p class="title">${title}</p>
      ${renderBadges(item)}
      ${note}
    </div>`;
}

function renderSection(sec, index) {
  const items = (sec.items ?? []).map(renderItem).join("\n");
  const lead = sec.lead ? `<p class="lead">${esc(sec.lead)}</p>` : "";
  // 锚点 id 供侧边导航跳转；索引由调用方传入
  const anchor = Number.isInteger(index) ? ` id="sec-${index}"` : "";
  return `<section class="section"${anchor}>
      <h2>${esc(sec.title)}</h2>
      ${lead}
      ${items}
    </section>`;
}

function renderHighlights(list) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const lis = list.map((h) => `<li>${esc(h)}</li>`).join("");
  return `<div class="highlights">
      <h2>今日要点</h2>
      <ol>${lis}</ol>
    </div>`;
}

function renderMasthead(issue) {
  return `<header class="masthead">
      <h1>赛博报纸</h1>
      <div class="meta">
        <span>${esc(fmtDate(issue.date))}</span>
        <span class="issue">第 ${String(issue.issueNo ?? 1).padStart(3, "0")} 期</span>
        <span>${issue.stats?.itemCount ?? 0} 条 · ${issue.stats?.sectionCount ?? 0} 栏</span>
      </div>
    </header>`;
}

function renderFoot(issue) {
  const parts = [];
  if (issue.provider && issue.model) {
    parts.push(`本期由 ${esc(issue.provider)} / ${esc(issue.model)} 生成`);
  }
  if (issue.generatedAt) {
    const t = new Date(issue.generatedAt);
    if (!Number.isNaN(t.getTime())) {
      parts.push(t.toLocaleString("zh-CN", { hour12: false }));
    }
  }
  parts.push("数据来自公开信息源，标题与链接均为原文");
  return `<footer class="foot">${parts.map(esc).join(" · ")}</footer>`;
}

/**
 * 渲染 Issue 主体。返回 HTML 片段（不含 <html> 外壳）。
 */
export function renderIssueBody(issue) {
  if (!issue || !Array.isArray(issue.sections) || issue.sections.length === 0) {
    return `<div class="empty">这一期没有内容。</div>`;
  }
  const sections = issue.sections.map((s, i) => renderSection(s, i)).join("\n");
  const closing = issue.closing
    ? `<div class="closing"><span class="label">收尾</span>${esc(issue.closing)}</div>`
    : "";
  return `${renderMasthead(issue)}
    ${renderSources(issue.sources)}
    ${renderHighlights(issue.highlights)}
    ${sections}
    ${closing}
    ${renderFoot(issue)}`;
}

/**
 * 渲染完整 HTML 文档。
 *
 * @param {object} issue
 * @param {object} opts
 *   - mode: "standalone" | "print" | "embed"
 *     standalone = 单文件，可离线打开（默认）
 *     print      = 附加打印样式，供 PDF 用
 *     embed      = 只给片段与内联样式，供工作台卡片用
 */
export function renderIssue(issue, opts = {}) {
  const mode = opts.mode ?? "standalone";
  const body = renderIssueBody(issue);
  const title = `赛博报纸 ${issue?.date ?? ""}`;

  if (mode === "embed") {
    // 不包 .wrap：嵌入模式由调用方（工作台）自己控制宽度。
    // 保留 baseCss 是因为正文的排版规则都住在里面。
    return `<style>${baseCss()}</style>${body}`;
  }

  const extraCss = mode === "print" ? printCss() : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${baseCss()}${pageCss()}${extraCss}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`;
}
