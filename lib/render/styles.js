/**
 * 视觉常量与样式
 *
 * 风格：瑞士国际主义（International Typographic Style）
 *   - 硬线分隔，零圆角、零阴影、零渐变
 *   - 强字号层级对比：大标题 / 小标签
 *   - 左对齐为主，小标签用大写 + 宽字距
 *
 * 颜色策略（跟随宿主主题）
 * ------------------------
 * 宿主主题在 :root 上定义 --bg / --text / --accent / --border 等变量，
 * 换主题时**变量名不变、值变**。
 *
 * 本模块用一套自己的内部变量名（--dg-*），值指向宿主变量并带静态兜底：
 *     --dg-bg: var(--bg, #FFFFFF)
 * 这样既跟随宿主，又不会和宿主变量名撞车（撞车会造成 CSS 自我引用的循环）。
 *
 * 在 Hana 里 → 跟随用户当前主题；
 * 脱离宿主（单独打开导出的 HTML）→ 用兜底值，仍是一套完整的瑞士风格。
 *
 * 注意：跟随的只有**颜色**。结构特征（硬线、字号层级、大写小标签）
 * 是风格本体，不随主题变化。
 */

export const TOKENS = {
  // 兜底配色：瑞士风格的白底黑字
  paperFallback: "#FFFFFF",
  inkFallback: "#000000",
  inkBodyFallback: "#111111",
  inkSoftFallback: "#333333",
  inkFaintFallback: "#5A5A5A",
  accentFallback: "#2E5F80",
  ruleFallback: "#000000",
  ruleSoftFallback: "#C8C8C8",

  fontStack:
    '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  monoStack: '"SF Mono", "Roboto Mono", Menlo, Consolas, monospace',

  weightNormal: 400,
  weightMedium: 500,
  weightBold: 700,

  measure: "46em",
  gutter: "22px",
};

/**
 * 宿主变量的镜像名。
 *
 * 为什么不直接引用宿主名：宿主已定义 --bg / --text / --accent 等，
 * 若我们也写 `--accent: var(--accent, 兜底)`，那是自我引用，
 * CSS 会判定为循环、整个变量失效。
 *
 * 所以镜像时把宿主的 --X 写成我们自己的 --hana-X，再由样式引用。
 * 两者名字不同，既跟随宿主又不会循环。
 */
/**
 * 宿主变量名。
 *
 * 这里写的是**宿主的真名**（--bg / --accent …），不再是镜像名。
 * 原因：镜像名 --hana-* 靠 JS 搬，而 JS 有失败可能（主题 CSS 没落地 /
 * 宿主没给 data-theme）。写成嵌套兜底 var(--hana-bg, var(--bg, 兜底)) 后：
 *   - JS 搬运成功 → 用 --hana-bg（行为不变）
 *   - JS 挂了但主题 CSS 在 → 浏览器自己就能解出宿主的 --bg
 *   - 两者都没有 → 用写死的兜底值
 * 不会自我引用：--dg-bg 与 --bg 不同名。
 */
export const HOST_VARS = {
  bg: "--bg",
  bgCard: "--bg-card",
  sidebarBg: "--sidebar-bg",
  text: "--text",
  textLight: "--text-light",
  textMuted: "--text-muted",
  accent: "--accent",
  border: "--border",
};

/** JS 搬运后的镜像名，优先级高于宿主真名 */
export const MIRROR_VARS = {
  bg: "--hana-bg",
  bgCard: "--hana-bg-card",
  sidebarBg: "--hana-sidebar-bg",
  text: "--hana-text",
  textLight: "--hana-text-light",
  textMuted: "--hana-text-muted",
  accent: "--hana-accent",
  border: "--hana-border",
};

/** 宿主真实变量名 → 我们的镜像名。theme-follow.js 按此表搬运。 */
export const HOST_VAR_MAP = {
  "--bg": "--hana-bg",
  "--bg-card": "--hana-bg-card",
  "--sidebar-bg": "--hana-sidebar-bg",
  "--text": "--hana-text",
  "--text-light": "--hana-text-light",
  "--text-muted": "--hana-text-muted",
  "--accent": "--hana-accent",
  "--border": "--hana-border",
};

/** 内部变量名（避免与宿主同名造成循环） */
export const DG = {
  bg: "--dg-bg",
  ink: "--dg-ink",
  inkBody: "--dg-ink-body",
  inkSoft: "--dg-ink-soft",
  inkFaint: "--dg-ink-faint",
  accent: "--dg-accent",
  accentSoft: "--dg-accent-soft",
  accentText: "--dg-accent-text",
  rule: "--dg-rule",
  ruleSoft: "--dg-rule-soft",
};

