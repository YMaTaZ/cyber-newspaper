# Cyber Newspaper（赛博报纸）App · 规格书

> 一份开源 Hana v2 App 的完整设计契约。读这份文档的人应该能据此实现、验收、或接手维护。

---

## 0 文档信息

| 项 | 值 |
|---|---|
| 文档版本 | v1.3 |
| 状态 | **已实现，验收中** |
| 日期 | 2026-10-14 |
| 目标读者 | 实现者、验收者、后续维护者 |
| 关联项目 | 前身是 Hana skill `github-daily`（私有，不随本项目开源） |

### 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-14 | 首版。从私有 skill 转为开源 v2 App，形态定为工作台 + 归档 |
| v1.1 | 2026-10-14 | 导出改四格式（HTML/MD/Word/PDF）；工作台改侧边导航 + 整页阅读 |
| v1.2 | 2026-10-14 | 视觉改瑞士国际主义，强调色回蓝钢；对比度/字号/间距重调 |
| v1.3 | 2026-10-14 | 新增 §8.6 主题跟随；§8.2 改为"风格写死、色值不写死"并定义 4.5:1 硬判据 |
| v1.4 | 2026-10-14 | 重写 §8.6：真实宿主首屏不注入主题 CSS、不设 data-theme；改为 URL 参数 + `<link>` + 三层嵌套兜底；内部变量改名避开与宿主撞名；新增 theme-probe 日志回传 |

### 本文档的用法

- 第 3 章（架构）和第 4 章（数据模型）是承重墙，改动会牵连全文。
- 第 13 章的验收标准是**可对照的判据**，不是"效果良好"这类描述。
- 第 14 章单列未决项与风险，不把没定的事藏进正文装成定案。

---

## 1 项目概述

### 1.1 一句话

一个 Hana v2 App：装完后自动识别用户已配置的模型供应商，用户选一个，之后一键生成当天的 AI 热点简报，在工作台里按日期归档、可搜索、可导出。

### 1.2 面向谁

Hana 中文社区用户。默认中文优先，同时抓取中英文数据源。

### 1.3 解决什么问题

追踪 AI 领域每天发生的事，成本不在于"看不到"，而在于**筛选和归并**：信息散落在 Hacker News、GitHub、arXiv、多家媒体 RSS 里，人工过一遍要花掉半小时以上，而且每天都得重来。

这个 App 把那套重复劳动固定下来：抓取 → 归并去重 → 让模型按当天的实际情况分栏和点评 → 呈现。

### 1.4 与私有 skill 的关系

本项目的前身是一个单用户场景的 Hana skill（拉模式、8 个数据源、A4 PDF、硬编码推送通道）。转成开源 App 时做了三处结构性改动：

| 维度 | 私有 skill | 开源 App |
|---|---|---|
| 载体 | A4 PDF 文件 | 工作台（卡片 + 归档页），PDF 降为可选导出 |
| 触发 | 说一句「日报」 | 工作台按钮 + 两个可选入口 |
| 编辑层 | Agent 临场判断 | App 调模型出结构化数据 |
| 推送 | 硬编码单一通道 | 无通道假设，靠宿主桥接 |

**私有 skill 不作为本项目的一部分开源**，两者并存，互不依赖。

---

## 2 边界

### 2.1 做什么

- 抓取 8 个公开数据源，归并去重，标记多源交叉
- 调用用户选定的模型，产出结构化的当日简报（Issue）
- 在工作台中按日期归档、搜索、查看
- 支持导出为 HTML 与 PDF
- 提供两个**默认关闭**的可选入口：会话内触发、桥接推送

### 2.2 不做什么（及理由）

| 不做 | 理由 |
|---|---|
| 内置微信 / 飞书 / Telegram 推送 | 通道属于宿主环境，不属于 App。App 硬编码任何一个通道，都会让它对没有该通道的用户不成立 |
| 定时自动生成 | 自动推送会把"每天想看的东西"变成"每天堆积的未读"。默认不做，架构上留门（第 12.4 节） |
| 生成封面图 | 视觉全部走排版，不引入图像生成依赖，减少授权面与不确定性 |
| 抓取 `github.com` 网页 | 前身实测该域名的网页端在部分网络下超时，只有 `api.github.com` 稳定可用。这条是硬约束，见第 5.3 节 |
| 用户画像 / 阅读偏好学习 | 超出首版范围，且需要额外存储与隐私声明 |
| 服务端组件 | 纯本地 App，不引入任何需要运维的远端 |

### 2.3 隐私立场

- 抓取的都是公开数据，不采集用户行为。
- 模型调用走宿主凭证，App 不接触、不存储任何 API key。
- 归档只存在本机 `dataDir`，不上传。
- README 中须明确写出以上三点。

---

## 3 架构总览

### 3.1 核心原则：一份数据，多个投影

```
                    ┌─────────────┐
   8 个数据源 ──────▶│  抓取 + 归并 │
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │  候选条目池  │  结构化，无自然语言
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │   编辑层     │  调用户选定的模型
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │   Issue     │  ★ 唯一真相
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          工作台视图     HTML 导出     PDF 导出
          （卡片/归档）   （单文件）    （会话文件）
```

**Issue 对象是整个 App 的枢轴。** 三种输出形态是同一个 Issue 的不同投影，共用一个渲染器，只有最外层包装不同。

> **实现红线**：禁止为三种形态各写一套模板。一旦拆成三条渲染路径，风格一致性就守不住了，这是本项目最容易失控的地方。

### 3.2 风格与格式的职责分离

