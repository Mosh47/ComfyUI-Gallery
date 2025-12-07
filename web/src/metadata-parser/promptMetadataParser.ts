import type { Metadata } from "../types";
import { isPlainPromptString } from "./heuristicMetadataParser";
import type { ExtractedPrompts, LoraInfo, MetadataExtractionPass, Parameters } from "./metadataParser";
import { isPositivePrompt, isNegativePrompt } from "./validator";

// Node types that combine/concat multiple conditioning inputs
const CONDITIONING_COMBINE_TYPES = [
    'ConditioningCombine', 'ConditioningConcat', 'ConditioningSetTimestepRange',
    'ConditioningAverage', 'ConditioningSetArea', 'ConditioningSetAreaPercentage',
    'easy positive', 'easy negative', 'easy promptConcat',
    'ImpactCombineConditionings',
];

// Node types that concatenate text strings - add new text concat nodes here if needed
const TEXT_CONCAT_TYPES = [
    // Comfyroll
    'CR Text Concatenate', 'CR Text Combine', 'CR Prompt Text Combiner',
    // Generic
    'Text Concatenate', 'StringConcat', 'String Concatenate', 'Text Concat',
    'JoinStrings', 'Join Strings', 'Concat Strings', 'String Join',
    // Easy nodes
    'easy promptConcat', 'easy textConcat',
    // WAS
    'Text Concatenate (mtb)', 'String Concatenate (mtb)',
];

// Node types that pass through conditioning without modification
const CONDITIONING_PASSTHROUGH_TYPES = [
    'ConditioningSetTimestepRange', 'ConditioningSetArea', 'ConditioningSetAreaPercentage',
    'ConditioningSetMask', 'ConditioningZeroOut', 'CLIPTextEncodeSDXL',
    'unCLIPConditioning', 'ControlNetApply', 'ControlNetApplyAdvanced',
    'FreeU', 'FreeU_V2', 'PerturbedAttentionGuidance',
];

// Node types that contain text prompts
const TEXT_NODE_TYPES = [
    'CLIPTextEncode', 'CR Prompt Text', 'ImpactWildcardProcessor', 'Textbox',
    'easy showAnything', 'StringFunction', 'Text Multiline', 'String', 'Text',
    'CR Text', 'ShowText', 'ShowText|pysssss', 'Note', 'PrimitiveNode',
];

// Node types that show/display the final combined text (these have text_0, text_1 etc with resolved values)
const SHOW_TEXT_TYPES = [
    'ShowText|pysssss', 'ShowText', 'easy showAnything', 'Display Any', 'Text Display',
];

/**
 * Resolves a text value from a node reference, following the chain recursively.
 * Returns the resolved text string or empty string.
 */
