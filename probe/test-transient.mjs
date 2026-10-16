/**
 * 验证瞬时故障判别的边界：该重试的要重试，不该重试的别浪费额度。
 *
 * 为什么单独测：重试逻辑的代价是不对称的 ——
 *   漏判：网关抽风时整次生成白 abort，用户得手动再点。
 *   误判：对"provider 不合规""输入超长"这类硬错反复重试，白烧额度和时间。
 * 两边都贵，所以两边都要断言。
 *
 * 用法：node probe/test-transient.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "..", "index.js"), "utf8");

// 把判别用的三段按文本取出来单测：整个 index.js 是 App 入口，顶层要 import 宿主 sdk，
// 直接 import 会失败，所以只抠这几个纯函数。
function pick(start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`找不到 ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`找不到 ${start} 的结束`);
  return src.slice(i, j + end.length);
}

const body = [
  pick("const TRANSIENT = new RegExp(", ");"),
  pick("const FATAL =", ";"),
  pick("function isTransientError", "\n}"),
].join("\n");

const { isTransientError } = new Function(`${body}; return { isTransientError };`)();

let pass = 0;
let fail = 0;
const t = (label, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
};
const err = (code, message) => ({ code, message });

console.log("=== 应当重试（瞬时故障）===");
// 两条真实报错的形状，逐字来自界面截图
t(
  "502 Bad Gateway + upstream base stream timeout",
  isTransientError(
    err("HTTP_ERROR", "[HTTP_ERROR]: 502 Bad Gateway\n供应商返回：{\"error\":{\"message\":\"upstream base stream timeout\",\"type\":\"server_error\"}}")
  )
);
t(
  "500 Internal Server Error + upstream stream timeout",
  isTransientError(
    err("HTTP_ERROR", "[HTTP_ERROR]: 500 Internal Server Error\n供应商返回：{\"error\":{\"message\":\"upstream base stream timeout\",\"type\":\"server_error\",\"code\":\"upstream_base_timeout\"}}")
  )
);
t("429 限流", isTransientError(err("rate_limited", "429 Too Many Requests")));
t("503 服务不可用", isTransientError(err("", "503 Service Unavailable")));
t("504 网关超时", isTransientError(err("", "504 Gateway Timeout")));
t("overloaded", isTransientError(err("", "model is temporarily overloaded")));
t("连接被重置", isTransientError(err("", "fetch failed: ECONNRESET")));
t("纯 timeout 字样", isTransientError(err("", "request timed out")));

console.log("\n=== 不该重试（硬错）===");
t("provider 非 ASCII（宿主机器话）", !isTransientError(err("", "provider must be 1-128 ASCII identifier characters.")));
t("能力未授权", !isTransientError(err("APP_CAPABILITY_DENIED", "capability not granted")));
t("模型不存在", !isTransientError(err("", "invalid model: some/deepseek-x")));
t("401 未授权", !isTransientError(err("", "401 Unauthorized")));
t("403 越权", !isTransientError(err("", "forbidden: no permission")));
// 这条是重点：文本里带 "upstream"，但是 400 输入超长，重试必然再撞
t(
  "上游 400 InvalidParameter（输入超长）",
  !isTransientError(
    err("", "Error in upstream response: <400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 983616]")
  )
);

console.log("\n=== 边界与陷阱 ===");
t("null 不炸", !isTransientError(null));
t("undefined 不炸", !isTransientError(undefined));
t("字符串入参也能判", isTransientError("502 Bad Gateway"));
t("裸数字 500 不误判（「最多 500 字」）", !isTransientError(err("", "输出请控制在 500 字以内")));
t("裸数字 429 单独出现在文案里不算", !isTransientError(err("", "共 429 条候选")));
t("瞬时与硬错同时出现时按硬错（FATAL 优先）", !isTransientError(err("", "502 but provider must be 1-128 ASCII identifier characters")));

console.log(`\n${fail === 0 ? "✓" : "✗"} 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
