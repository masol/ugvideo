import { pathToFileURL } from "url";


export const PROTOCOL_NAME = 'appfile';



export function path2URL(filePath: string): string {
    // 1. 转为绝对路径的文件 URL，例如 file:///D:/tools/unigen/...
    const fileUrl = pathToFileURL(filePath).href;

    // 2. 提取路径部分（含前导斜杠），格式如 "/D:/tools/..." 或 "/home/..."
    const url = new URL(fileUrl);
    const pathname = url.pathname; // 自动解码

    // 3. 拼接自定义协议，带上 localhost 主机名
    const ret = `${PROTOCOL_NAME}://localhost${pathname}`;
    return ret;
}