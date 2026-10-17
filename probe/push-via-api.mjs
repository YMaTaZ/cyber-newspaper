/**
 * 用 GitHub 的 Git Data API 把本地领先远程的提交推上去，绕开 github.com。
 *
 * 为什么需要它：本机到 github.com:443 间歇性不通（git push 走这个域），
 * 而 api.github.com 稳定可达。网络挡住 push 时不必干等。
 *
 * 做法：把「本地领先远程」那些改动整理成一次 API 提交。
 * 注意这是**压缩**提交：多次本地提交会被合并成一条，消息取最新的那条。
 * 网络恢复后若想要完整历史，可在本地重放。
 *
 * 用法：node probe/push-via-api.mjs <owner/repo> <branch>
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [repoArg, branchArg] = process.argv.slice(2);
if (!repoArg || !branchArg) {
  console.error("用法：node probe/push-via-api.mjs <owner/repo> <branch>");
  process.exit(1);
}

const run = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
if (!token) {
  console.error("✗ 拿不到 token（gh 是否已登录？）");
  process.exit(1);
}
const H = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "cyber-newspaper",
  "X-GitHub-Api-Version": "2022-11-28",
};
const API = `https://api.github.com/repos/${repoArg}`;

async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...H, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// 本地领先远程的改动文件（含新增/修改/删除）
const changed = run(["diff", "--name-status", `origin/${branchArg}...HEAD`])
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [st, ...rest] = l.split(/\s+/);
    return { status: st[0], path: rest.join(" ") };
  });

if (!changed.length) {
  console.log("本地与远程一致，无需推送");
  process.exit(0);
}
console.log(`=== 经 API 推送 ${repoArg}:${branchArg} ===`);
for (const c of changed) console.log(`  ${c.status}  ${c.path}`);

const ref = await api(`/git/ref/heads/${branchArg}`);
const baseCommit = ref.object.sha;
const base = await api(`/git/commits/${baseCommit}`);
console.log(`\n  base: ${baseCommit.slice(0, 7)}`);

// 逐文件建 blob；删除的走 sha:null（Git Data API 用 null 表示移除）
const tree = [];
for (const f of changed) {
  if (f.status === "D") {
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
    console.log(`  del  ${f.path}`);
    continue;
  }
  const buf = readFileSync(join(ROOT, f.path));
  const blob = await api("/git/blobs", {
    method: "POST",
    body: { content: buf.toString("base64"), encoding: "base64" },
  });
  tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  console.log(`  blob ${f.path} → ${blob.sha.slice(0, 7)}`);
}

const newTree = await api("/git/trees", {
  method: "POST",
  body: { base_tree: base.tree.sha, tree },
});

// 提交信息：把领先的那些本地提交标题都带上，别丢线索
const titles = run(["log", "--format=%s", `origin/${branchArg}..HEAD`])
  .split("\n")
  .filter(Boolean);
const newestBody = run(["log", "-1", "--format=%B"]);
const message =
  titles.length > 1
    ? `Squashed via API (github.com unreachable):\n\n` +
      titles.map((t) => `- ${t}`).join("\n") +
      `\n\n${newestBody}`
    : newestBody;

const authorName = run(["log", "-1", "--format=%an"]);
const authorEmail = run(["log", "-1", "--format=%ae"]);
const newCommit = await api("/git/commits", {
  method: "POST",
  body: {
    message,
    tree: newTree.sha,
    parents: [baseCommit],
    author: { name: authorName, email: authorEmail },
  },
});
console.log(`  new commit: ${newCommit.sha.slice(0, 7)}`);
console.log(`  author    : ${newCommit.author.name} <${newCommit.author.email}>`);
console.log(`  含 ${titles.length} 条本地提交的标题`);

await api(`/git/refs/heads/${branchArg}`, {
  method: "PATCH",
  body: { sha: newCommit.sha, force: false },
});
console.log(`\n✓ ${branchArg} 已更新到 ${newCommit.sha.slice(0, 7)}（未走 github.com）`);
console.log("  提示：这条路只推内容、推不了历史。远端会与本机分叉：两边文件逐字一致，但提交链不同，");
console.log("        之后再走 git push 会被当作非快进拒掉，只能继续用本脚本，分叉会越堆越厚。");
console.log("        github.com 恢复后应该执行：");
console.log(`            git push --force-with-lease origin ${branchArg}`);
console.log("        把远端换回真实历史（已发布的 v* tag 仍引用着压缩提交，所以不会丢对象）。");
console.log("        不要反过来用 git fetch + reset 把本机对齐压缩历史——那会丢掉本机的提交粒度。");
