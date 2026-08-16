/**
 * weaver · meta · 确定性 JSON 拼接
 *
 * 只负责把数据拼成最终结构，不含 LLM 逻辑。
 */

export interface MetaJsonInput {
    stableId: string;
    name: string;
    description: string;
    icon: string;
}

export function buildMetaJson(input: MetaJsonInput): Record<string, unknown> {
    return {
        name: input.name,
        id: input.stableId,
        icon: input.icon,
        description: input.description,
    };
}

export interface TargetDef {
    label: string;
    desc: string;
    icon: string;
}

export interface TypeJsonInput {
    flowName: string;
    flowDesc: string;
    icon: string;
    idleHint: string;
    checkInputTitle: string;
    checkInputDesc: string;
    targets: TargetDef[];
    activities: unknown[];
    blueprintFilters: { glossary: { value: string; desc: string }[] };
}

export function buildTypeJson(input: TypeJsonInput): Record<string, unknown> {
    return {
        icon: input.icon,
        statusText: input.flowName,
        header: {
            title: input.flowName,
            detail: input.flowDesc,
        },
        hints: {
            idle: input.idleHint,
        },
        checkInput: {
            title: input.checkInputTitle,
            description: input.checkInputDesc,
        },
        targets: input.targets.map((t) => ({
            label: t.label,
            desc: t.desc,
            icon: t.icon,
        })),
        activities: input.activities,
        blueprintFilters: input.blueprintFilters,
    };
}