/**
 * 查市场投稿 PR 的当前状态：PR 本体、工作流、索引是否已收录。
 *
 * 为什么用 node 而不是 gh + PowerShell：
 *   gh api 返回的 base64 带换行，PowerShell 解码会失败（本次真踩过）。
 *   node 直接打 GitHub API，一步到位。
 *
 * 定时任务也该调这个脚本，而不是每次现写抓取逻辑 —— 省 token，也不会写歪。
 *
 * 用法：node probe/check-market-status.mjs
 */
const REPO = "liliMozi/hana-marketplace";
const PR = 104;
const APP_ID = "cyber-newspaper";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cyber-newspaper",
};
// 有凭据就读得更准（私有可见性、限速更高），没有就匿名读公开数据
const tok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (tok) headers.Authorization = `Bearer ${tok}`;

async function get(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) return { error: `HTTP ${r.status} ${r.statusText}` };
  return r.json();
}

// ---------- 1. PR 本体 ----------
const pr = await get(`/repos/${REPO}/pulls/${PR}`);
console.log("=== PR #" + PR + " ===");
if (pr.error) {
  console.log("  读取失败: " + pr.error);
} else {
  const merged = !!pr.merged_at;
  const closed = pr.state === "closed" && !merged;
  console.log("  state        : " + pr.state + (merged ? " (已合并)" : closed ? " (已关闭未合并)" : ""));
  console.log("  merged_at    : " + (pr.merged_at || "(未合并)"));
  console.log("  mergeable    : " + pr.mergeable + " / " + (pr.mergeable_state || "-"));
  console.log("  review 决定   : " + (pr.review_decision?.state || "(无)"));
  console.log("  评论数       : " + (pr.comments + pr.review_comments));
  console.log("  最后更新     : " + pr.updated_at);
}

// ---------- 2. 工作流是否已被维护者批准 ----------
const runs = await get(`/repos/${REPO}/actions/workflows/sync-market.yml/runs?per_page=5`);
console.log("\n=== Synchronize market index 工作流 ===");
if (runs.error) {
  console.log("  读取失败: " + runs.error);
} else {
  const mine = (runs.workflow_runs || []).filter((r) => String(r.pull_request?.number) === String(PR) || r.head_sha === pr?.head?.sha);
  if (!mine.length) console.log("  没找到本 PR 触发的运行");
  for (const r of mine.slice(0, 3)) {
    console.log(`  ${r.status}/${r.conclusion || "-"}  attempt=${r.run_attempt}  ${r.created_at}`);
  }
  const waiting = mine.some((r) => r.conclusion === "action_required");
  if (waiting) console.log("  → 仍卡在 action_required：等维护者点批准（fork PR 的默认门禁）");
}

// ---------- 3. 索引是否已收录（真正上架的判据）----------
// Contents API 只对 1MB 以下的文件返回 content，市场索引常常更大，
// 所以直接要 raw 字节。
console.log("\n=== 市场索引 ===");
try {
  const rr = await fetch(`https://api.github.com/repos/${REPO}/contents/index.v2.json`, {
    headers: { ...headers, Accept: "application/vnd.github.raw+json" },
  });
  if (!rr.ok) {
    console.log("  读取失败: HTTP " + rr.status + " " + rr.statusText);
  } else {
    const idx = JSON.parse(await rr.text());
    const hit = (idx.items || []).find((x) => x.id === APP_ID);
    console.log("  条目总数     : " + (idx.items || []).length);
    console.log("  publishedAt  : " + idx.publishedAt);
    console.log("  含 " + APP_ID + " : " + (hit ? "是（已上架）" : "否"));
    if (hit) {
      console.log("    name    : " + hit.name);
      console.log("    version : " + hit.version);
      console.log("    下载数  : " + (hit.stats?.downloads ?? "(无)"));
    }
  }
} catch (e) {
  console.log("  解析失败：" + e.message);
}

// ---------- 4. 结论 ----------
console.log("\n=== 结论 ===");
let verdict = "未知";
if (!pr.error) {
  const merged = !!pr.merged_at;
  const closed = pr.state === "closed" && !merged;
  if (merged) verdict = "PR 已合并，等索引更新（工作流约 30 秒）";
  else if (closed) verdict = "PR 被关闭且未合并 —— 需要看评论找原因";
  else if (pr.comments + pr.review_comments > 0) verdict = "有新评论/审查，需要人工看";
  else verdict = "无变化：仍 OPEN，没人碰过，索引里也还没有";
}
console.log("  " + verdict);
