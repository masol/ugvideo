// nodes/design-characters/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import pMap from "p-map";
import { Storage as AlignStorage } from "../align-entities/storage.js";
import type { GlobalEntity } from "../align-entities/types.js";
import { COSTUME_DESIGNER_PROMPT } from "./prompts/costume-designer.js";
import { IDENTITY_INFERRER_PROMPT } from "./prompts/identity-inferrer.js";
import { UNIFORM_DESIGNER_PROMPT } from "./prompts/uniform-designer.js";
import { CharDesignStorage } from "./storage.js";
import type {
    CharacterIdentity,
    CostumeDesign,
    UniformDesign,
} from "./types.js";

const P = "#video:";

export async function designCharacterAssets(ctx: IRunnerContext): Promise<void> {
    await inferIdentities(ctx);
    await designCostumes(ctx);
    await designUniforms(ctx);
}

async function inferIdentities(ctx: IRunnerContext): Promise<void> {
    const store = new CharDesignStorage(ctx);

    const characters = store.allGlobalEntities().filter(e => e.kind === "character");
    if (!characters.length) return;

    const needInfer = characters.some(c => !store.getIdentity(c.name));
    if (!needInfer) {
        ctx.info("[inferIdentities] 所有角色已有身份，跳过");
        return;
    }

    const entityRegistry = characters.map(e => {
        const countLabel = e.count === 0 ? "群体" : e.count === 1 ? "个体" : `${e.count}个`;
        return `- ${e.name}（${e.kind}｜${countLabel}）外观：${e.appearance || "无"}｜出场：${e.scenes.join("、")}`;
    }).join("\n");

    const sceneTexts = collectSceneTexts(store, 200);
    const worldContext = extractWorldContext(ctx, store);

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: IDENTITY_INFERRER_PROMPT.system,
        prompt: IDENTITY_INFERRER_PROMPT.user(worldContext, entityRegistry, sceneTexts),
    });

    const blocks = text.split(/^##\s+/m).slice(1);
    for (const block of blocks) {
        const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
        const rawName = lines[0]?.replace(/[「」[\]【】]/g, "").trim();
        if (!rawName) continue;

        const entity = characters.find(
            c => c.name === rawName || rawName.includes(c.name) || c.name.includes(rawName),
        );
        if (!entity) continue;

        const identity = parseIdentityBlock(entity.name, lines.slice(1), entity);
        store.saveIdentity(identity);
        ctx.info(`[inferIdentities] ${entity.name}: ${identity.identity}｜${identity.ethnicity}`);
    }

    for (const c of characters) {
        if (!store.getIdentity(c.name)) {
            store.saveIdentity(defaultIdentity(c));
        }
    }

    ctx.info(`[inferIdentities] 完成，${store.allIdentities().length} 个角色`);
}

function parseIdentityBlock(name: string, lines: string[], entity: GlobalEntity): CharacterIdentity {
    const pick = (label: string): string => {
        const line = lines.find(l => l.replace(/^[-*]\s*/, "").startsWith(label));
        if (!line) return "";
        const m = line.match(new RegExp(`${label}[：:]\\s*(.+)`));
        return m ? m[1].trim() : "";
    };

    const genderRaw = pick("性别").toLowerCase();
    let gender: CharacterIdentity["gender"] = "unknown";
    if (/male|男/.test(genderRaw) && !/female/.test(genderRaw)) gender = "male";
    else if (/female|女/.test(genderRaw)) gender = "female";
    else if (/androgynous|中性/.test(genderRaw)) gender = "androgynous";

    return {
        name,
        identity: pick("身份") || "身份不详",
        ethnicity: pick("族裔") || inferDefaultEthnicity(entity),
        age_stage: pick("年龄段") || "成年",
        gender,
        body_type: pick("体型") || "匀称",
    };
}

function defaultIdentity(entity: GlobalEntity): CharacterIdentity {
    return {
        name: entity.name,
        identity: "身份不详",
        ethnicity: inferDefaultEthnicity(entity),
        age_stage: "成年",
        gender: entity.humanoid ? "unknown" : "androgynous",
        body_type: "匀称",
    };
}

function inferDefaultEthnicity(entity: GlobalEntity): string {
    if (!entity.humanoid) return "非人类角色，无族裔";
    return "东亚/汉族面部特征";
}

