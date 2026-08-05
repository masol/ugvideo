// 视频、语音、翻译、BGM 工厂函数
export { createBGMModel, type BGMModel } from './factory/bgm/index.js';
export { createModel } from './factory/chat.js';
export { createEmbeding } from './factory/embed.js';
export { createImageModel } from './factory/image/index.js';
export { createMTModel } from './factory/mt/index.js';
export { createSpeechModel } from './factory/speech/index.js';
export { createTranscriptionModel } from './factory/transcription/index.js';
export { createVideoModel } from './factory/video/index.js';

export { SortStrategy } from './balancer/candidate.js';
export { getSmartASR, type GetSmartASROptions } from './balancer/get-smart-asr.js';
export { getSmartBGM, type GetSmartBGMOptions } from './balancer/get-smart-bgm.js';
export { getSmartImage, type GetSmartImageOptions } from './balancer/get-smart-image.js';
export { getSmartModel, type GetSmartModelOptions } from './balancer/get-smart-model.js';
export { getSmartMT, type GetSmartMTOptions, type MTResult } from './balancer/get-smart-mt.js';
export { getSmartTTS, type GetSmartTTSOptions } from './balancer/get-smart-tts.js';
export { getSmartVideo, type GetSmartVideoOptions } from './balancer/get-smart-video.js';

export { getLimiter, syncAndGetProviders } from './balancer/pool-registry.js';
