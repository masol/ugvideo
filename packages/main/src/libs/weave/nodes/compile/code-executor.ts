/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · compile · 代码语法 / 编译校验
 *
 * v3 变更：
 * - 编译检查时用运行时相同的 wrapper 包裹代码
 *   `(async function (__ioc__) { with (__ioc__) { ... } })`
 *   确保顶层 await 合法、__ioc__ 成员（llm / tool / err 等）不报 undefined token
 * - 裸 regex 预检仍对原始代码执行（不受 wrapper 影响）
 */

import vm from "node:vm";
import { minify } from "terser";

export interface CompilationCheckResult {
    ok: boolean;
    terserOk: boolean;
    scriptOk: boolean;
    regexCheckOk: boolean;
    terserError?: string;
    scriptError?: string;
    regexError?: string;
}

/**
 * 运行时 wrapper——与实际执行环境保持一致。
 * 生成的代码在此 wrapper 内执行，因此编译检查也必须在此 wrapper 内进行。
 */
function wrapForCompilation(code: string): string {
    return `(async function (__ioc__) {\n  with (__ioc__) {\n${code}\n  }\n})`;
}

export async function checkCompilation(code: string): Promise<CompilationCheckResult> {
    const regexCheck = checkRegexLiterals(code);
    if (!regexCheck.ok) {
        return {
            ok: false,
            terserOk: true,
            scriptOk: true,
            regexCheckOk: false,
            regexError: regexCheck.error,
        };
    }

    const wrapped = wrapForCompilation(code);

    let terserOk = true;
    let terserError: string | undefined;
    try {
        const out = await minify(wrapped, {
            compress: false,
            mangle: false,
            format: { comments: false },
        });
        if (out && 'error' in out && out.error) {
            terserOk = false;
            terserError = String(out.error);
        }
    } catch (e: any) {
        terserOk = false;
        terserError = e?.message ?? String(e);
    }

    let scriptOk = true;
    let scriptError: string | undefined;
    try {
        new vm.Script(wrapped, { filename: "compiled.js" });
    } catch (e: any) {
        scriptOk = false;
        scriptError = e?.message ?? String(e);
    }

    return {
        ok: terserOk && scriptOk,
        terserOk,
        scriptOk,
        regexCheckOk: true,
        terserError,
        scriptError,
    };
}

/**
 * 扫描代码中所有裸 regex 字面量（`/.../`形式），做粗粒度完整性检查：
 *   - 是否左右斜杠配对
 *   - 字符类 `[]` 是否闭合
 *   - 分组 `()` 是否平衡
 *   - 量词 `{}` 是否闭合
 *
 * 注意：regex 预检对原始代码执行，不需要 wrapper。
 */
export function checkRegexLiterals(code: string): { ok: boolean; error?: string } {
    const stripped = stripCommentsAndStrings(code);

    let i = 0;
    while (i < stripped.length) {
        const ch = stripped[i];

        if (ch === "/") {
            const prev = i > 0 ? stripped[i - 1] : "";
            const isRegexContext = isLikelyRegexStart(stripped, i, prev);

            if (isRegexContext) {
                const end = findRegexEnd(stripped, i + 1);
                if (end === -1) {
                    return {
                        ok: false,
                        error: `检测到不完整的 regex 字面量（位置 ${i} 附近）：缺少右斜杠。` +
                            `常见原因：模板字符串 \${...}内的 regex 被截断，或字符组/分组未闭合。` +
                            `请将 regex 提取到外部 const（如 const FOO_RE = /.../;），再在代码中引用。`,
                    };
                }

                const body = stripped.slice(i + 1, end);
                const bal = checkBracketsBalanced(body);
                if (!bal.ok) {
                    return {
                        ok: false,
                        error: `检测到不完整的 regex 字面量（位置 ${i} 附近）：${bal.error}。` +
                            `字符组 []、分组 ()、量词 {} 必须配对。` +
                            `请检查 regex 内部结构，确保所有括号闭合。`,
                    };
                }

                i = end + 1;
                continue;
            }
        }

        i++;
    }

    return { ok: true };
}

function isLikelyRegexStart(code: string, pos: number, prev: string): boolean {
    if (pos === 0) return true;
    if (/[=,(;:!&|?{}+\-*/%^~<>]/.test(prev)) return true;
    if (/\s/.test(prev)) {
        let j = pos - 2;
        while (j >= 0 && /\s/.test(code[j])) j--;
        if (j < 0) return true;
        const before = code[j];
        return /[=,(;:!&|?{}+\-*/%^~<>]/.test(before);
    }
    return false;
}

function findRegexEnd(code: string, start: number): number {
    let i = start;
    let inCharClass = false;

    while (i < code.length) {
        const ch = code[i];

        if (ch === "\\") {
            i += 2;
            continue;
        }

        if (!inCharClass && ch === "[") {
            inCharClass = true;
            i++;
            continue;
        }

        if (inCharClass && ch === "]") {
            inCharClass = false;
            i++;
            continue;
        }

        if (!inCharClass && ch === "/") {
            return i;
        }

        if (ch === "\n") {
            return -1;
        }

        i++;
    }

    return -1;
}

function checkBracketsBalanced(body: string): { ok: boolean; error?: string } {
    let roundDepth = 0;
    let squareDepth = 0;
    let curlyDepth = 0;
    let inEscape = false;
    let inCharClass = false;

    for (let i = 0; i < body.length; i++) {
        const ch = body[i];

        if (inEscape) {
            inEscape = false;
            continue;
        }
        if (ch === "\\") {
            inEscape = true;
            continue;
        }

        if (!inCharClass && ch === "[") {
            inCharClass = true;
            squareDepth++;
            continue;
        }
        if (inCharClass && ch === "]") {
            inCharClass = false;
            squareDepth--;
            continue;
        }

        if (inCharClass) continue;

        if (ch === "(") {
            roundDepth++;
        } else if (ch === ")") {
            roundDepth--;
            if (roundDepth < 0) {
                return { ok: false, error: "右括号 `)` 多于左括号 `(`" };
            }
        } else if (ch === "{") {
            const next = body[i + 1];
            if (next !== undefined && (/[0-9]/.test(next) || next === ",")) {
                curlyDepth++;
            }
        } else if (ch === "}") {
            if (curlyDepth > 0) {
                curlyDepth--;
            }
        }
    }

    if (roundDepth > 0) return { ok: false, error: "左括号 `(` 多于右括号 `)`" };
    if (squareDepth > 0) return { ok: false, error: "字符组 `[` 未闭合" };

    return { ok: true };
}

function stripCommentsAndStrings(code: string): string {
    let result = "";
    let i = 0;

    while (i < code.length) {
        const ch = code[i];

        if (ch === '"' || ch === "'") {
            const end = scanSimpleString(code, i);
            result += " ".repeat(end - i);
            i = end;
            continue;
        }

        if (ch === "`") {
            const end = scanTemplateString(code, i);
            result += " ".repeat(end - i);
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

function scanSimpleString(code: string, start: number): number {
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

function scanTemplateString(code: string, start: number): number {
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