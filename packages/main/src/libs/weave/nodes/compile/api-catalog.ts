/**
 * weaver · compile · 内建 API 清单 + 全局白名单（v2）
 *
 * 分两段注入到 system prompt：
 *   1. API 清单（llm.* / tool.*）——LLM 可调用的接口；
 *   2. 全局白名单（globals）——LLM 可直接使用的全局对象。
 *
 * 两段都必须告诉 LLM 边界在哪，否则会写出 require / import / fs 等禁用法。
 */

// import type { ExternalFunction } from "./parse-types.js";

export interface ApiMemberDoc {
    signature: string;
    description: string;
    example?: string;
}

export interface ApiCatalog {
    llm: ApiMemberDoc[];
    tools: ApiMemberDoc[];
    /** 渲染"全局白名单"段到 system prompt */
    renderGlobalsBlock(): string;
    /** 渲染"API 清单"段到 system prompt */
    renderAsSystemBlock(): string;
}

const LLMS: ApiMemberDoc[] = [
    {
        signature: "llm.generate(options)",
        description:
            "调用 LLM，返回 Promise<{text: string}>。" +
            "options 形如 `{ instructions?: string, prompt?: string, messages?: Array<{role:'user'|'assistant', content:string}> }`。" +
            "二选一传 prompt 或 messages，instructions 可选；不需要传 model（自动选择）。",
        example:
            "const { text } = await llm.generate({\n" +
            "  instructions: '你是资深编辑',\n" +
            "  prompt: '润色以下文本：\\n' + 草稿\n" +
            "});",
    },
    {
        signature: "llm.safefmt(nl, output)",
        description:
            "从自然语言文本 nl 中提取结构化 JSON。" +
            "第一个参数 nl 直接传 LLM 产出的原始文本字符串——safefmt 内部能自动处理任意格式的输入（包括含 markdown、代码块、混合格式的文本），" +
            "绝不需要调用方做任何预处理（禁止在调用前用 regex 提取 JSON、禁止 JSON.parse、禁止剥离代码块标记）。" +
            "第二个参数 output 必须是 `llm.Output.object({ schema: zodSchema })` 的形态（注意是 `{ schema }` 包装对象，**不是裸 schema**）。" +
            "output 使用的 zod schema **每个字段必须有 .describe() 描述**，描述越精确提取质量越高。" +
            "返回 Promise<NlFormatType>：成功时 result.value.output 是符合 zod schema 的 JSON 对象；失败时 result.success=false 且 result.err 非空。",
        example:
            "const Schema = z.object({ points: z.array(z.string()).describe('要点列表，每条一行') });\n" +
            "const r = await llm.safefmt(原文, llm.Output.object({ schema: Schema }));\n" +
            "if (!r.success || !r.value) err.throwUnprcessable('提取失败：' + JSON.stringify(r.err));\n" +
            "const points = r.value.output.points;",
    },
    {
        signature: "llm.streamGenerate(options)",
        description:
            "流式调用，返回 Promise<{textStream: AsyncIterable<string>}>。用于需要分块输出的场景。",
    },
    {
        signature: "llm.Output.object({ schema })",
        description:
            "配合 llm.safefmt 使用，必须传入 `{ schema: zodSchema }` 包装对象。",
    },
];

