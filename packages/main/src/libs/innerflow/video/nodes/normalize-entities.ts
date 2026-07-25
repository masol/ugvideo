// src/workflows/script-to-video/nodes/normalize-entities.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { ENTITY_NORMALIZER_PROMPT } from "../prompts/entity-normalizer.js";
import { STATE_TRACKER_PROMPT } from "../prompts/state-tracker.js";

/**
 * 节点 3：实体归一 + 状态维护
 *
 * 步骤：
 *   3.1 用 safefmt 把 raw entities 抽成结构化 "实体清单"
 *   3.2 LLM 归一（合并别名 / 同物不同名）
 *   3.3 LLM 按场景时间轴维护每个实体的"状态变化日志"
 *
 * 输出 KV：
 *   state:entity_register_nl (统一实体登记册 - 自然语言)
 *   state:state_log_nl (实体状态变化日志 - 自然语言)
 *   每个实体还有 state:entity:{id}:description 这种裸字符串描述
 */
export async function normalizeEntities(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const raw = prjdb.get<string>("state:entities_raw_nl");
    if (!raw) {
        ctx.warn("[normalizeEntities] 无原始实体数据");
        return;
    }

    ctx.notify("阶段一·实体归一", "正在合并同名实体 / 维护状态...");

    // ---------- 3.1 结构化抽取 ----------
    // const extractModel = getSmartModel({
    //     requiredAbilities: [ModelTags.Outline],
    //     sort: SortStrategy.VersionAsc,
    // }, ctx);

    const SceneEntitiesSchema = z.object({
        entities: z.array(z.object({
            scene_id: z.string().describe("场景编号 Sxx"),
            characters: z.array(z.object({
                local_id: z.string().describe("原始编号 Pxx"),
                name: z.string(),
                aliases: z.array(z.string()).describe("所有别名"),
                gender: z.string(),
                age: z.string(),
                appearance: z.string().describe("核心外貌特征"),
                costume: z.string().describe("服装描述"),
            })),
            props: z.array(z.object({
                local_id: z.string().describe("原始编号 Rxx"),
                name: z.string(),
                category: z.string(),
                visual: z.string(),
            })),
            environments: z.array(z.object({
                local_id: z.string().describe("原始编号 Exx"),
                location: z.string(),
                lighting: z.string(),
                tone: z.string(),
                decor: z.string(),
            })),
        })).describe("按场景提取的实体清单"),
    });

    const extracted = await safefmt(raw, Output.object({ schema: SceneEntitiesSchema }), ctx);
    if (!extracted.success || !extracted.value) {
        ctx.warn("[normalizeEntities] 实体抽取失败，跳过归一");
        return;
    }

    // ---------- 3.2 归一判定 + 统一描述 ----------
    const normalizeModel = getSmartModel({
        requiredAbilities: [ModelTags.Reasoning],
        minInctx: 32768,
    }, ctx);

    const { text: register } = await generateText({
        model: normalizeModel,
        system: ENTITY_NORMALIZER_PROMPT.system,
        prompt: ENTITY_NORMALIZER_PROMPT.user(JSON.stringify(extracted.value.output, null, 2)),
    });

    prjdb.set("state:entity_register_nl", register);

    // ---------- 3.3 状态变化日志 ----------
    const { text: stateLog } = await generateText({
        model: normalizeModel,
        system: STATE_TRACKER_PROMPT.system,
        prompt: STATE_TRACKER_PROMPT.user(register, raw),
    });

    prjdb.set("state:state_log_nl", stateLog);

    // ---------- 3.4 把"统一实体描述"也存为独立 KV 槽（供 VLM 比对） ----------
    // 我们让 LLM 同时给出"canonical description for image gen"
    const { text: canonical } = await generateText({
        model: normalizeModel,
        system: ENTITY_NORMALIZER_PROMPT.canonicalSystem,
        prompt: ENTITY_NORMALIZER_PROMPT.canonicalUser(register),
    });

    prjdb.set("state:entity_canonical_nl", canonical);

    // 写裸字符串描述到 entity:* slot
    const canonicalLines = canonical.split(/\n{2,}/).filter(Boolean);
    for (const block of canonicalLines) {
        // 取第一行作为名字 key
        const firstLine = block.split("\n")[0];
        const m = firstLine.match(/^#+\s*(.+)$/);
        if (!m) continue;
        const id = m[1].trim().toLowerCase().replace(/\s+/g, "_");
        prjdb.set(`entity:${id}:description`, block);
    }

    ctx.info(`[normalizeEntities] 完成，写入 entity:* 描述槽`);
}