function resolveTextFromRef(prompt: any, ref: any, visited: Set<string>, depth = 0): string {
    if (depth > 50) return '';

    // Direct string value
    if (typeof ref === 'string') {
        return isPlainPromptString(ref) ? ref.trim() : '';
    }

    // Object with content field (pysssss format)
    if (typeof ref === 'object' && ref !== null && !Array.isArray(ref) && ref.content) {
        return isPlainPromptString(ref.content) ? ref.content.trim() : '';
    }

    // Array reference [nodeId, outputIndex]
    if (!Array.isArray(ref) || typeof ref[0] !== 'string') return '';

    const nodeId = ref[0];
    if (visited.has(nodeId)) return '';
    visited.add(nodeId);

    const node = prompt[nodeId];
    if (!node) return '';

    const classType = node.class_type || '';
    const inputs = node.inputs || {};

    // === ShowText|pysssss nodes have the FINAL combined text in text_0 ===
    if (SHOW_TEXT_TYPES.includes(classType)) {
        // Check for text_0, text_1, etc. which contain resolved values
        for (const key of ['text_0', 'text_1', 'text_2', 'value', 'text']) {
            if (inputs[key] && typeof inputs[key] === 'string' && inputs[key].trim() !== '') {
                return inputs[key].trim();
            }
        }
    }

    // === ImpactWildcardProcessor - use populated_text (resolved wildcards) ===
    if (classType === 'ImpactWildcardProcessor') {
        if (inputs.populated_text && typeof inputs.populated_text === 'string' && inputs.populated_text.trim() !== '') {
            return inputs.populated_text.trim();
        }
        if (inputs.wildcard_text && typeof inputs.wildcard_text === 'string' && inputs.wildcard_text.trim() !== '') {
            return inputs.wildcard_text.trim();
        }
        return '';
    }

    // === CR Text Concatenate - join text1 + separator + text2 + text3... ===
    if (TEXT_CONCAT_TYPES.includes(classType)) {
        const separator = typeof inputs.separator === 'string' ? inputs.separator : ' ';
        const parts: string[] = [];

        // Collect all text inputs (text1, text2, text3... or text_1, text_2...)
        const textKeys = Object.keys(inputs)
            .filter(k => k.match(/^text[_]?\d*$/i))
            .sort((a, b) => {
                const numA = parseInt(a.replace(/\D/g, '') || '0');
                const numB = parseInt(b.replace(/\D/g, '') || '0');
                return numA - numB;
            });

        for (const key of textKeys) {
            const resolved = resolveTextFromRef(prompt, inputs[key], new Set(visited), depth + 1);
            if (resolved) parts.push(resolved);
        }

        return parts.join(separator);
    }

    // === CR Text / simple text nodes - get direct text value ===
    if (classType === 'CR Text' || classType === 'CR Prompt Text' || classType === 'Text' || classType === 'String') {
        if (inputs.text && typeof inputs.text === 'string') {
            return inputs.text.trim();
        }
        if (inputs.value && typeof inputs.value === 'string') {
            return inputs.value.trim();
        }
    }

    // === CLIPTextEncode - follow the text input ===
    if (classType === 'CLIPTextEncode') {
        if (inputs.text) {
            return resolveTextFromRef(prompt, inputs.text, new Set(visited), depth + 1);
        }
    }

    // === Generic text node fallback ===
    if (TEXT_NODE_TYPES.includes(classType) || classType.includes('Text') || classType.includes('String') || classType.includes('Prompt')) {
        for (const key of ['text', 'prompt', 'string', 'value', 'text_output', 'output', 'result']) {
            if (inputs[key]) {
                const resolved = resolveTextFromRef(prompt, inputs[key], new Set(visited), depth + 1);
                if (resolved) return resolved;
            }
        }
    }

    // === Last resort: check if ANY input looks like a text reference or string ===
    for (const key of Object.keys(inputs)) {
        const val = inputs[key];
        // Direct string value
        if (typeof val === 'string' && isPlainPromptString(val) && val.trim() !== '' && val.length > 10) {
            return val.trim();
        }
        // Reference to another node - try to resolve it
        if (Array.isArray(val) && typeof val[0] === 'string' && !visited.has(val[0])) {
            const resolved = resolveTextFromRef(prompt, val, new Set(visited), depth + 1);
            if (resolved && resolved.length > 10) return resolved;
        }
    }

    return '';
}

/**
 * Extracts ALL positive prompts by tracing the entire conditioning graph.
 * This follows ALL branches through ConditioningConcat nodes and collects all text
 * from all CLIPTextEncode nodes in the chain.
 *
 * Key insight: ConditioningConcat combines TWO separate conditioning tensors,
 * which means TWO separate text sources that are encoded separately. We need
 * to trace BOTH branches and collect ALL text.
 */
