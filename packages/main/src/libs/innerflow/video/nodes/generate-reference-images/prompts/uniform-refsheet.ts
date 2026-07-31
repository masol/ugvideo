// nodes/generate-reference-images/prompts/uniform-refsheet.ts

export const UNIFORM_REFSHEET_PROMPT = {
    system: (styleSection: string) =>
        `你是制服参考图提示词工程师。把制服设计转为三视图提示词。

${styleSection}

---

**铁律**：
1. 纯白背景，soft even studio lighting
2. 穿着者：仅性别 + 标准体型 + 中性肤色 + 头发简洁后梳。**面部特征完全省略**
3. 中性站姿，arms slightly away from body
4. 材质不泛化，色彩含色调
5. 不写 uniform_name，不写 meta 声明

**输出**：直接输出提示词短语（逗号分隔），不分段不编号。`,

    user: (params: {
        uniformName: string;
        groupEntityName: string;
        eraReference: string;
        silhouetteKeywordsEn: string[];
        items: Array<{
            layer: string;
            item: string;
            silhouette: string;
            material: string;
            color: string;
            pattern: string | null;
            key_detail: string | null;
        }>;
        wearerGender: "male" | "female" | "androgynous";
        wearerBodyType: string;
        styleAnchor: string;
    }) => {
        const layerOrder = ["outer", "mid", "base", "underlayer", "footwear", "headwear", "accessory"];
        const sortedItems = [...params.items].sort(
            (a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer),
        );

        const itemsText = sortedItems.map(it => {
            const parts = [`${it.layer}: ${it.item}`];
            if (it.silhouette) parts.push(`silhouette ${it.silhouette}`);
            parts.push(`material ${it.material}`);
            parts.push(`color ${it.color}`);
            if (it.pattern) parts.push(`pattern ${it.pattern}`);
            if (it.key_detail) parts.push(`detail ${it.key_detail}`);
            return parts.join(", ");
        }).join("; ");

        const silhouetteText = params.silhouetteKeywordsEn.length > 0
            ? params.silhouetteKeywordsEn.join(" ")
            : "standard uniform silhouette";

        const wearerDesc = params.wearerGender === "male" ? "male figure"
            : params.wearerGender === "female" ? "female figure"
                : "androgynous figure";

        return `【群体】${params.groupEntityName}
【时代参照】${params.eraReference}
【廓形关键词】${silhouetteText}
【构件清单（按 layer 从外到内）】${itemsText}
【穿着者】${wearerDesc}, ${params.wearerBodyType}, neutral skin tone, hair neatly pulled back

使用构图模板：
"costume design reference sheet, front view, left side view, back view, same outfit in all three views, consistent garment structure, plain white background, neutral standing pose, arms slightly away from body, soft even studio lighting, ${params.styleAnchor}"

请直接输出提示词。不写面部特征，不写 meta 声明。`;
    },
};