/** 生成变量定义块
 *
 * 跟随规则（重要）：
 *   --dg-bg / --dg-accent / --dg-rule-soft  → 跟随宿主（这是用户要的"背景+主色调跟着变"）
 *   文字系列与硬线                          → 不跟宿主具体色值，按深浅模式取高对比值
 *
 * 为什么不跟宿主 --text：宿主主题的 --text 是为了它自己的 UI 选的（例如
 * 暖纸是 #3B3D3F 深灰），拿来做正文会直接把对比度拉低。瑞士风格的高对比
 * 是风格本体，所以只跟随主题的**明暗**，不跟随它的**色值**。
 */
function varBlock() {
  const t = TOKENS;
  const H = HOST_VARS;
  const M = MIRROR_VARS;
  const D = DG;
  // 三层取值：镜像（JS 搬的）→ 宿主真名（CSS 直接解）→ 写死兜底
  const follow = (key, fallback) => `var(${M[key]}, var(${H[key]}, ${fallback}))`;
  return `
${D.bg}:        ${follow("bg", t.paperFallback)};
${D.accent}:    ${follow("accent", t.accentFallback)};
${D.ruleSoft}:  ${follow("border", t.ruleSoftFallback)};
${D.ink}:        ${t.inkFallback};
${D.inkBody}:    ${t.inkBodyFallback};
${D.inkSoft}:    ${t.inkSoftFallback};
${D.inkFaint}:   ${t.inkFaintFallback};
${D.rule}:       ${t.ruleFallback};
/* 强调色浅底由 accent 自身派生，不依赖宿主额外定义 */
${D.accentSoft}: color-mix(in srgb, var(${D.accent}) 12%, transparent);
/* 用作**文字**的强调色：向高对比的 --ink 混合，保证小字也能读。
 * 宿主主色本身不保证与背景有足够对比（暖纸的 #537D96 上 #F8F4ED 只有约 4.0:1）。
 * --ink 已经按明暗取定高对比值，混过去就等于有了地板，纯 CSS 实现。
 * 线条与按钮背景仍用原色 --accent，不混。*/
${D.accentText}: color-mix(in srgb, var(${D.accent}) 70%, var(${D.ink}));`;
}

/**
 * 深色模式覆盖。由 theme-follow.js 根据宿主 --bg 的亮度写 data-color-mode。
 * 文字与硬线整体反转为高对比白字；背景仍用宿主值。
 */
function darkModeBlock() {
  const t = TOKENS;
  const D = DG;
  return `
:root[data-color-mode="dark"] {
  ${D.ink}:        #FFFFFF;
  ${D.inkBody}:    #F2F2F2;
  ${D.inkSoft}:    #D6D6D6;
  /* 弱化档不能拍脑袋：青夜深底 #3B4A54 上，#A8A8A8 只有 3.85:1，
     不达 WCAG AA 的 4.5。#C2C2C2 为 5.14:1。 */
  ${D.inkFaint}:   #C2C2C2;
  ${D.rule}:       #FFFFFF;
  ${D.accentSoft}: color-mix(in srgb, var(${D.accent}) 22%, transparent);
}
`;
}

/**
 * 页面级 CSS：只在独立文档（HTML 导出 / PDF 打印）里使用。
 * 嵌入模式（工作台）绝不能用这部分——它会污染宿主页面。
 */
export function pageCss() {
  const t = TOKENS;
  const D = DG;
  return `
:root {${varBlock()}
}${darkModeBlock()}
html, body {
  margin: 0;
  padding: 0;
  background: var(${D.bg});
  color: var(${D.inkBody});
  font-family: ${t.fontStack};
  font-weight: ${t.weightNormal};
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.wrap {
  max-width: ${t.measure};
  margin: 0 auto;
  padding: 48px ${t.gutter} 64px;
}
`;
}