async function designCostumes(ctx: IRunnerContext): Promise<void> {
    const store = new CharDesignStorage(ctx);
    const alignStore = new AlignStorage(ctx);

    const targets = store.allGlobalEntities().filter(e => {
        if (e.kind !== "character" || !e.humanoid) return false;
        const identity = store.getIdentity(e.name);
        return identity != null;
    });

    if (!targets.length) {
        ctx.info("[designCostumes] 无角色，跳过");
        return;
    }

    const worldContext = extractWorldContext(ctx, store);

    await pMap(targets, async (entity) => {
        const identity = store.getIdentity(entity.name);
        if (!identity) return;

        let previousCostume = "";

        for (const sceneId of entity.scenes) {
            const isTimeSkip = entity.time_skips?.[sceneId] ?? false;
            const isFirstScene = sceneId === entity.scenes[0];

            const existingCostumeText = (isTimeSkip || isFirstScene) ? "" : previousCostume;

            if (!checkExpiry(ctx, {
                inputKeys: [
                    store.identityKey(entity.name),
                    `${P}output:aligned_text_${sceneId}`,
                    `${P}state:stage_${sceneId}`,
                    `${P}state:beat_nl_${sceneId}`,
                ],
                outputKeys: store.costumeKey(entity.name, sceneId),
            })) {
                const cached = store.getCostume(entity.name, sceneId);
                if (cached) {
                    previousCostume = formatCostume(cached);
                    // 修复：cache 命中分支不再调用 upsertSceneSnapshot（snapshot 已在 cache miss 时登记），
                    // 避免每次执行重复写入 align-entities registry 触发 isDeepStrictEqual 比较。
                    continue;
                }
            }

            const stage = store.getStage(sceneId);
            const alignedText = store.getAlignedText(sceneId);
            const sceneContext = [
                `环境：${stage?.world.environment ?? "无"}`,
                `原文节选：${(alignedText ?? "").slice(0, 300)}`,
                isTimeSkip ? `⚠️ 时间跳跃（与上一场景存在显著间隔，可能需要换装/衰老/伤痕）` : "",
            ].filter(Boolean).join("\n");

            const { text } = await generateText({
                model: getSmartModel(undefined, ctx),
                instructions: COSTUME_DESIGNER_PROMPT.system,
                prompt: COSTUME_DESIGNER_PROMPT.user({
                    characterName: entity.name,
                    identity: identity.identity,
                    ethnicity: identity.ethnicity,
                    ageStage: identity.age_stage,
                    gender: identity.gender,
                    bodyType: identity.body_type,
                    originalAppearance: entity.appearance || "无",
                    worldContext,
                    sceneContext,
                    existingCostume: existingCostumeText,
                }),
            });

            const costume = parseCostume(entity.name, text);
            store.saveCostume(entity.name, sceneId, costume);

            alignStore.upsertSceneSnapshot(entity.name, {
                scene_id: sceneId,
                costume_ref: store.costumeKey(entity.name, sceneId),
                requires_redress: isTimeSkip,
            });

            previousCostume = formatCostume(costume);
            ctx.info(`[designCostumes] ${entity.name}@${sceneId} 服装设计完成${isTimeSkip ? "（时间跳跃）" : ""}`);
        }
    }, { concurrency: 3 });

    ctx.info("[designCostumes] 服装设计完成");
}

async function designUniforms(ctx: IRunnerContext): Promise<void> {
    const store = new CharDesignStorage(ctx);

    const groupCharacters = store.allGlobalEntities()
        .filter(e => e.kind === "character" && e.humanoid && e.count !== 1);
    if (!groupCharacters.length) {
        ctx.info("[designUniforms] 无群体角色，跳过");
        return;
    }

    const worldContext = extractWorldContext(ctx, store);

    await pMap(groupCharacters, async (entity) => {
        const uniformName = `${entity.name}制服`;
        const firstScene = entity.scenes[0];
        if (!firstScene) return;

        if (!checkExpiry(ctx, {
            inputKeys: [
                `${P}stage:registry:${entity.name}`,
                store.identityKey(entity.name),
                `${P}output:aligned_text_${firstScene}`,
                `${P}state:stage_${firstScene}`,
                `${P}state:beat_nl_${firstScene}`,
                `${P}char:costume_${entity.name}_${firstScene}`,
            ],
            outputKeys: store.uniformKey(uniformName),
        })) {
            ctx.info(`[designUniforms] ${uniformName} 仍新鲜，跳过`);
            return;
        }

        const stage = store.getStage(firstScene);
        const alignedText = store.getAlignedText(firstScene);
        const sceneContext = [
            `环境：${stage?.world.environment ?? "无"}`,
            `原文节选：${(alignedText ?? "").slice(0, 300)}`,
        ].join("\n");

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: UNIFORM_DESIGNER_PROMPT.system,
            prompt: UNIFORM_DESIGNER_PROMPT.user({
                groupName: entity.name,
                groupDescription: entity.appearance || "群体角色",
                worldContext,
                sceneContext,
            }),
        });

        const uniform = parseUniform(uniformName, entity.name, text);
        store.saveUniform(uniform);
        ctx.info(`[designUniforms] ${uniformName} 制服设计完成`);
    }, { concurrency: 2 });

    ctx.info("[designUniforms] 制服设计完成");
}

