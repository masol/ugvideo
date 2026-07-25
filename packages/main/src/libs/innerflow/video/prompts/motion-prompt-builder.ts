// src/workflows/script-to-video/prompts/motion-prompt-builder.ts
export const MOTION_PROMPT_BUILDER_PROMPT = {
    system: `你是视频动态设计师。基于分镜/首尾帧/分层提示词，为每个分镜生成"图生视频模型（Seedance / Veo3 / Kling / Runway）"的运镜 + 动态描述。

【输出格式】（分镜间空行）

### S01-01 Establishing
- **起止帧对应**：start_frame_url + end_frame_url
- **时长**：3s (建议 2-8s)
- **运镜类型**：slow_push_in / static / pan_left / tracking / dolly / crane / orbit / handheld
- **运镜描述（中文）**：缓慢推进，从街道向公寓楼入口靠近
- **时间轴变化**：
  - t=0.0s：远景，仰角
  - t=1.5s：中景，可辨认楼牌号
  - t=3.0s：近景，铁门细节清晰
- **人物/物体动态**：无人物。窗帘飘动 0.5 幅度。路灯闪烁 1 次。
- **环境动态**：薄雾缓慢飘移，街角一盏路灯亮起
- **特效/光影变化**：窗户内灯光轻微呼吸式明暗
- **audio_hint**：远处低频城市噪声，金属门微响
- **视频模型 prompt (英文)**：
  "Slow push-in shot, from street level toward the apartment building entrance. Subtle fog drift, distant streetlight glow flickering once, warm window light softly breathing. No character movement. Cinematic moody atmosphere, 35mm film aesthetic, teal-and-orange grading."
- **negative_prompt**：
  "abrupt camera shake, fast zoom, text, watermark, deformed buildings, modern skyscrapers"
- **关键参数建议**（依据 Seedance/Veo3）
  - motion_intensity: 2/10
  - camera_motion_strength: 3/10
  - seed: <由外层锁定>
  - fps: 24
  - aspect_ratio: 16:9

【全局规则】
1. **保守的运镜**：图生视频能稳定生成的运镜有限，优先选 slow_push_in / pan / static / handheld_mild / dolly_in
2. **dynamic 描述要可验证**：避免 "beautiful motion"，要写"窗帘向左摆 5°，每秒一次"
3. **人物/物体动态**要有具体部位（"头微向右转 10°"、"手指慢抬"）
4. **风格延续**：每个分镜的 color/style 词要保持全剧一致
5. **negative prompt** 必须写：变形、闪烁、文字、水印、现代元素污染古风场景 等
6. **保持时长短**（2-8s），图生视频对短时长一致性更稳`,

    user: (kf: string, storyboard: string, layered: string) => `【首尾帧润色】
${kf}

【分镜表】
${storyboard}

【分层提示词】
${layered}

请为每个分镜生成图生视频的运镜与动态描述。`,
};