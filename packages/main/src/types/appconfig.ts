import type { RecentProject } from "./shared/api/recents.js";
import { Provider } from "./shared/model.js";



export interface AppConfig {
    theme: 'light' | 'dark' | 'system';
    lang: string;
    maximized: boolean;
    // model_endpoint: string; // 模型的下载点。(包括ugvector下载embeding以及ollmacpp自动下载模型)
    embed_model: string; // ugvector使用的模型名称(external:XXX为外部模型，非本地模型)
    local_model: string; // 废弃使用本地LLM模型(可以通过llama-cpp或LM Studio等本地桥接)，本字段改为rerank配置。
    autoupdate: boolean;
    parallelRun: boolean;
    models: Provider[];
    concurrency: number;
    telemetry: string; // COLLECTOR_URL配置。
    disableHA: boolean; // 禁用硬件加速。 disableHardwareAcceleration 
    itemsPerPage: number;
    fontSize: number;
    lineHeight: number;
    lineNumbers: boolean;
    rmblueprint: boolean; // 是否允许删除blueprint三表中的成员，默认false.
    silentSave: boolean; // 是否静默保存--在保存数据前提醒用户，默认为false(提醒用户).
    keybindings: Record<string, string[]>;
    // 其他配置...
}


// 无需备份与恢复的第二配置。
export interface SecondConfig {
    recents: RecentProject[]
}