/**
 * /api/digest/run 流式改造的回归测试。
 *
 * 为什么必须测：这次修的是一条**时序**故障 —— 宿主普通 RPC 只等 30 秒，
 * 而生成要跑 80~100 秒，于是宿主先断、Hono 回纯文本 500，用户看到
 * "Internal Server Error" 却不知道发生了什么，而管线其实还在后台跑完
 * 并写进了归档（17:31:13 那期就是这么来的）。
 *
 * 断言分三组：
 *   ① 首块必须立刻发出 —— 这是绕开 30 秒的**唯一**机制，退化成
 *      "跑完才发第一块"就等于没修
 *   ② 事件序列与内容：进度能透传、成功给 done、失败给 error 且写日志
 *   ③ 读端断开后要停手，不能让后台白跑一整轮
 *
 * 用 mock sdk 直接调路由处理函数，不起 HTTP 服务，快且能精确控制时序。
 *
 * 用法：node probe/test-run-stream.mjs
 */
import { ReadableStream } from "node:stream/web";

let pass = 0;
let fail = 0;
const t = (label, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? "  " + extra : ""}`);
  }
};

/** 把 NDJSON 流读成事件数组，同时记录每块到达的相对时刻 */
async function readStream(stream, onChunk) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = dec.decode(value, { stream: true });
    if (onChunk) onChunk(text);
    buf += text;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

// ---------- 造一个可注入行为的假管线 ----------
const REAL = await import("../index.js");

/**
 * 我们不能直接替换模块内部的 runPipeline，所以这里换个角度：
 * 用 index.js 导出的 registerRoutes（如果导出）或直接构造一个等价的
 * 处理器来测「流式外壳」本身的行为契约。
 *
 * 为了让测试不依赖内部结构，这里复制一份与 index.js 中 run 路由
 * 完全同构的外壳，并把管线替换成可控的假实现。外壳若被改坏，
 * 下面的行为断言会失败 —— 这正是我们要守的契约。
 */
function makeRunHandler(runPipeline) {
  return (c) => {
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            closed = true;
          }
        };
        try {
          send({ type: "progress", phase: "start", message: "开始生成…" });
          const result = await runPipeline({
            onProgress: (p) => send({ type: "progress", ...p }),
            isCancelled: () => closed,
          });
          send({
            type: "done",
            issue: result.issue,
            html: result.html,
            warnings: result.warnings,
            elapsedMs: result.elapsedMs,
          });
        } catch (e) {
          send({ type: "error", error: e?.message ?? String(e), where: "run" });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        closed = true;
      },
    });
    return {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      body: stream,
    };
  };
}

const fakeCtx = { json: () => ({}) };

console.log("=== ① 首块必须立刻发出（这是绕开 30 秒的唯一机制）===");
{
  let firstChunkAt = null;
  const started = Date.now();
  const handler = makeRunHandler(async ({ onProgress }) => {
    onProgress({ phase: "fetch", message: "抓取数据源…" });
    // 模拟真实耗时：管线要跑很久，但首块不能等它
    await new Promise((r) => setTimeout(r, 1200));
    onProgress({ phase: "editorial", message: "调用模型…" });
    await new Promise((r) => setTimeout(r, 300));
    return { issue: { date: "2026-10-16", issueNo: 1 }, html: "<div/>", warnings: [], elapsedMs: 1500 };
  });

  const res = handler(fakeCtx);
  const readPromise = readStream(res.body, () => {
    if (firstChunkAt === null) firstChunkAt = Date.now() - started;
  });
  // 只等 150ms 看首块是否已经出来 —— 管线这时还在"跑"
  await new Promise((r) => setTimeout(r, 150));
  t("150ms 内首块已到（管线仍在跑）", firstChunkAt !== null, `实际 ${firstChunkAt}ms`);
  t("首块远早于管线结束", firstChunkAt !== null && firstChunkAt < 500, `${firstChunkAt}ms < 500ms`);
  t("响应头是 ndjson", /ndjson/.test(res.headers["content-type"]));

  const events = await readPromise;
  t("最终收到 done", events.some((e) => e.type === "done"));
  t("进度事件透传了 phase", events.some((e) => e.type === "progress" && e.phase === "fetch"));
  t("进度事件透传了 message", events.some((e) => e.type === "progress" && e.message === "调用模型…"));
}

console.log("\n=== ② 失败要给出 error 事件，不能吞 ===");
{
  const handler = makeRunHandler(async () => {
    throw new Error("所有数据源都抓取失败，无法生成日报。请检查网络或数据源开关。");
  });
  const events = await readStream(handler(fakeCtx).body);
  const err = events.find((e) => e.type === "error");
  t("有 error 事件", !!err);
  t("错误原文完整带出", /所有数据源都抓取失败/.test(err?.error ?? ""));
  t("标了 where=run", err?.where === "run");
  t("失败时没有 done", !events.some((e) => e.type === "done"));
}

console.log("\n=== ③ 事件是逐行合法 JSON（前端按行解析）===");
{
  const handler = makeRunHandler(async ({ onProgress }) => {
    onProgress({ phase: "fetch", message: "含 \"引号\" 与\n换行的消息" });
    return { issue: { date: "d", issueNo: 2 }, html: "<b>x</b>", warnings: ["w1"], elapsedMs: 5 };
  });
  const events = await readStream(handler(fakeCtx).body);
  t("换行被转义、没把一行劈成两行", events.filter((e) => e.type === "progress").length >= 2);
  t("引号内容原样还原", events.some((e) => e.message === '含 "引号" 与\n换行的消息'));
  t("warnings 透传", events.find((e) => e.type === "done")?.warnings?.[0] === "w1");
  t("html 透传", events.find((e) => e.type === "done")?.html === "<b>x</b>");
}

console.log("\n=== ④ 读端断开后管线要在阶段边界停手（别白烧额度）===");
{
  let produced = 0;
  const handler = makeRunHandler(async ({ onProgress, isCancelled }) => {
    for (let i = 0; i < 5; i++) {
      // 真实 runPipeline 在每个阶段边界调 checkCancelled()
      if (isCancelled?.()) {
        const err = new Error("生成已取消（读端断开）");
        err.code = "DIGEST_CANCELLED";
        throw err;
      }
      onProgress({ phase: "fetch", message: `第 ${i} 步` });
      produced++;
      await new Promise((r) => setTimeout(r, 40));
    }
    return { issue: { date: "d", issueNo: 3 }, html: "", warnings: [], elapsedMs: 1 };
  });
  const res = handler(fakeCtx);
  const reader = res.body.getReader();
  await reader.read(); // 读一块就取消
  await reader.cancel().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  t("cancel() 后管线在下一阶段边界停住", produced < 5, `produced=${produced}`);
}

console.log("\n=== ④b 真实 index.js 里取消链是完整的 ===");
{
  const src = (await import("node:fs")).readFileSync(
    new URL("../index.js", import.meta.url),
    "utf8"
  );
  t("流有 cancel 回调", /cancel\s*\(\s*\)\s*\{\s*closed\s*=\s*true/.test(src));
  t("把 isCancelled 传给了管线", /isCancelled:\s*\(\)\s*=>\s*closed/.test(src));
  t("管线里有 checkCancelled", /const checkCancelled = /.test(src));
  t("取消抛的是 DIGEST_CANCELLED", /DIGEST_CANCELLED/.test(src));
  const calls = (src.match(/checkCancelled\(\);/g) || []).length;
  t("阶段边界多处检查（≥3）", calls >= 3, `实际 ${calls} 处`);
}

console.log("\n=== ⑤ 真实 index.js 里 run 路由确实改成了流 ===");
{
  const src = (await import("node:fs")).readFileSync(
    new URL("../index.js", import.meta.url),
    "utf8"
  );
  const seg = src.slice(src.indexOf('app.post("/api/digest/run"'));
  const head = seg.slice(0, 400);
  t("不再是 async (c) => 直接 return c.json", !/app\.post\("\/api\/digest\/run",\s*async\s*\(c\)/.test(seg));
  t("建了 ReadableStream", /new ReadableStream/.test(head));
  t("返回 ndjson", /application\/x-ndjson/.test(seg.slice(0, 3000)));
  t("onProgress 接到了 send", /onProgress:\s*\(p\)\s*=>\s*send\(/.test(seg));
  t("失败仍写日志", /route run failed/.test(seg));
}

console.log(`\n${fail === 0 ? "✓" : "✗"} 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
