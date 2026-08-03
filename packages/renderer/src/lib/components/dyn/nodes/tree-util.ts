// src/lib/components/dyn/nodes/tree-util.ts
/**
 * Tree 节点的纯函数工具：模板插值 + 正则解析 + 数据项归一 + 标题/动作上下文计算。
 * 与 Svelte 无耦合，便于单测与复用。
 */
import type { TreeAction, TreeLevel } from "../ast";

/** 树节点的最小数据形状 */
export interface TreeItem {
    id: string;
    label?: string;
    meta?: string;
    /** 本节点正则提取的其它命名捕获（id/label/meta 之外的字段） */
    fields?: Record<string, string>;
}

/** 整棵树的全局字段：根 KV 解析出的 root.<name>（任意命名捕获）。 */
export type RootFields = Record<string, string>;

/**
 * 模板变量：普通占位符为 string | number；root 是唯一的对象命名空间，
 * 通过 {root.<name>} 访问。
 */
export interface TemplateVars {
    root?: RootFields;
    [key: string]: string | number | RootFields | undefined;
}

/**
 * 模板插值：{var} 占位替换；未知/空变量替换为空串。
 * {root.<name>} 从 vars.root 取字段；其它 {a.b} 形式一律替换为空串。
 */
export function interpolate(tpl: string, vars: TemplateVars): string {
    return tpl.replace(
        /\{(\w+)(?:\.([\w-]+))?\}/g,
        (_, k: string, sub?: string) => {
            if (sub !== undefined) {
                if (k !== "root") return "";
                return vars.root?.[sub] ?? "";
            }
            const v = vars[k];
            if (v === undefined || v === null || typeof v === "object") return "";
            return String(v);
        },
    );
}

/** 构造 global 正则；非法正则返回 null（调用方按空结果兜底） */
function makeGlobalRegex(src: string): RegExp | null {
    try {
        return new RegExp(src, "g");
    } catch {
        return null;
    }
}

/**
 * 用正则把一段字符串解析为节点数组 + 汇总字段。
 * - 强制以 global 模式逐条匹配：每条匹配 → 一个 TreeItem。
 * - 命名捕获优先：id / label / meta；未命名时退回分组顺序 [1]=id [2]=label [3]=meta。
 * - 其它命名捕获 → 该条的 fields，同时汇总进返回的 fields（后值覆盖前值）。
 */
export function parseItemsWithRegex(
    raw: string,
    src: string,
): { items: TreeItem[]; fields: RootFields } {
    const items: TreeItem[] = [];
    const fields: RootFields = {};
    const re = makeGlobalRegex(src);
    if (!re) return { items, fields };

    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const g = m.groups ?? {};
        const id = g.id ?? m[1];
        if (id) {
            const extra: RootFields = {};
            for (const [k, v] of Object.entries(g)) {
                if (k === "id" || k === "label" || k === "meta") continue;
                if (typeof v === "string") {
                    extra[k] = v;
                    fields[k] = v;
                }
            }
            items.push({
                id,
                label: (g.label ?? m[2]) || undefined,
                meta: (g.meta ?? m[3]) || undefined,
                fields: Object.keys(extra).length ? extra : undefined,
            });
        }
        // 零宽匹配防护：避免 lastIndex 不推进导致死循环
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    return { items, fields };
}

/**
 * 根 KV 值解析：把根字符串拆成根节点数组 + 根字段。
 * - 有 rootRegex：按正则（global）解析；
 * - 无 rootRegex：整段当一个根节点（id="root"，label=前 60 字符预览）。
 */
export function parseRoot(
    raw: string,
    rootRegex?: string,
): { items: TreeItem[]; rootFields: RootFields } {
    if (!raw) return { items: [], rootFields: {} };
    if (!rootRegex) {
        const label = raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
        return { items: [{ id: "root", label }], rootFields: {} };
    }
    const { items, fields } = parseItemsWithRegex(raw, rootRegex);
    return { items, rootFields: fields };
}

/**
 * 容器节点 baseKey 值归一：子节点数据可能是数组（已是 TreeItem[] / string[]）
 * 或字符串（按 childRegex 解析）。未知 / null → 空数组。
 */
export function coerceChildrenFromUnknown(
    v: unknown,
    childRegex: string | undefined,
): TreeItem[] {
    if (Array.isArray(v)) {
        return v.map((x, i): TreeItem => {
            if (typeof x === "string") return { id: x };
            if (x && typeof x === "object") {
                const o = x as Record<string, unknown>;
                const id =
                    typeof o.id === "string"
                        ? o.id
                        : o.id !== undefined
                            ? String(o.id)
                            : String(i);
                return {
                    id,
                    label: typeof o.label === "string" ? o.label : undefined,
                    meta: typeof o.meta === "string" ? o.meta : undefined,
                };
            }
            return { id: String(i) };
        });
    }
    if (typeof v === "string" && childRegex) {
        return parseItemsWithRegex(v, childRegex).items;
    }
    return [];
}

/** 计算某层节点的展示标题 */
export function nodeLabel(
    level: TreeLevel,
    item: TreeItem,
    index: number,
    rootFields: RootFields,
): string {
    if (level.labelTemplate) {
        return interpolate(level.labelTemplate, {
            id: item.id,
            label: item.label,
            meta: item.meta,
            index,
            n: index + 1,
            root: rootFields,
        });
    }
    return item.label ?? `第 ${index + 1} 项`;
}

/**
 * 拼装某个 action 的调用上下文：
 *  - name：动作函数名（action.name ?? action.type ?? "view"）
 *  - key：解析 keyTemplate（缺省用节点 baseKey）
 *  - args：原样透传
 */
export function buildActionContext(opts: {
    action: TreeAction;
    baseKey: string;
    parentKey: string;
    item: TreeItem;
    index: number;
    rootFields: RootFields;
}): {
    name: string;
    key: string;
    args: Record<string, unknown> | undefined;
} {
    const { action, baseKey, parentKey, item, rootFields } = opts;
    const key = action.keyTemplate
        ? interpolate(action.keyTemplate, {
            key: baseKey,
            parent: parentKey,
            id: item.id,
            label: item.label,
            meta: item.meta,
            root: rootFields,
        })
        : baseKey;
    const name = action.name ?? action.type ?? "view";
    return { name, key, args: action.args };
}