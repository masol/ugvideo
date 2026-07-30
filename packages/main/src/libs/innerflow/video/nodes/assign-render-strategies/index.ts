// nodes/assign-render-strategies/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import type { GlobalEntity } from "../align-entities/types.js";
import type { EntityRenderDecision, RenderStrategy } from "../design-characters/types.js";
import { RENDER_STRATEGY_PROMPT } from "./prompts/render-strategy.js";
import { RenderStratStorage } from "./storage.js";

const P = "#video:";

export async function assignRenderStrategies(ctx: IRunnerContext): Promise<void> {
    const store = new RenderStratStorage(ctx);
    const entities = store.allGlobalEntities();

    if (!entities.length) {
        ctx.info("[assignRenderStrategies] 无实体，跳过");
        return;
    }

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}stage:registry:idx`,
            `${P}shots:idx:scenes`,
            ...entities.map(e => `${P}stage:registry:${e.name}`),
            ...store.designedSceneIds().map(id => `${P}shots:design_${id}`),
        ],
        outputKeys: entities.map(e => store.decisionKey(e.name)),
    })) {
        ctx.info("[assignRenderStrategies] 所有策略决策仍新鲜，跳过");
        return;
    }

    const entityRegistry = entities.map(e => {
        const countLabel = e.count === 0 ? "群体(数量不定)" : e.count === 1 ? "个体" : `群体(${e.count}个)`;
        const humanoidLabel = e.kind === "character" ? (e.humanoid ? "类人" : "非类人") : "—";
        return `- ${e.name}（${e.kind}｜${countLabel}｜${humanoidLabel}）外观：${e.appearance || "无"}｜出场场景：${e.scenes.join("、")}`;
    }).join("\n");

    const sceneShotDesigns = collectShotDesigns(store, 1500);

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: RENDER_STRATEGY_PROMPT.system,
        prompt: RENDER_STRATEGY_PROMPT.user({ entityRegistry, sceneShotDesigns }),
    });

    const parsed = parseDecisions(text, entities);

    const finalDecisions: EntityRenderDecision[] = [];
    for (const e of entities) {
        let decision = parsed.get(e.name);
        if (!decision) decision = fallbackDecision(e);

        // 硬规则 1：跨场景 ≥ 2 且是 humanoid character → 强制 individual_refsheet
        if (e.kind === "character" && e.count === 1 && e.humanoid && e.scenes.length >= 2) {
            decision.strategy = "individual_refsheet";
            decision.importance = Math.max(decision.importance, 8);
            decision.rationale = `${e.scenes.length} 个场景跨镜头出现，需定妆照保障一致性`;
        }

        // 硬规则 2：跨场景 set → 强制出图
        if (e.kind === "set" && e.scenes.length >= 2) {
            decision.strategy = "individual_refsheet";
            decision.importance = Math.max(decision.importance, 6);
            decision.rationale = `跨场景陈设，需参考图保障视觉一致`;
        }

        // 硬规则 3：跨场景 prop 且显著使用 → 强制出图
        if (e.kind === "prop" && e.scenes.length >= 2) {
            decision.strategy = "individual_refsheet";
            decision.importance = Math.max(decision.importance, 7);
            decision.rationale = `跨场景道具，需参考图保障视觉一致`;
        }

        // 硬规则 4：单场景 prop / set 即便被判定为 prompt_only，
        // 其描述也必须进入场景环境图 prompt（由环境生成器源头保证，不在此处理）

        store.saveDecision(decision);
        finalDecisions.push(decision);
    }

    ctx.info(`[assignRenderStrategies] 完成，${finalDecisions.length} 个决策`);
    for (const d of finalDecisions) {
        ctx.info(`[assignRenderStrategies]   ${d.name}: ${d.strategy}｜重要度 ${d.importance}`);
    }
}

function collectShotDesigns(store: RenderStratStorage, limit: number): string {
    return store.designedSceneIds().map(id => {
        const design = store.getShotDesign(id);
        if (!design) return "";
        return `【场景 ${id} 分镜】\n${design.slice(0, limit)}`;
    }).filter(Boolean).join("\n\n");
}

function parseDecisions(text: string, entities: GlobalEntity[]): Map<string, EntityRenderDecision> {
    const decisions = new Map<string, EntityRenderDecision>();

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        const mainMatch = line.match(/^[-*]\s*(.+?)｜/);
        if (!mainMatch || !/策略[：:]/.test(line)) continue;

        const rawName = mainMatch[1].replace(/[「」[\]【】]/g, "").trim();
        const entity = entities.find(
            e => e.name === rawName || rawName.includes(e.name) || e.name.includes(rawName),
        );
        if (!entity) continue;

        const strategy = parseStrategy(pickField(line, "策略"));
        const importance = parseImportance(pickField(line, "重要度"));
        const rationale = pickField(line, "理由") || "无";

        const decision: EntityRenderDecision = {
            name: entity.name,
            kind: entity.kind,
            strategy,
            importance,
            rationale,
        };

        if (strategy === "uniform_refsheet") {
            const uMatch = line.match(/制服名称[：:]\s*(.+)/);
            if (uMatch) decision.uniform_name = uMatch[1].trim();
        }

        decisions.set(entity.name, decision);
    }

    return decisions;
}

function pickField(line: string, label: string): string {
    const m = line.match(new RegExp(`${label}[：:]\\s*([^｜]+)`));
    return m ? m[1].trim() : "";
}

function parseStrategy(raw: string): RenderStrategy {
    const s = raw.toLowerCase();
    if (s.includes("individual")) return "individual_refsheet";
    if (s.includes("uniform")) return "uniform_refsheet";
    if (s.includes("prompt")) return "prompt_only";
    if (s.includes("skip")) return "skip";
    return "prompt_only";
}

function parseImportance(raw: string): number {
    const m = raw.match(/\d+/);
    if (!m) return 3;
    return Math.max(0, Math.min(10, parseInt(m[0], 10)));
}

function fallbackDecision(e: GlobalEntity): EntityRenderDecision {
    if (e.kind === "light") {
        return { name: e.name, kind: e.kind, strategy: "skip", importance: 0, rationale: "光源" };
    }
    if (e.kind === "character" && e.count === 1) {
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 3,
            rationale: "兜底：单场景角色",
        };
    }
    if (e.kind === "character") {
        return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 2, rationale: "兜底：群体" };
    }
    return {
        name: e.name, kind: e.kind,
        strategy: "prompt_only",
        importance: 2,
        rationale: "兜底：单场景陈设/道具",
    };
}