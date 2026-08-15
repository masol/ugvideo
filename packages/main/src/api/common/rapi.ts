import { os } from '@orpc/server';
import { z } from 'zod';
// import { genText } from '$libs/utils/model/factory/node-llama-cpp/local.js'
import { iconQuery } from '$libs/utils/api/icon.js';

// ─── RPC 接口 ─────────────────────────────────────────────────

/**
 * 添加有效icon名称。
 */
const addIcon = os
    .input(
        z.object({
            names: z.array(z.string()),
            icon: z.boolean().optional()
        }),
    )
    .output(z.void())
    .handler(async ({ input }) => {
        const { names, icon } = input;
        iconQuery.init(names, icon ? "icon" : "emoji")
    })


const iconInited = os
    .input(z.void())
    .output(z.boolean())
    .handler(async () => {
        return iconQuery.isInitialized();
    });

export default {
    addIcon,
    iconInited,
}