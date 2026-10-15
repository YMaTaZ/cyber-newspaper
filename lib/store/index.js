/**
 * 归档与配置存储
 *
 * 设计（SPEC 12）：
 *   - 配置与索引走 ctx.storage.global（宿主维护，无额外授权，跨机器成立）
 *   - Issue 全文与 HTML 快照落 ctx.dataDir/archive/
 *   - 索引是缓存，文件系统是真相。启动时校验，不一致则以文件重建
 *
 * 不依赖 Hana 运行时：ctx 由调用方注入。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_CONFIG = {
  provider: null,
  model: null,
  lang: "zh",
  maxCandidates: 40,
  enabledSources: null, // null = 全部启用
  windowHours: 24,
  // 开关（默认全部关闭）
  enableSessionEntry: false,
  enableBridgePush: false,
  enableDesktopNotify: false,
  keepHtmlSnapshot: true,
};

const CONFIG_KEY = "config";
const INDEX_KEY = "archiveIndex";

/** 归档目录 */
function archiveDir(ctx) {
  const dir = join(ctx.dataDir, "archive");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function issuePath(ctx, date) {
  return join(archiveDir(ctx), `${date}.json`);
}

export function htmlPath(ctx, date) {
  return join(archiveDir(ctx), `${date}.html`);
}

// ---------- 配置 ----------

export async function loadConfig(ctx) {
  const raw = await ctx.storage.global.get(CONFIG_KEY, null);
  return { ...DEFAULT_CONFIG, ...(raw ?? {}) };
}

export async function saveConfig(ctx, patch) {
  const cur = await loadConfig(ctx);
  const next = { ...cur, ...patch };
  await ctx.storage.global.set(CONFIG_KEY, next);
  return next;
}

// ---------- 索引 ----------

const EMPTY_INDEX = { schemaVersion: 1, entries: [], nextIssueNo: 1 };

export async function loadIndex(ctx) {
  const raw = await ctx.storage.global.get(INDEX_KEY, null);
  if (!raw || !Array.isArray(raw.entries)) return { ...EMPTY_INDEX };
  return { ...EMPTY_INDEX, ...raw };
}

export async function saveIndex(ctx, index) {
  await ctx.storage.global.set(INDEX_KEY, index);
}

/**
 * 校验索引与文件系统是否一致。不一致则以文件为准重建索引。
 * 返回 { index, repaired }。
 */
export async function reconcileIndex(ctx) {
  const dir = archiveDir(ctx);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  const fromDisk = [];
  for (const f of files) {
    try {
      const issue = JSON.parse(readFileSync(join(dir, f), "utf8"));
      fromDisk.push({
        date: issue.date,
        issueNo: issue.issueNo,
        title: (issue.highlights?.[0] ?? "").slice(0, 60),
        itemCount: issue.stats?.itemCount ?? 0,
        sectionCount: issue.stats?.sectionCount ?? 0,
        sourceOk: issue.stats?.sourceOk ?? 0,
        generatedAt: issue.generatedAt,
      });
    } catch {
      // 坏文件跳过，不阻塞
    }
  }
  fromDisk.sort((a, b) => (a.date < b.date ? 1 : -1));

  const stored = await loadIndex(ctx);
  const same =
    stored.entries.length === fromDisk.length &&
    stored.entries.every((e, i) => e.date === fromDisk[i].date && e.issueNo === fromDisk[i].issueNo);

  if (same) return { index: stored, repaired: false };

  const maxNo = fromDisk.reduce((m, e) => Math.max(m, e.issueNo ?? 0), 0);
  const rebuilt = {
    schemaVersion: 1,
    entries: fromDisk,
    nextIssueNo: Math.max(maxNo + 1, stored.nextIssueNo ?? 1),
  };
  await saveIndex(ctx, rebuilt);
  return { index: rebuilt, repaired: true };
}

// ---------- 读写 Issue ----------

export async function readIssue(ctx, date) {
  const p = issuePath(ctx, date);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export async function writeIssue(ctx, issue, html) {
  const dir = archiveDir(ctx);
  writeFileSync(issuePath(ctx, issue.date), JSON.stringify(issue, null, 2), "utf8");
  if (html) writeFileSync(htmlPath(ctx, issue.date), html, "utf8");

  const { index } = await reconcileIndex(ctx);
  const entries = index.entries.filter((e) => e.date !== issue.date);
  entries.unshift({
    date: issue.date,
    issueNo: issue.issueNo,
    title: (issue.highlights?.[0] ?? "").slice(0, 60),
    itemCount: issue.stats?.itemCount ?? 0,
    sectionCount: issue.stats?.sectionCount ?? 0,
    sourceOk: issue.stats?.sourceOk ?? 0,
    generatedAt: issue.generatedAt,
  });
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));

  const nextIndex = {
    schemaVersion: 1,
    entries,
    nextIssueNo: Math.max(index.nextIssueNo ?? 1, (issue.issueNo ?? 0) + 1),
  };
  await saveIndex(ctx, nextIndex);
  return nextIndex;
}

export async function deleteIssue(ctx, date) {
  for (const p of [issuePath(ctx, date), htmlPath(ctx, date)]) {
    if (existsSync(p)) unlinkSync(p);
  }
  const { index } = await reconcileIndex(ctx);
  return index;
}

/**
 * 分配期号。同一天重复生成时复用原期号（视为修订），不递增。
 */
export async function allocateIssueNo(ctx, date) {
  const { index } = await reconcileIndex(ctx);
  const existing = index.entries.find((e) => e.date === date);
  if (existing) return { issueNo: existing.issueNo, index, isRevision: true };
  return { issueNo: index.nextIssueNo ?? 1, index, isRevision: false };
}

// ---------- 搜索 ----------

/**
 * 本地搜索。范围：要点、栏目名、条目标题、点评。
 * 不涉及模型调用，不需要任何授权。
 */
export function searchIssues(issues, query) {
  const terms = String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const results = [];
  for (const issue of issues) {
    const hits = [];

    for (const h of issue.highlights ?? []) {
      if (matches(h, terms)) hits.push({ kind: "highlight", text: h });
    }
    for (const sec of issue.sections ?? []) {
      if (matches(sec.title, terms)) hits.push({ kind: "section", text: sec.title });
      for (const it of sec.items ?? []) {
        if (matches(it.title, terms) || matches(it.note, terms)) {
          hits.push({ kind: "item", text: it.title, note: it.note, url: it.url, section: sec.title });
        }
      }
    }
    if (hits.length) {
      results.push({ date: issue.date, issueNo: issue.issueNo, hits });
    }
  }
  // 日期倒序
  results.sort((a, b) => (a.date < b.date ? 1 : -1));
  return results;
}

function matches(text, terms) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return terms.every((term) => t.includes(term));
}
