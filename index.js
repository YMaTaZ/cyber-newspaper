/**
 * App 入口：把各模块串成一条可用的管线。
 *
 * 入口设计（SPEC 3.3）：
 *   ① 工作台按钮  → 走 route，无 callToken，不出 PDF
 *   ② 会话内触发  → 走工具，有 callToken，出 PDF
 *   ③ 桥接推送    → 与 ② 同一条代码路径，会话来自哪里 App 不感知
 *
 * 实现红线（SPEC 3.3）：工作台路径不得有任何投递动作。
 */

import { defineApp } from "./sdk/app-contract/server-client.js";

import { fetchAll, SOURCE_IDS } from "./lib/sources/index.js";
import { buildCandidatePool } from "./lib/pipeline/dedupe.js";
import {
  EDITORIAL_SYSTEM_PROMPT,
  buildEditorialInput,
  extractJson,
  assembleIssue,
} from "./lib/editorial/index.js";
import { renderIssue } from "./lib/render/index.js";
import { exportIssue, FORMATS } from "./lib/export/index.js";
import {
  loadConfig,
  saveConfig,
  allocateIssueNo,
  writeIssue,
  readIssue,
  loadIndex,
  reconcileIndex,
  deleteIssue,
  searchIssues,
  DEFAULT_CONFIG,
} from "./lib/store/index.js";

export const name = "cyber-newspaper";

/**
 * 路由统一的错误出口：写日志 + 返回合法 JSON。
 *
 * 两个问题一起治：
 *   1. 以前部分路由没 try/catch，抛异常时宿主兜底给一个非 JSON 的 500，
 *      前端只能编出一句“响应不是合法 JSON（HTTP 500）”，真错误被遮死。
 *   2. 失败不留痕迹，定位全靠猜（本次就是）。
 */
async function jsonError(c, sdk, where, e) {
  const message = e?.message ?? String(e);
  try {
    await sdk.logger.error(`route ${where} failed: ${message}\n${e?.stack ?? ""}`);
  } catch {
    // 日志失败不能把错误响应也吞掉
  }
  return c.json({ ok: false, error: message, where }, 500);
}

/** 把 sdk.network.fetch 包成管线需要的 fetcher 签名 */
function makeFetcher(sdk, timeoutMs) {
  return async (url, { headers } = {}) => {
    const res = await sdk.network.fetch(url, { headers, timeoutMs });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.name = "HttpError";
      throw err;
    }
    return await res.text();
  };
}

