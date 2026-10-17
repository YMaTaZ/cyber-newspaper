# Cyber Newspaper · 赛博报纸

[中文](#中文) · [English](#english)

---

## 中文

抓取多个公开 AI 信息源，归并去重后由**你选定的模型**整理成一份结构化日报，按日期归档、可搜索、可导出。

每天早上想知道 AI 圈发生了什么，成本不在「看不到」，而在**筛选和归并**：信息散落在 Hacker News、GitHub、arXiv 和多家媒体里，人工过一遍要花掉半小时以上，而且每天都得重来。

这个 App 把那套重复劳动固定下来：

```
抓取 8 个源 → 归并去重（标记多源覆盖）→ 模型整理成结构化日报 → 归档
```

### 三个入口

| 入口 | 怎么用 | 能出 PDF |
|---|---|---|
| **工作台** | 装完后在侧边导航打开，点「生成今日日报」 | 是（走浏览器打印） |
| **会话内** | 在对话里说「日报」（需在设置里开启） | 是 |
| **桥接会话** | 从已桥接到 Hana 的会话触发（需在设置里开启） | 是 |

工作台只负责生成、查看、归档、搜索、导出，**不做任何推送**。App 不假设任何具体通道 —— 通道属于宿主环境，不属于 App。

### 导出格式

工作台右上角「导出」可选四种：

| 格式 | 说明 |
|---|---|
| **网页 (HTML)** | 单文件，样式内联，离线可开 |
| **Markdown** | 纯文本，适合贴进笔记、邮件、issue 系统 |
| **Word 文档** | 真正的 .docx，可直接编辑，不依赖任何第三方库 |
| **PDF** | 打开打印视图，用浏览器「另存为 PDF」 |

工作台的 PDF 导出走浏览器打印，**零额外授权、零模型消耗**。只有在会话内触发日报时，才会用宿主自带的渲染器产出 PDF（需 `app/render.pdf` 授权）。

### 外观：跟着你的 Hana 主题走

日报的**骨相固定，皮肤跟随**。瑞士国际主义的硬线分隔、零圆角、宽字距小标签不会变；背景、主色、分隔线实时跟随你在 Hana 里选的主题。你换主题，日报跟着换。

两条刻意的取舍：

- **文字颜色不跟随**。宿主主题的正文色是为它自己的 UI 选的，拿来做长文会掉对比度。日报自己按背景亮度取黑或白，保证读得清。
- **强调色会加深**。直接用主色当小字颜色，在浅色主题上常常不达 4.5:1，所以往高对比方向混了一部分。颜色仍来自主色，只是不再发虚。

对比不是「看着行」，是可验的：无头 Chrome 量渲染后的**真实计算色**，三套主题 42 项均过 WCAG AA。

导出件的跟随情况：HTML 与 PDF 跟随（PDF 看打印当时的主题）；**Word 不跟随**，.docx 里没有 CSS 变量这回事，固定浅底深字。在 Hana 外打开导出件也正常可读，兜底值自带。

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

### 权限

| 能力 | 用途 | 不给会怎样 |
|---|---|---|
| `app/tools.expose-to-model` | 让会话内的「日报」指令可用 | 只能用工作台 |
| `app/models.infer` | 调用你选定的模型整理日报 | **无法生成**（这是核心功能） |
| 网络（声明 8 个域名） | 抓取公开数据源 | **无法生成** |
| `app/render.pdf` | 可选，默认关。会话内入口的 PDF 产出 | 会话内日报照常出，只是不带 PDF。**工作台导出 PDF 不受影响** |

**本 App 不申请**：读取你的会话、派生进程、读取任何供应商凭证、写盘。

导出 HTML / Markdown / Word 由 App 自己生成字节、浏览器直接下载，不需要任何额外授权。

### 隐私

- 抓取的都是**公开数据**，不采集你的任何行为。
- 模型调用走 Hana 自己的凭证系统，**本 App 不接触、不存储任何 API Key**。
- 所有归档只存在**本机**（`app-data/cyber-newspaper/`），不上传任何服务器。
- 搜索是本地字符串匹配，不调用模型、不联网。

### 已知限制

- **数据源可能不稳**。单个源失败不影响整体，日报里会明确标出哪个源没抓到。所有源都失败时会中止并报错，不会拿旧数据充数。
- **每期的栏目结构不同**。栏目数量与名称由模型根据当天内容决定，这是有意设计：新闻天天不同，不该长成同一个模子。视觉风格固定，不会因为换模型而变丑。
- **主题跟随有边界**。背景与主色跟随 Hana，文字色不跟随（为了对比度）；Word 导出完全不跟随。
- **同一天重复生成视为修订**，期号不递增。
- **Word 导出是简化版式**。.docx 保留标题层级、正文、超链接与来源标记，但不做多栏排版。

### 开源

MIT 许可。仓库：https://github.com/YMaTaZ/cyber-newspaper

---

## English

[中文](#中文) · [English](#english)

Fetches a set of public AI sources, merges and deduplicates them, and hands the result to **a model you choose**, which turns it into a structured daily digest — archived by date, searchable, exportable.

The cost of keeping up with AI news is not access, it is **filtering and merging**. The material is scattered across Hacker News, GitHub, arXiv and several outlets; reading through it by hand takes well over half an hour, and you have to do it again the next day.

This app fixes that recurring work in place:

```
Fetch 8 sources → merge and dedupe (flag multi-source coverage) → model writes the digest → archive
```

### Three entry points

| Entry | How | PDF |
|---|---|---|
| **Workbench** | Open it from the sidebar after installing, click "Generate today's issue" | Yes (via browser print) |
| **In a session** | Say "日报" in a conversation (enable it in settings) | Yes |
| **Bridged session** | Triggered from a session bridged to Hana (enable it in settings) | Yes |

The workbench generates, reads, archives, searches and exports — it **never pushes anything**. The app assumes no particular channel; channels belong to the host, not to the app.

### Export formats

Four formats from the Export menu:

| Format | Notes |
|---|---|
| **HTML** | Single file, styles inlined, opens offline |
| **Markdown** | Plain text, good for notes, mail, issue trackers |
| **Word** | A real .docx, directly editable, no third-party library |
| **PDF** | Opens the print view; use the browser's "Save as PDF" |

The workbench's PDF export goes through browser print, so it costs **no extra permission and no model tokens**. Only an in-session run uses the host's own renderer to produce a PDF (needs `app/render.pdf`).

### Appearance: it follows your Hana theme

The digest's **skeleton is fixed, its skin follows**. Swiss International Style holds: hard rules, zero corner radius, wide-tracked small labels. Background, accent and separators track whatever theme you have selected in Hana. Change the theme and the digest changes with it.

Two deliberate trade-offs:

- **Body text colour does not follow.** The host theme's text colour was chosen for its own UI, and it loses contrast in long-form reading. The digest picks black or white from the background's luminance so the text stays legible.
- **The accent is darkened.** Using the raw accent for small text often falls below 4.5:1 on light themes, so it is mixed toward higher contrast. The hue still comes from your accent; it just stops being washed out.

Contrast here is not "looks fine", it is measured: headless Chrome reads the **real computed colours** after rendering, and all 42 checks across three themes pass WCAG AA.

How the exports behave: HTML and PDF follow (the PDF follows the theme at print time); **Word does not** — there are no CSS variables in a .docx, so it is fixed light paper with dark ink. Exports also read correctly outside Hana; fallback values are built in.

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

### Permissions

| Capability | Purpose | Without it |
|---|---|---|
| `app/tools.expose-to-model` | Makes the in-session "日报" command available | Workbench only |
| `app/models.infer` | Calls the model you chose to write the digest | **Cannot generate** — this is the core function |
| Network (8 declared domains) | Fetches public sources | **Cannot generate** |
| `app/render.pdf` | Optional, off by default. PDF from the in-session entry point | In-session digests still work, just without the PDF. **The workbench's PDF export is unaffected** |

**Not requested**: reading your sessions, spawning processes, reading any provider credentials, writing to disk.

HTML / Markdown / Word exports are produced by the app itself and downloaded directly by the browser. They **need no extra permission**.

### Privacy

- Everything fetched is **public data**. No behavioural tracking of any kind.
- Model calls go through Hana's own credential system. The app **never sees or stores an API key**.
- All archives stay **on this machine** (`app-data/cyber-newspaper/`). Nothing is uploaded anywhere.
- Search is local string matching; it neither calls a model nor touches the network.

### Known limitations

- **Sources can be flaky.** One failing source does not break the digest — the issue states clearly which source came back empty. If every source fails, generation stops and reports an error rather than padding the issue with stale material.
- **Each issue has a different section structure.** The number and names of sections are decided by the model from that day's content. That is intentional: news differs day to day and should not be forced into one mould. The visual style is fixed and does not degrade when you switch models.
- **Theme following has edges.** Background and accent follow Hana; body text colour does not (for contrast); Word export does not follow at all.
- **Regenerating the same day counts as a revision** — the issue number does not advance.
- **Word export is a simplified layout.** The .docx keeps heading levels, body text, hyperlinks and source markers, but does not reproduce the multi-column layout.

### Open source

MIT licensed. Repository: https://github.com/YMaTaZ/cyber-newspaper
