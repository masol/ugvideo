import { PROTOCOL_NAME } from '$libs/utils/sys/appfile.js';
import { app, net, protocol } from 'electron';
import Logger from 'electron-log/main';
import { platform } from 'os';
import path from 'path';
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
        Logger.error(`试图注册协议${PROTOCOL_NAME},但是app已经就绪。`)
    }
    //   console.log('顶层同步：app.isReady() =', app.isReady()) // false

    protocol.registerSchemesAsPrivileged([
        {
            scheme: PROTOCOL_NAME,
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
    protocol.handle(PROTOCOL_NAME, (request) => {
        const rawUrl = request.url;
        Logger.debug("rawUrl=", rawUrl);

        // 1. 使用标准 URL 解析，拿到路径名（已自动解码）
        const parsedUrl = new URL(rawUrl);
        const pathname = parsedUrl.pathname;   // 如 "/D:/tools/..." 或 "/home/..."
        Logger.debug("pathname=", pathname);

        // 2. 根据平台还原为文件系统绝对路径
        let realFsPath;
        if (platform() === 'win32') {
            // Windows: pathname 形如 "/D:/tools/..."
            // 去掉前导斜杠，保留 "D:/tools/..."
            realFsPath = pathname.slice(1);
        } else {
            // Linux/macOS: pathname 就是绝对路径 "/home/..."
            realFsPath = pathname;
        }

        // 3. 规范化路径（处理斜杠、'.' '..' 等）
        realFsPath = path.normalize(realFsPath);
        Logger.debug("realFsPath=", realFsPath);

        // 4. 转为标准 file:// URL 并 fetch
        const targetFileUrl = pathToFileURL(realFsPath).href;
        Logger.debug("targetFileUrl=", targetFileUrl);

        return net.fetch(targetFileUrl, {
            headers: request.headers,
        });
    });
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
