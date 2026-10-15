/**
 * 清掉跨供应商的坏配置，保留其余设置与归档。
 *
 * 为什么要清：存的是 provider 与 model 不匹配的一对，
 * 而那个 model 属于另一个上游的前缀，被误写进了当前 provider 的 model 字段。
 * 代码修好后这条脏数据仍在，下次生成多半还会失败。
 *
 * 只动 provider / model 两个字段，其他配置（数据源开关、语言、归档）全保留。
 * 清理前先备份，出错可回退。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.USERPROFILE || process.env.HOME;
const FILE = join(HOME, ".hanako", "app-data", "cyber-newspaper", "storage", "global.json");
const BACKUP = join(HOME, ".hanako", "tmp", "global-before-cleanup.json");

let doc;
try {
  doc = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.log(`找不到或读不了配置文件（${e.code}），无需清理`);
  process.exit(0);
}

const cfg = doc?.entries?.config;
if (!cfg) {
  console.log("配置里没有 entries.config，无需清理");
  process.exit(0);
}

mkdirSync(join(HOME, ".hanako", "tmp"), { recursive: true });
copyFileSync(FILE, BACKUP);
console.log(`已备份：${BACKUP}`);
console.log(`清理前：provider=${JSON.stringify(cfg.provider)}  model=${JSON.stringify(cfg.model)}`);

cfg.provider = null;
cfg.model = null;
writeFileSync(FILE, JSON.stringify(doc, null, 2), "utf8");

const after = JSON.parse(readFileSync(FILE, "utf8")).entries.config;
console.log(`清理后：provider=${JSON.stringify(after.provider)}  model=${JSON.stringify(after.model)}`);
console.log(`其余字段保留：${Object.keys(after).filter((k) => k !== "provider" && k !== "model").join(", ")}`);
const archive = JSON.parse(readFileSync(FILE, "utf8")).entries?.archiveIndex;
console.log(`归档索引仍在：${archive?.entries?.length ?? 0} 期`);
