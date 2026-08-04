// src/lib/components/dyn/nodes/tree-util.ts
/**
 * Tree 节点的纯函数工具：
 *   - 模板插值（支持多级祖先、root 命名空间、对象 value 字段）
 *   - 正则解析（根 / 容器层）
 *   - 数据归一（字符串 / 数组 / {key,value} / 嵌套对象）
 *   - 标题与 action 上下文构造
 *
 * 【占位符语法】
 *   {var}                   - 当前节点的字段（id/label/meta/n/index/value 等）
 *   {parent}                - 父节点 baseKey
 *   {root.<name>}           - 根 KV 解析后的字段（未指定 rootRegex 时至少含 {root.key}={rootKey}）
 *   {ancestor.<L>.<name>}   - 第 L 层祖先的某字段（L=0 是直接父，L=1 是祖父…）
 */
import type { TreeAction, TreeLevel } from "../ast";

/* ── 类型 ──────────────────────────────────────────────────────── */

export interface TreeItem {
    id: string;
    label?: string;
    meta?: string;
    /** 本节点正则/对象 value 提取的其它字段；模板可用 {<name>} 或 {fields.<name>} 引用 */
    fields?: Record<string, string>;
}

export type RootFields = Record<string, string>;

export interface TemplateVars {
    root?: RootFields;
    ancestor?: TreeItem[];
    [key: string]:
    | string
    | number
    | RootFields
    | TreeItem[]
    | undefined;
}

/* ── 插值 ──────────────────────────────────────────────────────── */

export function interpolate(tpl: string, vars: TemplateVars): string {
    return tpl.replace(
        /\{(\w+)(?:\.([\w-]+))?(?:\.([\w-]+))?\}/g,
        (_m, k: string, sub?: string, sub2?: string): string => {
            if (k === "root" && sub !== undefined) {
                return vars.root?.[sub] ?? "";
            }
            if (k === "ancestor" && sub !== undefined && sub2 !== undefined) {
                const L = Number(sub);
                const a = vars.ancestor?.[L];
                if (!a) return "";
                return getField(a, sub2) ?? "";
            }
            if (sub !== undefined) return "";
            const v = vars[k];
            if (v === undefined || v === null || typeof v === "object") return "";
            return String(v);
        },
    );
}

function getField(item: TreeItem, name: string): string | undefined {
    if (name === "id") return item.id;
    if (name === "label") return item.label;
    if (name === "meta") return item.meta;
    return item.fields?.[name];
}

/* ── 正则解析 ──────────────────────────────────────────────────── */

function makeGlobalRegex(src: string): RegExp | null {
    try {
        return new RegExp(src, "g");
    } catch {
        return null;
    }
}

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
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    return { items, fields };
}

/* ── 数据归一 ──────────────────────────────────────────────────── */

/** 把任意未知值归一为 TreeItem[]。统一支持字符串/数组/{key,value}/嵌套对象。 */
export function coerceItems(v: unknown): TreeItem[] {
    if (v == null) return [];
    if (typeof v === "string") {
        return [];
    }
    if (!Array.isArray(v)) {
        console.warn("[tree-util] coerceItems 遇到非数组值，返回空数组。若需展开对象字段，请用 TreeLevel.children（待实现）。", v);
        return [];
    }
    return v.map((x, i): TreeItem => normalizeOne(x, i));
}

/** 容器层专用：支持 childRegex 解析字符串。 */
export function coerceChildrenFromUnknown(
    v: unknown,
    childRegex: string | undefined,
): TreeItem[] {
    if (v == null) return [];
    if (typeof v === "string") {
        if (!childRegex) {
            return v
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s): TreeItem => ({ id: s }));
        }
        return parseItemsWithRegex(v, childRegex).items;
    }
    return coerceItems(v);
}

function normalizeOne(x: unknown, i: number): TreeItem {
    if (typeof x === "string") return { id: x };
    if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;

        if (
            "key" in o &&
            typeof o.key === "string" &&
            "value" in o &&
            o.value !== undefined
        ) {
            return {
                id: o.key,
                label: typeof o.label === "string" ? o.label : undefined,
                meta: typeof o.meta === "string" ? o.meta : undefined,
                fields: { value: stringifyScalar(o.value) ?? "" },
            };
        }

        const id =
            typeof o.id === "string"
                ? o.id
                : o.id !== undefined
                    ? String(o.id)
                    : String(i);
        const fields: Record<string, string> = {};
        for (const [k, val] of Object.entries(o)) {
            if (k === "id" || k === "label" || k === "meta") continue;
            const s = stringifyScalar(val);
            if (s !== undefined) fields[k] = s;
        }
        return {
            id,
            label: typeof o.label === "string" ? o.label : undefined,
            meta: typeof o.meta === "string" ? o.meta : undefined,
            fields: Object.keys(fields).length ? fields : undefined,
        };
    }
    return { id: String(i) };
}

function stringifyScalar(v: unknown): string | undefined {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return undefined;
}

/* ── 根解析 ────────────────────────────────────────────────────── */

export function parseRoot(
    raw: unknown,
    rootKey: string,
    rootRegex?: string,
): { items: TreeItem[]; rootFields: RootFields } {
    if (raw == null) return { items: [], rootFields: {} };

    if (Array.isArray(raw)) {
        return { items: coerceItems(raw), rootFields: { key: rootKey } };
    }

    if (typeof raw === "string") {
        if (!raw) return { items: [], rootFields: { key: rootKey } };
        if (!rootRegex) {
            const label = raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
            return {
                items: [{ id: "root", label }],
                rootFields: { key: rootKey },
            };
        }
        const { items, fields } = parseItemsWithRegex(raw, rootRegex);
        return { items, rootFields: { ...fields, key: rootKey } };
    }

    return { items: [], rootFields: { key: rootKey } };
}

/* ── 标题 ──────────────────────────────────────────────────────── */

export function nodeLabel(
    level: TreeLevel,
    item: TreeItem,
    index: number,
    rootFields: RootFields,
    ancestors: TreeItem[],
): string {
    if (level.labelTemplate) {
        return interpolate(level.labelTemplate, {
            id: item.id,
            label: item.label,
            meta: item.meta,
            index,
            n: index + 1,
            value: item.fields?.value,
            root: rootFields,
            ancestor: ancestors,
        });
    }
    return item.label ?? `第 ${index + 1} 项`;
}

/* ── 动作上下文 ────────────────────────────────────────────────── */

export function buildActionContext(opts: {
    action: TreeAction;
    baseKey: string;
    parentKey: string;
    item: TreeItem;
    index: number;
    rootFields: RootFields;
    ancestors: TreeItem[];
}): {
    name: string;
    key: string;
    args: Record<string, unknown> | undefined;
} {
    const { action, baseKey, parentKey, item, rootFields, ancestors } = opts;
    const key = action.keyTemplate
        ? interpolate(action.keyTemplate, {
            key: baseKey,
            parent: parentKey,
            id: item.id,
            label: item.label,
            meta: item.meta,
            value: item.fields?.value,
            root: rootFields,
            ancestor: ancestors,
        })
        : baseKey;
    const name = action.name ?? action.type ?? "view";
    return { name, key, args: action.args };
}