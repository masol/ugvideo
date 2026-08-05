import { AppConfig } from '$types/appconfig.js';
import { Schema } from 'electron-store';
import { keybindingsSchema } from './common.schema.js';
import { providerSchema } from './provider.schema.js';

export const configSchema: Schema<AppConfig> = {
    theme: {
        type: 'string',
        enum: ['light', 'dark', 'system'],
        default: 'light',
    },
    lang: {
        type: 'string',
        default: 'zh-CN',
    },
    itemsPerPage: {
        type: 'integer',
        default: 10,
        minimum: 5,
        maximum: 30
    },
    fontSize: {
        type: 'integer',
        default: 16,
        minimum: 6,
        maximum: 80
    },
    lineHeight: {
        type: 'integer',
        default: 26,
        minimum: 3,
        maximum: 50
    },
    concurrency: {
        type: 'integer',
        default: 12,
        minimum: 1,
        maximum: 3000
    },
    lineNumbers: {
        type: 'boolean',
        default: true
    },
    maximized: {
        type: 'boolean',
        default: true
    },
    disableHA: {
        type: 'boolean',
        default: false,
    },
    embed_model: {
        type: 'string',
        default: ""
    },
    telemetry: {
        type: 'string',
        default: ""
    },
    local_model: {
        type: "string",
        default: ""
    },
    autoupdate: {
        type: "boolean",
        default: true,
    },
    parallelRun: {
        type: "boolean",
        default: false,
    },
    rmblueprint: {
        type: "boolean",
        default: false,
    },
    silentSave: {
        type: "boolean",
        default: false,
    },
    models: {
        type: 'array',
        default: [],
        items: providerSchema // 引入服务商 schema
    },
    keybindings: keybindingsSchema,
};
