/**
 * 供应商可调用性检查。
 *
 * 结论（有据可查，不是推测）：
 *   宿主的 provider 注册表里，键名可以是非 ASCII：
 *     models.json → providers["<非 ASCII 名>"]
 *   但 App 调用模型的入口有一道硬校验（宿主 bundle 里读到）：
 *     /^[A-Za-z0-9_.:-]{1,128}$/  → 不过就抛
 *     "provider must be 1-128 ASCII identifier characters"
 *   所以非 ASCII 名的供应商在**聊天窗口**能用（走宿主内部路径），在**本 App** 里用不了
 *   （走 App 模型契约）。ASCII 名的供应商能过这道门。
 *
 * 这个脚本把上面的判据固化下来：读宿主的 models.json 与 provider-catalog.json，
 * 列出哪些供应商是 App 可调用的。它只读文件，不改任何东西。
 *
 * 用法：node probe/check-provider-addressable.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOME = join(process.env.USERPROFILE || process.env.HOME, ".hanako");
/** 与宿主 bundle 里同一条规则 */
const ASCII_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const modelsDoc = readJson(join(HOME, "models.json"));
const providers = modelsDoc?.providers ?? {};
const names = Object.keys(providers);

if (!names.length) {
  console.error(`✗ 读不到 ${join(HOME, "models.json")} 里的 providers（宿主未配置或格式变了）`);
  process.exit(1);
}

console.log(`\n=== 宿主已注册供应商（共 ${names.length}）===`);
let usable = 0;
for (const n of names) {
  const arr = Array.isArray(providers[n]) ? providers[n] : (providers[n]?.models ?? []);
  const ok = ASCII_ID.test(n);
  if (ok) usable++;
  console.log(`  ${ok ? "✓" : "✗"} ${JSON.stringify(n).padEnd(20)} ${String(arr.length).padStart(2)} 个模型  ${ok ? "App 可调用" : "App 无法调用（名字非 ASCII）"}`);
}

console.log(`\n可被本 App 调用的供应商：${usable} / ${names.length}`);
const blocked = names.filter((n) => !ASCII_ID.test(n));
if (blocked.length) {
  console.log(`被宿主校验挡住的：${blocked.map((b) => JSON.stringify(b)).join(", ")}`);
  console.log("  这不是本 App 的 bug：宿主的 App 模型入口只接受 ASCII 标识符，");
  console.log("  而这些供应商在宿主注册表里的键名就是中文。要在本 App 里用它们，");
  console.log("  需要在 Hana 设置里给该供应商一个 ASCII 名称（例如 bailian）。");
}

// 顺带核对 provider-catalog.json 是否同一套键名
const cat = readJson(join(HOME, "provider-catalog.json"));
if (cat?.providers) {
  const catNames = Object.keys(cat.providers);
  const onlyInCat = catNames.filter((n) => !names.includes(n));
  const onlyInModels = names.filter((n) => !catNames.includes(n));
  console.log(`\nprovider-catalog.json 键数 ${catNames.length}；仅 catalog 有：${onlyInCat.length ? onlyInCat.join(", ") : "无"}；仅 models 有：${onlyInModels.length ? onlyInModels.join(", ") : "无"}`);
}

process.exit(0);
