/**
 * 用 GitHub 的 Git Data API 提交本地改动，绕开 github.com。
 *
 * 为什么需要它：本机到 github.com:443 间歇性不通（git push 走这个域），
 * 而 api.github.com 稳定可达。push 卡住时不必干等网络恢复。
 *
 * 用法：node probe/commit-via-api.mjs <owner/repo> <branch> [文件...]
 *   不带文件参数时，提交工作区当前所有已改动的跟踪文件。
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const [repoArg, branchArg, ...filesArg] = process.argv.slice(2);
if (!repoArg || !branchArg) {
  console.error("用法：node probe/commit-via-api.mjs <owner/repo> <branch> [文件...]");
  process.exit(1);
}

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
if (!token) {
  console.error("✗ 拿不到 token（gh auth status 是否已登录？）");
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

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

// 要提交的文件：命令行给的，或工作区里所有已改动/已暂存的跟踪文件
const files =
  filesArg.length > 0
    ? filesArg
    : run("git", ["diff", "--name-only", "HEAD"])
        .split("\n")
        .filter(Boolean);

if (!files.length) {
  console.log("没有需要提交的文件");
  process.exit(0);
}
console.log(`=== 经 API 提交 ${repoArg}:${branchArg} ===`);
for (const f of files) console.log("  " + f);

// 1) 当前 commit 与 tree
const ref = await api(`/git/ref/heads/${branchArg}`);
const baseCommit = ref.object.sha;
const commit = await api(`/git/commits/${baseCommit}`);
console.log(`\n  base commit: ${baseCommit.slice(0, 7)}  tree: ${commit.tree.sha.slice(0, 7)}`);

// 2) 建 blobs（内容直接取自工作区，比 base64 传 trees 更稳）
const tree = [];
for (const f of files) {
  const abs = join(ROOT, f);
  const buf = readFileSync(abs);
  const blob = await api("/git/blobs", {
    method: "POST",
    body: { content: buf.toString("base64"), encoding: "base64" },
  });
  tree.push({ path: f, mode: "100644", type: "blob", sha: blob.sha });
  console.log(`  blob ${f} → ${blob.sha.slice(0, 7)}`);
}

// 3) 新 tree（基于原 tree，未列出的文件保持不变）
const newTree = await api("/git/trees", {
  method: "POST",
  body: { base_tree: commit.tree.sha, tree },
});
console.log(`  new tree: ${newTree.sha.slice(0, 7)}`);

// 4) 新 commit（沿用本地写好的提交信息与作者身份，跟 git log 保持一致）
const message = run("git", ["log", "-1", "--format=%B"]);
const authorName = run("git", ["log", "-1", "--format=%an"]);
const authorEmail = run("git", ["log", "-1", "--format=%ae"]);
const newCommit = await api("/git/commits", {
  method: "POST",
  body: {
    message,
    tree: newTree.sha,
    parents,
    author: { name: authorName, email: authorEmail },
  },
});
console.log(`  new commit: ${newCommit.sha.slice(0, 7)}`);
console.log(`  author    : ${newCommit.author.name} <${newCommit.author.email}>`);

// 5) 移动分支 ref
await api(`/git/refs/heads/${branchArg}`, {
  method: "PATCH",
  body: { sha: newCommit.sha, force: false },
});
console.log(`\n✓ ${branchArg} 已更新到 ${newCommit.sha.slice(0, 7)}（未走 github.com）`);
