/**
 * weaver · meta · 图标选择（reAct：一次批量选 + 校验 + 反馈重选）
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { iconQuery } from "$libs/utils/api/icon.js";
import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";
import type { IconSlot } from "./index.js";

const MAX_ROUNDS = 4;

const ICON_SELECTION_INSTRUCTIONS = `你是 UI 图标选择专家。

## 可选图标库（只有这两）

1. **@tabler/icons-svelte**（格式：\`IconXxxXxx\`，PascalCase，以 \`Icon\` 开头）
   - 例如：IconPencil、IconBook2、IconSettings、IconScript、IconFileText
2. **@iconify-json/twemoji**（格式：\`twemoji:xxx\`，小写，以 \`twemoji:\` 开头）
   - 例如：twemoji:fire、twemoji:3rd-place-medal、twemoji:rocket

## 硬性约束

- **优先选择 IconXxx 形式**（@tabler/icons-svelte），不要默认用 twemoji；
- **绝对不要**使用其他格式（如 emoji 字符、svg path、icon-xxx 命名空间、material/fa 图标等）；
- 每个语义项给出 5 个候选，按优先级排列；
- 各项之间尽量视觉差异化。

## 输出格式

对每个 slotId，输出一行：\`slotId | icon1,icon2,icon3,icon4,icon5\`
（按优先级排列，逗号分隔，不要用其他分隔符）`;

export async function resolveIcons(
    ctx: WeaveContext,
    flow: HumanFlow,
    slots: IconSlot[],
): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    let pending = [...slots];

    const messages: ModelMessage[] = [];
    let previousFailures: Map<string, string[]> = new Map();

    for (let round = 0; round < MAX_ROUNDS; round++) {
        if (pending.length === 0) break;

        const slotDescs = pending
            .map((s, i) => `${i + 1}. slotId=\`${s.slotId}\`：${s.semantic}`)
            .join("\n");

        let userContent: string;
        if (round === 0) {
            userContent =
                `## 工作流主题\n${flow.intent}\n\n` +
                `## 需要选图标的语义项（共 ${pending.length} 个）\n${slotDescs}\n\n` +
                `对每个 slotId 给出 5 个候选 icon 名（**优先 IconXxx 形式**，实在找不到才用 twemoji:xxx）。`;
        } else {
            const failureBlock = pending
                .map((s, i) => {
                    const prev = previousFailures.get(s.slotId) ?? [];
                    return `${i + 1}. slotId=\`${s.slotId}\`：上一轮候选 [${prev.join(", ")}] 均校验失败`;
                })
                .join("\n");

            userContent =
                `## 需要重新选择的语义项（共 ${pending.length} 个）\n${slotDescs}\n\n` +
                `## 上一轮失败明细\n${failureBlock}\n\n` +
                `请重新为每个 slot 推荐 5 个**不同的、确实存在于 @tabler/icons-svelte 或 @iconify-json/twemoji 中的**候选。`;
        }

        messages.push({ role: "user", content: userContent });

        ctx.ctx.info(
            `[icons] R${round + 1}：调用 LLM，pending=${pending.length}`,
        );

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx.ctx),
            instructions: ICON_SELECTION_INSTRUCTIONS,
            messages,
        });

        messages.push({ role: "assistant", content: text });

        const schema = z.object({
            selections: z.array(z.object({
                slotId: z.string().describe("语义项 id，逐字一致"),
                candidates: z.array(z.string()).describe("5 个候选 icon 名，按优先级"),
            })),
        });

        const result = await safefmt(text, Output.object({ schema }), ctx.ctx);
        if (!result.success || !result.value) {
            ctx.ctx.info(
                `[icons] R${round + 1} safefmt 失败，重试`,
            );
            messages.push({ role: "user", content: "格式不正确，请按要求重新输出。" });
            continue;
        }

        const selections = result.value.output.selections as Array<{
            slotId: string;
            candidates: string[];
        }>;

        const newPending: IconSlot[] = [];
        const roundFailures: Map<string, string[]> = new Map();

        for (const slot of pending) {
            const sel = selections.find(
                (s: { slotId: string; candidates: string[] }) => s.slotId === slot.slotId,
            );
            const candidates = sel?.candidates ?? [];

            const detail: string[] = [];
            let picked: string | null = null;

            for (const c of candidates) {
                const ok = isValidIcon(c);
                detail.push(`${c}${ok ? "✓" : "✗"}`);
                if (ok && !picked) {
                    picked = c;
                }
            }

            if (picked) {
                resolved[slot.slotId] = picked;
                ctx.ctx.info(
                    `[icons] R${round + 1} slot=${slot.slotId} → ${picked}（候选: ${detail.join(", ")})`,
                );
            } else {
                newPending.push(slot);
                roundFailures.set(slot.slotId, candidates);
                ctx.ctx.info(
                    `[icons] R${round + 1} slot=${slot.slotId} ❌ 全部失败（候选: ${detail.join(", ")})`,
                );
            }
        }

        pending = newPending;  // ← 关键：更新 pending 为下一轮待处理列表

        if (pending.length === 0) break;

        previousFailures = roundFailures;
        ctx.ctx.info(
            `[icons] R${round + 1}：${pending.length} 个 slot 未通过，反馈重选`,
        );
    }

    // 极限兜底：只处理最终仍未解决的 slot
    for (const slot of pending) {
        resolved[slot.slotId] = "IconCircle";
        ctx.ctx.info(
            `[icons] slot=${slot.slotId} 兜底 IconCircle（${MAX_ROUNDS} 轮均失败）`,
        );
    }

    return resolved;
}

function isValidIcon(name: string): boolean {
    return iconQuery.isValid(name);
}