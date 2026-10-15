/**
 * 导出统一入口
 *
 * 四种格式，分两类实现：
 *   HTML / Markdown / Word  → 纯字节，前端直接下载（零授权）
 *   PDF                     → 宿主 Chromium 渲染需要 callToken；
 *                             工作台拿不到，改用浏览器打印（零授权、零额度）
 *
 * 所有格式共用同一个 Issue 对象，不重复构造内容。
 */

import { renderIssue } from "../render/index.js";
import { issueToMarkdown } from "./markdown.js";
import { issueToDocx } from "./docx.js";

export const FORMATS = [
  { id: "html", label: "网页 (HTML)", ext: "html", mime: "text/html;charset=utf-8", kind: "bytes" },
  { id: "md", label: "Markdown", ext: "md", mime: "text/markdown;charset=utf-8", kind: "bytes" },
  { id: "docx", label: "Word 文档", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "bytes" },
  { id: "pdf", label: "PDF（打印后另存）", ext: "pdf", mime: "text/html;charset=utf-8", kind: "print" },
];

export function fileBaseName(issue) {
  return `赛博报纸_${String(issue.date).replace(/-/g, "")}`;
}

/**
 * 生成导出内容。
 * @returns {{ kind: "bytes", mime: string, fileName: string, data: Buffer|string }
 *         | { kind: "print", html: string, fileName: string }}
 */
export async function exportIssue(issue, format) {
  const fmt = FORMATS.find((f) => f.id === format);
  if (!fmt) throw new Error(`不支持的导出格式：${format}`);

  const base = fileBaseName(issue);

  switch (fmt.id) {
    case "html":
      return {
        kind: "bytes",
        mime: fmt.mime,
        fileName: `${base}.html`,
        data: renderIssue(issue, { mode: "standalone" }),
      };

    case "md":
      return {
        kind: "bytes",
        mime: fmt.mime,
        fileName: `${base}.md`,
        data: issueToMarkdown(issue),
      };

    case "docx":
      return {
        kind: "bytes",
        mime: fmt.mime,
        fileName: `${base}.docx`,
        data: await issueToDocx(issue),
      };

    case "pdf":
      // 返回带打印样式的 HTML，由前端打开打印视图
      return {
        kind: "print",
        fileName: `${base}.pdf`,
        html: renderIssue(issue, { mode: "print" }),
      };

    default:
      throw new Error(`未实现的格式：${fmt.id}`);
  }
}
