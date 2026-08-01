/**
 * MCP 设置页面专用 Store。
 * 模式与 llm/searchstore.svelte.ts 对齐：class + 模块单例。
 * 不耦合任何持久化层；外部通过 readonly 引用，修改通过显式 action。
 */

import type { MCPServerConfig, MCPTool } from "./types";

// TODO: store bridge —— 把以下 mock 数据替换为真实 configStore 的派生。
const MOCK_SERVERS: MCPServerConfig[] = [
    {
        id: "github-mcp",
        name: "GitHub MCP",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        enabled: true,
        description: "允许 AI 读写 GitHub 仓库、Issue、PR",
        tools: [
            { name: "create_issue", description: "创建 Issue", dangerous: true },
            { name: "search_repos", description: "搜索仓库", dangerous: false },
            { name: "read_file", description: "读取文件内容", dangerous: false },
        ],
        autoApprove: ["search_repos", "read_file"],
        timeoutMs: 30000,
    },
    {
        id: "filesystem-mcp",
        name: "本地文件系统",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/workspace"],
        enabled: true,
        description: "受限访问本地工作目录",
        tools: [
            { name: "read_file", description: "读取文件", dangerous: false },
            { name: "write_file", description: "写入文件", dangerous: true },
            { name: "list_directory", description: "列出目录", dangerous: false },
        ],
        autoApprove: ["read_file", "list_directory"],
        timeoutMs: 15000,
    },
    {
        id: "brave-search-mcp",
        name: "Brave Search",
        transport: "http",
        url: "https://mcp.example.com/brave",
        enabled: false,
        description: "通过 HTTP 接入的搜索服务",
        tools: [
            { name: "web_search", description: "网页搜索", dangerous: false },
        ],
        autoApprove: [],
        timeoutMs: 10000,
    },
];

class MCPStore {
    // TODO: store bridge —— 替换为 configStore.mcpServers
    servers = $state<MCPServerConfig[]>(MOCK_SERVERS);

    // 搜索/筛选
    searchQuery = $state("");
    transportFilters = $state<MCPServerConfig["transport"][]>([]);
    showOnlyEnabled = $state(false);

    isFiltering = $derived(
        this.searchQuery.trim() !== "" ||
        this.transportFilters.length > 0 ||
        this.showOnlyEnabled,
    );

    toggleTransportFilter(t: MCPServerConfig["transport"]) {
        const idx = this.transportFilters.indexOf(t);
        if (idx >= 0) this.transportFilters.splice(idx, 1);
        else this.transportFilters.push(t);
    }

    toggleShowOnlyEnabled() {
        this.showOnlyEnabled = !this.showOnlyEnabled;
    }

    clearAllFilters() {
        this.searchQuery = "";
        this.transportFilters = [];
        this.showOnlyEnabled = false;
    }

    // CRUD actions（TODO: store bridge —— 同步到底层持久化）
    upsertServer(server: MCPServerConfig) {
        const idx = this.servers.findIndex((s) => s.id === server.id);
        if (idx >= 0) this.servers[idx] = server;
        else this.servers.push(server);
    }

    removeServer(id: string) {
        const idx = this.servers.findIndex((s) => s.id === id);
        if (idx >= 0) this.servers.splice(idx, 1);
    }

    toggleEnabled(id: string) {
        const s = this.servers.find((x) => x.id === id);
        if (s) s.enabled = !s.enabled;
    }

    upsertTool(serverId: string, tool: MCPTool) {
        const s = this.servers.find((x) => x.id === serverId);
        if (!s) return;
        const idx = s.tools.findIndex((t) => t.name === tool.name);
        if (idx >= 0) s.tools[idx] = tool;
        else s.tools.push(tool);
    }

    removeTool(serverId: string, toolName: string) {
        const s = this.servers.find((x) => x.id === serverId);
        if (!s) return;
        const idx = s.tools.findIndex((t) => t.name === toolName);
        if (idx >= 0) s.tools.splice(idx, 1);
    }

    toggleAutoApprove(serverId: string, toolName: string) {
        const s = this.servers.find((x) => x.id === serverId);
        if (!s) return;
        const list = s.autoApprove ?? [];
        const idx = list.indexOf(toolName);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(toolName);
        s.autoApprove = list;
    }

    // 派生
    filteredServers = $derived.by(() => {
        const q = this.searchQuery.toLowerCase().trim();
        const transports = this.transportFilters;
        if (!q && transports.length === 0 && !this.showOnlyEnabled) {
            return this.servers;
        }
        return this.servers.filter((s) => {
            if (this.showOnlyEnabled && !s.enabled) return false;
            if (transports.length > 0 && !transports.includes(s.transport)) return false;
            if (!q) return true;
            const hit =
                s.id.toLowerCase().includes(q) ||
                s.name.toLowerCase().includes(q) ||
                (s.description?.toLowerCase().includes(q) ?? false);
            return hit;
        });
    });
}

export const mcpStore = new MCPStore();