/**
 * 宿主主题跟随（工作台 / 设置页 / 功能面板共用）
 *
 * 背景
 * ----
 * 宿主主题把变量写在 `[data-theme="midnight"]` 这类选择器里。要让 App 页面
 * 拿到这些值，必须同时满足两件事：
 *   1. 那份主题 CSS 存在于本文档
 *   2. 本文档的 <html> 上有对应的 data-theme 属性
 *
 * SDK 两件都不保证：它只在收到 THEME_CHANGED 事件时注入 CSS（首屏不注入），
 * 也不设 data-theme。所以早期版本的"读 computed style 再搬运"在真实宿主里
 * 永远读不到值，页面停在兜底白底上 —— 本地预览是手工注入变量测的，
 * 把这个洞完整盖住了，四十二项对比度"达标"因此是假的。
 *
 * 现在的做法（按可靠性排序，不依赖单一时序）
 *   A. 立刻用 URL 参数同步出 data-theme 与明暗 —— SDK 已在 iframe URL 上带
 *      hana-theme / hana-theme-appearance，读它不需要等任何异步事件。
 *   B. 用 <link> 把主题 CSS 拉进本文档。<link> 不受 CORS 与 sandbox 限制，
 *      比 fetch + <style> 更稳；选择器有 A 的 data-theme 就能命中。
 *   C. 样式本身写成 var(--hana-x, var(--bg, 兜底)) —— 即使 JS 全挂，
 *      只要主题 CSS 落地，浏览器自己就能解析出宿主色。JS 只是加一层
 *      显式镜像（--hana-*）与明暗判定。
 *
 * 注意：只有**背景、卡片底、侧栏底、主色、分隔线**跟随宿主。**文字色不跟随**
 * 具体值，而是按背景明暗取高对比的黑/白——主题的 --text 是为它自己的 UI 选的
 * （暖纸是深灰 #3B3D3F），直接拿来做长文正文会把对比度拉回去。
 */

import { applyColorMode, colorModeOf, onAccentColor } from "./theme-mode.js";

/** 宿主真实变量名 → 我们的镜像名 */
const MIRROR_MAP = {
  "--bg": "--hana-bg",
  "--bg-card": "--hana-bg-card",
  "--sidebar-bg": "--hana-sidebar-bg",
  "--text": "--hana-text",
  "--text-light": "--hana-text-light",
  "--text-muted": "--hana-text-muted",
  "--accent": "--hana-accent",
  "--border": "--hana-border",
};

const HOST_NAMES = Object.keys(MIRROR_MAP);

const LINK_ID = "hana-theme-link";

/** 从 iframe URL 上读宿主告知的主题信息（不需要等异步） */
function readFromUrl() {
  try {
    const p = new URLSearchParams(location.search);
    const ap = p.get("hana-theme-appearance");
    return {
      theme: p.get("hana-theme") || "",
      cssUrl: p.get("hana-css") || "",
      appearance: ap === "light" || ap === "dark" ? ap : "",
    };
  } catch {
    return { theme: "", cssUrl: "", appearance: "" };
  }
}

/**
 * 从宿主窗口直接拿主题 id / 主题表 URL。
 *
 * 为什么需要这一层：整个跟随建立在“本文档上有 data-theme”之上，
 * 而 URL 参数是宿主可选行为。拿不到参数时不能直接退回兜底值，
 * 得去真正持有主题的那个文档上读。跨 frame 读不到就当作没有。
 */
function readFromHostWindow() {
  const out = { theme: "", cssUrl: "" };
  try {
    const host = window.parent && window.parent !== window ? window.parent : null;
    if (!host) return out;
    const root = host.document?.documentElement;
    if (!root) return out;
    out.theme = root.getAttribute("data-theme") || "";
    // 不读宿主的 matchMedia：那是**系统深浅偏好**，不等于宿主选的主题。
    // 青夜是深色但系统可以偏好 light，拿它定明暗会判反。
    // 明暗只从 URL 参数或背景亮度算（见 syncColorMode）。
    const link = host.document?.querySelector?.("link[rel=stylesheet][href*=theme]");
    if (link?.href) out.cssUrl = link.href;
  } catch {
    // 跨域 frame 读不到，正常，当作没有
  }
  return out;
}

/**
 * 主题快照里挑出当前该用的那套。
 * 主题自带深浅双调色板时按 appearance 选。
 */
function pickPalette(snap) {
  const p = snap?.palettes;
  if (snap?.appearance === "dark" && p?.dark?.cssUrl) return p.dark;
  if (snap?.appearance === "light" && p?.light?.cssUrl) return p.light;
  return { theme: snap?.theme, cssUrl: snap?.cssUrl };
}

/** 用 <link> 载入主题 CSS；同一 href 不重复插入 */
function ensureThemeStylesheet(cssUrl) {
  if (!cssUrl) return;
  let link = document.getElementById(LINK_ID);
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== cssUrl) {
    link.setAttribute("href", cssUrl);
  }
}

/** 读本文档 :root 上的宿主变量 */
function readHostVars() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  let n = 0;
  for (const name of HOST_NAMES) {
    const v = cs.getPropertyValue(name).trim();
    if (v) {
      out[name] = v;
      n++;
    }
  }
  return { vars: out, count: n };
}

