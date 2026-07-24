import { z } from "zod";
import { infoCardViewSchema } from "./info-card.js";
import { leftSidebarItemJSONSchema } from "./sidebar.js";
import { targetOptionSchema } from "./target.js";

/** Partial<Omit<InfoCardView, "id">> */
const partialInfoCardSchema = infoCardViewSchema.omit({ id: true }).partial();

export type PartialInfoCard = z.infer<typeof partialInfoCardSchema>

export const projectActivityDataSchema = z.object({
    icon: z.string(), // 图标，不能省略。
    status: z.string().optional(),
    statusText: z.string(), // 状态栏文字，不能省略。
    activities: z.array(leftSidebarItemJSONSchema),
    header: z.object({
        title: z.string(),
        detail: z.string(),
    }),
    infocards: z
        .object({
            "input-manager": partialInfoCardSchema.optional(),
            "spec-setting": partialInfoCardSchema.optional(),
            output: partialInfoCardSchema.optional(),
        })
        .optional(),
    targets: z.array(targetOptionSchema).optional(),
    /** dashboard 中的提示词文本 */
    hints: z
        .object({
            idle: z.string().optional(),
            running: z.string().optional(),
            term: z.string().optional(),
        })
        .optional(),
    /** 开始工作时的输入检查。如果本值给出，则需要检查key(默认script)的有效性。 */
    checkInput: z
        .object({
            title: z.string().optional(),
            description: z.string().optional(),
            key: z.string().optional(),
        })
        .optional(),
});

export type ProjectActivityData = z.infer<typeof projectActivityDataSchema>;
