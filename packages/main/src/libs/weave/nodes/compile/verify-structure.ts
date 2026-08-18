/**
 * weaver · compile · 约束器（v15）
 *
 * v15 变更：
 *   - reAct 消息结构不再强制变量名必须是 messages
 *   - 接受 const / let / var 声明
 *   - 接受单引号、双引号、反引号字符串
 *   - 接受 role: 'user' / role: "user" / role: `user`
 *   - 接受 push / assignment / concat 等等价消息追加形式
 *   - 保留循环、LLM 调用、verify、continue、末轮降级检查
 */

import type { FlowNode } from "../../types.js";
import type { ApiCatalog } from "./api-catalog.js";
import { checkCompilation, checkRegexLiterals } from "./code-executor.js";
import type { FunctionPlan, ParallelismHint } from "./parse-types.js";

export interface VerificationResult {
    valid: boolean;
    feedback: { kind: "compilation" | "structure" | "api" | "parallel"; msg: string }[];
}

const API_NAME_RE = /\b(llm|tool)\.([a-zA-Z_$][\w$]*)/g;
const BANNED_GLOBAL_RE =
    /\b(require|process|fs|child_process|crypto|vm|worker_threads)\s*\(/g;
const BANNED_BUILTINS_NAMED = /\b(axios|lodash|moment_|ramda|jquery)\b/g;
const TERSER_LOC_RE = /\(([0-9]+):([0-9]+)\)|line\s+([0-9]+).*col(?:umn)?\s+([0-9]+)/i;

export async function verifyFunctionPlan(
    plan: FunctionPlan,
    code: string,
    declaredInputs: string[],
    declaredOutputs: string[],
    catalog: ApiCatalog,
    _node: FlowNode,
): Promise<VerificationResult> {
    const feedback: VerificationResult["feedback"] = [];

    if (!code.trim()) {
        feedback.push({ kind: "structure", msg: "代码为空，必须输出完整 main 与全部实现。" });
        return { valid: false, feedback };
    }

    // ── 0.裸 regex 预检 ──
    const regexCheck = checkRegexLiterals(code);
    if (!regexCheck.ok) {
        feedback.push({
            kind: "compilation",
            msg: `[regex预检] ${regexCheck.error}`,
        });
        return { valid: false, feedback };
    }

    // ── 1. 编译 ──
    const comp = await checkCompilation(code);
    if (!comp.terserOk) {
        feedback.push({
            kind: "compilation",
            msg: `[terser] 代码语法错误：${formatSyntaxError(comp.terserError)}`,
        });
    }
    if (!comp.scriptOk) {
        feedback.push({
            kind: "compilation",
            msg: `[vm.Script] 编译失败：${comp.scriptError}`,
        });
    }
    if (!comp.ok) return { valid: false, feedback };

    const stripped = stripComments(code);

    // ── 2.1 main 签名 ──
    if (!/async\s+function\s+main\s*\(/.test(stripped)) {
        feedback.push({ kind: "structure", msg: "必须包含 `async function main(...)` 定义。" });
    }

    const mainSig = stripped.match(/async\s+function\s+main\s*\(([^)]*)\)/);
    if (mainSig) {
        const params = mainSig[1].trim();
        const paramCount = params
            ? params.split(",").filter((p) => p.trim().length > 0).length
            : 0;

        if (paramCount !== 2) {
            feedback.push({
                kind: "structure",
                msg: `main 必须恰好有两个参数（输入对象, instructions），当前参数数量=${paramCount}。`,
            });
        }
    }

    // ── 2.2 main 内容和 reAct 结构 ──
    const mainBody = extractMainBody(stripped);
    if (!mainBody) {
        feedback.push({
            kind: "structure",
            msg: "main 函数体提取失败，请确认花括号配对正确。",
        });
    } else {
        if (!/\breturn\s*\{[\s\S]*?\}\s*;?/.test(mainBody)) {
            feedback.push({
                kind: "structure",
                msg: "main 函数体内必须出现 `return { <outputKey>: <value>, ... };` 对象返回。",
            });
        }

        const hasReAct = verifyReActShape(mainBody, stripped);
        if (!hasReAct.ok) {
            feedback.push({
                kind: "structure",
                msg: `reAct 结构不完整：${hasReAct.missing.join("；")}。\n` +
                    "必须包含：限次循环 + 主思考 llm.generate({instructions, messages}) + user 消息 + assistant 消息 + verify 函数（返回 {ok, feedback}）+ 反馈 continue + return。",
            });
        }

        const hasLastRoundBypass = verifyLastRoundBypass(mainBody);
        if (!hasLastRoundBypass.ok) {
            feedback.push({
                kind: "structure",
                msg: `reAct 末轮降级缺失：${hasLastRoundBypass.missing.join("；")}。\n` +
                    "必须在循环最后一轮（无论用 `round === MAX - 1`、`i === 5`、`round >= N - 1` 哪种写法）" +
                    "先于 verify 直接 `return { <outputKey>: text, ... };`。\n" +
                    "这是工程韧性保证——防止 verify instruction 本身有缺陷时无限循环。",
            });
        }

        for (const inp of declaredInputs) {
            if (!stripped.includes(inp)) {
                feedback.push({
                    kind: "structure",
                    msg: `声明的输入 \`${inp}\` 未在代码中出现——入参对象 key 必须逐字一致。`,
                });
            }
        }

        for (const out of declaredOutputs) {
            if (!stripped.includes(out)) {
                feedback.push({
                    kind: "structure",
                    msg: `声明的输出 \`${out}\` 未在代码中出现——return 对象的 key 必须逐字一致。`,
                });
            }
        }
    }

    if (!["code", "llm", "aigc", "human", "external"].includes(plan.apiKind)) {
        feedback.push({ kind: "structure", msg: `api_kind 值不合法：${plan.apiKind}。` });
    }

    // ── 2.3 verify 函数必须 async ──
    const verifyAsyncCheck = verifyFunctionsAreAsync(stripped);
    if (!verifyAsyncCheck.ok) {
        feedback.push({
            kind: "structure",
            msg: verifyAsyncCheck.message,
        });
    }

    // ── 3. API 与全局对象合规 ──
    const allowedToolNames = new Set(
        catalog.tools.map((t) => t.signature.split(".")[1]),
    );
    const allowedLlmNames = new Set([
        "generate",
        "streamGenerate",
        "safefmt",
        "Output",
    ]);

    const usageMatches = [...stripped.matchAll(API_NAME_RE)];
    for (const m of usageMatches) {
        const ns = m[1];
        const name = m[2];

        if (ns === "llm") {
            if (!allowedLlmNames.has(name)) {
                feedback.push({
                    kind: "api",
                    msg: `调用了 llm.${name}——允许的只有 llm.${[...allowedLlmNames].join(" / llm.")}。`,
                });
            }
        } else if (ns === "tool") {
            if (!allowedToolNames.has(name)) {
                feedback.push({
                    kind: "api",
                    msg: `调用了 tool.${name}——本任务可用工具：${allowedToolNames.size > 0 ? `[${[...allowedToolNames].join(", ")}]` : "（无）"}。`,
                });
            }
        }
    }

    if (BANNED_GLOBAL_RE.test(code)) {
        feedback.push({
            kind: "api",
            msg: "检测到禁止的全局调用（require / process / fs / child_process / crypto / vm / worker_threads）。代码只能使用 llm.* / tool.* / globals 清单。",
        });
    }

    if (BANNED_BUILTINS_NAMED.test(code)) {
        feedback.push({
            kind: "api",
            msg: "检测到禁止的第三方库名（axios / lodash / moment / ramda / jquery）。只允许 globals 清单内对象。",
        });
    }

    const pMapUsages = [...code.matchAll(/pMap\s*\([^)]*\)/g)];
    for (const u of pMapUsages) {
        if (!/concurrency\s*:\s*\d+/.test(u[0])) {
            feedback.push({
                kind: "api",
                msg: "pMap 调用必须显式给出 concurrency 选项（如 { concurrency: 8 }）。",
            });
        }

        const cm = u[0].match(/concurrency\s*:\s*(\d+)/);
        if (cm && cm[1] !== "8") {
            feedback.push({
                kind: "api",
                msg: `pMap 并发数必须设为 8，当前为 ${cm[1]}。`,
            });
        }
    }

    return {
        valid: !feedback.some(
            (f) =>
                f.kind === "compilation" ||
                f.kind === "structure" ||
                f.kind === "api",
        ),
        feedback,
    };
}

