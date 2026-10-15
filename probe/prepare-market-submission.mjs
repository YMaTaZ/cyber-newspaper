/**
 * 生成市场投稿材料：两个 JSON 片段 + PR 正文。
 *
 * 为什么用脚本而不是手写：
 *   sha256 必须与 entry.json 一字不差，readme 是一大段 Markdown。
 *   手抄这两样都会出错，而市场是拿 sha256 校验安装包的 —— 抄错一位就装不上。
 *   这里全部从源文件读，人只负责审阅。
 *
 * 用法：node probe/prepare-market-submission.mjs
 * 产出：probe/out/market-submission/
 *   registry-entry.json      追加到 registry.json 的 entries
 *   approvals-entry.json     追加到 approvals.json 的 approvals
 *   PR.md                     PR 正文
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");
const DEST = join(OUT, "market-submission");
mkdirSync(DEST, { recursive: true });

const PUBLISHER = "YMaTaZ";
const REPO = "YMaTaZ/cyber-newspaper";
const HANA_VERSION = "1.1.0-beta";
const OS = "Windows 11 (10.0.26100)";

// ---- 读源文件 ----
const zipName = readdirSync(join(ROOT, "dist-extensions"))
  .filter((n) => n.endsWith(".entry.json"))
  .sort()
  .pop();
if (!zipName) {
  console.error("✗ 找不到 entry.json，先跑 pack.ps1");
  process.exit(1);
}
const entry = JSON.parse(readFileSync(join(ROOT, "dist-extensions", zipName), "utf8"));
const readme = readFileSync(join(OUT, "market-readme.md"), "utf8").trim();

console.log("=== 源数据 ===");
console.log("  id       :", entry.id);
console.log("  version  :", entry.version);
console.log("  sha256   :", entry.archive.sha256);
console.log("  size     :", entry.archive.size);
console.log("  readme   :", readme.length, "字符");
console.log("  publisher:", PUBLISHER);

// ---- 1. registry.json 条目 ----
const regEntry = {
  kind: "app",
  id: entry.id,
  repository: REPO,
  publisher: PUBLISHER,
};
writeFileSync(join(DEST, "registry-entry.json"), JSON.stringify(regEntry, null, 2) + "\n", "utf8");

// ---- 2. approvals.json 条目 ----
// tag 必须是含该附件的 Release tag，不能是 latest；sha256 照抄 entry.json
const tag = `v${entry.version}`;
const apprEntry = {
  kind: "app",
  id: entry.id,
  tag,
  sha256: entry.archive.sha256,
  readme,
};
writeFileSync(join(DEST, "approvals-entry.json"), JSON.stringify(apprEntry, null, 2) + "\n", "utf8");

// ---- 3. PR 正文 ----
const pr = `## 基本信息

| 项 | 值 |
| --- | --- |
| 扩展名称 | Cyber Newspaper（赛博报纸） |
| 类型 / ID | \`app\` / \`cyber-newspaper\` |
| 发布者 | ${PUBLISHER} |
| 作者仓库 | https://github.com/${REPO} |
| 正式 Release | https://github.com/${REPO}/releases/tag/${tag} |
| 版本 | ${entry.version} |

**用途**：抓取 8 个公开 AI 信息源（Hacker News、GitHub 新仓库、arXiv cs.AI，以及量子位、InfoQ 中国、TechCrunch AI、Ars Technica AI、OpenAI Blog），归并去重并标记多源覆盖，然后交给用户在设置页选定的模型整理成一份结构化日报。结果按日期归档、可本地搜索、可导出为 HTML / Markdown / Word / PDF。

**它解决的问题**：AI 资讯的成本不在「看不到」，而在筛选与归并。散落在多个源里，人工过一遍要半小时以上，而且每天重来。这个 App 把那套重复劳动固定下来。

## 图标预览

![icon](https://raw.githubusercontent.com/${REPO}/${tag}/assets/icon.png)

黑底白线的报纸图形，与 App 内的瑞士国际主义风格同源。

## 截图

工作台主界面，同一份日报在两套 Hana 主题下的样子（背景、主色、分隔线跟随宿主；文字色按背景亮度取高对比值，不跟宿主的正文色）：

**浅色（暖纸）**

![workbench light](https://raw.githubusercontent.com/${REPO}/${tag}/docs/screenshots/workbench-light.png)

**深色（午夜）**

![workbench dark](https://raw.githubusercontent.com/${REPO}/${tag}/docs/screenshots/workbench-dark.png)

截图说明：左栏是往期归档（按期号与日期），中间是当天日报正文，顶部是导出与生成入口。栏目数量与名称由模型根据当天内容决定，视觉风格（硬线分隔、零圆角、宽字距小标签）固定。

## 自测报告

**环境**

- Hana ${HANA_VERSION}
- ${OS}
- 安装测试使用的 Release：${tag}
- 安装包：\`app-cyber-newspaper-${entry.version}.zip\`，sha256 \`${entry.archive.sha256}\`，${entry.archive.size} 字节

**测试步骤与实际结果**

| 步骤 | 结果 |
| --- | --- |
| 在扩展管理器安装本 Release 的 zip | 通过。审查卡列出三项能力，确认后正常装载 |
| 打开侧边导航「日报」 | 通过。工作台整页渲染，主题变量跟随当前 Hana 主题 |
| 在设置页选定供应商与模型 | 通过。下拉框列出宿主已配置的供应商，选择后写入配置 |
| 点「生成今日日报」 | 通过。抓取 8 个源 → 归并去重 → 模型整理 → 归档，产出 6 栏 |
| 四种格式导出 | 通过。HTML 单文件离线可开；Markdown 纯文本；.docx 用真实 Word 打开验证；PDF 走浏览器打印 |
| 切换 Hana 主题 | 通过。日报背景与主色跟随变化，文字对比度不降 |
| 按日期翻看往期 | 通过。侧栏列出历史期数，点击加载对应内容 |
| 本地搜索 | 通过。字符串匹配，不联网、不调模型 |

**自动化验证**

| 检查 | 覆盖 |
| --- | --- |
| \`probe/test-pipeline.mjs\` | 数据源与归并，37 项 |
| \`probe/test-pipeline-run.mjs\` | 全链路 mock，25 项 |
| \`probe/test-export.mjs\` | 四种导出，27 项 |
| \`probe/e2e.mjs\` | 端到端，36 项 |
| \`probe/check-ui.mjs\` | 页面结构与标签闭合 |
| \`probe/verify-theme-layers.mjs\` | 主题跟随三层兜底（JS 挂掉、仅主题 CSS、完全无宿主） |
| \`probe/verify-contrast.mjs\` | 对比度实测：无头 Chrome 量渲染后真实计算色，三套主题 42 项均过 WCAG AA |

**已知问题与未测试部分**

- 数据源依赖第三方站点，单个源可能临时不可用。App 的做法是：单源失败不影响整体并在日报里明确标注；全部失败时中止并报错，不拿旧数据充数。
- 会话内入口与桥接会话入口**未在真实微信/飞书桥接环境下测试**（测试机未接桥）。代码路径与工作台共用同一套管线，仅触发来源不同。
- 主题跟随在 Hana 官方主题上验证；用户自命名主题未逐一测试，但实现是读宿主变量而非匹配主题名，理论上通用。

## 权限与外部服务

**声明的能力**

| 能力 | 为什么需要 |
| --- | --- |
| \`app/tools.expose-to-model\` | 让「日报」能在会话里被触发（可选入口，默认关） |
| \`app/models.infer\` | 调用用户在设置页选定的模型整理日报。这是核心功能，没有它无法生成 |
| \`app/render.pdf\` | 可选，默认关。仅会话内入口的 PDF 产出用；工作台导出 PDF 走浏览器打印，不需要它 |

**明确不申请**：读取会话内容、派生子进程、读取任何供应商凭证、在自身数据目录之外写盘。

**外部服务**

| 域名 | 用途 |
| --- | --- |
| hn.algolia.com | Hacker News 高分故事 |
| api.github.com | 近 7 天新建的高星仓库 |
| export.arxiv.org | arXiv cs.AI 最新提交 |
| www.qbitai.com | 量子位 |
| www.infoq.cn | InfoQ 中国 |
| techcrunch.com | TechCrunch AI |
| arstechnica.com | Ars Technica AI |
| openai.com | OpenAI Blog |

全部为公开只读接口，仅用 GET。除上述域名外无任何网络请求。**本 App 不接触、不存储任何 API Key** —— 模型调用走 Hana 自己的凭证系统。所有归档只存在本机 \`app-data/cyber-newspaper/\`，不上传任何服务器。

无凭据、无令牌、无私有服务依赖。
`;
writeFileSync(join(DEST, "PR.md"), pr, "utf8");

console.log("\n=== 产出 ===");
for (const f of ["registry-entry.json", "approvals-entry.json", "PR.md"]) {
  const p = join(DEST, f);
  console.log(`  ${f.padEnd(24)} ${(readFileSync(p).length / 1024).toFixed(1)} KB`);
}
console.log(`\n目录：${DEST}`);
