/**
 * 找宿主调用 app 路由（callback.routes.fetch）时用的 RPC 超时。
 *
 * 为什么关键：界面报的 500 是宿主 Hono 默认错误处理的纯文本响应，
 * 说明异常发生在宿主侧、没进我的处理函数。若宿主给路由调用的超时
 * 短于我的管线耗时，那"生成明明成功、界面却报 500"就说得通了 ——
 * 宿主等不及先断，我的管线在后台跑完把归档写了。
 */
import { readFileSync } from "node:fs";

const H = "C:/Users/20769/.hanako/artifacts/server/1.1.7-beta-win32-x64-4460b4c2a6bae210-gcd7ced270b9802f6";

function scan(file, patterns) {
  const lines = readFileSync(file, "utf8").split("\n");
  console.log(`=== ${file.split("/").pop()} ===`);
  for (const [label, re] of patterns) {
    console.log(`  [${label}]`);
    const hits = [];
    lines.forEach((l, i) => {
      if (re.test(l)) hits.push(`    L${i + 1}: ${l.trim().slice(0, 190)}`);
    });
    for (const h of hits.slice(0, 10)) console.log(h);
    if (!hits.length) console.log("    (无)");
  }
}

scan(`${H}/bundle/index.js`, [
  ["app 路由代理构造", /function Dan\(|Dan\(f\)|appRouteRequest/],
  ["RpcPeer 超时默认值", /class\s+\w+\s*\{[\s\S]{0,80}timeoutMs|timeoutMs\s*=\s*[A-Za-z_$][\w$]*\s*\)/],
  ["给 app host 的 timeout", /timeoutMs:\s*(?!r\.timeoutMs|n\.timeoutMs)[A-Za-z_$][\w$.]*/],
]);

scan(`${H}/app-host-entry.js`, [
  ["超时常量", /APP_HOST_RPC_TIMEOUT_MS|SHORT_TIMEOUT_MS|CANCEL_TIMEOUT_MS/],
  ["call 的默认超时", /call\(method, params, timeoutMs/],
]);
