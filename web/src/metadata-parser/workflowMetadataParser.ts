import type { Metadata } from "../types";
import { isPlainPromptString } from "./heuristicMetadataParser";
import type { NodeType, ExtractedPrompts, MetadataExtractionPass } from "./metadataParser";
import { isNegativePrompt, isPositivePrompt } from "./validator";

// Node types that usually contain model info
export const MODEL_NODE_TYPES = [
    'CheckpointLoaderSimple', 'CheckpointLoader|pysssss', 'ModelLoader', 'CheckpointLoader',
    'UnetLoaderGGUF', 'DualCLIPLoaderGGUF', 'UnetLoader', 'UnetLoaderGGML', 'UnetLoaderGGMLv3'
];

// Node types that combine/concat multiple conditioning inputs
const CONDITIONING_COMBINE_TYPES = [
    'ConditioningCombine', 'ConditioningConcat', 'ConditioningSetTimestepRange',
    'ConditioningAverage', 'ConditioningSetArea', 'ConditioningSetAreaPercentage',
    'easy positive', 'easy negative', 'easy promptConcat',
    'ImpactCombineConditionings',
];

// Node types that contain text prompts
const TEXT_NODE_TYPES = [
    'CLIPTextEncode', 'CR Prompt Text', 'ImpactWildcardProcessor', 'Textbox',
    'easy showAnything', 'StringFunction', 'Text Multiline', 'String', 'Text',
    'Text Concatenate', 'CR Text Concatenate', 'StringConcat',
    'ShowText', 'Note', 'PrimitiveNode',
];

/**
 * Recursively collects ALL prompt strings from a graph node and its upstream nodes.
 * Unlike the old version, this follows ALL branches and collects all text.
 */
export function collectAllPromptsFromGraph(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string[] {
    const collectedTexts: string[] = [];

    if (!node || visited.has(node.id)) return collectedTexts;
    visited.add(node.id);

    const nodeType = node.type || '';

    // Handle ImpactWildcardProcessor specially - prefer populated_text
    if (nodeType === 'ImpactWildcardProcessor') {
        // Check widgets_values for populated_text (index 1) or wildcard_text (index 0)
        if (Array.isArray(node.widgets_values)) {
            // populated_text is typically at index 1, wildcard_text at index 0
            const populatedText = node.widgets_values[1];
            const wildcardText = node.widgets_values[0];
            if (isPlainPromptString(populatedText) && populatedText.trim() !== '') {
                collectedTexts.push(populatedText.trim());
                return collectedTexts; // populated_text is the final resolved value
            }
            if (isPlainPromptString(wildcardText) && wildcardText.trim() !== '') {
                collectedTexts.push(wildcardText.trim());
                return collectedTexts;
            }
        }
    }

    // Handle conditioning combine/concat nodes - trace ALL inputs
    if (CONDITIONING_COMBINE_TYPES.includes(nodeType)) {
        if (Array.isArray(node.inputs)) {
            for (const inp of node.inputs) {
                if (inp.name?.startsWith('cond') || inp.name?.startsWith('conditioning') ||
                    inp.name === 'positive' || inp.name === 'negative') {
                    if (typeof inp.link === 'number') {
                        const upstream = findSourcePromptNode(nodes, inp.link, new Set());
                        if (upstream) {
                            const upstreamTexts = collectAllPromptsFromGraph(nodes, upstream, visited);
                            collectedTexts.push(...upstreamTexts);
                        }
                    }
                }
            }
        }
        return collectedTexts;
    }

    // Handle text nodes - extract the text value
    if (TEXT_NODE_TYPES.includes(nodeType) || nodeType.includes('Text') || nodeType.includes('String')) {
        // Try widgets_values[0] (most common place for prompt)
        if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
            const widgetVal = node.widgets_values[0];
            if (isPlainPromptString(widgetVal) && widgetVal.trim() !== '') {
                collectedTexts.push(widgetVal.trim());
            }
        }
        return collectedTexts;
    }

    // For any other node type, try to follow conditioning/text inputs
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if (['text', 'prompt', 'positive', 'negative', 'conditioning', 'cond'].includes(inp.name)) {
                if (typeof inp.link === 'number') {
                    const upstream = findSourcePromptNode(nodes, inp.link, new Set());
                    if (upstream) {
                        const upstreamTexts = collectAllPromptsFromGraph(nodes, upstream, visited);
                        collectedTexts.push(...upstreamTexts);
                    }
                }
            }
        }
    }

    // Also try widgets_values as fallback
    if (collectedTexts.length === 0 && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        const widgetVal = node.widgets_values[0];
        if (isPlainPromptString(widgetVal) && widgetVal.trim() !== '') {
            collectedTexts.push(widgetVal.trim());
        }
    }

    return collectedTexts;
}

// Legacy function - kept for compatibility but uses new implementation
export function resolvePromptStringFromGraph(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    const texts = collectAllPromptsFromGraph(nodes, node, visited);
    if (texts.length > 0) {
        return texts.join(', ');
    }
    return null;
}

