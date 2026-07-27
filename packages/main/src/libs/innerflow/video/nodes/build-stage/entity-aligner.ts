// nodes/build-stage/entity-aligner.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { ENTITY_ALIGNER_PROMPT } from "./prompts/entity-aligner.js";
import { Storage } from "./storage.js";
import type { GlobalEntity, StageEntity } from "./types.js";

/**
 * Pass D：跨场景实体对齐（串行，按叙事顺序调用）。
 *
 * 用原文名称做主键：
 *   - 名称不在登记册 → 新建全局实体；
 *   - 名称已在登记册 → LLM 布尔核对是否同一实体：
 *       同一个 → 追加本场景到 scenes[]；
 *       名同实不同（外观硬冲突）→ 加定语另立。
 * 结果写 stage:align:{scene}（本场局部名 → 全局规范名），
 * 不改动 stage 抽取产物本身，保持产物纯净、独立时效。
 */
export async function alignScene(ctx: IRunnerContext, sceneId: string): Promise<void> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.alignKey(sceneId),
    })) {
        ctx.info(`[alignScene] ${sceneId} 对齐仍新鲜，跳过`);
        return;
    }

    const stage = store.getStage(sceneId);
    if (!stage) return;

    const mapping: Record<string, string> = {};

    for (const entity of stage.entities) {
        // 光源不入全局登记册（场景局部即可）
        if (entity.kind === "light") {
            mapping[entity.name] = entity.name;
            continue;
        }

        const existing = store.getGlobalEntity(entity.name);

        if (!existing) {
            store.upsertGlobalEntity({
                name: entity.name,
                kind: entity.kind,
                appearance: entity.appearance ?? "",
                scenes: [sceneId],
            });
            mapping[entity.name] = entity.name;
            continue;
        }

        const same = await verifySameEntity(ctx, existing, entity, sceneId);
        if (same) {
            store.addSceneToEntity(entity.name, sceneId);
            mapping[entity.name] = entity.name;
        } else {
            const disamb = `${entity.name}·${sceneId}`;
            store.upsertGlobalEntity({
                name: disamb,
                kind: entity.kind,
                appearance: entity.appearance ?? "",
                scenes: [sceneId],
            });
            mapping[entity.name] = disamb;
            ctx.info(`[alignScene] ${sceneId} 同名不同实体，另立：${disamb}`);
        }
    }

    store.saveStageAlign(sceneId, mapping);
    ctx.info(`[alignScene] ${sceneId} 对齐完成，${Object.keys(mapping).length} 个实体`);
}

/** LLM 布尔核对：两处描述是否同一实体。不走 safefmt，末行读 SAME/DIFFERENT，模糊默认 SAME。 */
async function verifySameEntity(
    ctx: IRunnerContext,
    known: GlobalEntity,
    incoming: StageEntity,
    incomingScene: string,
): Promise<boolean> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        system: ENTITY_ALIGNER_PROMPT.system,
        prompt: ENTITY_ALIGNER_PROMPT.user(
            incoming.name,
            incoming.kind,
            known.appearance || "（原文无外观描写）",
            known.scenes.join("、"),
            incoming.appearance || "（原文无外观描写）",
            incomingScene,
        ),
    });

    const lastLine = text.trim().split(/\n+/).pop()?.trim().toUpperCase() ?? "";
    // 只有明确 DIFFERENT 才判不同；其余（含模糊）默认同一实体（宁合勿分）
    return !lastLine.includes("DIFFERENT");
}