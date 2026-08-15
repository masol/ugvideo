/**
 * weaver · compile · reAct 范式模板
 *
 * 用途：被引用于 compile-instructions.txt 中，作为 LLM 必须遵守的核心模式。
 * 文件本身**不导出任何运行期代码**，只是用来：
 *   - 在编译 prompt 中渲染一个完整 reAct 示例；
 *   - verify 阶段会扫描产物代码是否含 reAct 三段式特征。
 *
 * reAct 结构（强制）：
 *
 *   async function main(输入对象, instructions) {
 *       const messages = [{role: "user", content: <构造用户提示词>}];
 *       for (let round = 0; round < MAX_ROUNDS; round++) {
 *           const { text } = await llm.generate({ instructions, messages });
 *           messages.push({role: "assistant", content: text});
 *
 *           // 至少一个 verify，未通过则把反馈追加为 user 消息并 continue
 *           const v1 = await verify1(text, 输入对象);
 *           if (!v1.ok) { messages.push({role: "user", content: v1.feedback}); continue; }
 *
 *           // 可选并行块（撰写多个部分 / 多次抽取）
 *           const re = await reActBlock(...);
 *
 *           // 整体通读
 *           const v2 = await verify2(...);
 *           if (!v2.ok) { messages.push({role: "user", content: v2.feedback}); continue; }
 *
 *           return 输出对象;
 *       }
 *       err.throwUnprcessable("reAct 未收敛");
 *   }
 */

export const REACT_TEMPLATE = `
async function main(输入对象, instructions) {
  // 第一步：构造初始用户提示词（从输入对象读原料）
  const rawDraft = Array.isArray(输入对象['提纲草案'])
      ? 输入对象['提纲草案'].join('\n')
      : 输入对象['提纲草案'];
  if (!validator.isString(rawDraft) || rawDraft.length === 0) {
    err.throwUnprcessable('提纲草案不能为空');
  }

  const messages = [{
    role: 'user',
    content: '请基于以下提纲进行主体撰写：\\n' + rawDraft,
  }];

  for (let round = 0; round < 6; round++) {
    const { text } = await llm.generate({
      instructions: instructions['role_draft_writer'],
      messages,
    });
    messages.push({ role: 'assistant', content: text });

    const v1 = await verify结构完整性(text);
    if (!v1.ok) { messages.push({ role: 'user', content: v1.feedback }); continue; }

    const v2 = await verify可用性(text);
    if (!v2.ok) { messages.push({ role: 'user', content: v2.feedback }); continue; }

    return { '主体各部分内容': text };
  }
  err.throwUnprcessable('超出最大轮次仍未能收敛');
}

/**
 * verify1：结构完整性（如：含指定小节、所有声明字段必出现）
 */
async function verify结构完整性(text) {
  const pass = validator.isString(text) && text.length > 100;
  return { ok: pass, feedback: pass ? '' : '主体长度不足或类型错误，请补足。' };
}

/**
 * verify2：质量约束（如：口语化、新手可读）
 */
async function verify可用性(text) {
  const r = await llm.generate({
    instructions: instructions['role_reviewer'],
    prompt: '请判断以下文本是否新手可读、无明显卡顿。若有卡顿，请指出位置并给出修改建议；否则回复"通过"。\\n\\n' + text,
  });
  const pass = validator.isString(r.text) && r.text.includes('通过');
  return { ok: pass, feedback: pass ? '' : r.text };
}
`;