这是本项目最关键的设计决定，来自一句需求：「风格写死，格式不写死」。

| 维度 | 归属 | 说明 |
|---|---|---|
| **风格**（颜色、字重、留白、层级、栅格） | **渲染器** | 写死在代码里。模型碰不到，用户换任何模型都不会得到一份丑东西 |
| **格式**（栏目数量、栏目名称、每条点评） | **模型** | 由模型按当天实际新闻自己决定。新闻天天不同，不该长成同一个模子 |

具体落点：模型的输出是**结构化 JSON**（第 4 章），不是 HTML。渲染器负责把 JSON 排成好看的页面。模型永远不产出标记语言。

### 3.3 三条入口

| 入口 | 触发方式 | 有 callToken | 能出 PDF | 能推送 | 默认 |
|---|---|---|---|---|---|
| ① 工作台 | 点按钮 | 无 | 否 | **否** | 开 |
| ② 会话内 | 在会话里说「日报」 | 有 | 是 | 是 | **关**（开关） |
| ③ 桥接推送 | 在微信/飞书等桥会话里说「日报」 | 有 | 是 | 是 | **关**（开关） |

**入口与出口的分工（2026-10-14 定）**：

- **工作台只负责「生成 + 查看 + 归档 + 搜索 + 导出」。它不承担任何推送。**
- **推送只从会话入口走**（②③）。工作台按钮不发起会话回合，因此不产生任何额外的模型开销。
- 这条分工的理由：工作台点一下就跑是它的核心价值，如果它顺手起一个会话回合去推送，用户每点一次都会烧掉一次模型调用，成本不可预期。想要推送，就去会话里说一声——那里本来就是推送的语义所在。

> **实现红线**：工作台代码中不得出现任何投递动作（不发 `app_event`、不调 `session:send`、不弹桌面通知）。推送逻辑只存在于工具执行路径里。

**为什么工作台出不了 PDF**：`render:html-to-pdf` 必须携带 `callToken`，而 callToken 只在工具执行时由宿主签发。工作台是纯 UI 上下文，拿不到。工作台可以提供"生成 HTML"和"把 PDF 交给会话"两个降级路径，但不能直接产出 PDF。

**② 和 ③ 的区别只在会话来自哪里**。App 侧代码完全相同：都是"在某个会话里被工具调用"。至于那个会话连的是桌面还是微信，由宿主决定，App 不感知。这就是为什么开源版里一行微信代码都不需要，而桥接推送依然成立。

### 3.4 交付接缝

```
App 产出（Issue / HTML / PDF）
   ↓ 落到会话：SessionFile + 一条 App 事件
宿主 / Agent 接住
   ↓ 由宿主环境的通道能力投递
微信 / 飞书 / 桌面通知 / 其他
```

App 只负责"把包裹放进会话"，"送到谁手里"是宿主的事。

---

## 4 数据模型

### 4.1 类型定义

```ts
/** 一份日报。这是整个 App 的枢轴对象。 */
type Issue = {
  schemaVersion: 1;          // 数据格式版本，用于未来迁移
  date: string;              // YYYY-MM-DD，本地日期
  issueNo: number;           // 期号，从 1 起递增
  generatedAt: string;       // ISO 8601 时间戳
  lang: "zh" | "en";         // 本次生成使用的语言
  provider: string;          // 实际使用的供应商 id（用于溯源）
  model: string;             // 实际使用的模型 id

  sources: SourceReport[];   // 每个数据源的抓取结果，含失败
  highlights: string[];      // 今日要点，条数由模型定（建议 3~5）
  sections: Section[];       // 栏目，数量和标题由模型定
  closing: string;           // 收尾，把几条线串起来的一段话

  stats: IssueStats;         // 统计，用于归档页展示
};

type SourceReport = {
  id: string;                // 源标识，见第 5 章
  name: string;              // 展示名
  ok: boolean;
  count: number;             // 抓到的条目数
  error?: string;            // 失败原因，成功时省略
};

type Section = {
  id: string;                // 稳定标识，用于锚点与搜索
  title: string;             // 栏目名，模型当天决定
  lead?: string;             // 可选的栏目导语
  items: Item[];
};

type Item = {
  title: string;             // 标题（中文优先，见第 7.4 节）
  url: string;               // 原文链接
  sources: string[];         // 出现在哪些源里（多源交叉标记）
  points?: number;           // HN 热度（该源独有字段）
  comments?: number;         // HN 评论数
  stars?: number;            // GitHub 星数（该源独有字段）
  note?: string;             // 一句话点评，模型产出
};

type IssueStats = {
  itemCount: number;         // 总条目数
  sectionCount: number;      // 栏目数
  sourceOk: number;          // 成功的数据源数
  sourceTotal: number;       // 数据源总数
  crossSource: number;       // 被多源交叉验证的条目数
};
```

### 4.2 设计约束

1. **`sections` 是数组，不是固定字段**。这是"格式不写死"的实现点。禁止把栏目做成 `models / industry / opensource / research` 这样的固定键。
2. **`sources` 数组承载多源交叉**。同一个事件在多个源出现，说明它重要。这是第 6 章的产物，不是编辑层编的。
3. **`note` 是可选字段**。模型可以选择不给某条写点评，渲染器须能处理缺失。
4. **`schemaVersion` 必须存在**。归档文件会长期保存，未来改结构时靠它做迁移。
5. **`provider` / `model` 必须记录**。归档页要能回答"这一期是谁生成的"。

### 4.3 存储布局