// ════════════════════════════════════════════════════════════════
// reAct 结构检查
// ════════════════════════════════════════════════════════════════

function verifyReActShape(
    body: string,
    fullCode: string,
): { ok: boolean; missing: string[] } {
    const checks: [() => boolean, string][] = [
        [
            () => hasUserMessage(body),
            "包含 role: 'user' 的用户消息",
        ],
        [
            () => hasIterationLoop(body),
            "for/while 限次循环",
        ],
        [
            () => /await\s+llm\.generate\s*\(/.test(body),
            "await llm.generate(...) 主思考",
        ],
        [
            () => hasAssistantMessage(body),
            "追加或记录 role: 'assistant' 的主思考结果",
        ],
        [
            () => hasVerifyPattern(body, fullCode),
            "verify 函数（返回 {ok, feedback} 并驱动 continue）",
        ],
    ];

    const missing: string[] = [];
    for (const [check, desc] of checks) {
        if (!check()) {
            missing.push(`缺 ${desc}`);
        }
    }

    return {
        ok: missing.length === 0,
        missing,
    };
}

/**
 * 判断是否包含用户消息。
 *
 * 接受：
 *   const messages = [{ role: "user", content: ... }];
 *   let history = [{ role: "user", content: ... }];
 *   messages.push({ role: "user", content: ... });
 *   history = [...history, { role: "user", content: ... }];
 *
 * 不再要求变量名必须是 messages。
 */
function hasUserMessage(body: string): boolean {
    const userRole = /role\s*:\s*['"`]user['"`]/i;
    return userRole.test(body);
}

/**
 * 判断是否包含 assistant 消息。
 *
 * 接受：
 *   messages.push({ role: "assistant", content: text });
 *   history = [...history, { role: "assistant", content: result.text }];
 *   const assistantMessage = { role: "assistant", content: text };
 */
function hasAssistantMessage(body: string): boolean {
    const assistantRole = /role\s*:\s*['"`]assistant['"`]/i;
    return assistantRole.test(body);
}

/**
 * 检测限次循环。
 *
 * 接受：
 *   for (...; i < N; ...)
 *   for (...; attempt <= 5; ...)
 *   while (round < MAX)
 *   while (attempts !== 6)
 */
function hasIterationLoop(body: string): boolean {
    if (
        /for\s*\([^;]*;\s*\w+\s*(?:<|<=|!==|>=)\s*[^;]+;[^)]*\)/.test(
            body,
        )
    ) {
        return true;
    }

    if (
        /while\s*\(\s*\w+\s*(?:<|<=|!==|>=)\s*[^)]+\)/.test(
            body,
        )
    ) {
        return true;
    }

    return false;
}

/**
 * 检测 verify 模式。
 */
function hasVerifyPattern(body: string, fullCode: string): boolean {
    if (
        /if\s*\(\s*![\w.]+\.ok\s*\)/.test(body) &&
        /\bcontinue\b/.test(body)
    ) {
        return true;
    }

    const hasVerifyDef =
        /(?:async\s+)?function\s+verify\w*\s*\(/.test(fullCode);
    const hasVerifyCall = /await\s+verify\w*\s*\(/.test(body);

    if (hasVerifyDef && hasVerifyCall) {
        return true;
    }

    if (
        /\{\s*ok\s*:/.test(body) &&
        /feedback\s*:/.test(body) &&
        /\bcontinue\b/.test(body)
    ) {
        return true;
    }

    return false;
}

/**
 * 检测 verify 函数是否为 async。
 */
function verifyFunctionsAreAsync(
    code: string,
): { ok: boolean; message: string } {
    const nonAsyncVerify =
        /(?<!async\s)function\s+(verify\w*)\s*\(/g;
    const matches = [...code.matchAll(nonAsyncVerify)];

    if (matches.length > 0) {
        const names = matches.map((m) => m[1]).join("、");
        return {
            ok: false,
            message:
                `verify 函数「${names}」必须声明为 async function——` +
                "verify 内部需要调用 await llm.generate()，非 async 函数会导致运行时错误。",
        };
    }

    return {
        ok: true,
        message: "",
    };
}

// ════════════════════════════════════════════════════════════════
// 末轮降级检查
// ════════════════════════════════════════════════════════════════

function verifyLastRoundBypass(
    body: string,
): { ok: boolean; missing: string[] } {
    const missing: string[] = [];

    const hasLastReturn =
        /if\s*\([^)]*\)[\s\S]*?return\s*\{[\s\S]*?\}\s*;?/.test(
            body,
        );

    if (!hasLastReturn) {
        missing.push(
            "缺 if (...) { return { <outputKey>: text, ... }; } 早返回分支",
        );
        return {
            ok: false,
            missing,
        };
    }

    const hasNumericCondition =
        /if\s*\(\s*[^)]*\w+\s*(?:===|!==|>=|<=|>|<)\s*[^)]*\)/.test(
            body,
        );

    if (!hasNumericCondition) {
        missing.push(
            "早返回分支的条件必须涉及某种数值比较（===、>=、<= 等）",
        );
        return {
            ok: false,
            missing,
        };
    }

    return {
        ok: true,
        missing: [],
    };
}

// ════════════════════════════════════════════════════════════════
// 代码解析工具函数
// ════════════════════════════════════════════════════════════════

function stripComments(code: string): string {
    let result = "";
    let i = 0;

    while (i < code.length) {
        const ch = code[i];

        if (ch === '"' || ch === "'") {
            const end = scanSimpleString(code, i);
            result += code.slice(i, end);
            i = end;
            continue;
        }

        if (ch === "`") {
            const end = scanTemplateString(code, i);
            result += code.slice(i, end);
            i = end;
            continue;
        }

        if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            const nl = code.indexOf("\n", i);
            i = nl === -1 ? code.length : nl;
            continue;
        }

        if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            const end = code.indexOf("*/", i + 2);
            i = end === -1 ? code.length : end + 2;
            continue;
        }

        result += ch;
        i++;
    }

    return result;
}

