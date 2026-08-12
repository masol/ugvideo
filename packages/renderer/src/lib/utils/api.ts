import type { AppClient, NotifyContract } from '@app/main/types';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import Logger from 'electron-log/renderer';
import { getErrorMessage, isPlainObject } from 'radashi';
import { toast } from 'svelte-sonner';
import evtbus, { type Events } from './evtbus';

function initApi(): AppClient {

    const { port1: clientPort, port2: serverPort } = new MessageChannel()
    window.postMessage('start-orpc-client', '*', [serverPort])

    const link = new RPCLink({
        port: clientPort,
    })

    clientPort.start();
    // Or, create a client using a contract
    const client: AppClient = createORPCClient(link);
    return client;
}

let windowsId: number = -1;
export async function setupEvt(): Promise<number> {
    await window.onNotification((evt, msg) => {
        if (!isPlainObject(msg)) {
            Logger.error("收到无效的事件通知:", msg);
            return;
        }
        const notyObj: NotifyContract = msg as unknown as NotifyContract;
        if (!notyObj.name) {
            Logger.error("收到无效的事件通知(不包含名称):", msg);
            return;
        }
        if (windowsId === -1) {
            return; // 尚未初始化。
        }
        // 部分消息跳过回传检查。
        switch (notyObj.name) {
            case 'recent:projects':
                return evtbus.emit(notyObj.name as keyof Events, notyObj.payload as never);
        }
        if (notyObj.srcId === windowsId) {
            // 过滤自己发出的事件，不再通知回自己。
            // Logger.debug(`过滤自己发出的事件，不再通知回自己。${JSON.stringify(notyObj)}`)
            return;
        }
        evtbus.emit(notyObj.name as keyof Events, notyObj.payload as never);
    })
    windowsId = await window.getWindowId();
    return windowsId;
}

// export const wid = (): number => windowsId;

let client: AppClient;
export const api = (): AppClient => {
    if (!client) {
        client = initApi();
    }
    return client;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSafeProxy(target: any): any {
    // Proxy 的 target 必须是可调用的（function），apply 陷阱才能生效。
    // 用 function 作占位 target，get 陷阱也照常工作。
    const proxyTarget = typeof target === 'function' ? target : function () { };
    return new Proxy(proxyTarget, {
        get(_t, prop) {
            // 从真实 target 上取属性（真实 target 是 ORPC 的 Proxy）
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const original = (target as any)[prop];
            if (original === null || original === undefined) {
                return original;
            }
            // 不要 .bind()！bind 会创建一个原生 bound function，
            // 从而丢失 ORPC Proxy 的 get 行为，导致后续 .xxx 访问全部变 undefined。
            if (typeof original === 'function' || typeof original === 'object') {
                return createSafeProxy(original);
            }
            return original;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apply(_t, _thisArg, args: any[]) {
            if (typeof target !== 'function') {
                throw new TypeError('safeApi: target is not callable');
            }
            return (async () => {
                try {
                    // 直接以 ORPC 原 Proxy 作为 this 调用，保持其内部路径追踪逻辑。
                    return await Reflect.apply(target, target, args);
                } catch (e) {
                    procApiError(e);
                    return null;
                }
            })();
        },
    });
}
// 不会抛异常，而是报警并返回 null(用户取消不报警)。
export const safeApi = (): AppClient => {
    return createSafeProxy(api());
};


export function getErrorMsg(e: unknown): string {
    let msg: string;
    if (e instanceof ORPCError) {
        if (e.status === 601) { // 用户取消。
            return "";
        }
        // 项目已被打开，不再区别报告，以错误型态报告。
        // else if (e.status === COMMON_ORPC_ERROR_DEFS.TOO_MANY_REQUESTS.status) {
        //     return "";
        // }
        msg = e.message || e.code;
    } else {
        msg = getErrorMessage(e);
    }
    return msg;
}


export function procApiError(e: unknown): void {
    const msg = getErrorMsg(e);
    if (msg) {
        Logger.error("ProjectStore error:", msg, e);
        toast.error(msg);
    }
}