export function extractPositivePromptFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';

    const collectedTexts: string[] = [];
    const visitedNodes = new Set<string>();

    /**
     * Traces through the conditioning graph and collects all text from CLIPTextEncode nodes.
     * Handles ConditioningConcat by following BOTH conditioning_to AND conditioning_from.
     */
    function collectAllTextsFromConditioningRef(ref: any, depth = 0): void {
        if (depth > 50) return;

        if (!Array.isArray(ref) || typeof ref[0] !== 'string') return;

        const nodeId = ref[0];
        if (visitedNodes.has(nodeId)) return;
        visitedNodes.add(nodeId);

        const node = prompt[nodeId];
        if (!node) return;

        const classType = node.class_type || '';
        const inputs = node.inputs || {};

        // === ConditioningConcat / ConditioningCombine ===
        // These combine TWO conditioning tensors - trace BOTH to get all text
        if (classType === 'ConditioningConcat' || classType === 'ConditioningCombine') {
            // conditioning_to is the "main" conditioning
            if (inputs.conditioning_to) {
                collectAllTextsFromConditioningRef(inputs.conditioning_to, depth + 1);
            }
            // conditioning_from is the "additional" conditioning (quality tags, etc.)
            if (inputs.conditioning_from) {
                collectAllTextsFromConditioningRef(inputs.conditioning_from, depth + 1);
            }
            // Also check other possible input names
            for (const key of Object.keys(inputs)) {
                if ((key.startsWith('cond') || key.startsWith('conditioning')) &&
                    key !== 'conditioning_to' && key !== 'conditioning_from') {
                    collectAllTextsFromConditioningRef(inputs[key], depth + 1);
                }
            }
            return;
        }

        // === CLIPTextEncode - this is where text becomes conditioning ===
        // Resolve the text input and add it to our collection
        if (classType === 'CLIPTextEncode') {
            const text = resolveTextFromRef(prompt, inputs.text, new Set(), 0);
            if (text && text.trim() !== '' && !collectedTexts.includes(text.trim())) {
                collectedTexts.push(text.trim());
            }
            return;
        }

        // === CFGGuider - trace the positive conditioning ===
        if (classType === 'CFGGuider' || classType === 'BasicGuider' || classType === 'DualCFGGuider') {
            if (inputs.positive) {
                collectAllTextsFromConditioningRef(inputs.positive, depth + 1);
            }
            return;
        }

        // === Other conditioning manipulation nodes - follow through ===
        // Check common conditioning input names
        const conditioningInputKeys = [
            'conditioning', 'positive', 'negative', 'cond', 'cond_single',
            'base_positive', 'base_negative', 'cond1', 'cond2',
            'conditioning_1', 'conditioning_2', 'positive_cond', 'pos'
        ];
        for (const key of conditioningInputKeys) {
            if (inputs[key] && Array.isArray(inputs[key])) {
                collectAllTextsFromConditioningRef(inputs[key], depth + 1);
            }
        }

        // === Fallback: check ANY input that looks like a conditioning reference ===
        // This handles unknown/custom nodes that pass through conditioning
        for (const key of Object.keys(inputs)) {
            const val = inputs[key];
            if (Array.isArray(val) && typeof val[0] === 'string' && !visitedNodes.has(val[0])) {
                // Check if the referenced node outputs conditioning
                const refNode = prompt[val[0]];
                if (refNode) {
                    const refClass = refNode.class_type || '';
                    // If it's a known conditioning-producing node, follow it
                    if (refClass.includes('Conditioning') || refClass.includes('CLIP') ||
                        refClass === 'ConditioningConcat' || refClass === 'ConditioningCombine' ||
                        refClass === 'CLIPTextEncode') {
                        collectAllTextsFromConditioningRef(val, depth + 1);
                    }
                }
            }
        }
    }

    // Find the sampler node
    const sampler = prompt[samplerNodeId];
    if (!sampler || !sampler.inputs) return '';

    // SamplerCustomAdvanced uses a guider node
    if (sampler.inputs.guider) {
        collectAllTextsFromConditioningRef(sampler.inputs.guider, 0);
    }

    // KSampler uses positive directly
    if (sampler.inputs.positive) {
        collectAllTextsFromConditioningRef(sampler.inputs.positive, 0);
    }

    // Join all collected texts - maintain order (main prompt first, then additions)
    const uniqueTexts = collectedTexts.filter((t, i, arr) => t.trim() !== '' && arr.indexOf(t) === i);
    return uniqueTexts.join(', ');
}