function extractMainBody(code: string): string | null {
    const m = code.match(
        /async\s+function\s+main\s*\([^)]*\)\s*\{/,
    );

    if (!m) {
        return null;
    }

    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;

    while (i < code.length && depth > 0) {
        const ch = code[i];

        if (ch === '"' || ch === "'") {
            i = scanSimpleString(code, i);
            continue;
        }

        if (ch === "`") {
            const end = scanTemplateString(code, i);
            if (end > code.length - 1) {
                const lastBacktick = code.lastIndexOf("`", i + 1);
                if (lastBacktick > start) {
                    i = lastBacktick + 1;
                    continue;
                }
                return code.slice(start, i);
            }
            i = end;
            continue;
        }

        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
        }

        i++;
    }

    if (depth !== 0) {
        return null;
    }

    return code.slice(start, i - 1);
}

function scanSimpleString(
    code: string,
    start: number,
): number {
    const quote = code[start];
    let i = start + 1;

    while (i < code.length) {
        if (code[i] === "\\") {
            i += 2;
            continue;
        }

        if (code[i] === quote) {
            return i + 1;
        }

        i++;
    }

    return i;
}

function scanTemplateString(
    code: string,
    start: number,
): number {
    let i = start + 1;

    while (i < code.length) {
        const ch = code[i];

        if (ch === "\\") {
            i += 2;
            continue;
        }

        if (ch === "`") {
            return i + 1;
        }

        if (ch === "$" && i + 1 < code.length && code[i + 1] === "{") {
            i += 2;
            let exprDepth = 1;

            while (i < code.length && exprDepth > 0) {
                const ec = code[i];

                if (ec === "\\") {
                    i += 2;
                    continue;
                }

                if (ec === "{") {
                    exprDepth++;
                    i++;
                } else if (ec === "}") {
                    exprDepth--;
                    if (exprDepth === 0) {
                        i++;
                        break;
                    }
                    i++;
                } else if (ec === "`") {
                    i = scanTemplateString(code, i);
                } else if (ec === '"' || ec === "'") {
                    i = scanSimpleString(code, i);
                } else {
                    i++;
                }
            }

            continue;
        }

        i++;
    }

    return i;
}

