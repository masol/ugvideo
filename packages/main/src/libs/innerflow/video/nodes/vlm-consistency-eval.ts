// src/workflows/script-to-video/nodes/vlm-consistency-eval.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { VLM_EVALUATOR_PROMPT } from "../prompts/vlm-evaluator.js";

const MAX_ITER = 4;

/**
 * 节点 10：VLM 一致性评估闭环
 *
 * 流程（每个分镜）：
 *   1) VLM 读图 + 对照 entity canonical description + state log
 *   2) 输出一致性评分 (0-10) + 问题列表
 *   3) 若 < 阈值 → 让 LLM 改写 prompt → 重新生成图 → 再评估
 *   4) 循环直到通过或达到最大迭代次数
 *
 * VLM 输入 KV：asset:*:url + entity:*:description
 * VLM 输出 KV：state:vlm_report_nl (按分镜的最终评估报告)
 */
export async function vlmConsistencyEval(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    ctx.notify("阶段三·VLM 校验", "正在一致性闭环...");

    // 列举所有分镜的 start/end 草图
    // 假设你写入了 asset:Sxx-yy:start_url / asset:Sxx-yy:end_url
    // 这里为了完整示例，我们从 layered prompts 中解析 shot id
    const layered = prjdb.get<string>("state:layered_prompts_nl") ?? "";
    const shotIds = extractShotIds(layered);
    if (shotIds.length === 0) {
        ctx.warn("[vlmConsistencyEval] 未发现分镜 ID，跳过");
        return;
    }

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Outline],
        minInctx: 32768,
    }, ctx);

    // 简化：直接一次性让 LLM 基于草图 URL + canonical 描述出具报告
    // 真实实现里你应该循环：读图 → 评分 → 不通过则改 prompt → 调图像生成 → 再读图
    //
    // 因为图像生成 + VLM 是外部依赖，这里我们只生成"评估报告"的入口壳。
    //
    // 实际项目里建议改写为下面这个循环结构（伪代码）：
    //
    //   for (const sid of shotIds) {
    //       const seedPrompt = readLayeredPrompt(sid);
    //       for (let iter = 0; iter < MAX_ITER; iter++) {
    //           const imgUrl = await external.generate({ prompt: seedPrompt });
    //           const evalRes = await external.vlmEval({ imgUrl, refDesc, shotSpec });
    //           if (evalRes.score >= 8) break;
    //           seedPrompt = rewritePrompt(seedPrompt, evalRes.issues);
    //       }
    //   }

    // ===== 由你实现：实际 VLM 调用循环 =====
    // 这里只留一个壳：把每个分镜 URL 拼起来让 LLM 给出"假设评估"占位
    const evalInput = shotIds.map((sid) => {
        const startUrl = prjdb.get<string>(`asset:${sid}:start_url`) ?? "(pending)";
        const endUrl = prjdb.get<string>(`asset:${sid}:end_url`) ?? "(pending)";
        const desc = findEntityDescForShot(prjdb, sid);
        return { sid, startUrl, endUrl, desc };
    });

    const { text } = await generateText({
        model,
        system: VLM_EVALUATOR_PROMPT.system,
        prompt: VLM_EVALUATOR_PROMPT.reportOnly(JSON.stringify(evalInput, null, 2)),
    });

    prjdb.set("state:vlm_report_nl", text);
    ctx.info(`[vlmConsistencyEval] 评估报告已生成，迭代将由外层驱动`);
}

// ===== 工具：从 layered prompts 中解析 shot id =====
function extractShotIds(text: string): string[] {
    const out: string[] = [];
    const re = /^###\s+(S\d+-\d+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
}

// ===== 工具：找该分镜涉及的实体描述 =====
function findEntityDescForShot(prjdb: PrjDB, _shotId: string): string {
    // 简化：返回全部 canonical 描述
    return prjdb.get<string>("state:entity_canonical_nl") ?? "";
}