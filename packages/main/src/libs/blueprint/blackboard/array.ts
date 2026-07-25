import type { IdentifiedItem } from "$types/blueprint/blackboard/array.js";
import { isPlainObject, isString } from "radashi";

/**
 * 判断是否为"带 ID 的数组项"(推荐数组元素形态)。
 * 约束：普通对象 + 含 string 类型的 (推荐UUID，但不验证) id 字段。
 * 内部逻辑不应假定数据一定是这种形态；仅在明确使用 id 语义(如 upsertById)时才依赖它。
 */
export function isIdentifiedItem(value: unknown): value is IdentifiedItem {
    if (isPlainObject(value) && 'id' in value && isString(value.id) && value.id) {
        return true;
    }
    return false;
}

/** 判断是否为"带 ID 的数组"(每一项都是 IdentifiedItem)。 */
export function isIdentifiedArray(value: unknown): value is IdentifiedItem[] {
    return Array.isArray(value) && value.every(isIdentifiedItem);
}