```
{HANA_HOME}/app-data/cyber-newspaper/
  archive/
    2026-10-14.json          # Issue 全文
    2026-10-14.html          # 该期的 HTML 快照（可选，按设置决定是否保留）
    2026-10-13.json
    …
  index.json                 # 归档索引，见下
  storage/global.json        # 由宿主维护的 ctx.storage，存配置与计数
```

**索引结构**（写在 `ctx.storage.global` 的 `archiveIndex` 键下，同时也落一份 `index.json` 便于人工检查）：

```ts
type ArchiveEntry = {
  date: string;
  issueNo: number;
  title: string;             // 取 highlights[0] 的前若干字，便于列表展示
  itemCount: number;
  sectionCount: number;
  sourceOk: number;
  generatedAt: string;
};

type ArchiveIndex = {
  schemaVersion: 1;
  entries: ArchiveEntry[];   // 按 date 倒序
  nextIssueNo: number;       // 下一期期号，替代裸文件计数
};
```

> **对比前身**：私有 skill 用一个绝对路径下的文本文件存期号。开源版改用 `ctx.storage.global`，原因：不依赖任何绝对路径，且跨机器、跨安装位置都成立。

---

## 5 数据源规格

### 5.1 源清单

| id | 名称 | 端点 | 语言 | 特有字段 |
|---|---|---|---|---|
| `hn` | Hacker News | `https://hn.algolia.com/api/v1/search?query=AI&tags=story&numericFilters=points>100,created_at_i>{ts}&hitsPerPage=30` | en | `points`, `comments` |
| `github` | GitHub 新仓库 | `https://api.github.com/search/repositories?q=created:>{date}+stars:>100&sort=stars&order=desc&per_page=30` | en | `stars` |
| `arxiv` | arXiv cs.AI | `http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=12` | en | — |
| `qbitai` | 量子位 | `https://www.qbitai.com/feed` | zh | — |
| `infoq` | InfoQ 中国 | `https://www.infoq.cn/feed` | zh | — |
| `techcrunch` | TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | en | — |
| `ars` | Ars Technica AI | `https://arstechnica.com/ai/feed/` | en | — |
| `openai` | OpenAI Blog | `https://openai.com/blog/rss.xml` | en | — |

**默认全部开启**（中文优先指输出语言，不指源范围）。用户可在设置页逐源关闭。

### 5.2 时间窗口

- 默认抓取**过去 24 小时**。
- 若某源在 24 小时内条目不足 3 条，自动放宽到 **48 小时**并记录在 `SourceReport` 中。
- `{ts}` 为窗口起点的 Unix 时间戳；`{date}` 为窗口起点日期（`YYYY-MM-DD`）。

### 5.3 硬约束

> **GitHub 只走 `api.github.com`，绝不抓 `github.com` 网页。**
>
> 前身实测：在部分网络环境下 `github.com` 网页端连接超时，而 `api.github.com` 稳定可用。任何"抓 Trending 页面 HTML"的做法都会撞墙。这条在实现时不可绕过。

### 5.4 已知不稳定源

以下源在前身实测中不稳定，**首版不纳入**，但保留在文档中以免后来者重复踩坑：

| 源 | 问题 |
|---|---|
| HuggingFace daily papers | 502 |
| Google AI Blog | 超时 |
| VentureBeat | 429 |
| The Verge | RSS 中 `title` 是 `XmlElement`，需特殊处理 |
| 36kr | 返回 HTML 而非 RSS |

### 5.5 失败降级

1. **单源失败不影响整体**。每个源独立抓取、独立捕获异常，结果记入 `SourceReport.ok = false` 与 `error`。
2. **超时上限**：单源 15 秒。整体并发抓取，不串行等待。
3. **失败可见**：工作台与 Issue 都须展示"哪些源没抓到"，**绝不用旧数据或缓存充数**。
4. **全失败**：所有源都失败时，中止本次生成并报错，不产出空 Issue。
5. **部分成功**：成功源少于 3 个时，产出但显著标注"本次数据覆盖不足"。

### 5.6 网络声明

manifest 的 `network` 块：

```json
{
  "network": {
    "allowedHosts": [
      "hn.algolia.com",
      "api.github.com",
      "export.arxiv.org",
      "www.qbitai.com",
      "www.infoq.cn",
      "techcrunch.com",
      "arstechnica.com",
      "openai.com"
    ],
    "methods": ["GET"],
    "allowLocalhost": false,
    "defaultTimeoutMs": 15000,
    "maxResponseBytes": 8388608
  }
}
```

---

## 6 管线规格

### 6.1 流程

```
1. 读配置（源开关、条数上限、语言、供应商选择）
2. 并发抓取所有启用的源
3. 归一化为统一的候选条目结构
4. 归并去重 + 多源交叉标记
5. 截断到条数上限
6. 交给编辑层（第 7 章）
7. 归档 + 呈现
```

### 6.2 归一化

所有源统一转成候选条目：

```ts
type Candidate = {
  title: string;
  url: string;
  sourceId: string;          // 来自哪个源
  publishedAt?: string;      // ISO 时间，缺失则省略
  points?: number;
  comments?: number;
  stars?: number;
  rawSummary?: string;       // 原文摘要，供编辑层参考
};
```

**RSS 解析注意**：部分源（如 The Verge 类）的 `title` 节点是 `XmlElement` 而非纯文本，取文本时须兼容 `#text` 形式。首版虽未纳入该源，但解析器应写成健壮的。

### 6.3 去重与多源交叉

