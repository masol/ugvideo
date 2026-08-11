/**
 * weaver · 特征提取器
 *
 * 各决策域的特征提取器合集。
 * 特征提取必须是确定性的——不许 LLM 参与。
 */

import type {
    Artifact,
    ConceptReference,
    ExternalEdge,
    FlowNode,
} from '../types.js';

// ── artifact 特征 ────────────────────────────────────────────────────

export interface ArtifactFeatures {
    name: string;
    intent: string;
    shape: 'scalar' | 'array';
    semanticFields: string[];
}

export function extractArtifactFeatures(artifact: Artifact): ArtifactFeatures {
    return {
        name: artifact.name,
        intent: artifact.intent,
        shape: artifact.shape,
        semanticFields: [...artifact.semanticFields],
    };
}

export function artifactFeatureText(f: ArtifactFeatures): string {
    return [f.name, f.intent, f.shape, ...f.semanticFields].join(' | ');
}

// ── actionAtom 特征 ──────────────────────────────────────────────────

export interface ActionAtomFeatures {
    verb: string;
    object: string;
    rawText: string;
}

export function extractActionAtomFeatures(actionAtom: string): ActionAtomFeatures {
    const trimmed = actionAtom.trim();
    // 简单切分：第一个空格前为动词
    const spaceIdx = trimmed.indexOf(' ');
    const verb = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const object = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : '';
    return { verb, object, rawText: trimmed };
}

export function actionAtomFeatureText(f: ActionAtomFeatures): string {
    return [f.verb, f.object].join(' ');
}

// ── flowNode 特征（用于动作对齐） ────────────────────────────────────

export interface FlowNodeFeatures {
    actionVerb: string;
    actionObject: string;
    aligned: string | null;
}

export function extractFlowNodeFeatures(node: FlowNode): FlowNodeFeatures {
    const atom = extractActionAtomFeatures(node.actionAtom);
    return {
        actionVerb: atom.verb,
        actionObject: atom.object,
        aligned: node.aligned?.kind ?? null,
    };
}

export function flowNodeFeatureText(f: FlowNodeFeatures): string {
    return [f.actionVerb, f.actionObject, f.aligned ?? ''].join(' ');
}

// ── 边特征（用于子流程跳转判定） ────────────────────────────────────

export interface ExternalEdgeFeatures {
    kind: 'internal' | 'external';
    hasCondition: boolean;
    targetKind: 'node' | 'graph';
}

export function extractExternalEdgeFeatures(edge: ExternalEdge): ExternalEdgeFeatures {
    return {
        kind: edge.kind,
        hasCondition: edge.condition !== null,
        targetKind: edge.kind === 'internal' ? 'node' : 'graph',
    };
}

export function externalEdgeFeatureText(f: ExternalEdgeFeatures): string {
    return [f.kind, f.hasCondition ? 'conditional' : 'unconditional', f.targetKind].join(' | ');
}

// ── 通用：概念名+intent 特征 ────────────────────────────────────────

export function conceptFeatureText(c: ConceptReference): string {
    return [c.name, ...c.aliases, c.intent].join(' | ');
}