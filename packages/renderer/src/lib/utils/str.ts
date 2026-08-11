
function slash(path: string) {
    return path.replace(/\\/g, '/');
}

export function path2URL(path: string) {
    // 1. 转为正斜杠
    const normalized = slash(path);
    // 2. 确保以 "/" 开头（例如 windows 盘符 "C:/" 需要变成 "/C:/"）
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    // 3. 编码特殊字符，但保留 / : @ 等字符
    const encoded = encodeURI(withLeadingSlash); // encodeURI 不会编码 / : @
    // 4. 拼接协议
    const url = `appfile://localhost${encoded}`;
    return url;
}