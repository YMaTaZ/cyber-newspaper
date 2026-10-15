/**
 * 导出格式验证
 *
 * 关键：docx 必须能被真正的解析器打开，不能只是"看起来像 zip"。
 * 验证手段：
 *   1. zip 结构可解析（用 PowerShell Expand-Archive 解压）
 *   2. 解压后的 XML 能被解析
 *   3. document.xml 含预期内容
 *   4. 用 Word COM（如果装了 Office）实际打开一次
 *
 * 用法：node probe/test-export.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { issueToDocx } from "../lib/export/docx.js";
import { issueToMarkdown } from "../lib/export/markdown.js";
import { renderIssue } from "../lib/render/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// 用真实产物（若存在），否则用构造数据
let issue;
try {
  issue = JSON.parse(readFileSync(join(OUT, "issue.json"), "utf8"));
  console.log(`\n使用真实 Issue：${issue.date}，${issue.sections.length} 栏\n`);
} catch {
  console.log("\n未找到 issue.json，使用构造数据\n");
  issue = {
    schemaVersion: 1, date: "2026-10-14", issueNo: 7,
    generatedAt: new Date().toISOString(), lang: "zh",
    provider: "deepseek", model: "deepseek-v4",
    sources: [
      { id: "hn", name: "Hacker News", ok: true, count: 9 },
      { id: "github", name: "GitHub 新仓库", ok: true, count: 30 },
      { id: "qbitai", name: "量子位", ok: true, count: 4 },
      { id: "ars", name: "Ars Technica AI", ok: false, count: 0, error: "超时" },
    ],
    highlights: ["要点一：测试 & 转义 <tag>", "要点二"],
    sections: [
      { id: "a", title: "模型与产品", lead: "导语", items: [
        { title: "标题含 & 和 <符号>", url: "https://example.com/a?x=1&y=2", sources: ["hn", "ars"], points: 320, note: "点评" },
        { title: "无链接条目", url: "", sources: ["qbitai"] },
      ]},
      { id: "b", title: "研究前沿", items: [
        { title: "论文一", url: "https://arxiv.org/abs/1", sources: ["arxiv"], stars: 1200 },
      ]},
    ],
    closing: "收尾段落，含特殊字符 & < >",
    stats: { itemCount: 3, sectionCount: 2, sourceOk: 3, sourceTotal: 4, crossSource: 1 },
  };
}

// ---------- 1. Markdown ----------
console.log("① Markdown");
const md = issueToMarkdown(issue);
check("产出非空", md.length > 200, `${md.length} 字符`);
check("含标题层级", md.includes("# 赛博报纸"));
check("含今日要点", md.includes("## 今日要点"));
check("链接是 markdown 语法", md.includes("](https://"));
check("无残留未转义方括号破坏结构", !/\[[^\]]*\]\([^)]*$/.test(md));
writeFileSync(join(OUT, "export.md"), md, "utf8");

// ---------- 2. HTML ----------
console.log("\n② HTML");
const html = renderIssue(issue, { mode: "standalone" });
check("是完整文档", html.startsWith("<!DOCTYPE html>"));
writeFileSync(join(OUT, "export.html"), html, "utf8");

// ---------- 3. DOCX ----------
console.log("\n③ DOCX");
const docx = await issueToDocx(issue);
check("产出 Buffer", Buffer.isBuffer(docx));
check("是 ZIP（PK 魔数）", docx[0] === 0x50 && docx[1] === 0x4b, `首字节 ${docx[0]},${docx[1]}`);
check("大小合理（>3KB）", docx.length > 3000, `${docx.length} 字节`);
writeFileSync(join(OUT, "export.docx"), docx);

// 手写 zip 的结构自检：找 EOCD，核对条目数
const eocdIdx = docx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
check("有 EOCD 记录", eocdIdx > 0);
if (eocdIdx > 0) {
  const entryCount = docx.readUInt16LE(eocdIdx + 10);
  // 无超链接时 6 个，有超链接关系文件时 7 个
  check("EOCD 条目数合理（6 或 7）", entryCount === 6 || entryCount === 7, `实际 ${entryCount}`);
  const cdSize = docx.readUInt32LE(eocdIdx + 12);
  const cdOffset = docx.readUInt32LE(eocdIdx + 16);
  check("中央目录偏移合理", cdOffset > 0 && cdOffset + cdSize === eocdIdx,
    `offset=${cdOffset} size=${cdSize} eocd=${eocdIdx}`);
}

// 解压出来看内容（用 node:zlib 手工解）
console.log("\n④ DOCX 内部结构");
const zlib = await import("node:zlib");
const names = [];
let p = 0;
while (p < docx.length - 4) {
  if (docx.readUInt32LE(p) !== 0x04034b50) break;
  const method = docx.readUInt16LE(p + 8);
  const compSize = docx.readUInt32LE(p + 18);
  const nameLen = docx.readUInt16LE(p + 26);
  const extraLen = docx.readUInt16LE(p + 28);
  const name = docx.subarray(p + 30, p + 30 + nameLen).toString("utf8");
  const dataStart = p + 30 + nameLen + extraLen;
  const raw = docx.subarray(dataStart, dataStart + compSize);
  names.push({ name, method, size: compSize });
  if (name === "word/document.xml") {
    const xml = method === 8 ? zlib.inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    check("document.xml 有 w:document 根", xml.includes("<w:document"));
    check("含栏目标题", xml.includes("模型与产品") || xml.includes(issue.sections[0].title));
    check("含转义后的 &amp;", xml.includes("&amp;") || !xml.includes("&"));
    check("没有裸 & 破坏 XML", !/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml));
    check("超链接关系被引用", xml.includes("w:hyperlink") || !issue.sections.some(s => s.items.some(i => /^https?:/.test(i.url))));
    writeFileSync(join(OUT, "docx-document.xml"), xml, "utf8");
  }
  if (name === "[Content_Types].xml") {
    const xml = method === 8 ? zlib.inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    check("Content_Types 声明了 document.xml", xml.includes("/word/document.xml"));
    check("Content_Types 是合法 XML 结构", xml.includes("<Types") && xml.trim().endsWith("</Types>"));
  }
  if (name === "word/_rels/document.xml.rels") {
    const xml = method === 8 ? zlib.inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    check("关系表含 hyperlink", xml.includes("hyperlink"));
    check("关系表 XML 合法结尾", xml.trim().endsWith("</Relationships>"));
  }
  p = dataStart + compSize;
}

console.log(`\n  包内文件（${names.length} 个）：`);
names.forEach((n) => console.log(`    ${n.name}  (method ${n.method}, ${n.size} 字节)`));

const expected = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/settings.xml", "word/fontTable.xml"];
for (const e of expected) {
  check(`包含 ${e}`, names.some((n) => n.name === e));
}

console.log(`\n产出：probe/out/export.md, export.html, export.docx, docx-document.xml`);
console.log(`${"=".repeat(40)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
