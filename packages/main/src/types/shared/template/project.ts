import { z } from "zod";
import { infoCardViewSchema } from "./info-card.js";
import { leftSidebarItemJSONSchema } from "./sidebar.js";
import { targetOptionSchema } from "./target.js";

/** Partial<Omit<InfoCardView, "id">> */
const partialInfoCardSchema = infoCardViewSchema.omit({ id: true }).partial();

export type PartialInfoCard = z.infer<typeof partialInfoCardSchema>;

/**
 * 单个蓝图名称候选项 —— 提示不再是裸字符串，而是带描述的结构。
 *  - value：写入过滤输入框的实际文本（也是列表按名称过滤所用的值）。
 *  - desc：可选的一句话描述，既用于展示，也参与拼音模糊搜索。
 */
export const blueprintFilterOptionSchema = z.object({
    value: z.string(),
    desc: z.string().optional(),
});

export type BlueprintFilterOption = z.infer<typeof blueprintFilterOptionSchema>;

/**
 * 蓝图名称推荐列表 —— 用于术语表/元术语表/能力表输入框的辅助下拉。
 * 不设置或对应数组为空 = 不出现下拉（与现状一致，纯文本输入）。
 * 设置了非空数组 = 输入框升级为可搜索 Combobox：仍可自由输入任意文本（开放搜索），
 *                候选项仅作快捷入口，且支持名称 / 描述 / 拼音 / 首字母模糊匹配。
 */
export const blueprintFiltersSchema = z.object({
    /** 术语表候选项 */
    glossary: z.array(blueprintFilterOptionSchema).optional(),
    /** 元术语表候选项 */
    metag: z.array(blueprintFilterOptionSchema).optional(),
    /** 能力表候选项 */
    capa: z.array(blueprintFilterOptionSchema).optional(),
});

export type BlueprintFilters = z.infer<typeof blueprintFiltersSchema>;

export const projectApiSchema = z.enum(["icon"]);
/**
 * 媒体资源字段名列表 —— 用于在编辑器侧识别"素材"下拉。
 *
 * 业务语义：某些 JSON 字段名（以 `_path` 结尾是常见约定，但不是强制）
 * 表示相对于项目根的媒体资源路径。编辑器读取 JSON 后，会把这些字段聚合为一个
 * "素材"下拉菜单，便于用户一键在本地显示或用系统应用打开。
 *
 * 不设置 = 不出现素材下拉（与现状一致）。
 */
export const projectActivityDataSchema = z.object({
    icon: z.string(),
    status: z.string().optional(),
    statusText: z.string(),
    chatMode: z.boolean().optional(),
    /**
     * 需要客户端反向注入的api.
     * 当前有效值只有 "icon"。
     */
    api: z.array(projectApiSchema).optional(),
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
    hints: z
        .object({
            idle: z.string().optional(),
            running: z.string().optional(),
            term: z.string().optional(),
        })
        .optional(),
    checkInput: z
        .object({
            title: z.string().optional(),
            description: z.string().optional(),
            key: z.string().optional(),
        })
        .optional(),
    /**
     * 三张蓝图表的名称候选列表。
     */
    blueprintFilters: blueprintFiltersSchema.optional(),
    /**
     * 媒体资源字段名列表（如 ["image_path", "audio_path"]）。
     * 读取 JSON 时，凡是 key 命中列表且 value 为非空字符串的，都会在编辑器
     * 顶部渲染为"素材"下拉。不设置或空数组 = 不渲染。
     */
    mediaFields: z.array(z.string()).optional(),
});

export type ProjectActivityData = z.infer<typeof projectActivityDataSchema>;