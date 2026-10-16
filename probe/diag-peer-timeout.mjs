import { readFileSync } from "node:fs";
const H = "C:/Users/20769/.hanako/artifacts/server/1.1.7-beta-win32-x64-4460b4c2a6bae210-gcd7ced270b9802f6";
const text = readFileSync(`${H}/bundle/index.js`, "utf8");
const lines = text.split("\n");

for (const kw of ["yxt"]) {
  lines.forEach((l, i) => {
    if (new RegExp(`\\b${kw}\\s*=`).test(l)) console.log(`  L${i + 1}: ${l.trim().slice(0, 220)}`);
  });
}

// 也看 134810-134830（之前看到 yxt = 3e4 那行）
console.log("\n=== 134815-134825 ===");
console.log(lines.slice(134814, 134825).map((l, i) => `${134815 + i}: ${l.slice(0, 200)}`).join("\n"));
