// 这里导出的类型，目的是与renderer共享类型的--只能是type导出--默认的shared子目录为与renderer共享的类型定义。
export type { AppConfig } from './appconfig.js'
export type { CacheItem, IdentifiedItem } from './blueprint/blackboard/array.js'
export type { RunState } from './blueprint/state.js'
export type { AppClient, NotifyContract } from './shared/api/index.js'
export type { BlueprintKind } from './shared/api/list.js'
export type { RecentProject } from './shared/api/recents.js'
export type { FileFilterPreset } from './shared/api/sys.js'
export type { Model, ModelOption, ModelTags, Provider, ProviderProtocol } from './shared/model.js'
export type { Facets, GDagJSON, GuardKind, NodeKindT, NodeStatus, PNode, RegArtifact, RiskLevel, SizeEstimateT, TriState } from './shared/plan/nodes.js'
export type { ModuleSource, PluginInfo, PluginScope, PluginStatus } from './shared/plugin.js'
export type { WindowEventPayload, WindowEventType } from './shared/rpcevt.js'

export type * from './shared/template/index.js'

