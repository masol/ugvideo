import type { EmbedType } from "$libs/model/factory/type.js";
import { LanceEmbeding } from "$libs/project/controllers/lance/embed.js";
import { LanceDBType, getLanceDB } from "$libs/project/controllers/lance/lancedb.js";
import { TableBase, TableConstructor } from "$libs/project/controllers/lance/tablebase.js";
import { ILanceDB } from "$libs/project/controllers/lance/type.js";
import { throwNotfound, throwPrecondition } from "$libs/utils/err.js";
import type { Connection } from "@lancedb/lancedb";
import type { Tool } from "ai";
import Logger from "electron-log/main.js";
import Fuse from "fuse.js";
import { createHash } from "node:crypto";
import { JsonFileKV } from "./kv.js";
import { closeMcpClient, connectMcpServer, type McpClient } from "./mcp.js";
import { lanceDataPath } from "./path.js";
import { defaultReranker } from "./rerank.js";
import { searchTool, searchToolsToolName } from "./searchtool.js";
import { ToolTable } from "./tooltable.js";
import type {
    McpServerConfig,
    RegisteredTool,
    Reranker,
    ToolSearchResult,
    ToolSource,
} from "./type.js";

export const toolTableName = "tools";


/**
 * AI SDK v7 中 Tool.description 可为 string 或 (options) => string(动态描述)。
 * 注册表/向量索引需要静态字符串,此处物化一份快照;
 * 函数形式以空上下文求值,失败则回退为空串(仅影响该工具的检索质量,不阻断注册)。
 */
function resolveToolDescription(tool: Tool): string {
    const d = (tool as { description?: unknown }).description;
    if (typeof d === "string") return d;
    if (typeof d === "function") {
        try {
            const r = (d as (options: { context: unknown }) => string)({ context: undefined });
            return typeof r === "string" ? r : "";
        } catch {
            return "";
        }
    }
    return "";
}

const builtinId = (name: string) => `builtin::${name}`;
const mcpId = (serverId: string, name: string) => `mcp::${serverId}::${name}`;
const searchToolId = builtinId(searchToolsToolName);

function contentHash(name: string, description: string): string {
    return createHash("sha1").update(`${name}\u0000${description}`).digest("hex");
}

/** 收敛为合法 tool name: [a-zA-Z0-9_-],过长截断 */
function sanitizeToolName(name: string): string {
    const s = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    return s || "_tool";
}

/**
 * 全局工具向量库(应用级单例,不依赖项目打开)。
 *
 * 职责:
 * - 内置工具在 open() 时注册,同时自动注册 search_tools 元工具;
 * - searchTools() 自然语言检索(向量优先,Fuse 降级/兜底,rerank 收尾);
 * - searchToolsTool 可直接挂到 LLM,让 LLM 自己发现工具、生成工具流;
 * - 工具流持久化引用 id(确定性派生、跨重启稳定),执行时 getTool(id)。
 *
 * 与 MCP 配置的关系(本模块不读任何配置存储,由 configService 主动调用):
 * - 启动时:configService 读出持久化配置后调用 setMcpServers(all);
 * - 用户新增/编辑单个 server:configService 落盘后调用 upsertMcpServer(cfg);
 * - 用户删除单个 server:configService 落盘后调用 rmMcpServer(id);
 * 三者均已内部串行化,可任意并发调用;配置未变化的 server 不会被重连。
 */
export class GlobalToolDB implements ILanceDB {
    #db: Connection | null = null;
    #lanceInst: LanceDBType | null = null;
    #embedInst: LanceEmbeding = new LanceEmbeding();
    #vectorReady = false;

    #registry = new Map<string, RegisteredTool>();   // id -> tool
    #nameIndex = new Map<string, string>();          // 原始 name -> id(撞名时后者覆盖并告警)
    #llmNameIndex = new Map<string, string>();       // llmName -> id(保证唯一)
    #fuse: Fuse<RegisteredTool> | null = null;
    #mcpClients = new Map<string, McpClient>();      // serverId -> client
    #mcpConfigs = new Map<string, string>();         // serverId -> 配置 JSON,用于无变化短路

