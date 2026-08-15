/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · compile · 代码语法 / 编译校验
 *
 * 薄封装，DRY：
 *   1. terser minify 暴露 SyntaxError；
 *   2. vm.Script 暴露 host-level 拒收的写法（顶层 await 等）。
 *
 * 不执行代码，不依赖 side effect；压缩产物不进入存储（存原始代码）。
 */

import vm from "node:vm";
import { minify } from "terser";

export interface CompilationCheckResult {
    ok: boolean;
    terserOk: boolean;
    scriptOk: boolean;
    terserError?: string;
    scriptError?: string;
}

export async function checkCompilation(code: string): Promise<CompilationCheckResult> {
    let terserOk = true;
    let terserError: string | undefined;
    try {
        const out = await minify(code, {
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
        new vm.Script(code, { filename: "compiled.js" });
    } catch (e: any) {
        scriptOk = false;
        scriptError = e?.message ?? String(e);
    }

    return {
        ok: terserOk && scriptOk,
        terserOk,
        scriptOk,
        terserError,
        scriptError,
    };
}