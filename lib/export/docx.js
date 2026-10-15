/**
 * Issue → .docx（Word）
 *
 * 不依赖第三方库：手写 OOXML，用 lib/export/zip.js 打包。
 * 为什么不用 docx 库：App 安装时不执行 npm 安装，依赖必须自带；
 * 手写这一套只覆盖我们需要的最小结构，反而更可控。
 *
 * 风格与 HTML 渲染保持一致：暖纸底映射为文档默认字体与配色，
 * 标题用蓝钢色，字重只用常规/加粗。
 */

import { zip } from "./zip.js";

const ACCENT = "2E5F80";
const INK = "000000";
const INK_SOFT = "333333";
const FONT = "PingFang SC";
const FONT_FALLBACK = "Microsoft YaHei";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 把文本拆成 run 片段，保留行内格式（这里只做纯文本 + 换行） */
function runs(text, opts = {}) {
  const { size = 21, color = INK, bold = false, italic = false } = opts; // size 是半磅值：21 = 10.5pt
  const parts = String(text ?? "").split("\n");
  return parts
    .map((line, i) => {
      const br = i > 0 ? "<w:br/>" : "";
      const rPr =
        `<w:rPr>` +
        `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>` +
        (bold ? "<w:b/>" : "") +
        (italic ? "<w:i/>" : "") +
        `<w:color w:val="${color}"/>` +
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
        `</w:rPr>`;
      return `<w:r>${rPr}${br}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`;
    })
    .join("");
}

function para(content, opts = {}) {
  const { style, align, spaceBefore = 0, spaceAfter = 120, indent, keepNext } = opts;
  const pPr =
    `<w:pPr>` +
    (style ? `<w:pStyle w:val="${style}"/>` : "") +
    (keepNext ? "<w:keepNext/>" : "") +
    `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}" w:line="300" w:lineRule="auto"/>` +
    (indent ? `<w:ind w:left="${indent}"/>` : "") +
    (align ? `<w:jc w:val="${align}"/>` : "") +
    `</w:pPr>`;
  return `<w:p>${pPr}${content}</w:p>`;
}

function emptyPara(after = 120) {
  return para("", { spaceAfter: after });
}

/** 链接段落：用超链接关系引用 */
function linkPara(text, relId, opts = {}) {
  const { size = 21, color = INK, bold = false } = opts;
  const rPr =
    `<w:rPr>` +
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>` +
    (bold ? "<w:b/>" : "") +
    `<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `</w:rPr>`;
  const hl = relId
    ? `<w:hyperlink r:id="${relId}">` +
      `<w:r>${rPr.replace(`<w:color w:val="${color}"/>`, `<w:color w:val="${ACCENT}"/><w:u w:val="single"/>`)}` +
      `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:hyperlink>`
    : `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="60" w:line="300" w:lineRule="auto"/></w:pPr>${hl}</w:p>`;
}

/**
 * 生成 docx。
 * @param {object} issue
 * @returns {Promise<Buffer>}
 */
