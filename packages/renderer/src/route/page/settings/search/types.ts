// Search Provider: 配置一个搜索后端的接入点
export interface SearchProviderConfig {
    id: string;                    // "tavily"、"brave"
    name: string;
    apiKey?: string;
    endpoint?: string;             // 自定义端点
    enabled: boolean;
    defaultEngines: string[];      // 默认激活的 engine id 列表
}

// Search Engine: 提供商下挂载的搜索引擎能力
export interface SearchEngineConfig {
    id: string;
    providerId: string;            // 关联到 provider.id
    label: string;
    category: "general" | "news" | "academic" | "image" | "code";
    enabled: boolean;
    maxResults: number;
    safeSearch: "strict" | "moderate" | "off";
    recencyDays?: number;
    domains?: string[];
}