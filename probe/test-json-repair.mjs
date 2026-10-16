/**
 * 模型输出解析的回归测试
 *
 * 起因：qoder-cn 这条线路的 maxTokens 在目录里是 undefined，我们请求的 4096
 * 对它来说偏小，模型输出到一半被砍断。旧版 extractJson 只认「首 { 到末 }」，
 * 面对截断输入永远拼不出合法结构，一整期日报因此死掉，而报错只说
 * 「模型没有返回合法 JSON」，看不出是被截断。
 *
 * 断言分两类：
 *   必须救回来（结构基本完整，只少了尾巴）
 *   必须拒掉（残缺到补不回来时，宁可报错也不能编一份假日报）
 * 后者更重要：把截断的 JSON 硬凑成合法对象，等于把半截新闻当完整报道发出去。
 *
 * 用法：node probe/test-json-repair.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractJson } from "../lib/editorial/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "..", "index.js"), "utf8");

/** 从 index.js 里抠出内部函数来单测（整个模块 import 会去连宿主 sdk） */
function pick(name, end) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`找不到 ${name}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`找不到 ${name} 的结尾`);
  return src.slice(i, j + end.length);
}

const salvage = new Function(
  `${pick("salvageTruncatedJson", "\n  }")}; return salvageTruncatedJson;`
)();

/** 与 index.js 里等价的 parseModelJson：返回 { data, salvaged } */
function parse(t) {
  const direct = extractJson(t);
  if (direct) return { data: direct, salvaged: false };
  return { data: salvage(t), salvaged: true };
}

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

// 真实形状：highlights 完整，sections 写到一半被砍
const truncated = `{
  "highlights": [
    "Meta 发布 816B 参数开放权重模型，并联合 Apple 实现 Mac 本地运行",
    "Google 发布 Gemini 4，以限时半价 API 重返大模型第一梯队"
  ],
  "sections": [
    {
      "title": "模型与算力",
      "items": [
        { "ref": 1, "note": "开放权重阵营迎来迄今最大规模玩家" },
        { "ref": 2, "note": "半价策略把推理成本重新拉回`;

const complete = `{
  "highlights": ["A", "B"],
  "sections": [{ "title": "T", "items": [{ "ref": 1, "note": "n" }] }]
}`;

console.log("=== 旧版为什么失败：截断输入 extractJson 无解 ===");
t("截断输入 extractJson 返回 null", extractJson(truncated) === null);
t("完整输入 extractJson 正常", !!extractJson(complete));

console.log("\n=== 加上截断拼回后 ===");
const r0 = parse(truncated);
const fixed = r0.data;
t("截断输入能解出对象", !!fixed && typeof fixed === "object");
t("且标为 salvaged（外层该打截断标签）", r0.salvaged === true);
t("已写完的 highlights 两条都保住", fixed?.highlights?.length === 2);
t("sections 是数组而非残缺对象", Array.isArray(fixed?.sections));
t("已闭合的那一个栏目保住了", fixed?.sections?.length === 1);

const c0 = parse(complete);
t("完整输入仍走原路径", c0.data?.highlights?.length === 2);
t("完整输入不误标 salvaged", c0.salvaged === false);

console.log("\n=== 包裹与噪声（extractJson 该赢）===");
t("markdown 代码块", !!parse("```json\n" + complete + "\n```").data);
t("前后带散文", !!parse("好的，以下是结果：\n" + complete + "\n希望有用").data);

console.log("\n=== 必须拒掉的：不能为了凑合法而编数据 ===");
const hopeless = [
  ["只有开头没有内容", '{\n  "highlights": ['],
  ["完全不是 JSON", "今天天气不错，我想到几个新闻"],
  ["空字符串", ""],
  ["只有散文包裹的花括号", "见下 { 这里没有结构"],
];
for (const [label, s] of hopeless) {
  const r = parse(s).data;
  const hasContent = r && (r?.highlights?.length || r?.sections?.length);
  t(`拒掉：${label}`, !hasContent, r ? JSON.stringify(r).slice(0, 70) : "");
}

console.log("\n=== 括号计数不能被字符串内的符号骗 ===");
t(
  "字符串内的 } 不算闭合",
  salvage('{"a":"里有 } 和 [ 的字符串","b":[{"c":"ok"}') !== null
);
// 注：salvage 只负责被截断的输入。完整 JSON 它返回 null 是对的，
// 那是 extractJson 的活，不要在这里加「完整输入也该返回对象」这种断言。

console.log(`\n${fail === 0 ? "✓" : "✗"} 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