const GLOBALS: ApiMemberDoc[] = [
    {
        signature: "validator",
        description:
            "字符串验证库。常用：validator.isString(x)、validator.isURL(x)、validator.isEmail(x)、validator.isEmpty(x)、validator.trim(x)、validator.escape(x)、validator.toString(x) 等。" +
            "是 ESM 风格的对象（带括号调用）。",
        example: "if (!validator.isString(输入对象['用户邮箱'])) err.throwUnprcessable('用户邮箱必须是字符串');",
    },
    {
        signature: "z",
        description:
            "Zod schema 构造库。配合 llm.safefmt 使用——所有字段必须有 .describe() 描述。",
        example:
            "const ItemSchema = z.object({\n" +
            "  名称: z.string().describe('产物名称，逐字一致'),\n" +
            "  主题: z.string().describe('一句话语义作用')\n" +
            "});",
    },
    {
        signature: "randomUUID()",
        description: "生成 UUID v4。与本项目无关时一般不必调用。",
    },
    {
        signature: "pMap(items, mapper, opts)",
        description:
            "并发 map。items 是可迭代对象；mapper 是 async 函数；opts 形如 `{ concurrency: number, stopOnError?: boolean }`。" +
            "本项目并发数显式设为 8。",
        example:
            "const results = await pMap(items, async (item) => {\n" +
            "  return await 处理一个(item);\n" +
            "}, { concurrency: 8 });",
    },
    {
        signature: "util",
        description:
            "radashi 工具对象。常用方法：util.delay(ms)、util.unique(array)（去除重复）、util.chunk(array, size)、util.flatten(array)、util.sortBy(array, fn)、util.groupBy(array, fn) 等。" +
            "把这些当作普通对象上的方法调用即可。",
        example: "await util.delay(100);  // 等待 100ms",
    },
    {
        signature: "Fuse",
        description:
            "fuse.js v7.5，全局可直接使用，构造方式 `new Fuse(candidates, options)`。用于模糊匹配、相似度比对。",
    },
    {
        signature: "unified / remarkParse",
        description:
            "markdown 解析为 AST。`const tree = unified().use(remarkParse).parse(markdownStr);`",
    },
    {
        signature: "nodejieba",
        description: "中文分词（重型工具，仅在 fuse.js 对中文模糊匹配效果差时使用）。",
    },
];

const BANNED_GLOBALS: ApiMemberDoc[] = [
    {
        signature: "（禁止）require / import",
        description: "代码中不得出现 require() / import 任何外部包。",
    },
    {
        signature: "（禁止）Node.js 内建模块",
        description:
            "禁止调用 fs / net / http / child_process / process / crypto / vm / worker_threads。" +
            "需要 IO 操作一律通过 tool.* 接口走工具层。",
    },
    {
        signature: "（禁止）第三方 npm 包",
        description:
            "禁止通过任何途径（require / import / globalThis.X 假设）使用清单外的 npm 包。" +
            "lodash、axios、moment 等一律不可用。",
    },
];

export function buildApiCatalog(availableToolNames: string[]): ApiCatalog {
    const tools: ApiMemberDoc[] = availableToolNames.map((name) => ({
        signature: `tool.${name}(args)`,
        description:
            `可用工具 \`${name}\`，具体入参 / 出参参考任务说明里关于此工具的描述；` +
            "调用前若需 LLM 抽取参数，可与 llm.generate / llm.safefmt 组合使用。",
    }));

    return {
        llm: LLMS,
        tools,
        renderAsSystemBlock(this: ApiCatalog): string {
            return renderApiBlock(this.llm, this.tools);
        },
        renderGlobalsBlock(this: ApiCatalog): string {
            return renderGlobalsBlock(GLOBALS, BANNED_GLOBALS);
        },
    };
}

function renderApiBlock(llms: ApiMemberDoc[], tools: ApiMemberDoc[]): string {
    const lines: string[] = [];
    lines.push("## llm.*（LLM 调用，必须只能使用本节列出的接口）");
    lines.push("");
    for (const m of llms) {
        lines.push(`### \`${m.signature}\``);
        lines.push(m.description);
        if (m.example) {
            lines.push("");
            lines.push("```js");
            lines.push(m.example);
            lines.push("```");
        }
        lines.push("");
    }

    if (tools.length > 0) {
        lines.push("## tool.*（工具调用）");
        lines.push("");
        for (const m of tools) {
            lines.push(`### \`${m.signature}\``);
            lines.push(m.description);
            lines.push("");
        }
    }
    return lines.join("\n");
}

function renderGlobalsBlock(globals: ApiMemberDoc[], banned: ApiMemberDoc[]): string {
    const lines: string[] = [];
    lines.push("## 全局白名单（可直接使用，无需 require / import）");
    lines.push("");
    for (const m of globals) {
        lines.push(`### \`${m.signature}\``);
        lines.push(m.description);
        if (m.example) {
            lines.push("");
            lines.push("```js");
            lines.push(m.example);
            lines.push("```");
        }
        lines.push("");
    }

    lines.push("## 禁止调用（编译会静态扫描，触发即失败）");
    lines.push("");
    for (const m of banned) {
        lines.push(`### ${m.signature}`);
        lines.push(m.description);
        lines.push("");
    }
    return lines.join("\n");
}

// 仅引用以满足校验器
// type _Ref = ExternalFunction;