// Extracts the model filename by following references, including LoRA/model loader nodes
export function extractModelFromPromptObject(prompt: any): string {
    if (!prompt || typeof prompt !== 'object') return '';
    // Helper to resolve array references recursively
    function resolveModelRef(ref: any, visited = new Set()): string {
        if (!ref || visited.has(ref)) return '';
        visited.add(ref);
        // Direct model filename
        if (typeof ref === 'string' && (ref.endsWith('.safetensors') || ref.endsWith('.ckpt'))) return ref;
        if (typeof ref === 'object' && ref.content && (ref.content.endsWith('.safetensors') || ref.content.endsWith('.ckpt'))) return ref.content;
        // Array reference to another node
        if (Array.isArray(ref) && typeof ref[0] === 'string') {
            const refNode = prompt[ref[0]];
            if (refNode && refNode.inputs) {
                // LoRA node: follow its model input
                if ((refNode.class_type === 'LoraLoader' || refNode.class_type === 'Power Lora Loader (rgthree)') && refNode.inputs.model) {
                    return resolveModelRef(refNode.inputs.model, visited);
                }
                // CheckpointLoader nodes
                if ((refNode.class_type === 'CheckpointLoaderSimple' || refNode.class_type === 'CheckpointLoader|pysssss' || refNode.class_type === 'ModelLoader' || refNode.class_type === 'CheckpointLoader') && refNode.inputs.ckpt_name) {
                    return resolveModelRef(refNode.inputs.ckpt_name, visited);
                }
                // Fallback: search for any string ending with .safetensors or .ckpt
                for (const key in refNode.inputs) {
                    const val = refNode.inputs[key];
                    const resolved = resolveModelRef(val, visited);
                    if (resolved) return resolved;
                }
            }
        }
        return '';
    }
    // Main search: prefer CheckpointLoader, then LoRA, then any likely model filename
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // CheckpointLoader nodes
        if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss' || ct === 'ModelLoader' || ct === 'CheckpointLoader') && inputs.ckpt_name) {
            const resolved = resolveModelRef(inputs.ckpt_name);
            if (resolved) return resolved;
        }
        // LoRA nodes: follow their model input, but do NOT return the LoRA name
        if ((ct === 'LoraLoader' || ct === 'Power Lora Loader (rgthree)') && inputs.model) {
            const resolved = resolveModelRef(inputs.model);
            if (resolved) return resolved;
        }
        // Any node with a likely model filename
        for (const key in inputs) {
            const val = inputs[key];
            const resolved = resolveModelRef(val);
            if (resolved) return resolved;
        }
    }
    return '';
}

// Extracts all enabled LoRAs from the prompt object
export function extractLorasFromPromptObject(prompt: any): LoraInfo[] {
    const loras: LoraInfo[] = [];
    if (!prompt || typeof prompt !== 'object') return loras;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // Power Lora Loader (rgthree) style
        for (const key in inputs) {
            if (key.startsWith('lora_') && inputs[key] && inputs[key].on && inputs[key].lora) {
                loras.push({
                    name: inputs[key].lora,
                    model_strength: inputs[key].strength,
                    clip_strength: inputs[key].strengthTwo
                });
            }
        }
        // LoraLoader style
        if (ct === 'LoraLoader' && inputs.lora_name) {
            loras.push({
                name: inputs.lora_name,
                model_strength: inputs.strength_model,
                clip_strength: inputs.strength_clip
            });
        }
    }
    return loras;
}

// Extracts sampler/steps/cfg/model/seed/etc from the prompt object
export function extractParametersFromPromptObject(prompt: any): Parameters {
    const params: Parameters = {};
    if (!prompt || typeof prompt !== 'object') return params;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // Only extract from sampler nodes
        if (ct === 'KSampler' || ct === 'SamplerCustom' || ct === 'FaceDetailerPipe') {
            if (inputs.steps != null) params.steps = inputs.steps;
            if (inputs.cfg != null) params.cfg_scale = inputs.cfg;
            if (inputs.sampler_name) params.sampler = inputs.sampler_name;
            if (inputs.scheduler) params.scheduler = inputs.scheduler;
            if (inputs.seed != null) params.seed = inputs.seed;
            if (inputs.noise_seed != null && params.seed == null) params.seed = inputs.noise_seed;
        }
        // Model info from loader nodes
        if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss') && inputs.ckpt_name) {
            if (typeof inputs.ckpt_name === 'string') params.model = inputs.ckpt_name;
            if (typeof inputs.ckpt_name === 'object' && inputs.ckpt_name.content) params.model = inputs.ckpt_name.content;
        }
    }
    params.loras = extractLorasFromPromptObject(prompt);
    return params;
}