// ════════════════════════════════════════════════════════════════
// 错误位置 / 并行提示
// ════════════════════════════════════════════════════════════════

function formatSyntaxError(
    raw: string | undefined,
): string {
    if (!raw) {
        return "(空)";
    }

    const m = raw.match(TERSER_LOC_RE);

    if (m) {
        const line = m[1] ?? m[3];
        const col = m[2] ?? m[4];
        return `${raw}（行 ${line} 列 ${col}）`;
    }

    return raw;
}

export function detectParallelism(
    code: string,
): ParallelismHint {
    const mainBody = extractMainBody(stripComments(code));

    if (!mainBody) {
        return {
            kind: "sequential",
            parallelGroups: [],
            note: "main 函数体无法解析，跳过并行判定。",
        };
    }

    const awaits: { expr: string }[] = [];
    const lines = mainBody.split("\n");
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const opens = (ln.match(/\{/g) ?? []).length;
        const closes = (ln.match(/\}/g) ?? []).length;
        depth += opens - closes;

        const m = ln.match(
            /^\s*(?:const\s+(\w+)\s*=\s*)?await\s+([^\n;]+)/,
        );

        if (m && depth <= 1) {
            awaits.push({
                expr: m[2].trim(),
            });
        }
    }

    if (awaits.length < 2) {
        return {
            kind: "sequential",
            parallelGroups: [],
            note: "独立 await 数 < 2，无需并行优化。",
        };
    }

    const parallelGroups: string[][] = [];
    let current: string[] = [];

    for (let i = 0; i < awaits.length; i++) {
        const cur = awaits[i];
        current.push(cur.expr);

        const referenced = awaits
            .slice(i + 1)
            .some((later) =>
                later.expr.includes(
                    cur.expr.split("(")[0].trim(),
                ),
            );

        if (!referenced) {
            parallelGroups.push([...current]);
            current = [];
        }
    }

    if (current.length > 0) {
        parallelGroups.push(current);
    }

    if (
        parallelGroups.length >= 1 &&
        parallelGroups.some((g) => g.length >= 2)
    ) {
        return {
            kind: "partial",
            parallelGroups,
            note: "检测到可并行的 await 语句，可改写为 Promise.all 缩短整体时延。",
        };
    }

    return {
        kind: "sequential",
        parallelGroups: [],
        note: "await 间存在数据依赖，保持串行。",
    };
}