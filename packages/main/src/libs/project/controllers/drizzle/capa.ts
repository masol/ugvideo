// packages/main/src/libs/project/controllers/drizzle/capa.ts
import { intereg } from "$libs/blueprint/capability/intereg.js";
import { capabilities } from "$libs/utils/db/schema/capability.js";
import { throwNotimplement } from "$libs/utils/err.js";
import type { Capability, NewCapability } from "$types/blueprint/capability.js";
import { PrjTimeStamps } from "$types/prjstore.js";
import { eq } from 'drizzle-orm';
import type { DrizzleDBType } from "./type.js";

/**
 * 插入或更新能力记录
 *
 * 修复：显式写入 updatedAt = new Date().toISOString()。
 * 原因：原实现从 updateData 中剥掉 updatedAt 依赖 drizzle $onUpdate，
 * 但 onConflictDoUpdate 是 insert 语句不触发 $onUpdate 钩子，
 * 会回落到 SQL 层 default CURRENT_TIMESTAMP（无时区标记 "2026-08-02 14:29:52"），
 * 与应用层 ISO 格式（带 Z）混存，导致 dayjs 跨格式比较产生 8 小时偏移。
 * 显式写 ISO 后 insert/update 两条路径格式一致。
 *
 * createdAt 首次插入由 SQL 层 default 初始化，conflict 更新时不动它（保留原始创建时间）。
 *
 * 注意：internal capa id（如 $defaultFn 自动生成的 UUID）走 intereg 不走 DB，
 * 此处只处理 DB 路径。
 */
export function upsertCapability(db: DrizzleDBType, capability: NewCapability): string {
    if (intereg.hasId(capability.id ?? "")) {
        throwNotimplement(`internal capa id upcert not implemented: ${capability.id}`);
    }
    const { createdAt, updatedAt, id, ...updateData } = capability;
    void (createdAt);
    void (updatedAt);
    const finalId = id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(capabilities)
        .values({ id: finalId, ...updateData, updatedAt: now })
        .onConflictDoUpdate({
            target: capabilities.id,
            // 显式刷新 updatedAt。
            // createdAt 不出现在 set 里，保留原始创建时间。
            // 无需硬编码：直接把剩余字段整体塞给 set
            //   Drizzle 内部自动处理，不用 sql`excluded.xxx`
            set: { ...updateData, updatedAt: now },
        })
        .run();

    return finalId;
}


export function getCapabilityById(db: DrizzleDBType, id: string): Capability | null {
    // Logger.debug(`[PrjDB] getCapabilityById: ${id}`);
    const internalCapa = intereg.capaById(id);
    if (internalCapa) {
        return internalCapa;
    }
    const result = db
        .select()
        .from(capabilities)
        .where(eq(capabilities.id, id))
        .get(); // 立刻返回结果或 undefined

    // SQLite 未命中时返回 undefined，我们统一转换为 null 或对象
    return result ? result : null;
}

export function deleteCapabilityById(db: DrizzleDBType, id: string): void {
    const internalCapa = intereg.capaById(id);
    if (internalCapa) {
        throwNotimplement(`internal capa id delete not implemented: ${id}`);
    }
    db.delete(capabilities)
        .where(eq(capabilities.id, id))
        .run()
}

export function getCapaTimestamps(
    db: DrizzleDBType,
    id: string
): PrjTimeStamps | null {
    if (!id) return null;
    const row = db
        .select({
            createdAt: capabilities.createdAt,
            updatedAt: capabilities.updatedAt,
        })
        .from(capabilities)
        .where(eq(capabilities.id, id))
        .get();
    return row ?? null;
}