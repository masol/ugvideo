import { appLife } from "$libs/utils/tapable/applife.js";
import Logger from "electron-log/main.js";
import { getBuiltinTools } from "./builtins.js";
import { globalToolDB } from "./globaltooldb.js";
import type { McpServerConfig } from "./type.js";

let initialized = false;
let unregisterBeforeQuit: (() => void) | null = null;
void (unregisterBeforeQuit)

export async function initGlobalToolDB(
    mcpServers?: McpServerConfig[],
): Promise<{ failed: string[] }> {
    if (initialized) return { failed: [] };
    initialized = true;

    await globalToolDB.open(getBuiltinTools());

    unregisterBeforeQuit = appLife.beforeQuit.tapPromise("GlobalToolDB", async () => {
        Logger.debug("[ToolDB] 正在清理资源...");
        await globalToolDB.close();
        Logger.debug("[ToolDB] 清理资源完成。");
    });

    if (mcpServers && mcpServers.length > 0) {
        return globalToolDB.setMcpServers(mcpServers);
    }
    return { failed: [] };
}