// 单层模型：一个 SERP 后端 = 一个下拉选项 + 一个 apiKey + 一个 enabled
export interface SearchProviderConfig {
    id: string;                    // 后端 ID（自动从 type 生成）
    type: SerpProviderType;
    name: string;                  // 显示名
    apiKey: string;
    enabled: boolean;
}

export type SerpProviderType =
    | "serper"
    | "serpapi"
    | "google_cse"
    | "bing"
    | "brave"
    | "dataforseo"
    | "searchapi"
    | "valueserp"
    | "scrapingdog"
    | "brightdata"
    | "searchcans";

// 提供商注册表：UI 下拉数据 + 申请文档 URL
export interface SerpProviderMeta {
    type: SerpProviderType;
    name: string;
    docUrl: string;
}

export const SERP_PROVIDERS: SerpProviderMeta[] = [
    { type: "serper", name: "Serper", docUrl: "https://serper.dev/" },
    { type: "serpapi", name: "SerpAPI", docUrl: "https://serpapi.com/" },
    { type: "google_cse", name: "Google CSE", docUrl: "https://console.cloud.google.com/apis/credentials" },
    { type: "bing", name: "Bing", docUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api" },
    { type: "brave", name: "Brave", docUrl: "https://brave.com/search/api/" },
    { type: "dataforseo", name: "DataForSEO", docUrl: "https://dataforseo.com/" },
    { type: "searchapi", name: "SearchAPI", docUrl: "https://www.searchapi.io/" },
    { type: "valueserp", name: "ValueSERP", docUrl: "https://www.valueserp.com/" },
    { type: "scrapingdog", name: "ScrapingDog", docUrl: "https://www.scrapingdog.com/" },
    { type: "brightdata", name: "Bright Data", docUrl: "https://brightdata.com/" },
    { type: "searchcans", name: "SearchCans", docUrl: "https://www.searchcans.com/" },
];