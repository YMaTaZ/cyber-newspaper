/**
 * 页面脚本语法检查：把每个 HTML 里的 module script 抽出来编译一遍。
 * 用法：node probe/check-ui.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const files = ["ui/workbench.html", "ui/settings.html", "ui/status.html"];

let bad = 0;
const tmp = mkdtempSync(join(tmpdir(), "ui-check-"));

for (const f of files) {
  const h = readFileSync(f, "utf8");
  const m = h.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) {
    console.log(`SKIP ${f}（没有 module script）`);
    continue;
  }
  const js = m[1];
  // 用动态 import 检查语法：写到临时 .mjs，把 import 指向真实文件
  const tmpFile = join(tmp, f.replace(/[\\/]/g, "_") + ".mjs");
  const toUrl = (spec) => {
    const abs = join(process.cwd(), "ui", spec.replace(/^\.\//, ""));
    return pathToFileURL(abs).href;
  };
  // 把相对 import 换成绝对路径（theme-follow.js 用到 hana 参数，语法检查阶段不执行）
  const rewritten = js.replace(/from\s+["']((?:\.\/assets|\.\/)[^"']+)["']/g, (full, spec) => {
    try { return `from "${toUrl(spec)}"`; } catch { return full; }
  });
  writeFileSync(tmpFile, rewritten, "utf8");
  try {
    await import(pathToFileURL(tmpFile).href);
    console.log(`OK   ${f}  ${js.length} 字符`);
  } catch (e) {
    if (e instanceof SyntaxError) {
      bad++;
      console.log(`FAIL ${f} → ${e.message}`);
    } else {
      console.log(`OK   ${f}  ${js.length} 字符（语法通过，运行时错误已忽略：${String(e.message).slice(0, 50)}）`);
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

// 顺带检查 HTML 标签是否闭合
console.log("\n--- 标签平衡 ---");
for (const f of files) {
  const h = readFileSync(f, "utf8");
  const open = (h.match(/<script/g) || []).length;
  const close = (h.match(/<\/script>/g) || []).length;
  const divOpen = (h.match(/<div/g) || []).length;
  const divClose = (h.match(/<\/div>/g) || []).length;
  console.log(`${f}: script ${open}/${close}  div ${divOpen}/${divClose}`);
}

process.exit(bad === 0 ? 0 : 1);