/** 把宿主值镜像到 --hana-*（写 inline，优先级最高） */
function writeMirror(vars) {
  const root = document.documentElement;
  for (const [hostName, mirrorName] of Object.entries(MIRROR_MAP)) {
    const v = vars[hostName];
    if (v) root.style.setProperty(mirrorName, v);
  }
}

/** 按背景明暗写 data-color-mode，并算主按钮上的反色 */
function syncColorMode() {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--hana-bg").trim() || cs.getPropertyValue("--bg").trim();
  const accent = cs.getPropertyValue("--hana-accent").trim() || cs.getPropertyValue("--accent").trim();
  const mode = bg ? applyColorMode(bg, accent) : null;
  // 拿不到宿主背景时也别留脏属性
  if (!mode && !document.documentElement.dataset.colorMode) {
    document.documentElement.dataset.colorMode = "light";
  }
  return mode;
}

/**
 * 搬运一次。
 * @returns {number} 读到的宿主变量个数
 */
function syncOnce() {
  writeMirror(readHostVars().vars);
  syncColorMode();
  return readHostVars().count;
}

/** 主题 CSS 是异步落地的，落地前后各读一次；再多试几帧防重排 */
function syncWithRetry(times = 6, gapMs = 120) {
  let done = 0;
  const step = () => {
    const n = syncOnce();
    if (n >= HOST_NAMES.length || ++done >= times) return;
    setTimeout(step, gapMs);
  };
  step();
}

/**
 * 把诊断回传给 App 侧日志。
 *
 * 本地看不到真实宿主，只能让页面自己说。路径与凭证头必须跟
 * workbench.html 的 api() 一致：宿主的路由挂在
 * /api/apps/cyber-newspaper/routes 下，并要求 X-Hana-App-Surface-Session，
 * 缺前缀或缺头都会 403。
 */
function reportDiag(info) {
  try {
    const ss = new URLSearchParams(location.search).get("appSurfaceSession");
    void fetch("/api/apps/cyber-newspaper/routes/api/digest/theme-probe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ss ? { "X-Hana-App-Surface-Session": ss } : {}),
      },
      body: JSON.stringify(info),
      credentials: "same-origin",
    }).catch(() => {});
  } catch {}
}

/**
 * 启动主题跟随。在 hana.ready() 之后调用。
 * @param {object} hana SDK 实例
 */
export function followHostTheme(hana) {
  // A. 先吃 URL 参数：同步、不等异步，先把 data-theme 钉上
  const urlInfo = readFromUrl();
  // URL 没带就读宿主窗口，两层都没有才允许退回兜底
  const hostInfo = urlInfo.theme ? { theme: "", cssUrl: "" } : readFromHostWindow();
  const themeId = urlInfo.theme || hostInfo.theme || "";
  const cssUrl = urlInfo.cssUrl || hostInfo.cssUrl || "";

  if (themeId) {
    document.documentElement.dataset.theme = themeId;
    if (document.body) document.body.dataset.theme = themeId;
  }
  const appearance = urlInfo.appearance || "";
  if (appearance) {
    document.documentElement.dataset.colorMode = appearance;
  }
  if (cssUrl) ensureThemeStylesheet(cssUrl);

  const apply = (snap) => {
    const picked = pickPalette(snap);
    const tid = picked?.theme || themeId;
    if (tid) {
      document.documentElement.dataset.theme = tid;
      if (document.body) document.body.dataset.theme = tid;
    }
    ensureThemeStylesheet(picked?.cssUrl || cssUrl);

    // B/C. CSS 落地有先后，读不到就再试
    syncWithRetry();
    if (picked?.cssUrl || cssUrl) {
      const link = document.getElementById(LINK_ID);
      link?.addEventListener?.("load", () => syncOnce(), { once: true });
    }

    reportDiag({
      where: "followHostTheme",
      page: location.pathname.split("/").pop() || "?",
      themeFrom: urlInfo.theme ? "url" : hostInfo.theme ? "hostWindow" : snap?.theme ? "snapshot" : "none",
      urlTheme: urlInfo.theme,
      urlCss: urlInfo.cssUrl,
      hostCss: hostInfo.cssUrl || null,
      snapTheme: picked?.theme || null,
      dataTheme: document.documentElement.dataset.theme || null,
      mode: document.documentElement.dataset.colorMode || null,
      hostVars: readHostVars().count,
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || null,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || null,
      mirrorBg: getComputedStyle(document.documentElement).getPropertyValue("--hana-bg").trim() || null,
      // 这一项才是真正决定背面的值
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || null,
      themeLink: document.getElementById(LINK_ID)?.getAttribute("href") || null,
    });
  };

  try {
    const snap = hana?.theme?.getSnapshot?.();
    apply(snap);
    hana?.theme?.subscribe?.(apply);
  } catch {
    // 完全拿不到 SDK 时仍尽力搬一次
    ensureThemeStylesheet(cssUrl);
    syncWithRetry();
  }

  // 系统深浅切换时兜底重算
  try {
    window
      .matchMedia?.("(prefers-color-scheme: dark)")
      ?.addEventListener?.("change", () => syncWithRetry(2));
  } catch {}
}

export { MIRROR_MAP, colorModeOf, onAccentColor };
