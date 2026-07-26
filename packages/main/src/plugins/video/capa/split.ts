import { throwPrecondition } from "$libs/utils/err.js";
// import { delay } from "$libs/utils/promise.js";
import { BaseFunctor, fillCapa } from "$libs/blueprint/capability/base.js";
import { getIOInfo } from "$libs/blueprint/glossary/ioinfo.js";
import { saveToOutput } from "$libs/blueprint/glossary/output.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import { CacheItem } from "$types/index.js";
import { isString } from "radashi";


function splitLines(raw: string): string[] {
    const lines = raw.split('\n');
    return lines;
    // return lines.filter((line) => line); // 空行在后续有助于内容拆分吗？？
}

function formatId(n: number): string {
    return `P${String(n).padStart(3, '0')}`;
}


function isCJKRange(cp: number): boolean {
    return (
        (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified Ideographs
        (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Extension A
        (cp >= 0x20000 && cp <= 0x2a6df) ||  // CJK Extension B
        (cp >= 0x3040 && cp <= 0x30ff) ||  // Hiragana + Katakana
        (cp >= 0xac00 && cp <= 0xd7af) ||  // Korean Hangul
        (cp >= 0x3000 && cp <= 0x303f) ||  // CJK Symbols & Punctuation
        (cp >= 0xff00 && cp <= 0xffef) ||  // Fullwidth Forms
        (cp >= 0x2e80 && cp <= 0x2eff)      // CJK Radicals Supplement
    );
}

/**
 * 估算文本的 token 数（基于 cl100k_base / o200k_base 经验规则）
 *
 * 规则：
 *  - CJK 表意文字及相关标点  ≈ 1 token / 字符（主流 tokenizer 实测接近 1:1）
 *  - ASCII 字母数字空格      ≈ 0.25 token / 字符（约 4 字符 = 1 token）
 *  - 其他 Unicode（Emoji 等）≈ 2 tokens / 字符（保守估算）
 */
function estimateTokens(text: string): number {
    let count = 0;
    for (const char of text) {
        const cp = char.codePointAt(0) ?? 0;
        if (isCJKRange(cp)) {
            count += 1;
        } else if (cp <= 0x7f) {
            count += 0.25;
        } else {
            count += 2;
        }
    }
    return Math.ceil(count);
}


// 将原文分割为shot列表。
export class SplitFunctor extends BaseFunctor {
    constructor() {
        super(fillCapa({
            id: "a59566b3-5ade-4965-b4a4-cfa8287216db",
            name: "split",
            input: [
                "script",
            ],
            output: [
                "paragraph"
            ]
        }));
    }

    async doTask(ctx: IRunnerContext): Promise<void> {
        //获取输入
        if (this.capa.input && this.capa.output) {

            const ioInfo = getIOInfo(ctx, this.capa);
            ctx.debug("split ioInfo=", JSON.stringify(ioInfo, null, 2))

            // 测试模型筛选功能。
            // const model = getSmartModel({ sort: SortStrategy.VersionAsc }, ctx)
            // generateText({
            //     model: model,
            //     prompt: "输出一个1"
            // }).then(result => {
            //     ctx.debug("result=", result.content, model.modelId)
            // })

            // await delay(10);
            // const model2 = getSmartModel({ sort: SortStrategy.VersionAsc }, ctx)

            // generateText({
            //     model: model2,
            //     prompt: "输出一个2"
            // }).then(result => {
            //     ctx.debug("result=", result.content, model2.modelId)
            // })

            // await delay(10);
            // const model3 = getSmartModel({ sort: SortStrategy.VersionAsc }, ctx)
            // generateText({
            //     model: model3,
            //     prompt: "输出一个3"
            // }).then(result => {
            //     ctx.debug("result=", result.content, model3.modelId)
            // })
            // ctx.debug("model=", model.modelId, model2.modelId, model3.modelId)


            if (ioInfo.expired) {

                const scripts: CacheItem[] = ioInfo.inputs[0] as CacheItem[];

                // // 获取需要更新的ParaItemSchema。
                // const expChunks = getExpiredChunk(ctx, this.capa.input[0], this.capa.output[0]);
                // Logger.debug("expChunks=", JSON.stringify(expChunks, null, 2))

                let startId = 0;
                const output: CacheItem[] = [];

                // console.log("scripts=", scripts)
                scripts.forEach((s) => {
                    if (!isString(s.item)) {
                        throwPrecondition("[split functor] 传入了非字符串的剧本。")
                    }
                    const lines = splitLines(s.item);

                    const paragraphs: CacheItem[] = lines.map((text, i) => ({
                        id: formatId(startId + i + 1),
                        index: startId + i,
                        text,
                        ests: estimateTokens(text)
                    }));
                    output.push(...paragraphs);

                    startId += paragraphs.length;
                })
                ctx.debug("[split functor] 执行拆分的结果为:", JSON.stringify(output, null, 2))

                saveToOutput(ctx, this.capa.output[0], output);
            } else {
                ctx.debug("[split functor] 拆分未过期，跳过执行。")
            }
        }
        // await delay(1000);
    }
}
