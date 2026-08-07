// src/lib/components/chat/commands.ts
export type ChatCommand = {
    id: string;
    /** 插入到输入框的文本前缀，例如 "/translate" */
    label: string;
    desc: string;
};

export const chatCommands: ChatCommand[] = [
    {
        id: "导出知识库", label: "/export", desc: `将项目知识库导出，支持如下参数:
--kc 导出到知识库项目类型目录下。
--noentry: 不导出入口设置信息。
--nores:\t 不导出资源。
--nocap:\t 不导出能力。
--nometag: 不导出元术语。
` },
    {
        id: "plan", label: "/plan", desc: `给出输入/输出(如从剧本生成视频)，规划工作流。支持如下参数：
--cap: 指定根能力，而不是当前项目类型。new或uuid,new表示新建。
--rounds: 最大轮次，默认6.
--expand-depth: 最大展开的层级，默认6.
--detail-levels: 当模型规划失败时，会在减少节点数量后重试，这里指示分几次减少，5次意味着每次压缩20%数量的节点。
--think-depth: 当前节点终止条件是无人类明确定工作流，本参数打开随后模拟人类思维树的层级，默认0不开启。
--no-codegen: 规划完毕即退出，不执行代码生成。可设置为true或on,默认off。
` },
    {
        id: "aigc", label: "/aigc", desc: `执行指定的AGIC,测试并验证当前配置:
--type: text|image|video|tts|asr|bgm|mt
--size: 1024x1024  指定生成图像尺寸  480p 指定生成视频尺寸。
--duration: 1 指定生成视频/音频时长，单位秒。
` },
    {
        id: "run", label: "/run", desc: `执行指定ID的capa，默认直接执行当前任务的入口：
--plan: 执行规划结果.
--cap: 执行指定的能力.
` },
    {
        id: "prism", label: "/prism", desc: `使用prism方法回答你的问题--无上下文，支持如下参数：
--facets: 最大视角数，默认5.
--rounds: 最大轮次，默认2.
--kind:   日志中的名称。
` },
    {
        id: "preprism", label: "/preprism", desc: `使用preprism方法回答你的问题--无上下文，支持如下参数：
--facets: 最大维度数，默认5.
--kind:   日志中的名称。`},
    { id: "clear", label: "/clear", desc: "清空当前对话记录" },
    {
        id: "kv", label: "/kv", desc: `维护项目术语表，支持如下参数:
--rm pattern: 删除pattern通配符的全部key.
--ls pattern: 列出pattern通配符的全部key.
` },
];

/** 根据输入的查询词过滤命令（去掉开头的 "/"） */
export function filterCommands(
    query: string,
    source: ChatCommand[] = chatCommands,
): ChatCommand[] {
    const q = query.replace(/^\//, "").toLowerCase().trim();
    if (!q) return source;
    return source.filter(
        (c) =>
            c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
    );
}