**判定同一个事件**：

1. URL 规范化后完全一致 → 同一条。
2. URL 不同但标题高度相似（归一化后去停用词、比较字符重合度）→ 同一条。
3. 命中规则 2 时，**合并为一条，`sources` 数组记下所有来源**。

**多源交叉是重要信号**，在 Issue 中保留（`Item.sources`），渲染时以角标或标签呈现。这是"同一件事在多个源出现 = 重要"这一判断的落地。

### 6.4 排序与截断

- 排序权重：多源交叉数 > 是否有热度数值 > 数值本身 > 时间新旧。
- 默认上限 **40 条**进入编辑层（可配置），编辑层再筛到最终的 15~25 条。
- 上限存在的意义是控制编辑层的输入 token，不是内容上限。

### 6.5 性能要求

- 8 源并发抓取，整体目标 **15 秒内**完成。
- 编辑层推理单次上限 **90 秒**。
- 端到端（点按钮到出结果）目标 **2 分钟内**。

> 桥会话是批处理模式：长活期间用户在微信里看不到过程，只会等到最后一条。因此端到端时间必须压住。

---

## 7 编辑层规格

### 7.1 职责

把候选条目池转成一份 Issue。这是唯一调用模型的地方。

### 7.2 调用方式

```ts
const result = await ctx.models.stream({
  requestId,
  provider,          // 用户选定
  model,             // 用户选定
  messages: [{ role: "user", content: buildEditorialPrompt(candidates, config) }],
  systemPrompt: EDITORIAL_SYSTEM_PROMPT,
  temperature: 0.4,
  maxTokens: 4096,
  callToken,         // 会话入口时提供；工作台入口省略
});
```

**为什么用 `models.stream` 而不是 `models.utility`**：`utility` 走宿主 utility 配置，不接受 provider/model 指定；而本 App 的核心需求是"用户手动选供应商"，必须显式指定，因此走 `stream`。代价是需要 `app/models.infer` 授权（见第 11 章）。

### 7.3 输出契约

模型必须返回**严格 JSON**，结构即第 4 章的 Issue（去掉由 App 填充的字段）：

```json
{
  "highlights": ["…", "…", "…"],
  "sections": [
    { "title": "当天自己定的栏目名", "lead": "可选导语", "items": [
      { "ref": 3, "note": "一句话点评" }
    ]}
  ],
  "closing": "收尾段落"
}
```

**关键设计：模型用 `ref` 引用候选条目，不重新输出标题和 URL。**

- `ref` 是候选条目在输入池中的序号。
- App 侧据 `ref` 回填 `title` / `url` / `sources` / `points` / `stars`。
- **好处**：模型无法编造链接和数字，从结构上消灭幻觉来源。这是本项目对"不编造"这条原则的技术保障。

**容错**：`ref` 越界或缺失时，丢弃该条并记录日志，不中止整次生成。若有效条目少于 5 条，判定为生成质量不合格，报错重试一次。

### 7.4 语言规则（中文优先）

- **条目标题**：英文源的标题译成中文，保留原文链接与源标记。
- **不翻译**：模型名、公司名、仓库名、论文标题中的专有名词、代码标识符。
- **栏目名**：中文。
- **点评与收尾**：中文。
- 设置页提供"输出语言"选项（中文 / English），切换时本规则整体切换。

### 7.5 风格写死的落点

以下**不交给模型**，由渲染器固定：

- 配色：暖纸底 `#F8F4ED`，蓝钢主色 `#537D96`
- 字重：只用 400 / 500
- 禁用：纯黑白、渐变、玻璃拟态
- 间距与栅格：由渲染器统一定义

以下**交给模型**：

- 栏目数量（建议 3~5，但不强制）
- 栏目名称
- 栏目导语的有无
- 每条点评的有无与内容
- 今日要点的条数（建议 3~5）

### 7.6 Prompt 契约要点

system prompt 须包含：

1. 角色：一位中文科技编辑，面向中文读者。
2. 任务：从候选池中筛选、分栏、点评。
3. 输出格式：严格 JSON，无 markdown 包裹，无解释文字。
4. `ref` 引用规则：只能引用给定序号，不得编造。
5. 语言规则：第 7.4 节。
6. 栏目自定：明确告知"栏目数量和名称由你根据今天的内容决定，不要套用固定分类"。
7. 收尾要求：把几条线串起来，点出今天的暗线，而非复述条目。

**约束**：prompt 中不得出现任何具体日期、具体公司名或具体事件，避免过拟合到某一天。

---

## 8 渲染层规格

### 8.1 唯一渲染器

```ts
renderIssue(issue: Issue, opts: RenderOptions): string  // → HTML
```

三种形态共用它，只有外层包装不同：

| 形态 | 包装 |
|---|---|
| 工作台视图 | 直接渲染到卡片，无外层文档 |
| HTML 导出 | 完整单文件 HTML（内联样式） |
| PDF 导出 | 同上，交给宿主 Chromium 打印 |

> **实现红线**：禁止为 PDF 单独写一套更适合打印的模板。打印适配通过 CSS `@media print` 与 `@page` 完成，仍在同一个渲染器内。

### 8.2 视觉规范

风格写死，**色值不写死**。瑞士国际主义的骨相是固定的，皮肤跟着宿主走：