// Extracts the seed value by following references
export function extractSeedFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';
    const sampler = prompt[samplerNodeId];
    if (!sampler || !sampler.inputs) return '';
    const seedInput = sampler.inputs.seed;
    // If the seed input is an array reference, look up the referenced node
    if (Array.isArray(seedInput) && typeof seedInput[0] === 'string') {
        const refId = seedInput[0];
        const refNode = prompt[refId];
        if (refNode && refNode.class_type === 'FooocusV2Expansion' && refNode.inputs && refNode.inputs.prompt_seed != null) {
            return String(refNode.inputs.prompt_seed);
        }
        // Try other common fields
        if (refNode && refNode.inputs) {
            if (refNode.inputs.seed != null) return String(refNode.inputs.seed);
            if (refNode.inputs.text != null) return String(refNode.inputs.text);
            if (refNode.inputs.value != null) return String(refNode.inputs.value);
        }
    }
    // If the seed input is a direct value
    if (typeof seedInput === 'number' || typeof seedInput === 'string') {
        return String(seedInput);
    }
    return '';
}

/**
 * Extracts ALL negative prompts by tracing the entire conditioning graph.
 * Similar to extractPositivePromptFromPromptObject but follows the 'negative' input.
 */
export function extractNegativePromptFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';

    // === STRATEGY 1: Look for ShowText with "Combined" or "Negative" in title ===
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node) continue;
        const classType = node.class_type || '';
        const title = node._meta?.title || '';

        if (SHOW_TEXT_TYPES.includes(classType) &&
            (/combined.*negative/i.test(title) || /negative.*combined/i.test(title) || title === 'Combined Negative Prompt')) {
            const inputs = node.inputs || {};
            if (inputs.text_0 && typeof inputs.text_0 === 'string' && inputs.text_0.trim() !== '') {
                return inputs.text_0.trim();
            }
        }
    }

    // === STRATEGY 2: Look for CR Text node with "Negative Prompt" title ===
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node) continue;
        const classType = node.class_type || '';
        const title = node._meta?.title || '';

        if ((classType === 'CR Text' || classType === 'CR Prompt Text') && /negative\s*prompt/i.test(title)) {
            const inputs = node.inputs || {};
            if (inputs.text && typeof inputs.text === 'string' && inputs.text.trim() !== '') {
                return inputs.text.trim();
            }
        }
    }

    // === STRATEGY 3: Trace from sampler/guider through the conditioning chain ===
    const collectedTexts: string[] = [];
    const visitedNodes = new Set<string>();

    function collectAllTextsFromConditioningRef(ref: any, depth = 0): void {
        if (depth > 50) return;
        if (!Array.isArray(ref) || typeof ref[0] !== 'string') return;

        const nodeId = ref[0];
        if (visitedNodes.has(nodeId)) return;
        visitedNodes.add(nodeId);

        const node = prompt[nodeId];
        if (!node) return;

        const classType = node.class_type || '';
        const inputs = node.inputs || {};

        // ConditioningConcat - follow both inputs
        if (classType === 'ConditioningConcat' || classType === 'ConditioningCombine') {
            if (inputs.conditioning_to) collectAllTextsFromConditioningRef(inputs.conditioning_to, depth + 1);
            if (inputs.conditioning_from) collectAllTextsFromConditioningRef(inputs.conditioning_from, depth + 1);
            for (const key of Object.keys(inputs)) {
                if (key.startsWith('cond') || key.startsWith('conditioning')) {
                    collectAllTextsFromConditioningRef(inputs[key], depth + 1);
                }
            }
            return;
        }

        // CLIPTextEncode - resolve the text
        if (classType === 'CLIPTextEncode') {
            const text = resolveTextFromRef(prompt, inputs.text, new Set(), 0);
            if (text && !collectedTexts.includes(text)) {
                collectedTexts.push(text);
            }
            return;
        }

        // CFGGuider - follow negative input
        if (classType === 'CFGGuider' || classType === 'BasicGuider') {
            if (inputs.negative) {
                collectAllTextsFromConditioningRef(inputs.negative, depth + 1);
            }
            return;
        }

        // Passthrough nodes
        if (inputs.conditioning) collectAllTextsFromConditioningRef(inputs.conditioning, depth + 1);
        if (inputs.negative) collectAllTextsFromConditioningRef(inputs.negative, depth + 1);
        if (inputs.cond) collectAllTextsFromConditioningRef(inputs.cond, depth + 1);
    }

    // Find the starting point
    const sampler = prompt[samplerNodeId];
    if (sampler && sampler.inputs) {
        // SamplerCustomAdvanced uses guider
        if (sampler.inputs.guider) {
            const guiderId = sampler.inputs.guider[0];
            const guider = prompt[guiderId];
            if (guider && guider.inputs && guider.inputs.negative) {
                collectAllTextsFromConditioningRef(guider.inputs.negative, 0);
            }
        }
        // KSampler uses negative directly
        if (sampler.inputs.negative) {
            collectAllTextsFromConditioningRef(sampler.inputs.negative, 0);
        }
    }

    const uniqueTexts = [...new Set(collectedTexts.filter(t => t.trim() !== ''))];
    return uniqueTexts.join(', ');
}

