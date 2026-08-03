import { ModelTags } from '$types/shared/model.js';

export const modelSchema = {
    type: 'object',
    required: ['id', 'abilities'],
    additionalProperties: false,
    properties: {
        id: {
            type: 'string',
            minLength: 1
        },

        abilities: {
            type: 'array',
            items: {
                type: 'string',
                enum: Object.values(ModelTags)
            },
            uniqueItems: true,
            minItems: 1
        },

        // 输入上下文窗口（Tokens）
        inctx: {
            type: 'integer',
            minimum: 0
        },

        // 最大输出 Tokens
        outctx: {
            type: 'integer',
            minimum: 0
        },

        // 模型能力评分
        score: {
            type: 'number',
            minimum: 0
        }
    }
} as const;