| 项 | 值 | 来源 |
|---|---|---|
| 背景 | 跟随宿主 | `var(--hana-bg)`，无宿主时兜底 |
| 主色 / 强调色 | 跟随宿主 | `var(--hana-accent)` |
| 分隔线 | 跟随宿主 | `var(--hana-border)` |
| 正文文字 | **不跟随**，按背景亮度取黑或白 | `[data-color-mode]` |
| 强调色文字 | 主色往高对比 ink 混合 70% | `color-mix()` |
| 主按钮文字 | 按与主色的实际对比度取黑/白中更高者 | `--on-accent` |
| 字体 | 系统无衬线栈 | 写死 |
| 骨相 | 硬线分隔、零圆角、零阴影、大写 + 宽字距小标签 | 写死 |

> 为什么文字不跟宿主的 `--text`：宿主那个值是为它自己的 UI 选的（暖纸是深灰 `#3B3D3F`），直接拿来当正文色会当场把对比度拉下去。跟随的是**环境**，不是**可读性**。

### 8.2.1 对比度硬判据

主题跟随的成立条件不是"看着还行"，是可算的数值：

- 所有正文、标题、强调色文字与其**有效背景**：≥ **4.5:1**（WCAG AA）
- 强调色小字（期号、编号、角标）按正常文字要求 4.5，**不降级到 3.0**
- 主按钮文字与其背景：≥ 4.5
- 验算由 `probe/verify-contrast.mjs` 在无头 Chrome 里量**真实计算色**，三套宿主主题共 42 项

实测下限：暖纸 4.74（主按钮）/ 青夜 5.08 / 高对比 10.90。深色档的弱化文字定为 `#C2C2C2`：原先用 `#A8A8A8` 在青夜深底上只有 3.85:1，不达标。

### 8.3 版面结构

```
报头     标题 + 日期 + 期号 + 覆盖时段 + 源覆盖情况
今日要点  模型定条数，置于最前
栏目区    按 Issue.sections 顺序渲染，栏目数与名称动态
收尾      一段话
页脚      数据源署名 + 生成模型 + 生成时间
```

### 8.4 打印适配（PDF）

```css
@page { size: A4; margin: 16mm 15mm 14mm; }
```

- 每个栏目起新页：`break-before: page`
- 单条不被切断：`break-inside: avoid`
- 无头打印须关闭页眉页脚（前身实测：不关会印上文件路径与页码）

### 8.5 动态结构的渲染要求

渲染器必须容忍：

- `sections` 长度从 1 到 8 都正常
- 栏目名为任意字符串，长度不定
- `lead`、`note`、`points`、`stars` 任一缺失
- 同一栏目内条目数不均

> 这是"格式不写死"对渲染层提出的代价：渲染器要写得比固定模板更健壮。

### 8.6 主题跟随

用户改 Hana 主题，日报得跟着变。

#### 8.6.0 真实宿主的两个坑（首版就是在这里错的）

宿主主题把变量全部写在 `[data-theme="midnight"]` 这类选择器里。要让 App 页面拿到这些值，必须**同时**满足：

1. 那份主题 CSS 存在于本文档
2. 本文档的 `<html>` 上有对应的 `data-theme`

SDK 两件都不保证：

| 事实 | 后果 |
|---|---|
| SDK 只在收到 `THEME_CHANGED` 时拉主题 CSS（`followHostTheme()` 全库只有这一处调用），**首屏不注入** | 刚打开时本文档里根本没有 `--bg` 这些定义 |
| SDK 从不在 iframe 文档上设 `data-theme` | 即使 CSS 落地，`[data-theme="…"]` 选择器也不命中 |
| 只有暖纸写了 `:root:not([data-theme])` 兜底，其余 10 套只认 `[data-theme]` | 不补属性时，除了默认主题其他全都拿不到值 |

所以早期版本的"读 computed style 再搬运"在真实宿主里永远读到空，
页面停在 `#FFFFFF` 兜底上 —— 表现为外壳是主题色、日报内容却是白底。
本地预览把跟随脚本整块换成桩、手工注入变量，把这个洞完全盖住了。

#### 8.6.1 现在的机制：三层取值，不依赖任何单一时序

```
A. iframe URL 参数（同步、不等任何事件）
   hana-theme / hana-css / hana-theme-appearance
   → 立即补 data-theme 与 data-color-mode，并用 <link> 拉主题 CSS
B. theme-follow.js 搬运 computed style → 写 --hana-*（inline，优先级最高）
C. 样式本身写嵌套兜底：
   var(--hana-bg, var(--bg, 写死值))
   → 即使 JS 全挂，只要主题 CSS 落地，浏览器自己就能解出宿主色
```

为什么用 `<link>` 而不是 fetch + `<style>`：SDK 自己用后者，而 App iframe 常带
`sandbox` 属性，没有 `allow-same-origin` 时 fetch 会被拒。`<link>` 载入样式
不受 CORS 与 sandbox 限制。

#### 8.6.2 为什么必须换名，而且两个名字都不能跟宿主撞

两条约束合在一起才定下命名：

- 写 `--accent: var(--accent, 兜底)` 是**自我引用**，CSS 判为循环、整个变量失效。所以镜像叫 `--hana-*`、内部叫 `--dg-*`。
- 但内部变量也**不能与宿主同名**。页面在 `:root` 上定义 `--accent`，宿主主题 CSS 在 `[data-theme="…"]` 上定义 `--accent`——两者作同一个元素、特异性相同，注入的样式表在 head 里靠后，会直接覆盖我们的三层链。`--accent` 与 `--danger` 都撞了，已全部改为 `--dg-*` 前缀。

`probe/check-var-names.mjs` 盯这条回归。

#### 8.6.3 无宿主时的行为