/**
 * Scans all nodes for positive/negative prompt candidates.
 * This is a fallback method that doesn't trace the graph - it just finds all text nodes.
 */
export function extractPromptsFromPromptObject(prompt: any): ExtractedPrompts {
    let positive: string | null = null, negative: string | null = null;
    if (!prompt || typeof prompt !== 'object') return { positive, negative };

    // First, try to find the sampler and trace properly
    const samplerNodeId = Object.keys(prompt).find(
        k => ['KSampler', 'SamplerCustom', 'FaceDetailerPipe', 'KSamplerAdvanced'].includes(prompt[k]?.class_type)
    );

    if (samplerNodeId) {
        positive = extractPositivePromptFromPromptObject(prompt, samplerNodeId);
        negative = extractNegativePromptFromPromptObject(prompt, samplerNodeId);
        if (positive || negative) {
            return { positive: positive || null, negative: negative || null };
        }
    }

    // Fallback: scan all nodes for prompt candidates
    const positiveCandidates: { value: string, priority: number }[] = [];
    const negativeCandidates: { value: string, priority: number }[] = [];

    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const title = node._meta?.title || '';
        const inputs = node.inputs || {};

        // Check ImpactWildcardProcessor specially - prefer populated_text
        if (ct === 'ImpactWildcardProcessor') {
            const text = inputs.populated_text || inputs.wildcard_text;
            if (isPlainPromptString(text) && text.trim() !== '') {
                if (isPositivePrompt(text)) {
                    positiveCandidates.push({ value: text, priority: 8 });
                } else if (isNegativePrompt(text)) {
                    negativeCandidates.push({ value: text, priority: 8 });
                }
            }
            continue;
        }

        // Check common text fields
        for (const key of ['prompt', 'text', 'string', 'value']) {
            const val = inputs[key];
            if (!isPlainPromptString(val) || val.trim() === '') continue;

            let priority = 0;
            // Prioritize by node type and title
            if (ct === 'CR Prompt Text' && /positive/i.test(title)) priority = 10;
            else if (ct === 'CR Prompt Text' && /negative/i.test(title)) priority = 10;
            else if (/positive/i.test(title)) priority = 7;
            else if (/negative/i.test(title)) priority = 7;
            else if (ct === 'CLIPTextEncode') priority = 5;
            else if (TEXT_NODE_TYPES.includes(ct)) priority = 3;
            else priority = 1;

            if (isPositivePrompt(val) && !isNegativePrompt(val)) {
                positiveCandidates.push({ value: val, priority });
            } else if (isNegativePrompt(val)) {
                negativeCandidates.push({ value: val, priority });
            }
        }
    }

    // Sort by priority (highest first) and take the best
    positiveCandidates.sort((a, b) => b.priority - a.priority);
    negativeCandidates.sort((a, b) => b.priority - a.priority);

    if (positiveCandidates.length > 0) positive = positiveCandidates[0].value;
    if (negativeCandidates.length > 0) negative = negativeCandidates[0].value;

    return { positive, negative };
}