export async function issueToDocx(issue) {
  const rels = [];       // 外部超链接关系
  let relCounter = 0;

  const body = [];

  // ---------- 报头 ----------
  body.push(para(runs("赛博报纸", { size: 48, color: INK, bold: true }), { spaceAfter: 80 }));
  const d = new Date(`${issue.date}T00:00:00`);
  const wd = Number.isNaN(d.getTime()) ? "" : `　星期${"日一二三四五六"[d.getDay()]}`;
  body.push(
    para(
      runs(
        `${issue.date}${wd}　第 ${String(issue.issueNo ?? 1).padStart(3, "0")} 期　` +
          `${issue.stats?.itemCount ?? 0} 条 · ${issue.stats?.sectionCount ?? 0} 栏`,
        { size: 18, color: INK_SOFT, bold: true }
      ),
      { spaceAfter: 60 }
    )
  );

  // 源覆盖
  if (Array.isArray(issue.sources) && issue.sources.length) {
    const okList = issue.sources.filter((s) => s.ok).map((s) => `${s.name}(${s.count})`);
    const failList = issue.sources.filter((s) => !s.ok).map((s) => `${s.name}(未抓到)`);
    const line = [`数据源 ${okList.length}/${issue.sources.length}`, ...okList, ...failList].join("　·　");
    body.push(para(runs(line, { size: 16, color: INK_SOFT }), { spaceAfter: 260 }));
  } else {
    body.push(emptyPara(180));
  }

  // ---------- 今日要点 ----------
  if (Array.isArray(issue.highlights) && issue.highlights.length) {
    body.push(para(runs("今日要点", { size: 20, color: ACCENT, bold: true }), { spaceAfter: 120 }));
    issue.highlights.forEach((h, i) => {
      body.push(para(runs(`${String(i + 1).padStart(2, "0")}　${h}`, { size: 23, color: INK, bold: true }), { spaceAfter: 100, indent: 0 }));
    });
    body.push(emptyPara(200));
  }

  // ---------- 栏目 ----------
  for (const sec of issue.sections ?? []) {
    body.push(para(runs(sec.title, { size: 32, color: INK, bold: true }), { spaceBefore: 240, spaceAfter: 100, keepNext: true }));
    if (sec.lead) {
      body.push(para(runs(sec.lead, { size: 20, color: INK_SOFT }), { spaceAfter: 140, indent: 0 }));
    }
    for (const it of sec.items ?? []) {
      let relId = null;
      if (/^https?:\/\//i.test(it.url ?? "")) {
        relCounter++;
        relId = `rIdLink${relCounter}`;
        rels.push({ id: relId, url: it.url });
      }
      body.push(linkPara(it.title, relId, { size: 24, bold: true }));

      // 角标行：大写小字，瑞士风格
      const badges = [];
      if (Array.isArray(it.sources) && it.sources.length > 1) badges.push(`${it.sources.length} 源覆盖`);
      if (it.points) badges.push(`HN ${it.points}`);
      if (it.stars) badges.push(`${it.stars} 星`);
      if (badges.length) {
        body.push(para(runs(badges.join("　·　").toUpperCase(), { size: 15, color: INK_SOFT, bold: true }), { spaceAfter: 70 }));
      }
      if (it.note) {
        body.push(para(runs(it.note, { size: 22, color: INK }), { spaceAfter: 180 }));
      } else {
        body.push(emptyPara(120));
      }
    }
    body.push(emptyPara(160));
  }

  // ---------- 收尾 ----------
  if (issue.closing) {
    body.push(para(runs("收尾", { size: 20, color: ACCENT, bold: true }), { spaceBefore: 240, spaceAfter: 100, keepNext: true }));
    body.push(para(runs(issue.closing, { size: 23, color: INK, bold: true }), { spaceAfter: 200 }));
  }

  // ---------- 页脚 ----------
  const footParts = [];
  if (issue.provider && issue.model) footParts.push(`本期由 ${issue.provider} / ${issue.model} 生成`);
  if (issue.generatedAt) {
    const t = new Date(issue.generatedAt);
    if (!Number.isNaN(t.getTime())) footParts.push(t.toLocaleString("zh-CN", { hour12: false }));
  }
  footParts.push("数据来自公开信息源，标题与链接均为原文");
  body.push(para(runs(footParts.join("　·　"), { size: 15, color: INK_SOFT }), { spaceBefore: 260 }));

  // ---------- 组装包 ----------
  const files = [
    { name: "[Content_Types].xml", data: contentTypes() },
    { name: "_rels/.rels", data: rootRels() },
    { name: "word/document.xml", data: documentXml(body) },
    { name: "word/styles.xml", data: stylesXml() },
    { name: "word/settings.xml", data: settingsXml() },
    { name: "word/fontTable.xml", data: fontTableXml() },
  ];
  if (rels.length) {
    files.push({ name: "word/_rels/document.xml.rels", data: documentRels(rels) });
  }

  return zip(files);
}

// ---------- 各部分 XML ----------

function contentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function documentRels(rels) {
  const links = rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(r.url)}" TargetMode="External"/>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
${links}
</Relationships>`;
}

function documentXml(bodyParts) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${bodyParts.join("\n")}
<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/>
<w:cols w:space="425"/>
<w:docGrid w:type="lines" w:linePitch="312"/>
</w:sectPr>
</w:body>
</w:document>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>
<w:color w:val="${INK}"/>
<w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr>
<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>
</w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:qFormat/>
</w:style>
</w:styles>`;
}

function settingsXml() {
  // 关掉拼写检查，避免中文文档被标红
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:proofState w:spelling="clean" w:grammar="clean"/>
<w:defaultTabStop w:val="420"/>
<w:compat>
<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
</w:compat>
</w:settings>`;
}

function fontTableXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:font w:name="${FONT}"><w:altName w:val="${FONT_FALLBACK}"/><w:charset w:val="86"/><w:family w:val="swiss"/></w:font>
<w:font w:name="${FONT_FALLBACK}"><w:charset w:val="86"/><w:family w:val="swiss"/></w:font>
</w:fonts>`;
}
