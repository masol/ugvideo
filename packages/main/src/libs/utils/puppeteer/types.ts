export interface AgentWindowOptions {
    width?: number;
    height?: number;
    partition?: string;        // 自定义 session partition，默认 'agent'
    preloadScript?: string;    // 可选预加载脚本
}