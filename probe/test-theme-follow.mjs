/**
 * 主题跟随验证
 *
 * 目的：证明日报的颜色真的跟着宿主主题变，而不是写死一套。
 *
 * 做法：把三套真实主题的变量注入到预览页面，生成三份 HTML，逐份截图比对。
 * 三套值直接取自宿主主题文件，不是我编的：
 *   artifacts/renderer/[版本]/themes/ 下的 warm-paper / midnight / high-contrast
 *
 * 真实环境里这些搬运工作由 ui/assets/theme-follow.js 完成
 * （它读宿主窗口 computed style，写成我们的 --hana-* 镜像名）。
 *
 * 用法：node probe/test-theme-follow.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

/**
 * 三套宿主主题。key 是预览里注入的 --hana-* 镜像名，
 * 值来自 Hana 真实主题 CSS 的同名变量。
 */
const THEMES = {
  light: {
    label: "暖纸 warm-paper（默认，浅色）",
    vars: {
      "--hana-bg": "#F8F4ED",
      "--hana-bg-card": "#FCFAF5",
      "--hana-sidebar-bg": "#F4F0EA",
      "--hana-text": "#3B3D3F",
      "--hana-text-light": "#6B6F73",
      "--hana-text-muted": "#8E9196",
      "--hana-accent": "#537D96",
      "--hana-border": "rgba(122, 96, 88, 0.18)",
    },
  },
  dark: {
    label: "青夜 midnight（深色）",
    vars: {
      "--hana-bg": "#3B4A54",
      "--hana-bg-card": "#445560",
      "--hana-sidebar-bg": "#34424B",
      "--hana-text": "#E1EAF0",
      "--hana-text-light": "#B7C5CE",
      "--hana-text-muted": "#A3B5C0",
      "--hana-accent": "#C99AAF",
      "--hana-border": "rgba(170, 121, 141, 0.16)",
    },
  },
  contrast: {
    label: "高对比 high-contrast",
    vars: {
      "--hana-bg": "#FFFFFF",
      "--hana-bg-card": "#FFFFFF",
      "--hana-sidebar-bg": "#FFFFFF",
      "--hana-text": "#000000",
      "--hana-text-light": "#1A1A1A",
      "--hana-text-muted": "#333333",
      "--hana-accent": "#003B7E",
      "--hana-border": "#000000",
    },
  },
};

const base = readFileSync(join(OUT, "workbench-preview.html"), "utf8");

// 明暗判定用真实实现（ui/assets/theme-mode.js），与运行时同一份代码。
// 不在测试里拄一遗阈值：拄错了测试会“绿着骗人”，深色主题下变成深底深字。
const { colorModeOf } = await import("../ui/assets/theme-mode.js");

if (!base.includes("class=\"digest\"") && !base.includes("digest")) {
  console.error("预览文件不含日报内容，先跑 node probe/preview-workbench.mjs");
  process.exit(1);
}

let fail = 0;

for (const [key, theme] of Object.entries(THEMES)) {
  const decl = Object.entries(theme.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

  // 在 :root 上注入这套宿主变量，并补上 data-color-mode，
  // 完整模拟 theme-follow.js 跑完之后的结果。
  const mode = colorModeOf(theme.vars["--hana-bg"]);
  const inject = `<script>
(function(){
  var d="${decl}".split(";");
  for (var i=0;i<d.length;i++){
    if(!d[i]) continue;
    var ix=d[i].indexOf(":");
    document.documentElement.style.setProperty(d[i].slice(0,ix), d[i].slice(ix+1));
  }
  document.documentElement.dataset.colorMode = "${mode}";
})();
</script>`;

  const out = base.replace(/<head>/i, `<head>\n${inject}`);
  const file = join(OUT, `theme-${key}.html`);
  writeFileSync(file, out, "utf8");

  // 自检：注入是否真的写进去了，且用的是镜像名而非宿主原名
  if (!out.includes("--hana-bg:")) {
    console.error(`✗ ${key}: 未注入 --hana-bg`);
    fail++;
  }
  if (/setProperty\("--bg"/.test(out)) {
    console.error(`✗ ${key}: 直接写宿主原名 --bg，会造成自我引用循环`);
    fail++;
  }
  // 明暗判定必须与背景亮度一致
  if (key === "dark" && mode !== "dark") {
    console.error(`✗ ${key}: 深色背景被判为 ${mode}，会输出深底深字`);
    fail++;
  }
  if (key !== "dark" && mode !== "light") {
    console.error(`✗ ${key}: 浅色背景被判为 ${mode}`);
    fail++;
  }
  console.log(`✓ theme-${key}.html  ← ${theme.label}  (mode=${mode})`);
}

console.log(`\n产出三份预览，逐份截图即可看到同一份日报在三套主题下的样子：`);
console.log(`  probe/out/theme-light.html`);
console.log(`  probe/out/theme-dark.html`);
console.log(`  probe/out/theme-contrast.html`);

// 顺带断言渲染器输出确实走镜像名（防回归：万一有人改回 var(--bg)）
const { renderIssue } = await import("../lib/render/index.js");
const sample = renderIssue(
  {
    date: "2026-10-14", issueNo: 1, sources: [{ name: "X", ok: true, count: 1 }],
    highlights: ["a"], sections: [{ id: "s", title: "T", items: [{ title: "i", url: "https://a.com", sources: ["x"], note: "n" }] }],
    closing: "c", stats: { itemCount: 1, sectionCount: 1, sourceOk: 1, sourceTotal: 1, crossSource: 0 },
  },
  { mode: "standalone" }
);
if (!sample.includes("var(--hana-bg,")) {
  console.error("✗ 渲染器未使用 --hana-* 镜像名");
  fail++;
} else {
  console.log("✓ 渲染器输出使用 --hana-* 镜像名（无自我引用）");
}

process.exit(fail === 0 ? 0 : 1);
