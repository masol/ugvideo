import { PROTOCAL_NAME } from '$libs/utils/sys/appfile.js';
import { app, net, protocol } from 'electron';
import Logger from 'electron-log/main';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { AppModule } from '../AppModule.js';
import { ModuleContext } from '../types/ModuleContext.js';

/**
 * 注册自定义协议 appfile://
 *
 * 渲染进程使用示例：
 *   <video src="appfile:///Users/xxx/movie.mp4" controls />
 *   <img   src="appfile:///Users/xxx/photo.png" />
 *   <audio src="appfile:///Users/xxx/song.mp3" controls />
 *
 * Chromium 会自动发送 Range 请求，视频可拖动进度条，无需全部加载到内存。
 *
 * 在 app.whenReady() 之前调用 protocol.registerSchemesAsPrivileged
 * 在 app.whenReady() 之后调用 registerFileProtocol
 */
/** 第一步：在 app ready 之前调用 */
export function registerSchemes(): void {
    if (app.isReady()) {
        Logger.error(`试图注册协议${PROTOCAL_NAME},但是app已经就绪。`)
    }
    //   console.log('顶层同步：app.isReady() =', app.isReady()) // false

    protocol.registerSchemesAsPrivileged([
        {
            scheme: PROTOCAL_NAME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                stream: true,          // ← 关键：允许流式读取（视频拖动进度条）
                bypassCSP: true,
                corsEnabled: true,
            },
        },
    ])
}

function registerFileProtocol(): void {
    protocol.handle(PROTOCAL_NAME, (request) => {

        // 1. 拿到最原始的 URL 字符串
        const rawUrl = request.url

        // 2. 剥离自定义协议头（保留后面的全部内容）
        // 例如: "myproto://home/masol/..." -> "home/masol/..."
        // 或者: "myproto:///home/masol/..." -> "/home/masol/..."
        const prefixLength = `${PROTOCAL_NAME}://`.length
        let remainingPath = rawUrl.slice(prefixLength)

        // 3. URL 解码（处理中文、空格等转义字符）
        remainingPath = decodeURIComponent(remainingPath)

        // 4. 利用 path.resolve() 跨平台转为系统绝对路径
        // - 如果剩余部分是 "home/masol/..."，resolve("/") 会把它安全变成 Linux 的 "/home/masol/..."
        // - 如果在 Windows 上是 "C:/data/..."，resolve() 会自动识别盘符并转为 "C:\data\..."
        const realFsPath = resolve('/', remainingPath)

        // 5. 转为标准 file:// URL
        const targetFileUrl = pathToFileURL(realFsPath).href

        // console.log("targetFileUrl=", targetFileUrl)

        return net.fetch(targetFileUrl, {
            headers: request.headers,
        })
    })
}

class ProtocalModule implements AppModule {

    async enable({ app }: ModuleContext): Promise<void> {
        await app.whenReady();
        registerFileProtocol();
    }
}

export function protocalModule(...args: ConstructorParameters<typeof ProtocalModule>) {
    return new ProtocalModule(...args);
}
