import { onError, ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import plugin from './common/plugin.js';
import window from './common/window.js';
// import Logger from "electron-log/main.js";
import { alsMiddleware } from "./als.js";
import config from './common/cfg.js';
import rapi from './common/rapi.js';
import system from './common/sys.js';
import project from './project/index.js';
import { RpcContext } from "./type.js";

// ==========================================
// 3. 构建应用路由器（将中间件链条挂载到顶层）
// ==========================================
const appRouter = os
    .use(alsMiddleware) // 在最外层挂载中间件，使所有子路由（plugin, window）自动生效
    .router({
        plugin,
        window,
        config,
        system,
        project,
        rapi
    });

export type AppRouter = typeof appRouter;

let handler: RPCHandler<RpcContext> | undefined;

export function getOrpcHandler(): RPCHandler<RpcContext> {
    if (!handler) {
        handler = new RPCHandler<RpcContext>(appRouter, {
            interceptors: [
                onError((error, context) => {
                    void context;
                    // Logger.error('oRPC Server Error:', error, context);
                    // 重新抛出，错误透传给客户端。@todo: 这里需要处理不是从Error派生的异常，重新从Error派生。
                    // 如果不是 ORPCError，包装一层下发前端
                    if (!(error instanceof ORPCError)) {
                        throw new ORPCError('BAD_REQUEST', {
                            message: error instanceof Error ? error.message : String(error), // 把 Conf 校验信息透传给前端
                            cause: error,
                        })
                    }
                    // 本身就是 ORPCError 直接重抛
                    throw error
                }),
            ],
        });
    }
    return handler;
}