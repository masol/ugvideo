// MCP Server 配置项（伪数据，便于页面独立运行）
export interface MCPServerConfig {
    id: string;                  // 唯一标识，如 "github-mcp"
    name: string;                // 显示名
    transport: 'stdio' | 'sse' | 'http';
    command?: string;            // stdio: 命令
    args?: string[];             // stdio: 参数
    url?: string;                // sse/http: 端点
    enabled: boolean;
    tools: MCPTool[];
    env?: Record<string, string>;
    autoApprove?: string[];      // 工具名白名单
    timeoutMs?: number;
    description?: string;
}

export interface MCPTool {
    name: string;
    description: string;
    dangerous: boolean;          // 标记是否需要二次确认
}