/**
 * 验证「装进本机的那一版」到底是不是最新的、修复在不在里面。
 *
 * 为什么单独查这个：安装成功不等于装的是修好的代码。
 * 本项目真发生过「改了源码没打包、对面反复测旧版」—— 所以每次装完都该跑一次。
 *
 * 路径全部从环境变量与本文件位置推导，不写死：这脚本会随仓库公开，
 * 写死就把开发者的家目录形状带出去了。
 *
 * 用法：node probe/verify-installed.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.HANA_HOME || join(process.env.USERPROFILE || process.env.HOME, ".hanako");
const APP = join(HOME, "apps", "cyber-newspaper");

if (!existsSync(join(APP, "manifest.json"))) {
  console.error(`✗ 本机没装本 App：${APP}`);
  process.exit(1);
}

const srcManifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const instManifest = JSON.parse(readFileSync(join(APP, "manifest.json"), "utf8"));
const src = readFileSync(join(ROOT, "index.js"), "utf8");
const inst = readFileSync(join(APP, "index.js"), "utf8");

// 只看代码，不看注释：源码里本来就该留着「为什么不能这么写」的解释
const codeOf = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

let fail = 0;
const t = (label, cond, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fail++;
};

console.log("=== 版本对齐 ===");
console.log(`  源码 ${srcManifest.version}   已装 ${instManifest.version}`);
t("已装的版本号与源码一致", srcManifest.version === instManifest.version);

console.log("\n=== 修复与新增能力是否真进了已装的包 ===");
const present = [
  ["HTTP 状态检查", /response\.ok === false/],
  ["透传状态码文案", /模型调用失败：HTTP/],
  ["空正文诊断", /模型返回空正文/],
  ["logger 由参数传入", /label = "", log = null/],
  ["瞬时故障判别函数", /function isTransientError/],
  ["带重试的流调用", /function streamWithTransientRetry/],
  ["编辑层真的走重试", /await streamWithTransientRetry\(/],
];
for (const [name, re] of present) t(`${name}（已装）`, re.test(inst));

console.log("\n=== 旧的坏写法是否已消失 ===");
const gone = [
  ["悬空的 sdkLog 调用", /\bsdkLog\s*[?]?\s*\(/],
  ["done 分支被短路（双 else-if）", /else if \(ev\.type === "done" && !out\)/],
  ["不检查状态码就读流", /async function collectStreamText\(response\) \{/],
  ["编辑层裸调 models.stream（无重试）", /const response = await sdk\.models\.stream/],
];
for (const [name, re] of gone) t(`${name}（已装）`, !re.test(codeOf(inst)));

console.log("\n=== 已装代码与源码是否逐字一致 ===");
const hs = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
t("index.js 内容一致", hs(src) === hs(inst), `${hs(src)} vs ${hs(inst)}`);

console.log(fail === 0 ? "\n✓ 本机装的就是最新版，修复到位" : `\n✗ ${fail} 项不对，本机装的不是最新代码`);
process.exit(fail ? 1 : 0);
