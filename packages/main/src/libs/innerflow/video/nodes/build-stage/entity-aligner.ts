// nodes/build-stage/entity-aligner.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { ENTITY_ALIGNER_PROMPT } from "./prompts/entity-aligner.js";
import { StageStorage } from "./storage.js";
import type { GlobalEntity, StageEntity } from "./types.js";

const ALIGN_SCHEMA = z.object({
    matches: z.array(z.object({
        local_id: z.string().describe("本场景局部实体编号，如 e01"),
        matched_gid: z.string().nullable().describe("命中的全局实体编号(如 C01)；新实体填 null"),
        is_new: z.boolean().describe("true=登记册中无匹配、需新建全局实体；false=命中已有"),
        reason: z.string().describe("判定理由，一句话"),
    })).describe("逐个待对齐实体的判定结果"),
});

/** 需要跨场景对齐的类别（光源留场景局部，不入全局登记册） */
const ALIGNABLE = new Set(["character", "prop", "set"]);

/**
 * 顺序对齐单个场景的实体到全局登记册（必须按叙事顺序串行调用）。
 * 命中 → 回写 ref；未命中 → 新建全局实体并回写 ref。
 * 返回是否修改了场景实体（用于决定是否重存 stage）。
 */
export async function alignSceneEntities(
    ctx: IRunnerContext,
    store: StageStorage,
    sceneId: string,
): Promise<void> {
    const stage = store.loadStage(sceneId);
    if (!stage) return;

    const pending = stage.entities.filter((e) => ALIGNABLE.has(e.kind) && !e.ref);
    if (pending.length === 0) return;

    const localsNL = pending
        .map((e) => `- ${e.id}｜${e.kind}｜${e.label}｜${e.alignment_hint}`)
        .join("\n");
    const registryNL = store.listGlobals()
        .map((g) => `- ${g.gid}｜${g.kind}｜${g.name}｜${g.alignment_desc}`)
        .join("\n");

    let matches: z.infer<typeof ALIGN_SCHEMA>["matches"] = [];
    // 登记册为空时无需调用 LLM，全部新建
    if (registryNL) {
        const model = getSmartModel({ requiredAbilities: [ModelTags.Reasoning] }, ctx);
        const { text } = await generateText({
            model,
            system: ENTITY_ALIGNER_PROMPT.system,
            prompt: ENTITY_ALIGNER_PROMPT.user(sceneId, localsNL, registryNL),
        });
        const res = await safefmt(text, Output.object({ schema: ALIGN_SCHEMA }), ctx);
        if (res.success && res.value) matches = res.value.output.matches;
        else ctx.warn(`[alignScene] ${sceneId} 对齐抽取失败，全部按新实体处理`);
    }

    const decision = new Map(matches.map((m) => [m.local_id, m]));

    for (const local of pending) {
        const m = decision.get(local.id);
        const registryHas = (gid: string | null): gid is string =>
            !!gid && store.loadGlobal(gid) != null;

        if (m && !m.is_new && registryHas(m.matched_gid)) {
            // 命中已有全局实体
            local.ref = m.matched_gid;
        } else {
            // 新建全局实体
            const gid = store.nextGid(local.kind);
            const g: GlobalEntity = {
                gid,
                kind: local.kind,
                name: local.label,
                aliases: [],
                size_class: local.sizeClass,
                canonical_appearance: local.appearance,
                alignment_desc: local.alignment_hint,
                first_scene: sceneId,
                image_history: [],
            };
            store.saveGlobal(g);
            local.ref = gid;
        }
    }

    store.saveStage(stage); // 回写 ref
}

/** 供总览：把某局部实体的全局身份格式化 */
export function refLabel(store: StageStorage, e: StageEntity): string {
    if (!e.ref) return `${e.id} ${e.label}(未对齐)`;
    const g = store.loadGlobal(e.ref);
    return `${e.id}→${e.ref} ${g?.name ?? e.label}`;
}