导出的 HTML / PDF 可能在 Hana 外打开。第三层写死兜底值保证它仍完整可读，不依赖任何外部样式。

#### 8.6.4 已知限制

| 输出 | 主题跟随 |
|---|---|
| 工作台 / HTML / PDF | 跟随（PDF 看打印时的主题） |
| Word | **不跟随**：OOXML 无 CSS 变量，写死浅底深字 |

#### 8.6.5 验证手段

| 脚本 | 验什么 |
|---|---|
| `verify-theme-layers.mjs` | 三层兜底链各自落到正确值（含"JS 挂了也能跟随"） |
| `verify-contrast.mjs` | 真实计算色的 WCAG 对比度，三套主题 42 项 |
| `check-var-names.mjs` | 内部变量不与宿主撞名 |

> **本地验不了真实宿主**。预览把跟随脚本换成了桩，它只能证样式表，不能证跟随逻辑。
> 因此 theme-follow.js 会向 `/api/digest/theme-probe` 回传运行时现状，进 App 日志。
> 要确认跟随是否真生效，看这条日志，不要看预览。

---

## 9 供应商检测

### 9.1 流程

```
装完 App
  ↓
设置页调用 ctx.models.list()        ← 不需要额外授权
  ↓
按 provider 分组，列出用户已配置的供应商
  ↓
用户选 provider + model
  ↓
存入 ctx.config / ctx.storage.global
  ↓
每次生成时用 ctx.models.stream({ provider, model })
```

### 9.2 为什么这样设计

`ctx.models.list()` 返回宿主已配置的模型目录，含 `id` / `name` / `provider`，且**不含任何凭证、baseUrl 或密钥**。因此：

- App 不需要用户手输 API key，规避了凭证存储问题
- App 不接触凭证，隐私立场干净（第 2.3 节）
- "自动检测"与"用户手动选择"两个需求同时满足

### 9.3 边界情况

| 情况 | 行为 |
|---|---|
| 目录为空（用户没配任何供应商） | 明确报错，引导去 Hana 设置里配置供应商，不静默失败 |
| 用户未选 | 默认取目录中第一个可用项，但设置页显著显示"当前使用：X / Y" |
| 选中的模型被移除 | 下次生成时报错并提示重选，不自动换模型 |
| 目录中 id 含多段斜杠 | 必须原样传递。`models.stream` 的 `model` 字段是精确匹配，不做前缀/大小写/空白归一化 |
| id 超出 128 字符或含控制字符 | 该 id 不可调用，设置页应过滤掉并在日志中记录 |

---

## 10 目录结构

```
cyber-newspaper/
  manifest.json
  index.js                    # defineApp 入口，注册工具与路由
  lib/
    sources/
      index.js                # 源注册表与并发调度
      hn.js
      github.js
      arxiv.js
      rss.js                  # 通用 RSS 解析器（量子位/InfoQ/TC/Ars/OpenAI 共用）
    pipeline/
      normalize.js            # 候选条目归一化
      dedupe.js               # 去重 + 多源交叉
      rank.js                 # 排序与截断
    editorial/
      prompt.js               # system prompt 与输入构造
      parse.js                # 模型输出解析与 ref 回填
      index.js
    render/
      issue.js                # 唯一渲染器
      styles.js               # 视觉常量（暖纸底/蓝钢/字重）
    store/
      archive.js              # 归档读写
      config.js               # 配置读写
    detect/
      providers.js            # 供应商检测与分组
  ui/
    workbench.html            # 工作台整页
    workbench.js
    archive.html              # 归档页（可作为工作台的左栏）
    settings.html             # 设置页
    styles/
      app.css
  assets/
    icon.png
    cover.webp                # 工作台卡片封面（face.image 相对 ui/ 解析）
  README.md
  LICENSE
  THIRD-PARTY-NOTICES.md
```

---

## 11 manifest 与授权

### 11.1 capability 清单

| 声明 | 用途 | 必需 | 理由 |
|---|---|---|---|
| `network`（allowedHosts） | 8 个源域名 | **是** | 抓取是核心功能 |
| `app/models.infer` | 编辑层推理 | **是** | 用户手选供应商，须显式指定 provider/model |
| `app/render.pdf` | PDF 导出 | 否 | 默认关。不给也能用（工作台 + HTML 照常） |
| `app/resources.write` | 用户另存 HTML | 否 | 可选。不给则只能存到 App 自己的 dataDir |
| `app/tools.expose-to-model` | 会话内触发 | **是** | 入口 ② ③ 依赖工具调用 |
| `app/events.emit` | 交付钩子 | 否 | 默认关。用于"跑完了"事件 |
| `app/notifications.show` | 桌面通知 | 否 | 默认关 |
| `app/tasks.manage` | 后台任务记录 | 否 | 长活期间在会话里显示进度 |

**不申请**：

- `app/sessions.read` / `app/sessions.manage`（本 App 不需要读别人的会话）
- `app/process.spawn`（不做任何进程派生；PDF 走宿主渲染）
- `app/runtime.*`（无托管运行时）
- `app/provider.credentials.read`（**明确不申请**，第 9.2 节）

### 11.2 声明示例

