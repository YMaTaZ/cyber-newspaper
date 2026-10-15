/**
 * 深浅模式判定与主题换算（theme-follow.js、预览、测试共用一份实现）
 *
 * 为什么抽出来：预览和测试如果各抄一套判定，抄错了照样全绿。
 * 这个坑真踩过——本地预览用手工注入的变量测对比度，
 * 而真实宿主里跟随代码根本没跑起来，42 项"达标"是假的。
 *
 * 日报的跟随策略：
 *   跟随宿主 —— 背景、卡片底、侧栏底、主色、分隔线
 *   不跟随   —— 文字色。宿主主题的 --text 是为它自己的 UI 选的（暖纸是深灰
 *              #3B3D3F），拿来做长文正文会直接把对比度拉下去。
 *              文字按宿主背景的明暗取高对比的黑/白。
 */

/** 解析 #rgb / #rrggbb / rgb() / rgba() → [r,g,b]，失败返回 null */
export function parseRgb(v) {
  const raw = String(v || "").trim();
  let m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = raw.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
  m = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [+m[1], +m[2], +m[3]];
  // color(srgb R G B)：Chrome 对 color-mix() 计算值用的记法，通道是 0~1
  m = raw.match(/^color\(\s*srgb\s+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
  return null;
}

/** sRGB 通道线性化 */
function linearize(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（0~1） */
export function relLum(rgb) {
  if (!rgb) return null;
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

/** 粗略感知亮度（0~255），只用于明暗分流，不用于对比度判定 */
export function luminance(rgb) {
  if (!rgb) return null;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** WCAG 对比度 */
export function contrastRatio(aRgb, bRgb) {
  const la = relLum(aRgb), lb = relLum(bRgb);
  if (la === null || lb === null) return 0;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 亮度阈值：低于此值算深色背景 */
export const DARK_THRESHOLD = 145;

/**
 * 由背景色判断该用哪套文字。
 * @param {string} bg 背景色（#hex / rgb() / color(srgb …)）
 * @returns {"dark" | "light" | null}
 */
export function colorModeOf(bg) {
  const lum = luminance(parseRgb(bg));
  if (lum === null) return null;
  return lum < DARK_THRESHOLD ? "dark" : "light";
}

/**
 * 主色背景上该用白字还是黑字。
 *
 * 为什么不用亮度阈值判：早期版本拍了个 150，那是没有依据的数字，
 * 中间调上会选错。现在直接算黑/白各自与主色的对比度，取更高的一边。
 *
 * @param {string} accent 宿主主色
 * @returns {"#FFFFFF" | "#000000"}
 */
export function onAccentColor(accent) {
  const rgb = parseRgb(accent);
  if (!rgb) return "#FFFFFF";
  const white = contrastRatio(rgb, [255, 255, 255]);
  const black = contrastRatio(rgb, [0, 0, 0]);
  return white >= black ? "#FFFFFF" : "#000000";
}

/**
 * 把判定写到文档上：data-color-mode 与 --on-accent。
 * @param {string} bg 宿主背景色
 * @param {string} [accent] 宿主主色
 * @returns {"dark" | "light" | null}
 */
export function applyColorMode(bg, accent) {
  const mode = colorModeOf(bg);
  if (!mode) return null;
  const root = document.documentElement;
  root.dataset.colorMode = mode;
  if (document.body) document.body.dataset.colorMode = mode;
  if (accent) root.style.setProperty("--on-accent", onAccentColor(accent));
  return mode;
}
