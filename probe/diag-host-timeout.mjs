/**
 * 查宿主日志里有没有「app 路由调用超时」的痕迹。
 *
 * 为什么要查这个：归档里有 17:31:13 生成成功的 NO.003，界面却报
 * HTTP 500 Internal Server Error。宿主用的是 Hono 默认错误处理，
 * 那条 500 是纯文本、不带原因。两种可能：
 *   ① 我的路由抛了未捕获异常
 *   ② 宿主等不及，先断了连接
 * 我每个路由都有 try/catch 且失败必写日志，日志里却没有 app 错误 ——
 * 那 ① 说不通。找 ② 的直接证据。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOGDIR = "C:/Users/20769/.hanako/logs";
const files = readdirSync(LOGDIR)
  .filter((f) => /^2026-10-16.*\.log$/.test(f))
  .sort();

const PATTERNS = [
  ["超时", /timed out|timeout|RPC_TIMEOUT|超时/i],
  ["routes.fetch", /routes\.fetch|CallbackRoutesFetch/i],
  ["app 路由", /app-route|appRoute/i],
  ["app 错误", /\[cyber-newspaper\].*(?:ERROR|WARN|failed)/i],
];

for (const f of files) {
  const text = readFileSync(join(LOGDIR, f), "utf8");
  const lines = text.split(/\r?\n/);
  console.log(`=== ${f}（${lines.length} 行）===`);
  for (const [label, re] of PATTERNS) {
    const hits = lines.filter((l) => re.test(l));
    console.log(`  ${label.padEnd(14)} ${hits.length} 条`);
    for (const h of hits.slice(0, 6)) {
      console.log(`      ${h.slice(0, 190)}`);
    }
  }

  // stderr 直出的裸行：无时间戳、非栈帧、非 JSON 续行
  const bare = lines.filter(
    (l) =>
      l.trim() !== "" &&
      !/^\[\d{2}:\d{2}:\d{2}/.test(l) &&
      !/^\s+at /.test(l) &&
      !/^\s*["}\]\[]/.test(l) &&
      !/^\s*$/.test(l)
  );
  console.log(`  stderr 裸行      ${bare.length} 条`);
  for (const b of bare.slice(-8)) console.log(`      ${b.slice(0, 190)}`);
}