// Finds the node that is the source of a prompt link
export function findSourcePromptNode(nodes: NodeType[], linkId: number | undefined, visited = new Set<number>()): NodeType | undefined {
    if (typeof linkId !== 'number') return undefined;
    for (const node of nodes) {
        if (!Array.isArray(node.outputs)) continue;
        for (const out of node.outputs) {
            if (Array.isArray(out.links) && out.links.includes(linkId)) {
                // Prefer CLIPTextEncode nodes with a prompt string
                if (node.type === 'CLIPTextEncode' && isPlainPromptString(node.widgets_values?.[0])) return node;
                if (!visited.has(node.id)) {
                    visited.add(node.id);
                    // Recursively follow input links
                    if (Array.isArray(node.inputs)) {
                        for (const inp of node.inputs) {
                            if (typeof inp.link === 'number') {
                                const found = findSourcePromptNode(nodes, inp.link, visited);
                                if (found) return found;
                            }
                        }
                    }
                }
            }
        }
    }
    return undefined;
}

// Recursively resolves a prompt string from a node, following links
export function resolvePromptStringFromNode(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    if (!node || visited.has(node.id)) return null;
    visited.add(node.id);
    // Try widgets_values[0] first
    if (isPlainPromptString(node.widgets_values?.[0]) && node.widgets_values[0].trim() !== '') {
        return node.widgets_values[0];
    }
    // Try to follow 'text' or 'prompt' input recursively
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if ((inp.name === 'text' || inp.name === 'prompt' || inp.name === 'positive' || inp.name === 'negative') && inp.link !== undefined) {
                // Find the upstream node by link
                const upstream = findSourcePromptNode(nodes, inp.link, visited);
                if (upstream) {
                    // Try widgets_values[0] or inputs.text/prompt
                    let result = resolvePromptStringFromNode(nodes, upstream, visited);
                    if (result && result.trim() !== '') return result;
                    // Try direct input fields if widgets_values is empty
                    const upstreamInputs = upstream.inputs || {};
                    if (isPlainPromptString(upstreamInputs.text) && upstreamInputs.text.trim() !== '') return upstreamInputs.text;
                    if (isPlainPromptString(upstreamInputs.prompt) && upstreamInputs.prompt.trim() !== '') return upstreamInputs.prompt;
                }
            }
        }
    }
    return null;
}

// Extracts positive/negative prompts from the graph by tracing sampler node inputs
// Now collects ALL prompts from the entire conditioning chain
export function extractPromptsFromGraph(nodes: NodeType[]): ExtractedPrompts {
    const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe', 'SamplerCustomAdvanced'];
    const sampler = nodes.find(n => samplerTypes.includes(n.type));
    if (!sampler || !Array.isArray(sampler.inputs)) return { positive: null, negative: null };

    let positive: string | null = null, negative: string | null = null;

    // Find input links for positive/negative
    const posInput = sampler.inputs.find((inp: any) => inp.name === 'positive');
    const negInput = sampler.inputs.find((inp: any) => inp.name === 'negative');

    // Collect ALL positive prompts from the chain
    if (posInput && typeof posInput.link === 'number') {
        const posNode = findSourcePromptNode(nodes, posInput.link);
        if (posNode) {
            const allTexts = collectAllPromptsFromGraph(nodes, posNode, new Set());
            // Deduplicate and join
            const uniqueTexts = [...new Set(allTexts.filter(t => t.trim() !== ''))];
            if (uniqueTexts.length > 0) {
                positive = uniqueTexts.join(', ');
            }
        }
    }

    // Collect ALL negative prompts from the chain
    if (negInput && typeof negInput.link === 'number') {
        const negNode = findSourcePromptNode(nodes, negInput.link);
        if (negNode) {
            const allTexts = collectAllPromptsFromGraph(nodes, negNode, new Set());
            const uniqueTexts = [...new Set(allTexts.filter(t => t.trim() !== ''))];
            if (uniqueTexts.length > 0) {
                negative = uniqueTexts.join(', ');
            }
        }
    }

    // Heuristic: If both resolve to the same string, try to deduplicate
    if (positive && negative && positive === negative) {
        if (isNegativePrompt(negative) && !isPositivePrompt(positive)) {
            positive = null;
        } else if (isPositivePrompt(positive) && !isNegativePrompt(negative)) {
            negative = null;
        } else {
            // If both are ambiguous, clear negative
            negative = null;
        }
    }

    return { positive, negative };
}

