# Cyber Newspaper · 赛博报纸

[中文](#中文) · [English](#english)

---

## 中文

一个 Hana 应用（v2 App）：抓取多个公开 AI 信息源，归并去重后由你选定的模型整理成一份结构化日报，按日期归档、可搜索、可导出。

### 它做什么

每天早上想知道 AI 圈发生了什么，成本不在"看不到"，而在**筛选和归并**：信息散落在 Hacker News、GitHub、arXiv 和多家媒体里，人工过一遍要花掉半小时以上，而且每天都得重来。

这个 App 把那套重复劳动固定下来：

```
抓取 8 个源 → 归并去重（标记多源覆盖）→ 模型整理成结构化日报 → 归档
```

### 三个入口

| 入口 | 怎么用 | 能出 PDF |
|---|---|---|
| **工作台** | 装完后在侧边导航打开，点「生成今日日报」 | 是（走打印） |
| **会话内** | 在对话里说「日报」（需在设置里开启） | 是 |
| **桥接会话** | 从已桥接到 Hana 的会话触发（需在设置里开启） | 是 |

工作台只负责生成、查看、归档、搜索、导出，**不做任何推送**。App 不假设任何具体通道 —— 通道属于宿主环境，不属于 App。

### 导出格式

工作台右上角「导出」可选四种格式：

| 格式 | 说明 |
|---|---|
| **网页 (HTML)** | 单文件，样式内联，离线可开 |
| **Markdown** | 纯文本，适合贴进笔记、邮件、issue 系统 |
| **Word 文档** | 真正的 .docx，可直接编辑。不依赖任何第三方库 |
| **PDF** | 打开打印视图，用浏览器「另存为 PDF」 |

> **关于 PDF**：工作台的 PDF 导出走浏览器打印，零额外授权、零模型消耗，打印效果与宿主渲染一致。
> 只有在**会话内**触发日报时，才会用宿主自带的渲染器产出 PDF（需 `app/render.pdf` 授权）。

### 外观：跟着你的 Hana 主题走

日报的**骨相固定，皮肤跟随**。瑞士国际主义的硬线分隔、零圆角、宽字距小标签不会变；背景、主色、分隔线实时跟随你在 Hana 里选的主题。你换主题，日报跟着换。

两条刻意的取舍：

- **文字颜色不跟随**。宿主主题的正文色是为它自己的 UI 选的，拿来做长文会掉对比度。日报自己按背景亮度取黑或白，保证读得清。
- **强调色会加深**。直接用主色当小字颜色，在浅色主题上常常不达 4.5:1，所以往高对比方向混了一部分。颜色仍来自主色，只是不再发虚。

对比不是「看着行」，是可验的：无头 Chrome 量渲染后的**真实计算色**，三套主题 42 项均过 WCAG AA（最低 4.74:1）。

导出件的跟随情况：HTML 与 PDF 跟随（PDF 看打印当时的主题）；**Word 不跟随**，.docx 里没有 CSS 变量这回事，固定浅底深字。在 Hana 外打开导出件也正常可读，兜底值自带。

### 安装

1. 在 Hana 的扩展市场安装本 App（或把包交给扩展管理器）
2. 安装时会请求三项授权，见下
3. 打开侧边导航的「日报」，在设置页选择一个模型供应商
4. 回到工作台，点「生成今日日报」

### 授权说明

| 能力 | 用途 | 不给会怎样 |
|---|---|---|
| `app/tools.expose-to-model` | 让会话内的「日报」指令可用 | 只能用工作台 |
| `app/models.infer` | 调用你选定的模型整理日报 | **无法生成**（这是核心功能） |
| 网络（声明 8 个域名） | 抓取公开数据源 | **无法生成** |

**本 App 不申请**：读取你的会话、派生进程、读取任何供应商凭证、写盘。

可选项（默认关闭，用到再开）：

| 能力 | 用途 | 不给会怎样 |
|---|---|---|
| `app/render.pdf` | 会话内入口的 PDF 产出 | 会话内日报照常出，只是不带 PDF。**工作台导出 PDF 不受影响**（走浏览器打印） |

导出 HTML / Markdown / Word 由 App 自己生成字节、浏览器直接下载，**不需要任何额外授权**。

### 隐私

- 抓取的都是**公开数据**，不采集你的任何行为。
- 模型调用走 Hana 自己的凭证系统，**本 App 不接触、不存储任何 API Key**。
- 所有归档只存在**本机**（`app-data/cyber-newspaper/`），不上传任何服务器。
- 搜索是本地字符串匹配，不调用模型、不联网。

### 数据源

默认全部开启，可在设置页逐源关闭。

| 源 | 语言 | 说明 |
|---|---|---|
| Hacker News | EN | 高分故事，含分数与评论数 |
| GitHub 新仓库 | EN | 近 7 天新建、100 星以上 |
| arXiv cs.AI | EN | 最新提交 |
| 量子位 | 中 | |
| InfoQ 中国 | 中 | |
| TechCrunch AI | EN | |
| Ars Technica AI | EN | |
| OpenAI Blog | EN | |

> **注意**：GitHub 只走 `api.github.com`，不抓 `github.com` 网页。部分网络环境下后者会超时。

### 已知限制

- **数据源可能不稳**。单个源失败不影响整体，日报里会明确标出哪个源没抓到。所有源都失败时会中止并报错，不会拿旧数据充数。
- **每期的栏目结构不同**。栏目数量与名称由模型根据当天内容决定，这是有意设计：新闻天天不同，不该长成同一个模子。视觉风格固定（瑞士国际主义：硬线分隔、零圆角），不会因为换模型而变丑。
- **主题跟随有边界**。背景与主色跟随 Hana，文字色不跟随（为了对比度）；Word 导出完全不跟随。
- **同一天重复生成视为修订**，期号不递增。
- **PDF 走浏览器打印**。工作台的 PDF 导出会打开打印视图，在打印对话框里选「另存为 PDF」。
- **Word 导出是简化版式**。.docx 保留标题层级、正文、超链接与来源标记，但不做多栏排版。

### 开发

```
cyber-newspaper/
  manifest.json        应用清单
  index.js             入口：工具注册、路由、管线编排
  lib/
    sources/           数据源定义与并发抓取
    pipeline/          归并、去重、多源交叉、排序
    editorial/         编辑层：prompt、解析、ref 回填
    render/            渲染器（唯一）：Issue → HTML
    export/            导出：HTML / Markdown / Word / PDF
    store/             归档与配置
  ui/
    workbench.html     工作台（整页）
    settings.html      设置页
    status.html        功能面板
    assets/
      theme-follow.js  把宿主主题变量搬成 --hana-* 镜像
      theme-mode.js    明暗判定与对比度计算（渲染/预览/测试共用）
  probe/               开发期验证脚本（不随应用发布）
```

#### 核心设计

**一份数据，多个投影。** `Issue` 对象是唯一真相，工作台视图、HTML 导出、PDF 是它的三种投影，共用一个渲染器。不要为某一种形态另写模板。

**风格与格式分离。** 视觉风格写死在 `lib/render/styles.js`（瑞士国际主义：硬线分隔、零圆角、单一强调色）；栏目数量、栏目名、每条点评由模型决定。**具体色值也不写死**：它们跟宿主走，写死的只有一层兜底。

**颜色分层。** 宿主变量 → `--hana-*`（镜像层）→ `--dg-*`（渲染层）。名字必须分开：写 `--accent: var(--accent, …)` 是 CSS 自我引用，兜底值永远不会生效。

**防编造。** 模型只输出候选池的序号（`ref`）和点评，标题与链接由 App 按序号回填。模型在结构上无法编造 URL。

**生成必须流式返回。** 宿主对 App 的普通 RPC 超时是 **30 秒**，而一次生成要跑 80~100 秒（抓 8 个源 + 调模型）。同步返回必然先被宿主掐断，用户看到一句没有原因的 `Internal Server Error`，而管线其实还在后台跑完并写了归档。所以 `/api/digest/run` 返回 **NDJSON 流**：第一块进度立刻发出（响应头先走，RPC 随即完成），进度边跑边推，最后一块给结果。改回一次 `c.json` 就会重新踩这个坑。

**救不回就拒掉。** 模型输出被截断时只在最后一个干净闭合的 `}`/`]` 处切并补齐括号；拼不回去就返回 null，让错误照实报 —— 宁可不发，也不能把半截新闻当完整日报。

#### 本地验证

```bash
node probe/test-pipeline.mjs        # 数据源与归并（37）
node probe/run-pipeline.mjs         # 真实抓取，产出候选池与 prompt
node probe/test-pipeline-run.mjs    # 全链路 mock（25）
node probe/test-export.mjs          # 四种导出（27）
node probe/e2e.mjs                  # 端到端（36）
node probe/test-run-stream.mjs      # 流式生成：首块时延、事件序列、取消（25）
node probe/test-json-repair.mjs     # 截断 JSON 抢救（16）
node probe/test-transient.mjs       # 瞬时故障重试（20）
node probe/check-ui.mjs             # 页面结构与标签闭合
node probe/check-brand.mjs          # 品牌命名一致（显示名/项目名/包名分层）
node probe/check-var-names.mjs      # CSS 变量命名不撞车
node probe/check-package.mjs        # 发布包内容：不该有的没有、该有的都在
node probe/check-entry-integrity.mjs # entry.json 声明的 size/sha256 与 zip 对得上
node probe/check-provider-addressable.mjs # 供应商名能被宿主地址化
node probe/verify-theme-layers.mjs  # 主题三层兜底（JS 挂掉、仅主题 CSS、完全无宿主）
node probe/verify-contrast.mjs      # 对比度实测（三主题 42 项）
node probe/verify-installed.mjs     # 已装代码与源码逐字一致
node probe/audit-personal.mjs       # 个人信息与凭据审计（仓库 + 发布包两范围）
powershell -File probe/verify-docx.ps1   # 用真实 Word 打开 docx 验证
```

看效果不用装 App：

```bash
node probe/preview-workbench.mjs  # 工作台预览（fetch 走 mock）
node probe/preview-theme.mjs      # 四套主题导出图
```

### 许可

MIT

---

## English

[中文](#中文) · [English](#english)

A Hana app (v2 App). It fetches a set of public AI sources, merges and deduplicates them, and hands the result to a model you choose, which turns it into a structured daily digest — archived by date, searchable, and exportable.

### What it does

The cost of keeping up with AI news is not access. It is **filtering and merging**. The material is scattered across Hacker News, GitHub, arXiv and several outlets; reading through it by hand takes well over half an hour, and you have to do it again the next day.

This app fixes that recurring work in place:

```
Fetch 8 sources → merge and dedupe (flag multi-source coverage) → model writes the digest → archive
```

### Three entry points

| Entry | How | PDF |
|---|---|---|
| **Workbench** | Open it from the sidebar after installing, click "Generate today's issue" | Yes (via print) |
| **In a session** | Say "日报" in a conversation (enable it in settings) | Yes |
| **Bridged session** | Triggered from a session bridged to Hana (enable it in settings) | Yes |

The workbench generates, reads, archives, searches and exports — it **never pushes anything**. The app assumes no particular channel; channels belong to the host, not to the app.

### Export formats

Four formats from the Export menu in the workbench:

| Format | Notes |
|---|---|
| **HTML** | Single file, styles inlined, opens offline |
| **Markdown** | Plain text, good for notes, mail, issue trackers |
| **Word** | A real .docx, directly editable. No third-party library |
| **PDF** | Opens the print view; use the browser's "Save as PDF" |

> **On PDF**: the workbench export goes through the browser's print path, so it costs no extra permission and no model tokens, and matches what the host renderer would produce.
> Only an **in-session** run uses the host's own renderer to produce a PDF (needs `app/render.pdf`).

### Appearance: it follows your Hana theme

The digest's **skeleton is fixed, its skin follows**. Swiss International Style holds: hard rules, zero corner radius, wide-tracked small caps labels. Background, accent and separators track whatever theme you have selected in Hana. Change the theme and the digest changes with it.

Two deliberate trade-offs:

- **Body text colour does not follow.** The host theme's text colour was chosen for its own UI, and it loses contrast in long-form reading. The digest picks black or white from the background's luminance so the text stays legible.
- **The accent is darkened.** Using the raw accent for small text often falls below 4.5:1 on light themes, so it is mixed toward higher contrast. The hue still comes from your accent; it just stops being washed out.

Contrast here is not "looks fine", it is measured: headless Chrome reads the **real computed colours** after rendering, and all 42 checks across three themes pass WCAG AA (lowest 4.74:1).

How the exports behave: HTML and PDF follow (the PDF follows the theme at print time); **Word does not** — there are no CSS variables in a .docx, so it is fixed light-on-dark-ink. Exports also read correctly outside Hana; fallback values are built in.

### Install

1. Install the app from the Hana extension market (or hand the package to the extension manager)
2. Three permissions are requested during install — see below
3. Open "日报" from the sidebar and pick a model provider on the settings page
4. Back on the workbench, click "Generate today's issue"

### Permissions

| Capability | Purpose | Without it |
|---|---|---|
| `app/tools.expose-to-model` | Makes the in-session "日报" command available | Workbench only |
| `app/models.infer` | Calls the model you chose to write the digest | **Cannot generate** — this is the core function |
| Network (8 declared domains) | Fetches public sources | **Cannot generate** |

**Not requested**: reading your sessions, spawning processes, reading any provider credentials, writing to disk.

Optional (off by default, enable when you want it):

| Capability | Purpose | Without it |
|---|---|---|
| `app/render.pdf` | PDF from the in-session entry point | In-session digests still work, just without the PDF. **The workbench's PDF export is unaffected** (it goes through browser print) |

HTML / Markdown / Word exports are produced by the app itself and downloaded directly by the browser. They **need no extra permission**.

### Privacy

- Everything fetched is **public data**. No behavioural tracking of any kind.
- Model calls go through Hana's own credential system. The app **never sees or stores an API key**.
- All archives stay **on this machine** (`app-data/cyber-newspaper/`). Nothing is uploaded anywhere.
- Search is local string matching; it neither calls a model nor touches the network.

### Sources

All on by default; each can be turned off on the settings page.

| Source | Language | Notes |
|---|---|---|
| Hacker News | EN | High-score stories, with points and comment counts |
| GitHub new repos | EN | Created in the last 7 days, 100+ stars |
| arXiv cs.AI | EN | Latest submissions |
| 量子位 (QbitAI) | ZH | |
| InfoQ China | ZH | |
| TechCrunch AI | EN | |
| Ars Technica AI | EN | |
| OpenAI Blog | EN | |

> **Note**: GitHub is reached only through `api.github.com`; the `github.com` web pages are never scraped. In some network environments the latter times out.

### Known limitations

- **Sources can be flaky.** One failing source does not break the digest — the issue states clearly which source came back empty. If every source fails, generation stops and reports an error rather than padding the issue with stale material.
- **Each issue has a different section structure.** The number and names of sections are decided by the model from that day's content. That is intentional: news differs day to day and should not be forced into one mould. The visual style is fixed (Swiss International Style: hard rules, zero radius) and does not degrade when you switch models.
- **Theme following has edges.** Background and accent follow Hana; body text colour does not (for contrast); Word export does not follow at all.
- **Regenerating the same day counts as a revision** — the issue number does not advance.
- **PDF goes through browser print.** The workbench's PDF export opens the print view; choose "Save as PDF" in the dialog.
- **Word export is a simplified layout.** The .docx keeps heading levels, body text, hyperlinks and source markers, but does not reproduce the multi-column layout.

### Development

```
cyber-newspaper/
  manifest.json        app manifest
  index.js             entry: tool registration, routes, pipeline orchestration
  lib/
    sources/           source definitions and concurrent fetching
    pipeline/          merge, dedupe, cross-source matching, ranking
    editorial/         editorial layer: prompt, parsing, ref backfill
    render/            the single renderer: Issue -> HTML
    export/            export: HTML / Markdown / Word / PDF
    store/             archive and config
  ui/
    workbench.html     the workbench (full page)
    settings.html      settings page
    status.html        feature panel
    assets/
      theme-follow.js  mirrors host theme variables into --hana-*
      theme-mode.js    light/dark decision and contrast maths (shared by render/preview/tests)
  probe/               development-time verification scripts (not shipped)
```

#### Core design

**One dataset, several projections.** The `Issue` object is the single source of truth; the workbench view, the HTML export and the PDF are three projections of it, sharing one renderer. Do not write a second template for one of the shapes.

**Style and structure are separate.** The visual style is fixed in `lib/render/styles.js` (Swiss International Style: hard rules, zero radius, one accent). Section count, section names and per-item commentary are the model's call. **The actual colour values are not fixed either** — they follow the host; only a fallback layer is hard-coded.

**Colour is layered.** Host variables -> `--hana-*` (mirror layer) -> `--dg-*` (render layer). The names must stay distinct: `--accent: var(--accent, …)` is a CSS self-reference and the fallback would never apply.

**Fabrication is structurally blocked.** The model only emits candidate indices (`ref`) plus commentary; titles and links are backfilled by the app from the candidate pool. It cannot invent a URL.

**Generation must stream.** The host's ordinary RPC timeout for an app is **30 seconds**, while one run takes 80-100 seconds (eight sources plus a model call). Returning the result synchronously means the host cuts the request off first, the user sees a bare `Internal Server Error` with no reason, and the pipeline goes on to finish in the background and write the archive. So `/api/digest/run` returns an **NDJSON stream**: the first progress chunk is emitted immediately (headers go out, the RPC completes right away), progress streams as the pipeline advances, and the last chunk carries the result. Reverting to a single `c.json` reintroduces the bug.

**If it cannot be rescued, refuse it.** When model output is truncated it is cut only at the last cleanly closed `}` / `]` and the brackets are balanced; if it cannot be reassembled, the function returns null and the error is reported as-is. Better to publish nothing than to pass half a story off as a finished digest.

#### Local verification

```bash
node probe/test-pipeline.mjs        # sources and merging (37)
node probe/run-pipeline.mjs         # real fetch; writes candidate pool and prompt
node probe/test-pipeline-run.mjs    # full pipeline, mocked (25)
node probe/test-export.mjs          # the four exports (27)
node probe/e2e.mjs                  # end to end (36)
node probe/test-run-stream.mjs      # streaming: first-chunk latency, event order, cancel (25)
node probe/test-json-repair.mjs     # truncated-JSON salvage (16)
node probe/test-transient.mjs       # transient-failure retry (20)
node probe/check-ui.mjs             # page structure and tag closure
node probe/check-brand.mjs          # brand naming consistency across display/project/package names
node probe/check-var-names.mjs      # CSS variable names do not collide
node probe/check-package.mjs        # package contents: nothing extra, nothing missing
node probe/check-entry-integrity.mjs # entry.json size/sha256 match the zip
node probe/check-provider-addressable.mjs # provider names the host can address
node probe/verify-theme-layers.mjs  # three-layer theme fallback (JS dead, theme CSS only, no host at all)
node probe/verify-contrast.mjs      # measured contrast (42 checks, three themes)
node probe/verify-installed.mjs     # installed code is byte-identical to source
node probe/audit-personal.mjs       # personal-info and credential audit (repo + package)
powershell -File probe/verify-docx.ps1   # open the .docx in real Word
```

To look at it without installing:

```bash
node probe/preview-workbench.mjs  # workbench preview (fetch is mocked)
node probe/preview-theme.mjs      # exported images across four themes
```

### License

MIT