function collectSceneTexts(store: CharDesignStorage, limit: number): string {
    return store.sceneIds().map(id => {
        const text = store.getAlignedText(id);
        if (!text) return "";
        return `【场景 ${id}】\n${text.slice(0, limit)}`;
    }).filter(Boolean).join("\n\n");
}

function extractWorldContext(ctx: IRunnerContext, store: CharDesignStorage): string {
    const synopsis = store.getSynopsis();
    if (synopsis && synopsis.trim().length > 0) {
        const trimmed = synopsis.trim().slice(0, 2000);
        ctx.info(`[designCharacters] 世界观来自 synopsis（${trimmed.length}字）`);
        return trimmed;
    }
    const sceneIds = store.sceneIds().slice(0, 3);
    const parts: string[] = [];
    for (const id of sceneIds) {
        const stage = store.getStage(id);
        if (!stage) continue;
        const env = stage.world.environment?.trim();
        const light = stage.world.key_light?.trim();
        if (env) parts.push(light ? `${env}（${light}）` : env);
    }
    const fallback = parts.join("；");
    if (fallback) {
        ctx.info(`[designCharacters] 无 synopsis，世界观回退至场景环境拼凑`);
    } else {
        ctx.info(`[designCharacters] 无 synopsis 也无场景环境，世界观为空`);
    }
    return fallback;
}

function parseSection(text: string, heading: string): string {
    const re = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : "";
}

function parseItems(text: string): CostumeDesign["items"] {
    const section = parseSection(text, "构件清单");
    if (!section) return [];
    const items: CostumeDesign["items"] = [];
    for (const rawLine of section.split("\n")) {
        const line = rawLine.replace(/^[-*]\s*/, "").trim();
        if (!line) continue;
        const layer = parseLayer(line);
        const nameMatch = line.match(/^\[?[^\]]*\]?\s*([^：:]+)[：:]/);
        const item = nameMatch ? nameMatch[1].replace(/\[.*?\]/g, "").trim() : line.slice(0, 20);
        items.push({
            layer,
            item,
            silhouette: pickInline(line, "廓形"),
            material: pickInline(line, "材质"),
            color: pickInline(line, "色彩") || pickInline(line, "颜色"),
            pattern: pickInline(line, "纹样") || null,
            key_detail: pickInline(line, "细节") || null,
        });
    }
    return items;
}

function parseLayer(line: string): CostumeDesign["items"][number]["layer"] {
    const l = line.toLowerCase();
    if (/outer|外层|外袍/.test(l)) return "outer";
    if (/mid|中层/.test(l)) return "mid";
    if (/base|内层|中衣/.test(l)) return "base";
    if (/under|内衬|贴身/.test(l)) return "underlayer";
    if (/foot|鞋|靴/.test(l)) return "footwear";
    if (/head|帽|冠|头/.test(l)) return "headwear";
    if (/access|配饰|腰带|佩/.test(l)) return "accessory";
    return "outer";
}

function pickInline(line: string, label: string): string {
    const m = line.match(new RegExp(`${label}\\s*[：:]?\\s*([^，,；;]+)`));
    return m ? m[1].trim() : "";
}

function parseCostume(name: string, text: string): CostumeDesign {
    const kwSection = parseSection(text, "廓形关键词");
    const keywords = kwSection
        .replace(/[[\]]/g, "")
        .split(/[,，、\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 5);
    return {
        character_name: name,
        description: parseSection(text, "整体描述"),
        era_reference: parseSection(text, "时代参照"),
        silhouette_keywords_en: keywords,
        items: parseItems(text),
    };
}

function parseUniform(uniformName: string, groupName: string, text: string): UniformDesign {
    const kwSection = parseSection(text, "廓形关键词");
    const keywords = kwSection
        .replace(/[[\]]/g, "")
        .split(/[,，、\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 5);
    const wearerSection = parseSection(text, "穿着者");
    const genderRaw = pickInline(wearerSection, "性别").toLowerCase();
    let wearerGender: UniformDesign["wearer_gender"] = "androgynous";
    if (/male|男/.test(genderRaw) && !/female/.test(genderRaw)) wearerGender = "male";
    else if (/female|女/.test(genderRaw)) wearerGender = "female";
    return {
        uniform_name: uniformName,
        group_entity_name: groupName,
        description: parseSection(text, "整体描述"),
        era_reference: parseSection(text, "时代参照"),
        silhouette_keywords_en: keywords,
        items: parseItems(text),
        wearer_gender: wearerGender,
        wearer_body_type: pickInline(wearerSection, "体型") || "标准体型",
    };
}

function formatCostume(c: CostumeDesign): string {
    const lines: string[] = [c.description];
    if (c.era_reference) lines.push(`时代参照：${c.era_reference}`);
    for (const item of c.items) {
        lines.push(`- ${item.item}：${item.material}，${item.color}`);
    }
    return lines.join("\n");
}