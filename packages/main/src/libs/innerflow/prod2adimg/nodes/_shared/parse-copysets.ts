
// prod2adimg/nodes/_shared/parse-copysets.ts

/** 从文案 NL 切出各套文案块（"## 文案套 N"起头），顺序即 copySetIdx。 */
export function parseCopySets(copywriting: string): string[] {
    if (!copywriting) return [];
    const blocks = copywriting.split(/^##\s*文案套/m).slice(1);
    return blocks.map(b => ("## 文案套" + b).trim()).filter(Boolean);
}