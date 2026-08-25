import type { ProjectType } from '@app/main/types';
export type { ProjectType };

/** 工作流工坊类型的固定 id，永远无条件可选 */
export const BLANK_PROJECT_TYPE_ID = 'blank';

/** 工作流工坊类型定义（本地内置，不依赖服务器返回） */
export const BLANK_PROJECT_TYPE: ProjectType = {
    id: BLANK_PROJECT_TYPE_ID,
    name: '通用任务',
    description: '聊天窗里说一句话（比如“整理上周销售数据”），配置里细化具体步骤（可填可不填）。两者一起，一键生成干活流程并执行。',
    icon: 'IconSquarePlus',
};