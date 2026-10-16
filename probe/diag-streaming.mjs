import { readFileSync } from "node:fs";
const H = "C:/Users/20769/.hanako/artifacts/server/1.1.7-beta-win32-x64-4460b4c2a6bae210-gcd7ced270b9802f6";
const lines = readFileSync(`${H}/bundle/index.js`, "utf8").split("\n");
console.log("=== 135340-135400（serialize/deserialize 实现）===");
console.log(lines.slice(135339, 135400).map((l, i) => `${135340 + i}: ${l.slice(0, 200)}`).join("\n"));