```json
{
  "manifestVersion": 2,
  "id": "cyber-newspaper",
  "name": "Cyber Newspaper",
  "version": "0.1.0",
  "entry": "index.js",
  "icon": "assets/icon.png",
  "minAppVersion": "0.1028.0",
  "capabilities": [
    "app/tools.expose-to-model",
    "app/models.infer"
  ],
  "network": {
    "allowedHosts": ["hn.algolia.com", "api.github.com", "export.arxiv.org",
                     "www.qbitai.com", "www.infoq.cn", "techcrunch.com",
                     "arstechnica.com", "openai.com"],
    "methods": ["GET"],
    "allowLocalhost": false,
    "defaultTimeoutMs": 15000,
    "maxResponseBytes": 8388608
  },
  "activation": { "mode": "on-demand" },
  "contributes": {
    "cards": [
      {
        "id": "workbench",
        "title": "日报",
        "description": "当天的 AI 热点摘要，按日期归档，可搜索、可导出。",
        "route": "/workbench.html",
        "realization": "page",
        "siteNavEntry": true,
        "fpFullPanel": true,
        "functionPanel": { "id": "daily-panel", "label": "生成状态", "route": "/settings.html" },
        "cardForm": "flush",
        "face": { "image": "assets/cover.webp" }
      }
    ],
    "settings": {
      "title": "日报",
      "ui": { "route": "/settings.html" }
    },
    "homeActions": [
      { "id": "run", "title": "生成今日日报", "toolName": "daily_run", "icon": "wrench" }
    ]
  }
}
```

> 注：上例 capability 只列了必需项。可选能力（`app/render.pdf` 等）由用户在设置页按需开启后再写入声明，或在首版直接不声明、后续版本追加。

### 11.3 授权矩阵（用户视角）

| 功能 | 需要授权 | 不授权时 |
|---|---|---|
| 工作台生成 + 查看 + 搜索 + 归档 | 无 | — |
| 导出 HTML 到 dataDir | 无 | — |
| 导出 HTML 到用户指定位置 | `app/resources.write` | 只能存 dataDir |
| 导出 PDF | `app/render.pdf` | 该按钮禁用并说明原因 |
| 会话内触发 | `app/tools.expose-to-model` | 该入口不可用 |
| 桌面通知 | `app/notifications.show` | 静默完成 |

---

## 12 存储与归档

### 12.1 配置项

存于 `ctx.storage.global`（宿主维护，无额外授权）：

```ts
type AppConfig = {
  provider: string | null;      // 用户选定
  model: string | null;         // 用户选定
  lang: "zh" | "en";
  maxCandidates: number;        // 默认 40
  enabledSources: string[];     // 默认全部 8 个
  windowHours: 24 | 48;         // 默认 24，不足时自动放宽
  // 开关（默认全部 false）
  enableSessionEntry: boolean;  // 入口 ②：允许在会话里触发并推送
  enableBridgePush: boolean;    // 入口 ③：允许桥会话（微信等）触发并推送
  enableDesktopNotify: boolean; // 桌面通知：仅作为「会话入口跑完后」的本地提醒，
                                // 不适用于工作台（工作台不推送，见第 3.3 节）
  keepHtmlSnapshot: boolean;    // 是否保留每期 HTML 快照
};
```

### 12.2 归档读写

- 写入：生成成功后立即写 `archive/{date}.json`，并更新索引。
- 读取：工作台左栏读索引（轻量），点某期才读该期全文（按需）。
- 删除：用户可在工作台删除某期，须二次确认。
- **索引与文件的一致性**：以文件系统为准，索引是缓存。启动时校验一次，发现不一致则以文件重建索引。

### 12.3 搜索

- 范围：标题、要点、栏目名、条目标题、点评。
- 方式：本地字符串匹配（大小写不敏感，支持多关键词与/或）。
- **不需要任何授权**，不涉及模型调用。
- 结果高亮命中词，点击跳转到该期的对应位置。

### 12.4 定时（预留，首版不做）

架构上留门：`ctx.tasks.schedule` 支持定时触发（需 Hana ≥ 0.942.0 与 `app/tasks.manage`）。首版**不实现、不声明**。若未来要做，实现要点：

- 不在 `apply` 里创建 schedule（会在每次重启时重复创建）
- 创建前先查已有 schedule，复用其 `scheduleId`
- 定时触发时没有 callToken，因此**出不了 PDF**，与工作台入口的限制相同

---

## 13 分期与验收

### 阶段一：后端管线（不出 UI）

**范围**：抓取 → 归并 → 编辑层 → 一份真 Issue，落 JSON。

**验收判据**（可对照）：

1. 8 个源中至少 **6 个**抓取成功。
2. Issue 通过第 4 章的 schema 校验（含 `schemaVersion`）。
3. 所有 `Item.url` 可回溯到候选池中的真实条目，**无一编造**。
4. 多源交叉标记非空（至少 1 条被 2 个以上源覆盖）。
5. 人工通读全文，**无逻辑断裂、无重复条目**。
6. 端到端耗时 **≤ 2 分钟**。

**产出**：一份 JSON + 一份人工通读意见。

### 阶段二：渲染器 + 工作台

**范围**：Issue → HTML，工作台整页可查看。

**验收判据**：

1. 同一个 Issue 渲染到工作台与导出 HTML，**视觉一致**（同一渲染器）。
2. 用 3 份不同结构的 Issue 测试（3 栏 / 5 栏 / 单栏），渲染均正常。
3. 缺失 `note` / `lead` / `points` 时渲染不崩。
4. 视觉符合第 8.2 节（暖纸底、蓝钢、字重 400/500、无渐变）。
5. **工作台点按钮后，无任何投递动作**：不产生会话回合、不发事件、不弹通知（对应第 3.3 节实现红线）。

### 阶段三：设置页

**范围**：供应商选择、源开关、条数上限、语言、各功能开关。