// Recursively traces graph nodes to extract seed value
export function resolveSeedFromGraph(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    if (!node || visited.has(node.id)) return null;
    visited.add(node.id);
    // Prefer widgets_values[1] for FooocusV2Expansion
    if (node.type === 'FooocusV2Expansion' && Array.isArray(node.widgets_values) && node.widgets_values.length > 1 && node.widgets_values[1] != null && node.widgets_values[1] !== '') {
        return String(node.widgets_values[1]);
    }
    // Otherwise, try widgets_values[0]
    if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0 && node.widgets_values[0] != null && node.widgets_values[0] !== '') {
        return String(node.widgets_values[0]);
    }
    // Try direct input fields
    if (node.inputs && node.inputs.seed != null) {
        return String(node.inputs.seed);
    }
    // Try to follow input links (for graph nodes)
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if (inp.name === 'seed' && typeof inp.link === 'number') {
                const upstream = findSourcePromptNode(nodes, inp.link, visited);
                if (upstream) {
                    const result = resolveSeedFromGraph(nodes, upstream, visited);
                    if (result && result !== '') return result;
                }
            }
        }
    }
    // Try to find a direct seed value in the inputs array
    if (Array.isArray(node.inputs)) {
        const directSeed = node.inputs.find((inp: any) => inp.name === 'seed' && inp.value != null);
        if (directSeed) {
            return String(directSeed.value);
        }
    }
    return null;
}

// Extracts seed from the graph by tracing sampler node inputs
export function extractSeedFromGraph(nodes: NodeType[], samplerNode: NodeType): string {
    if (!samplerNode || !Array.isArray(samplerNode.inputs)) return '';
    const seedInput = samplerNode.inputs.find((inp: any) => inp.name === 'seed');
    if (seedInput && typeof seedInput.link === 'number') {
        const upstream = findSourcePromptNode(nodes, seedInput.link);
        if (upstream) {
            const result = resolveSeedFromGraph(nodes, upstream);
            if (result && result !== '') return result;
        }
    }
    // Fallback: try direct value on the input
    if (seedInput && seedInput.value != null) {
        return String(seedInput.value);
    }
    // Fallback: try to find a direct seed value in the inputs array
    const directSeed = samplerNode.inputs.find((inp: any) => inp.name === 'seed' && inp.value != null);
    if (directSeed) {
        return String(directSeed.value);
    }
    return '';
}

// Main workflow metadata parser class
export class WorkflowMetadataParser {
    constructor() {}
    // Finds model filename from model loader nodes
    model(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (MODEL_NODE_TYPES.includes(node.type)) {
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string') {
                    return node.widgets_values[0];
                }
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'object' && node.widgets_values[0]?.content) {
                    return node.widgets_values[0].content;
                }
            }
        }
        return undefined;
    }
    // Finds seed value by tracing sampler node inputs
    seed(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe'];
        const samplerNode = workflow.nodes.find((n: any) => samplerTypes.includes(n.type));
        if (samplerNode) {
            return extractSeedFromGraph(workflow.nodes, samplerNode) || undefined;
        }
        return undefined;
    }
    // Finds positive prompt by tracing sampler node inputs
    positive(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.positive || undefined;
    }
    // Finds negative prompt by tracing sampler node inputs
    negative(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.negative || undefined;
    }
    // Finds sampler name from sampler node
    sampler(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[4] === 'string') return node.widgets_values[4];
                if (node.inputs && node.inputs.sampler_name) return node.inputs.sampler_name;
            }
        }
        return undefined;
    }
    // Finds step count from sampler node
    steps(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[2] === 'number') return String(node.widgets_values[2]);
                if (node.inputs && node.inputs.steps != null) return String(node.inputs.steps);
            }
        }
        return undefined;
    }
    // Finds CFG scale from sampler node
    cfg_scale(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[3] === 'number') return String(node.widgets_values[3]);
                if (node.inputs && node.inputs.cfg != null) return String(node.inputs.cfg);
            }
        }
        return undefined;
    }
}

// Extraction pass for workflow graph
export const extractByWorkflow: MetadataExtractionPass = {
    model(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (MODEL_NODE_TYPES.includes(node.type)) {
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string') {
                    return node.widgets_values[0];
                }
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'object' && node.widgets_values[0]?.content) {
                    return node.widgets_values[0].content;
                }
            }
        }
        return null;
    },
    seed(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe'];
        const samplerNode = workflow.nodes.find((n: any) => samplerTypes.includes(n.type));
        if (samplerNode) {
            return extractSeedFromGraph(workflow.nodes, samplerNode) || null;
        }
        return null;
    },
    positive(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.positive || null;
    },
    negative(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.negative || null;
    },
    sampler(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[4] === 'string') return node.widgets_values[4];
                if (node.inputs && node.inputs.sampler_name) return node.inputs.sampler_name;
            }
        }
        return null;
    },
    steps(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[2] === 'number') return String(node.widgets_values[2]);
                if (node.inputs && node.inputs.steps != null) return String(node.inputs.steps);
            }
        }
        return null;
    },
    cfg_scale(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[3] === 'number') return String(node.widgets_values[3]);
                if (node.inputs && node.inputs.cfg != null) return String(node.inputs.cfg);
            }
        }
        return null;
    }
};