// Main parser class for prompt objects
export class PromptMetadataParser {
    constructor() {}

    model(metadata: Metadata): string | undefined {
        return extractModelFromPromptObject(metadata.prompt) || undefined;
    }

    seed(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );
        if (!samplerNodeId) return undefined;
        return extractSeedFromPromptObject(metadata.prompt, samplerNodeId) || undefined;
    }

    positive(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;

        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );

        if (samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos && pos.trim() !== '') return pos;
        }

        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.positive) return promptPrompts.positive;
        return undefined;
    }

    negative(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;

        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );

        if (samplerNodeId) {
            const neg = extractNegativePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (neg && neg.trim() !== '') return neg;
        }

        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.negative) return promptPrompts.negative;
        return undefined;
    }

    sampler(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.sampler ? String(params.sampler) : undefined;
    }

    scheduler(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.scheduler ? String(params.scheduler) : undefined;
    }

    steps(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.steps != null ? String(params.steps) : undefined;
    }

    cfg_scale(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.cfg_scale != null ? String(params.cfg_scale) : undefined;
    }

    loras(metadata: Metadata): string | undefined {
        const loras = extractLorasFromPromptObject(metadata.prompt);
        return loras.length > 0 ? loras.map(lora => lora && lora.name ? `${lora.name} (Model: ${lora.model_strength ?? ''}, Clip: ${lora.clip_strength ?? ''})` : '').filter(Boolean).join(', ') : undefined;
    }
}

// Sampler node types to search for - add new sampler types here if needed
const SAMPLER_NODE_TYPES = [
    // Core ComfyUI samplers
    'KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced',
    // Impact pack
    'FaceDetailerPipe', 'DetailerForEach', 'DetailerForEachDebug',
    // Ultimate SD Upscale
    'UltimateSDUpscale', 'UltimateSDUpscaleNoUpscale',
    // Tiled samplers
    'Tiled KSampler', 'TiledKSampler', 'TiledKSamplerAdvanced',
    // Other common samplers
    'KSamplerSelect', 'SamplerDPMPP_2M_SDE', 'SamplerEulerAncestral',
];

// Extraction pass for prompt objects
export const extractByPrompt: MetadataExtractionPass = {
    model(metadata: Metadata) {
        return extractModelFromPromptObject(metadata.prompt) || null;
    },
    seed(metadata: Metadata) {
        if (!metadata.prompt) return null;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );
        if (!samplerNodeId) return null;
        return extractSeedFromPromptObject(metadata.prompt, samplerNodeId) || null;
    },
    positive(metadata: Metadata) {
        if (!metadata.prompt) return null;

        // Find the sampler node
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );

        if (samplerNodeId) {
            // Use the new comprehensive extractor that follows ALL branches
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos && pos.trim() !== '') return pos;
        }

        // Fallback: use heuristics to scan all nodes
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.positive) return promptPrompts.positive;
        return null;
    },
    negative(metadata: Metadata) {
        if (!metadata.prompt) return null;

        // Find the sampler node
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => SAMPLER_NODE_TYPES.includes(metadata.prompt[k]?.class_type)
        );

        if (samplerNodeId) {
            // Use the new comprehensive extractor
            const neg = extractNegativePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (neg && neg.trim() !== '') return neg;
        }

        // Fallback: use heuristics
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.negative) return promptPrompts.negative;
        return null;
    },
    sampler(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.sampler ? String(params.sampler) : null;
    },
    scheduler(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.scheduler ? String(params.scheduler) : null;
    },
    steps(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.steps != null ? String(params.steps) : null;
    },
    cfg_scale(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.cfg_scale != null ? String(params.cfg_scale) : null;
    },
    loras(metadata: Metadata) {
        const loras = extractLorasFromPromptObject(metadata.prompt);
        return loras.length > 0 ? loras.map(lora => lora && lora.name ? `${lora.name} (Model: ${lora.model_strength ?? ''}, Clip: ${lora.clip_strength ?? ''})` : '').filter(Boolean).join(', ') : null;
    }
};