**验收判据**：

1. 供应商列表来自 `ctx.models.list()`，按 provider 分组正确。
2. 用户未选时有明确提示，且默认值有显著标注。
3. 每个开关的开启/关闭行为与第 11.3 节矩阵一致。
4. 保存失败时保留草稿（依赖宿主 settings 控件的行为）。

### 阶段四：归档 + 搜索 + PDF 导出

**范围**：按日期翻往期、搜索、HTML/PDF 导出。

**验收判据**：

1. 连续生成 3 期后，左栏按日期倒序列出 3 期。
2. 搜索能命中标题、要点、点评三类内容。
3. 导出 HTML 是**单文件**（样式内联，无外部依赖），离线可打开。
4. PDF 页数在 3~5 页，无页眉页脚，栏目起新页。
5. 删除某期后索引与文件一致。

### 阶段五：开源准备

**范围**：README、LICENSE、清理、打包。

**验收判据**：

1. 代码中**无任何**个人私有内容：无硬编码推送通道、无绝对路径、无个人域名。
2. README 含：安装步骤、授权说明、隐私声明（第 2.3 节三点）、已知限制。
3. `THIRD-PARTY-NOTICES.md` 列出依赖与许可。
4. 通过官方 `validate_app.mjs` 静态校验与 `--smoke` 启动校验。
5. 打包产物可被 `extension_manager` 正常安装。

---

## 14 未决项与风险

### 14.1 未决项

| 项 | 状态 | 说明 |
|---|---|---|
| 桥会话能否被 App 直接写入并送达 | **待实测** | 文档未明确。若成立，交付链可少一跳；若不成立，走第 3.4 节接缝。**不得在验证前写进实现当作事实** |
| 英文源标题是否翻译 | 暂定翻译 | 第 7.4 节按"译成中文、保留原文链接"写。可改 |
| ~~工作台是否需要"从会话带回 PDF"按钮~~ | **已定：不做** | 2026-10-14 定。工作台只生成查看，推送与 PDF 交付只从会话入口走。理由见第 3.3 节 |
| 归档保留策略 | 未定 | 是否设上限（如 90 期）、是否自动清理旧 HTML 快照 |

### 14.2 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模型不返回合法 JSON | 生成失败 | 第 7.3 节：`ref` 回填 + 解析失败重试一次 + 有效条目下限检查 |
| 中文源在部分网络下不稳 | 数据覆盖不足 | 第 5.5 节：单源独立失败 + 明确标注 |
| 编辑层 token 消耗超预期 | 用户成本上升 | 第 6.4 节：候选池上限 40 条；第 7.2 节：`maxTokens` 4096 |
| 动态栏目导致渲染失控 | 视觉崩坏 | 第 8.5 节：渲染器对边界情况做健壮性要求 |
| `models.stream` 的 model id 精确匹配失败 | 无法推理 | 第 9.3 节：原样传递，不归一化；设置页过滤非法 id |

---

## 15 开源准备

### 15.1 README 必含

1. 一句话介绍 + 截图（工作台）
2. 安装步骤
3. **授权说明**：每个 capability 做什么、不给会怎样（第 11.3 节矩阵）
4. **隐私声明**：抓公开数据、不接触凭证、归档只在本机
5. 已知限制：数据源稳定性、PDF 需要额外授权、动态栏目意味着每期结构不同
6. 开发说明：目录结构、如何新增数据源

### 15.2 许可证

建议 **MIT**。理由：与 Hana 生态内其他 App（如白板、office-toolkit）一致，降低使用与二次开发门槛。

### 15.3 打包与发布

1. 官方 `validate_app.mjs --dir <dir> --json` 静态校验
2. 官方 `validate-app.mjs --dir <dir> --smoke --json` 隔离启动校验
3. `pack_app.mjs --dir <dir> --publisher "<name>" --out ./dist-extensions` 打包
4. 按 Hana 市场流程提交（`registry.json` + `approvals.json`）

### 15.4 与前身 skill 的关系（须在 README 说明）

本 App 的前身是作者自用的私有 skill。**该 skill 不随本项目开源**，本项目是完全独立的重写，不复用其代码。README 中提及仅为交代设计来源。

---

## 附录 A：与前身 skill 的逐项对照

| 前身做法 | 本项目做法 | 原因 |
|---|---|---|
| 裸文本文件存期号 | `ctx.storage.global` | 不依赖绝对路径 |
| 固定目录落盘 | `dataDir` + 会话文件 | 开源无固定路径假设 |
| 无头 Chrome 打印 PDF | `render:html-to-pdf` | 宿主已有 Chromium，App 无子进程权限 |
| Agent 临场判断分栏 | 模型输出结构化 JSON | 可复现、可归档 |
| 硬编码四栏 | 栏目动态 | 格式不写死 |
| 硬编码单一推送通道 | 无通道假设 + 交付钩子 | 通道属宿主 |
| 说「日报」触发 | 工作台按钮 + 两个可选入口 | 面向陌生用户 |
| 封面图（已废弃） | 不做 | 减少依赖与授权面 |

## 附录 B：参考的既有 App

| App | 参考点 |
|---|---|
| `hana-excalidraw`（白板） | 工作台形态：`realization: "page"` + `siteNavEntry` + `functionPanel` + `detached` |
| `session-insight`（会话用量） | 设置页与工作台分离、`network.allowedHosts` 声明方式、多卡片分工 |

---

*文档结束。实现前若有与本文冲突的需求变更，应先更新本文档再动代码。*