/** 逐行解析 NDJSON 模型流，拼出完整文本 */
async function collectStreamText(response, label = "", log = null) {
  // HTTP 层失败必须当场抛出并带上状态码。
  //
  // 为什么单独加这一道：旧版本直接开始读 body，而下面的循环对解析不了的行
  // 一律 continue。供应商网关报 500 时返回的是错误页而非 NDJSON，于是每一行都被
  // 静默丢掉，最终 out=""、streamError=null，上层把它报成「模型没有返回合法 JSON」。
  // 网络故障被伪装成了模型问题，把排查方向整条带偏。
  if (response && response.ok === false) {
    let snippet = "";
    try {
      snippet = String(await response.text()).slice(0, 300);
    } catch {
      /* 读不到就算了，状态码已经够定位 */
    }
    throw new Error(
      `模型调用失败：HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}` +
        (label ? `（${label}）` : "") +
        (snippet ? `\n供应商返回：${snippet}` : "")
    );
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // 退化路径：当作普通 JSON 响应
    const text = await response.text();
    try {
      const j = JSON.parse(text);
      return j.text ?? j.content ?? text;
    } catch {
      return text;
    }
  }
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  let streamError = null;
  let unparsed = [];   // 解析不了的原样行，只用于出错时取证
  let stopReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let ev;
      try {
        ev = JSON.parse(s);
      } catch {
        if (unparsed.length < 3) unparsed.push(s.slice(0, 200));
        continue;
      }
      if (ev.type === "text-delta") out += ev.delta ?? "";
      else if (ev.type === "error") streamError = `${ev.code}: ${ev.message}`;
      else if (ev.type === "done") {
        stopReason = ev.stopReason ?? null;
        // 有些适配器只在 done 里给完整内容（以前写成另一个 else-if，会被上面的
        // done 分支短路，永远进不到）。
        if (!out) {
          const asst = ev.assistant?.content ?? [];
          out = asst.filter((c) => c.type === "text").map((c) => c.text).join("");
        }
      }
    }
  }
  if (streamError && !out) throw new Error(streamError);
  // 空正文不在这里报错。上层对它的处理是「带提示重试一次」，
  // 抢在这里抛会直接打断重试路径。
  // 但诊断信息不能丢：空正文到底是被截断、还是根本没有 text-delta，
  // 只有流这一层知道。所以把它交给调用方给的 logger，重试照旧发生。
  //
  // 注意：log 必须从外面传进来。这个函数在顶层，看不到 sdk，
  // 写成 sdkLog?.() 会在真正走到这条分支时抛 ReferenceError。
  if (!out) {
    const why =
      stopReason === "length" ? "输出被 maxTokens 截断" :
      stopReason ? `stopReason=${stopReason}` :
      "流里没有 text-delta";
    try {
      await log?.warn?.(
        `模型返回空正文（${label || "未知模型"}）：${why}` +
          (unparsed.length ? ` 无法解析的行：${unparsed.join(" | ")}` : "")
      );
    } catch {
      /* 日志失败不能影响主流程 */
    }
  }
  return out;
}

/**
 * 供应商检测（SPEC 9）：读目录，按 provider 分组。不接触凭证。
 *
 * 为什么要分开存 id 与 label：宿主给 App 的返回里带一份
 * `providerDisplayNames`（ASCII 标识符 → 显示名）。调用只认前者（实测正则
 * ^[A-Za-z0-9_.:-]{1,128}$），但前者对自定义供应商插件可能就是个非 ASCII 名（
 * 例如自建插件的 provider 字段直接写了中文名），拿它去调会被宿主拒。
 * 所以这里用 ASCII 规则筛：能用的存 provider，不能用的标出来。
 */