    /** 重排序钩子,默认直通截断;接入 rerank 模型时整体替换 */
    reranker: Reranker = defaultReranker;

    // 串行化 open / mcp 变更 / close,避免并发重建索引
    #chain: Promise<unknown> = Promise.resolve();
    #enqueue<T>(job: () => Promise<T>): Promise<T> {
        const p = this.#chain.then(job, job);
        this.#chain = p.then(() => undefined, () => undefined);
        return p;
    }

    private tableRegistry = new Map<TableConstructor, TableBase>();

    // ---------- ILanceDB 实现(使 TableBase 可原样复用) ----------

    get opened(): boolean { return !!this.#db; }

    get db(): Connection {
        if (!this.#db) throwNotfound("未初始化的全局工具数据库!");
        return this.#db;
    }

    get lanceInst(): LanceDBType {
        if (!this.#lanceInst) throwPrecondition("GlobalToolDB未初始化!");
        return this.#lanceInst;
    }

    get embedSize(): number { return this.#embedInst.embedSize; }

    async doEmbedding(batch: string[], type: EmbedType): Promise<number[][]> {
        return this.#embedInst.doEmbedding(batch, type);
    }

    async addTable<T extends TableBase>(token: TableConstructor<T>, name: string): Promise<void> {
        const instance = new token(this, name);
        await instance.init(this.db);
        this.tableRegistry.set(token, instance);
    }

    getTable<T extends TableBase>(token: TableConstructor<T>): T | null {
        const instance = this.tableRegistry.get(token);
        return (instance as T) ?? null;
    }

    // ---------- 生命周期 ----------

    /**
     * 打开全局库。路径自治于 userData/tooldb,外部无需传入。
     * @param builtinTools 内置工具集,key 为工具名(与传给 LLM 的 ToolSet 同构)
     */
    async open(builtinTools: Record<string, Tool> = {}): Promise<void> {
        return this.#enqueue(async () => {
            if (this.#db) return;

            try {
                this.#lanceInst = await getLanceDB();

                // 嵌入初始化失败(未配置模型)不致命:降级为 Fuse 检索
                try {
                    await this.#embedInst.init(new JsonFileKV());
                    this.#vectorReady = true;
                } catch (e) {
                    Logger.warn("[ToolDB] 向量嵌入不可用,检索将降级为 Fuse 模糊匹配:", e);
                    this.#vectorReady = false;
                }

                if (this.#vectorReady) {
                    this.#db = await this.lanceInst.connect(lanceDataPath(), {
                        storageOptions: { timeout: "10s" },
                    });
                    await this.addTable(ToolTable, toolTableName);
                }

                // 自动注册 search_tools 元工具,LLM 挂上它即可自行发现工具
                this.#addEntry({
                    id: searchToolId,
                    name: searchToolsToolName,
                    llmName: searchToolsToolName,
                    description: "用自然语言检索当前可用的工具",
                    source: "builtin",
                    tool: searchTool,
                });

                for (const [name, tool] of Object.entries(builtinTools)) {
                    this.#addEntry({
                        id: builtinId(name),
                        name,
                        llmName: this.#allocLlmName(name, builtinId(name)),
                        description: resolveToolDescription(tool),
                        source: "builtin",
                        tool,
                    });
                }
                await this.#syncSource("builtin");
                // 若 configService 在 open 之前已注册过 MCP(仅入内存注册表),此处补一次索引同步
                await this.#syncSource("mcp");

                Logger.debug("[ToolDB] 全局工具库已就绪.");
            } catch (error) {
                Logger.error("[ToolDB] 全局工具库初始化失败:", error);
                throw error;
            }
        });
    }

    async close(): Promise<void> {
        return this.#enqueue(async () => {
            for (const [id, client] of this.#mcpClients) {
                await closeMcpClient(id, client);
            }
            this.#mcpClients.clear();
            this.#mcpConfigs.clear();
            this.#registry.clear();
            this.#nameIndex.clear();
            this.#llmNameIndex.clear();
            this.#fuse = null;

            for (const t of this.tableRegistry.values()) {
                await t.close();
            }
            this.tableRegistry.clear();

            try {
                this.#db?.close();
            } catch (e) {
                Logger.error("[ToolDB] 关闭数据库时发生错误:", e);
            }
            this.#db = null;
            Logger.log("[ToolDB] 全局工具库已关闭.");
        });
    }

    // ---------- MCP 变更接口(由 configService 在完成持久化之后主动调用) ----------

    /**
     * 【增量】新增或更新单个 MCP server。
     * 调用时机:configService 已将该 server 配置落盘之后。
     * 行为:
     * - 配置与上次完全一致且连接仍在 → 无操作(幂等,可放心在保存流程里无条件调用);
     * - 否则断开旧连接、按新配置重连、重新拉取工具并增量更新向量索引;
     * - cfg.enabled === false 等价于临时下线该 server(保留配置指纹,再次启用时重连)。
     * 连接失败会抛出,供配置界面向用户反馈;此时该 server 的旧工具已被移除。
     */
    async upsertMcpServer(cfg: McpServerConfig): Promise<void> {
        return this.#enqueue(async () => {
            try {
                await this.#applyUpsert(cfg);
            } finally {
                await this.#syncSource("mcp");
            }
        });
    }

    /**
     * 【增量】删除单个 MCP server。
     * 调用时机:configService 已将该 server 从持久化配置中移除之后。
     * 断开连接、移除其全部工具并更新向量索引。对不存在的 id 幂等。
     */
    async rmMcpServer(serverId: string): Promise<void> {
        return this.#enqueue(async () => {
            await this.#applyRemove(serverId);
            await this.#syncSource("mcp");
        });
    }

    /**
     * 【全量】将 MCP 状态对齐到给定配置列表(声明式)。
     * 调用时机:应用启动时 configService 读出全部持久化配置后调用一次;
     *          或配置批量导入/重置后调用。
     * 行为:不在列表中的 server 被断开移除;列表中的逐个 upsert(配置未变化的不会重连)。
     * 单个 server 连接失败不阻断其它 server,失败的 id 在返回值中给出。
     */
    async setMcpServers(servers: McpServerConfig[]): Promise<{ failed: string[] }> {
        return this.#enqueue(async () => {
            const desired = new Set(servers.map((s) => s.id));

            // 收集需要移除的:现存连接 + 注册表残留条目
            const stale = new Set<string>();
            for (const id of this.#mcpClients.keys()) {
                if (!desired.has(id)) stale.add(id);
            }
            for (const e of this.#registry.values()) {
                if (e.source === "mcp" && e.serverId && !desired.has(e.serverId)) {
                    stale.add(e.serverId);
                }
            }
            for (const id of stale) {
                await this.#applyRemove(id);
            }

            const failed: string[] = [];
            for (const cfg of servers) {
                try {
                    await this.#applyUpsert(cfg);
                } catch (e) {
                    failed.push(cfg.id);
                    Logger.error(`[ToolDB] MCP [${cfg.id}] 连接失败,已跳过:`, e);
                }
            }

            await this.#syncSource("mcp");
            Logger.debug(`[ToolDB] MCP 全量对齐完成,工具总数 ${this.#registry.size},失败 ${failed.length}。`);
            return { failed };
        });
    }

    /** upsert 的内部实现,不做索引同步(由调用方统一收尾) */
    async #applyUpsert(cfg: McpServerConfig): Promise<void> {
        const cfgJson = JSON.stringify(cfg);
        const unchanged = this.#mcpConfigs.get(cfg.id) === cfgJson;
        // 配置没变:已连接的不动;disabled 的本就无连接,也不动
        if (unchanged && (cfg.enabled === false || this.#mcpClients.has(cfg.id))) return;

        await this.#applyRemove(cfg.id);
        this.#mcpConfigs.set(cfg.id, cfgJson);
        if (cfg.enabled === false) return;

        const { client, tools } = await connectMcpServer(cfg); // 失败抛出,此时无残留条目
        this.#mcpClients.set(cfg.id, client);
        for (const [name, tool] of Object.entries(tools)) {
            const id = mcpId(cfg.id, name);
            this.#addEntry({
                id,
                name,
                llmName: this.#allocLlmName(name, id, cfg.id),
                description: resolveToolDescription(tool),
                source: "mcp",
                serverId: cfg.id,
                tool,
            });
        }
    }

    /** remove 的内部实现,不做索引同步(由调用方统一收尾) */
    async #applyRemove(serverId: string): Promise<void> {
        const client = this.#mcpClients.get(serverId);
        if (client) {
            await closeMcpClient(serverId, client);
            this.#mcpClients.delete(serverId);
        }
        this.#mcpConfigs.delete(serverId);

        let removed = false;
        for (const [id, e] of this.#registry) {
            if (e.source === "mcp" && e.serverId === serverId) {
                this.#registry.delete(id);
                removed = true;
            }
        }
        if (removed) this.#rebuildIndexes();
    }

    // ---------- 注册表与内存索引 ----------

    /** 分配唯一 llmName:不撞名用原名,撞名依次尝试 serverId 前缀、数字后缀 */
    #allocLlmName(name: string, id: string, serverId?: string): string {
        const base = sanitizeToolName(name);
        const candidates = [
            base,
            serverId ? sanitizeToolName(`${serverId}_${name}`) : null,
        ].filter((c): c is string => !!c);
        for (const c of candidates) {
            const holder = this.#llmNameIndex.get(c);
            if (!holder || holder === id) return c;
        }
        for (let i = 2; ; i++) {
            const c = sanitizeToolName(`${base}_${i}`);
            const holder = this.#llmNameIndex.get(c);
            if (!holder || holder === id) return c;
        }
    }

    #addEntry(entry: RegisteredTool): void {
        this.#registry.set(entry.id, entry);
        if (this.#nameIndex.has(entry.name) && this.#nameIndex.get(entry.name) !== entry.id) {
            Logger.warn(
                `[ToolDB] 工具重名: "${entry.name}" (${this.#nameIndex.get(entry.name)} -> ${entry.id}),按名称获取将命中后者;工具流请引用 id。`,
            );
        }
        this.#nameIndex.set(entry.name, entry.id);
        this.#llmNameIndex.set(entry.llmName, entry.id);
        this.#fuse = null; // 惰性重建
    }

    #rebuildIndexes(): void {
        this.#nameIndex.clear();
        this.#llmNameIndex.clear();
        for (const entry of this.#registry.values()) {
            this.#nameIndex.set(entry.name, entry.id);
            this.#llmNameIndex.set(entry.llmName, entry.id);
        }
        this.#fuse = null;
    }

    #getFuse(): Fuse<RegisteredTool> {
        if (!this.#fuse) {
            this.#fuse = new Fuse([...this.#registry.values()], {
                keys: [
                    { name: "name", weight: 0.4 },
                    { name: "description", weight: 0.6 },
                ],
                includeScore: true,
                threshold: 0.45,
                ignoreLocation: true,
            });
        }
        return this.#fuse;
    }

    // ---------- 索引同步(hash 增量) ----------

    async #syncSource(source: ToolSource): Promise<void> {
        if (!this.#vectorReady) return;
        const table = this.getTable(ToolTable);
        if (!table) return;

        const desired = [...this.#registry.values()]
            .filter((t) => t.source === source && t.id !== searchToolId) // 元工具不入检索库
            .map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                source: t.source,
                server_id: t.serverId ?? "",
                hash: contentHash(t.name, t.description),
                text: `${t.name}: ${t.description}`,
            }));
        const desiredMap = new Map(desired.map((d) => [d.id, d]));

        const existing = await table.listBrief(source);

        const keep = new Set<string>();
        const toDelete: string[] = [];
        for (const row of existing) {
            const d = desiredMap.get(row.id);
            if (d && d.hash === row.hash) keep.add(row.id);
            else toDelete.push(row.id);
        }
        const toAdd = desired.filter((d) => !keep.has(d.id));

        await table.deleteByIds(toDelete);
        if (toAdd.length > 0) {
            const vectors = await this.doEmbedding(toAdd.map((d) => d.text), "document");
            await table.addRows(toAdd.map((d, i) => ({ ...d, vector: vectors[i] })));
        }
        Logger.debug(
            `[ToolDB] 索引同步[${source}]: 保留 ${keep.size}, 删除 ${toDelete.length}, 新嵌入 ${toAdd.length}`,
        );
    }

    // ---------- 对外查询 ----------

    /** search_tools 元工具,直接挂到 LLM 的 ToolSet 即可让 LLM 自行发现工具 */
    get searchToolsTool(): Tool {
        // if (!searchTool) throwPrecondition("[ToolDB] 尚未 open()");
        return searchTool;
    }

    /**
     * 自然语言检索工具:召回(向量优先,Fuse 降级/兜底) → rerank(排序+筛选) → 截断。
     */
    async searchTools(
        queryText: string,
        opts: { limit?: number; source?: ToolSource } = {},
    ): Promise<ToolSearchResult[]> {
        const q = (queryText ?? "").trim();
        if (!q) throwPrecondition("searchTools: queryText 不能为空");
        const limit = opts.limit ?? 8;

        let candidates: ToolSearchResult[] = [];

        const table = this.getTable(ToolTable);
        if (this.#vectorReady && table) {
            const [vec] = await this.doEmbedding([q], "query");
            // 召回量放大 3 倍,给 rerank 留筛选空间;库中行可能对应已下线 server,需过滤
            const rows = await table.searchByVector(vec, limit * 3, opts.source);
            for (const row of rows) {
                const entry = this.#registry.get(row.id);
                if (!entry) continue;
                candidates.push({ ...entry, score: row._distance, matchedBy: "vector" });
            }
        }

        if (candidates.length === 0) {
            candidates = this.#fuseSearch(q, limit * 3, opts.source);
        }

        // 元工具自身不作为检索结果返回
        candidates = candidates.filter((c) => c.id !== searchToolId);

        const ranked = await this.reranker(q, candidates, limit);
        return ranked.slice(0, limit);
    }

    #fuseSearch(q: string, limit: number, source?: ToolSource): ToolSearchResult[] {
        return this.#getFuse()
            .search(q, { limit: limit * 2 })
            .filter((r) => !source || r.item.source === source)
            .slice(0, limit)
            .map((r) => ({ ...r.item, score: r.score ?? 1, matchedBy: "fuse" as const }));
    }

    /**
     * 按 ID(优先)/ llmName / 原始 name 获取工具。
     * 工具流执行引擎应传 ID;llmName/name 仅为交互便利。
     */
    getTool(idOrName: string): Tool | null {
        return this.getToolMeta(idOrName)?.tool ?? null;
    }

    getToolMeta(idOrName: string): RegisteredTool | null {
        const byId = this.#registry.get(idOrName);
        if (byId) return byId;
        const id = this.#llmNameIndex.get(idOrName) ?? this.#nameIndex.get(idOrName);
        return id ? this.#registry.get(id) ?? null : null;
    }

    /**
     * 把检索结果或 id 列表转为可直接挂给 LLM 的 ToolSet。
     * key 使用 llmName,保证唯一且合法;失效的 id 静默跳过。
     */
    toToolSet(
        items: Array<string | ToolSearchResult | RegisteredTool>,
        opts: { includeSearchTool?: boolean } = {},
    ): Record<string, Tool> {
        const set: Record<string, Tool> = {};
        if (opts.includeSearchTool) {
            set[searchToolsToolName] = this.searchToolsTool;
        }
        for (const item of items) {
            const entry = typeof item === "string" ? this.getToolMeta(item) : item;
            if (!entry) continue;
            set[entry.llmName] = entry.tool;
        }
        return set;
    }

    /** 列出全部已注册工具的元信息(不含 Tool 实例) */
    listTools(source?: ToolSource): Array<Omit<RegisteredTool, "tool">> {
        return [...this.#registry.values()]
            .filter((t) => !source || t.source === source)
            .map(({ tool: _tool, ...meta }) => meta);
    }
}

const KEY = Symbol.for('unigen.singleton.globalToolDB');

/**
 * 应用级单例。Electron 主进程模块图唯一,模块级实例即天然单例,无需 ensure。
 * 使用顺序:main 启动 → await globalToolDB.open(builtins)
 *          → configService 加载配置 → await globalToolDB.setMcpServers(all)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalToolDB: GlobalToolDB = ((globalThis as any)[KEY] ??= new GlobalToolDB());
