/**
 * weaver · Config Storage
 *
 * 设计：每个配置项一个独立 key（config:weave:XXX）。
 * 缺省值由各调用方在读取时自行提供——本类只负责 KV 存取。
 */

import { BaseStorage } from "./base.js";

export class ConfigStorage extends BaseStorage {
    protected NS = "#weave:config:";

    getMaxReactRounds(): number {
        const raw = this.get<string>("maxReactRounds");
        if (!raw) return 4;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : 4;
    }

    getMaxPathsPerNode(): number {
        const raw = this.get<string>("maxPathsPerNode");
        if (!raw) return 50;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : 50;
    }
}