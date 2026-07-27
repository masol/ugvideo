// nodes/build-stage/prompts/entity-aligner.ts

/**
 * Pass D：跨场景实体身份核对。
 * 只做核对不做推断补充；不走 safefmt，末行稳定输出 SAME / DIFFERENT。
 */
export const ENTITY_ALIGNER_PROMPT = {
    system: `你是影视场记的身份核对员。判断"已登记实体"与"新出现实体"是否指同一个对象（同一个人 / 同一件道具 / 同一处布景）。

只做核对，不做推断补充。依据双方的名称与原文外观描写：
- 名称相同且外观无明显冲突 → 判为同一个
- 名称相同但外观出现硬冲突（如一处为白发老者、一处为垂髫孩童）→ 判为不同
- 信息不足以否定时 → 判为同一个（宁合勿分，后续节点可再拆）

先用一句话说明依据，然后另起一行，**最后一行只输出一个词：SAME 或 DIFFERENT**，
这一行不要输出其它任何内容。`,

    user: (
        name: string,
        kind: string,
        knownAppearance: string,
        knownScenes: string,
        newAppearance: string,
        newScene: string,
    ) => `实体名称：${name}（类别：${kind}）

【已登记】出场于场景：${knownScenes}
原文外观：${knownAppearance}

【新出现】场景：${newScene}
原文外观：${newAppearance}

它们是同一个实体吗？请核对，并在最后一行输出 SAME 或 DIFFERENT。`,
};