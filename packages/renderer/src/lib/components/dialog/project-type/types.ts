import type { ProjectType } from '@app/main/types';
export type { ProjectType };

/** 工作流工坊类型的固定 id，永远无条件可选 */
export const BLANK_PROJECT_TYPE_ID = 'blank';

/** 工作流工坊类型定义（本地内置，不依赖服务器返回） */
export const BLANK_PROJECT_TYPE: ProjectType = {
    id: BLANK_PROJECT_TYPE_ID,
    name: '工作流工坊',
    description: '输入人类工作流，输出AI智能体，并可以发布为新的项目类型。',
    icon: 'IconSquarePlus',
};