import { safeApi } from '$lib/utils/api';
import { type ProjectType } from './types';

/**
 * 获取本地已安装的有效项目类型。
 * Electron 环境下这里应替换为读取本地已安装模板的 IPC 调用。
 * 返回列表不含工作流工坊类型——工作流工坊由对话框内置置顶。
 */
export async function fetchInstalledProjectTypes(): Promise<ProjectType[]> {
    return await safeApi().system.prjTypes();
}