/** 内容级 CSS。三种形态共用，不含页面级规则。 */
export function baseCss() {
  const t = TOKENS;
  const D = DG;
  return `
:root {${varBlock()}
}${darkModeBlock()}
* { box-sizing: border-box; }

/* ---------- 报头 ---------- */
.masthead { border-bottom: 4px solid var(${D.rule}); padding-bottom: 20px; margin-bottom: 32px; }
.masthead h1 {
  font-size: 46px; font-weight: ${t.weightBold}; letter-spacing: -0.034em;
  margin: 0 0 14px; line-height: 0.98; color: var(${D.ink});
}
.masthead .meta {
  display: flex; flex-wrap: wrap; gap: 5px 24px;
  font-size: 12.5px; font-weight: ${t.weightBold}; letter-spacing: .1em;
  text-transform: uppercase; color: var(${D.inkFaint});
}
.masthead .meta .issue { color: var(${D.accentText}); }

/* ---------- 源覆盖 ---------- */
.sources {
  display: flex; flex-wrap: wrap; gap: 0;
  margin: 0 0 38px; border-bottom: 1px solid var(${D.ruleSoft});
}
.sources .chip {
  font-size: 12px; font-weight: ${t.weightBold}; letter-spacing: .05em;
  padding: 9px 0; margin-right: 20px;
  color: var(${D.inkBody});
  border-bottom: 2px solid var(${D.rule});
  margin-bottom: -1px;
}
.sources .chip.fail {
  color: var(${D.inkFaint});
  border-bottom-color: transparent;
  text-decoration: line-through;
}
.sources .chip .n { color: var(${D.inkFaint}); margin-left: 6px; }

/* ---------- 今日要点 ---------- */
.highlights {
  border-left: 7px solid var(${D.accent});
  padding: 6px 0 6px 28px; margin-bottom: 46px;
}
.highlights h2 {
  font-size: 12px; font-weight: ${t.weightBold}; letter-spacing: .15em;
  text-transform: uppercase; color: var(${D.accentText}); margin: 0 0 20px;
}
.highlights ol { margin: 0; padding-left: 0; list-style: none; counter-reset: hl; }
.highlights li {
  counter-increment: hl;
  position: relative; padding-left: 42px;
  margin: 0 0 16px; line-height: 1.6; font-size: 18px;
  color: var(${D.ink}); font-weight: ${t.weightMedium};
}
.highlights li::before {
  content: counter(hl, decimal-leading-zero);
  position: absolute; left: 0; top: 4px;
  font-size: 13.5px; font-weight: ${t.weightBold}; letter-spacing: .02em;
  color: var(${D.accentText});
}
.highlights li:last-child { margin-bottom: 0; }

/* ---------- 栏目 ---------- */
.section { margin-bottom: 50px; }
.section > h2 {
  font-size: 29px; font-weight: ${t.weightBold}; color: var(${D.ink});
  margin: 0 0 0; padding: 18px 0 14px;
  border-top: 3px solid var(${D.rule});
  line-height: 1.12; letter-spacing: -0.026em;
}
.section .lead {
  font-size: 16px; color: var(${D.inkSoft});
  margin: 0 0 26px; padding: 15px 0 0;
  border-top: 1px solid var(${D.ruleSoft});
  line-height: 1.66;
}

/* ---------- 条目 ---------- */
.item { margin-bottom: 30px; break-inside: avoid; }
.item .title {
  font-size: 19.5px; font-weight: ${t.weightBold}; color: var(${D.ink});
  line-height: 1.34; margin: 0 0 7px; letter-spacing: -0.016em;
}
.item .title a { color: var(${D.ink}); text-decoration: none; }
.item .title a:hover { color: var(${D.accent}); }
.item .badges { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 10px; }
.item .badge {
  font-size: 11.5px; font-weight: ${t.weightBold}; letter-spacing: .09em;
  text-transform: uppercase; color: var(${D.inkSoft});
  border-bottom: 1px solid var(${D.ruleSoft}); padding-bottom: 2px;
}
.item .badge.cross { color: var(${D.accentText}); border-bottom-color: var(${D.accent}); }
.item .note {
  font-size: 17.5px; line-height: 1.76; color: var(${D.inkBody}); margin: 0;
}

/* ---------- 收尾 ---------- */
.closing {
  margin-top: 56px; padding-top: 28px;
  border-top: 4px solid var(${D.rule});
  font-size: 18px; line-height: 1.76; color: var(${D.ink});
  font-weight: ${t.weightMedium};
}
.closing .label {
  font-size: 12px; font-weight: ${t.weightBold}; letter-spacing: .15em;
  text-transform: uppercase; color: var(${D.accentText});
  display: block; margin-bottom: 16px;
}

/* ---------- 页脚 ---------- */
.foot {
  margin-top: 44px; padding-top: 18px;
  border-top: 1px solid var(${D.ruleSoft});
  font-size: 12.5px; color: var(${D.inkFaint}); line-height: 1.7;
  letter-spacing: .02em;
}

/* ---------- 空态 ---------- */
.empty {
  padding: 60px 0; text-align: left; color: var(${D.inkFaint}); font-size: 14px;
}
`;
}

/** 打印适配。PDF 走这里，不另写模板。 */
export function printCss() {
  return `
@page { size: A4; margin: 16mm 15mm 14mm; }
html, body { background: #fff; color: #000; }
.wrap { max-width: none; padding: 0; }
.section { break-before: page; }
.section:first-of-type { break-before: auto; }
.masthead { break-after: avoid; }
.highlights { break-inside: avoid; }
.item { break-inside: avoid; }
.closing { break-inside: avoid; }
a { color: inherit; text-decoration: none; }
`;
}