export async function detectProviders(sdk) {
  const result = await sdk.models.list();
  const models = result?.models ?? [];
  await probeProviderShape(sdk, result, models);

  const displayNames = result?.providerDisplayNames ?? {};

  const groups = new Map();
  for (const m of models) {
    const raw = String(m?.provider ?? "unknown");
    // 能过 ASCII 校验的直接用；不能的也原样留着，由 usable 标出去。
    // 不能静默丢掉：丢了这个供应商，用户会以为 Hana 里没配。
    if (!groups.has(raw)) {
      groups.set(raw, {
        provider: raw,
        label: displayNames[raw] || raw,
        usable: ASCII_ID.test(raw),
        models: [],
      });
    }
    groups.get(raw).models.push({ id: String(m?.id ?? ""), name: String(m?.name ?? m?.id ?? "") });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    models: g.models.sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

/**
 * 一次性探测 models.list() 返回对象的字段形状，进 App 日志。
 *
 * 为什么要探：真实宿主上曾报
 *   provider must be 1-128 ASCII identifier characters
 * 而当时存的 provider 是个非 ASCII 名。说明目录投影给的可能是显示名，
 * 而宿主调用只认 ASCII 标识符（^[A-Za-z0-9_.:-]{1,128}$）。
 * 修法取决于投影里到底有没有 providerId 这类 ASCII 字段，
 * 本地验不了真实宿主，只能让它自己报一次结构。
 *
 * 只记键名与 ASCII 相关的值，不碰任何可能含凭证的字段。看完可删。
 */
let shapeProbed = false;
async function probeProviderShape(sdk, result, models) {
  if (shapeProbed || !models.length) return;
  shapeProbed = true;
  try {
    const topKeys = Object.keys(result ?? {});
    const keys = [...new Set(models.flatMap((m) => Object.keys(m ?? {})))].sort();
    const samples = models.slice(0, 3).map((m) => ({
      provider: m?.provider,
      providerId: m?.providerId,
      id: m?.id,
      name: m?.name,
    }));
    // 只记键名与显示名（非凭证），看看中文供应商到底有没有 ASCII 对应
    const dn = Object.entries(result?.providerDisplayNames ?? {}).slice(0, 14);
    await sdk.logger.info(
      `models.list 探测 top=[${topKeys.join(",")}] keys=[${keys.join(",")}] ` +
        `samples=${JSON.stringify(samples)} names=${JSON.stringify(Object.fromEntries(dn))}`
    );
  } catch {}
}

/**
 * 宿主的 provider 标识符规则（从宿主 bundle 里读到的同一条正则）。
 * 不匹配就必然被宿主拒，而且它回的是机器话。
 */
const ASCII_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * 把目录给的 provider 名字解析成宿主调用端认得的 ASCII 标识符。
 *
 * 为什么要解析而不是直接拒：实测供应商插件的 manifest 同时有两层名字：
 *   id       = "provider-<hex>"   （ASCII，调用端要这个）
 *   provider = "显示名"            （可能是非 ASCII，list() 投影给的是这个）
 * 两头不一致，所以不能拿 list 给的名字直接发请求，也不能一发就拦死。
 * 现在先试原值，原值不合规则就从 providerDisplayNames 的键里找 ASCII 候选。
 *
 * @returns {{ provider: string, remapped: boolean }}
 */
async function resolveProvider(sdk, provider) {
  if (typeof provider !== "string" || !provider) {
    throw new Error("尚未选择模型供应商。请在工作台左下角选定一个供应商与模型。");
  }
  if (ASCII_ID.test(provider)) return { provider, remapped: false };

  // 不合规则：从目录里找能指向同一个供应商的 ASCII 候选
  try {
    const result = await sdk.models.list();
    const names = result?.providerDisplayNames ?? {};
    const models = result?.models ?? [];
    // 候选一：providerDisplayNames 的键本身就是 ASCII 且值等于这个中文名
    for (const [k, v] of Object.entries(names)) {
      if (ASCII_ID.test(k) && v === provider) {
        await sdk.logger.info(`provider 重映射：「${provider}」→ ${k}`);
        return { provider: k, remapped: true };
      }
    }
    // 候选二：目次里同一个供应商另有一个 ASCII 写法（按模型集交集判同一家）
    const mine = new Set(models.filter((m) => String(m?.provider ?? "") === provider).map((m) => String(m?.id ?? "")));
    for (const m of models) {
      const p = String(m?.provider ?? "");
      if (p === provider || !ASCII_ID.test(p)) continue;
      if (mine.has(String(m?.id ?? ""))) {
        await sdk.logger.info(`provider 重映射（按模型集）：「${provider}」→ ${p}`);
        return { provider: p, remapped: true };
      }
    }
  } catch (e) {
    await sdk.logger.warn(`provider 重映射查找失败：${e?.message ?? e}`);
  }

  // 找不到等价名字：不拦，原值发出去，让宿主说话（错误会比我们的猜测准确）
  await sdk.logger.warn(`provider「${provider}」不是 ASCII 标识符且找不到别名，原值发出`);
  return { provider, remapped: false };
}

/**
 * 核心管线。三种入口共用。
 *
 * @param {object} sdk
 * @param {object} args
 *   - config        配置（不传则读存储）
 *   - onProgress    进度回调
 *   - callToken     会话入口才有；有它才能出 PDF
 *   - taskId        App 任务 id，用于长活归属
 * @returns {{ issue, html, warnings }}
 */
export async function runPipeline(sdk, args = {}) {
  const { onProgress, callToken, taskId } = args;
  const config = args.config ?? (await loadConfig(sdk));
  const startedAt = Date.now();

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // ① 抓取
  onProgress?.({ phase: "fetch", message: "抓取数据源…" });
  const enabled = config.enabledSources ?? SOURCE_IDS;
  const { items, report } = await fetchAll({
    enabledIds: enabled,
    windowHours: config.windowHours ?? 24,
    fetcher: makeFetcher(sdk, 15000),
    onProgress: (p) => onProgress?.({ phase: "fetch", ...p }),
  });

  const okSources = report.filter((r) => r.ok).length;
  if (okSources === 0) {
    throw new Error("所有数据源都抓取失败，无法生成日报。请检查网络或数据源开关。");
  }

  // ② 归并
  onProgress?.({ phase: "merge", message: "归并去重…" });
  const { candidates, stats } = buildCandidatePool(items, {
    maxCandidates: config.maxCandidates ?? 40,
    perSourceQuota: 4,
  });

  if (candidates.length < 5) {
    throw new Error(`候选条目只有 ${candidates.length} 条，不足以生成日报。`);
  }

  // ③ 供应商：名字不合规则时先试重映射，不直接拦死
  if (!config.model) {
    throw new Error("尚未选择模型。请在工作台左下角选定一个模型。");
  }
  const resolved = await resolveProvider(sdk, config.provider);
  const provider = resolved.provider;
  // 日志与报错都用这个标签：出问题时能直接看出是哪个模型挂了。
  const modelLabel = `${provider} / ${config.model}`;

  // ④ 编辑层
  onProgress?.({ phase: "editorial", message: `调用 ${config.provider} / ${config.model} 生成…` });
  const requestId = `digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const response = await sdk.models.stream({
    requestId,
    provider,
    model: config.model,
    systemPrompt: EDITORIAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildEditorialInput(candidates, { date }) }],
    temperature: 0.4,
    maxTokens: 4096,
    ...(callToken ? { callToken } : {}),
    ...(taskId ? { taskId } : {}),
  });

  const raw = await collectStreamText(response, modelLabel, sdk.logger);

  // ⑤ 解析 + ref 回填
  onProgress?.({ phase: "assemble", message: "整理结构…" });
  let modelOutput = extractJson(raw);
  let warnings = [];

  if (!modelOutput) {
    // 解析失败重试一次（SPEC 7.3）
    onProgress?.({ phase: "editorial", message: "输出解析失败，重试一次…" });
    const retryId = `${requestId}-retry`;
    const retryRes = await sdk.models.stream({
      requestId: retryId,
      provider,
      model: config.model,
      systemPrompt: EDITORIAL_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildEditorialInput(candidates, { date }) },
        { role: "user", content: "上次输出不是合法 JSON。请只输出 JSON 对象本身，不要任何其他文字。" },
      ],
      temperature: 0.2,
      maxTokens: 4096,
      ...(callToken ? { callToken } : {}),
      ...(taskId ? { taskId } : {}),
    });
    modelOutput = extractJson(await collectStreamText(retryRes, modelLabel, sdk.logger));
  }

  if (!modelOutput) {
    throw new Error(
      `模型两次都没有返回合法 JSON，本次生成中止。（模型：${modelLabel}，原始输出 ${raw.length} 字符）` +
        (raw ? `\n输出开头：${raw.slice(0, 200)}` : "\n输出为空")
    );
  }

  const { issueNo, isRevision } = await allocateIssueNo(sdk, date);

  const { issue, warnings: w, validItemCount } = assembleIssue(modelOutput, candidates, {
    date,
    issueNo,
    provider: config.provider,
    model: config.model,
    sourceReport: report,
    generatedAt: new Date().toISOString(),
  });
  warnings = w;

  if (validItemCount < 5) {
    throw new Error(`模型只产出 ${validItemCount} 条有效内容，质量不合格，本次生成中止。`);
  }

  // ⑥ 渲染
  onProgress?.({ phase: "render", message: "排版…" });
  const html = renderIssue(issue, { mode: "standalone" });
  const htmlPrint = renderIssue(issue, { mode: "print" });

  // ⑦ 归档
  onProgress?.({ phase: "archive", message: "归档…" });
  await writeIssue(sdk, issue, config.keepHtmlSnapshot ? html : null);

  return {
    issue,
    html,
    htmlPrint,
    warnings,
    isRevision,
    elapsedMs: Date.now() - startedAt,
    mergeStats: stats,
  };
}

export default defineApp(async (sdk) => {
  await sdk.logger.info("cyber-newspaper loaded");

  // ---------- 设置页数据 ----------
  await sdk.routes.register((app) => {
    app.get("/api/digest/providers", async (c) => {
      try {
        const providers = await detectProviders(sdk);
        return c.json({ ok: true, providers });
      } catch (e) {
        return c.json({ ok: false, error: e?.message ?? String(e) }, 500);
      }
    });

    app.get("/api/digest/config", async (c) => {
      try {
        const config = await loadConfig(sdk);
        return c.json({ ok: true, config, defaults: DEFAULT_CONFIG });
      } catch (e) {
        return jsonError(c, sdk, "config.read", e);
      }
    });

    app.post("/api/digest/config", async (c) => {
      try {
        const patch = await c.req.json();
        const config = await saveConfig(sdk, patch);
        return c.json({ ok: true, config });
      } catch (e) {
        // 这条以前没保护：一旦抛异常宿主就返回非 JSON 的 500，
        // 前端只能猜“响应不是合法 JSON”，真错误被遮掉，配置也没写成。
        return jsonError(c, sdk, "config.write", e);
      }
    });

    app.post("/api/digest/theme-probe", async (c) => {
      // 主题跟随在本地验不了：预览把跟随脚本换成了桩，真实宿主才能证伪。
      // 这个口只把页面回传的变量现状写进日志，不存东西、不参与业务。
      let body = null;
      try {
        body = await c.req.json();
      } catch {}
      await sdk.logger.info(`theme-probe ${JSON.stringify(body)}`);
      return c.json({ ok: true });
    });

    app.get("/api/digest/archive", async (c) => {
      try {
        const { index, repaired } = await reconcileIndex(sdk);
        return c.json({ ok: true, index, repaired });
      } catch (e) {
        return jsonError(c, sdk, "archive", e);
      }
    });

    app.get("/api/digest/issue/:date", async (c) => {
      try {
        const issue = await readIssue(sdk, c.req.param("date"));
        if (!issue) return c.json({ ok: false, error: "not found" }, 404);
        return c.json({ ok: true, issue, html: renderIssue(issue, { mode: "embed" }) });
      } catch (e) {
        return jsonError(c, sdk, "issue.read", e);
      }
    });

    app.delete("/api/digest/issue/:date", async (c) => {
      try {
        const index = await deleteIssue(sdk, c.req.param("date"));
        return c.json({ ok: true, index });
      } catch (e) {
        return jsonError(c, sdk, "issue.delete", e);
      }
    });

    app.get("/api/digest/search", async (c) => {
      try {
        const q = c.req.query("q") ?? "";
        const { index } = await reconcileIndex(sdk);
        const issues = [];
        for (const e of index.entries) {
          const it = await readIssue(sdk, e.date);
          if (it) issues.push(it);
        }
        return c.json({ ok: true, results: searchIssues(issues, q) });
      } catch (e) {
        return jsonError(c, sdk, "search", e);
      }
    });

    // 导出：返回文件字节，由前端下载。不涉及任何额外授权。
    app.get("/api/digest/export/:date/:format", async (c) => {
      const date = c.req.param("date");
      const format = c.req.param("format");

      let issue;
      try {
        issue = await readIssue(sdk, date);
      } catch (e) {
        return jsonError(c, sdk, "export.read", e);
      }
      if (!issue) return c.json({ ok: false, error: "这一期不存在" }, 404);

      try {
        const out = await exportIssue(issue, format);

        if (out.kind === "print") {
          // PDF：返回打印用的 HTML，前端在新窗口打开并调 print()
          return c.body(out.html, 200, {
            "content-type": "text/html;charset=utf-8",
            "cache-control": "no-store",
          });
        }

        const data = Buffer.isBuffer(out.data) ? out.data : Buffer.from(out.data, "utf8");
        return c.body(data, 200, {
          "content-type": out.mime,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
          "content-length": String(data.length),
          "cache-control": "no-store",
        });
      } catch (e) {
        return jsonError(c, sdk, "export", e);
      }
    });

    // 支持的导出格式清单
    app.get("/api/digest/formats", (c) => c.json({ ok: true, formats: FORMATS }));

    // 工作台生成入口：无 callToken，因此不出 PDF（SPEC 3.3 实现红线）
    app.post("/api/digest/run", async (c) => {
      try {
        const result = await runPipeline(sdk, {
          onProgress: () => {},
        });
        return c.json({
          ok: true,
          issue: result.issue,
          html: renderIssue(result.issue, { mode: "embed" }),
          warnings: result.warnings,
          elapsedMs: result.elapsedMs,
        });
      } catch (e) {
        return jsonError(c, sdk, "run", e);
      }
    });
  });

  // ---------- 会话内工具（入口 ②③）----------
  await sdk.tools.register({
    name: "daily_run",
    description:
      "生成当天的赛博报纸。抓取多个公开 AI 数据源，归并去重后由模型整理成结构化日报，归档并返回。在会话里被调用时会同时产出 PDF。",
    parameters: {
      type: "object",
      properties: {
        withPdf: {
          type: "boolean",
          description: "是否同时产出 PDF。默认 true。",
        },
      },
    },
    execute: async (args) => {
      const callToken = args?.context?.callToken;
      const config = await loadConfig(sdk);

      // 开关：会话入口默认关闭（SPEC 3.3）
      if (!config.enableSessionEntry && !config.enableBridgePush) {
        return {
          content: [
            {
              type: "text",
              text:
                "会话内生成日报的开关未开启。请到「日报」设置页打开「会话内触发」，" +
                "或直接在工作台里生成。",
            },
          ],
        };
      }

      const result = await runPipeline(sdk, { callToken });

      const lines = [
        `赛博报纸 第 ${String(result.issue.issueNo).padStart(3, "0")} 期（${result.issue.date}）`,
        "",
        ...result.issue.highlights.map((h, i) => `${i + 1}. ${h}`),
        "",
        `共 ${result.issue.stats.itemCount} 条 / ${result.issue.stats.sectionCount} 栏，` +
          `数据源 ${result.issue.stats.sourceOk}/${result.issue.stats.sourceTotal}`,
      ];
      if (result.warnings.length) {
        lines.push("", `（生成过程有 ${result.warnings.length} 条提示，已自动处理）`);
      }

      const content = [{ type: "text", text: lines.join("\n") }];

      // PDF 需要 callToken 与 app/render.pdf 授权
      if (args?.withPdf !== false && callToken) {
        try {
          const res = await sdk.bus.request("render:html-to-pdf", {
            callToken,
            html: result.htmlPrint,
            outputName: `赛博报纸_${result.issue.date.replace(/-/g, "")}.pdf`,
            options: { pageSize: "A4" },
          });
          if (res?.file) {
            content.push({
              type: "file",
              fileId: res.file.fileId ?? res.file.id,
              name: res.file.name ?? "赛博报纸.pdf",
            });
          }
        } catch (e) {
          // PDF 失败不中止，正文照常返回
          lines.push("", `（PDF 导出未完成：${e?.message ?? e}。需要 app/render.pdf 授权）`);
          content[0] = { type: "text", text: lines.join("\n") };
        }
      }

      return { content };
    },
  });

  await sdk.logger.info("cyber-newspaper ready");
});
