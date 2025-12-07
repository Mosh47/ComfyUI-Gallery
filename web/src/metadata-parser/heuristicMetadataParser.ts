import type { Metadata } from "../types";
import type { ExtractedPrompts } from "./metadataParser";
import { isPositivePrompt, isNegativePrompt } from "./validator";

// Node types that often contain prompt text
export const PROMPT_NODE_TYPES = [
    'CLIPTextEncode', 'CR Prompt Text', 'ImpactWildcardProcessor', 'Textbox',
    'easy showAnything', 'StringFunction', 'Text Multiline', 'String', 'Text',
    'Text Concatenate', 'CR Text Concatenate', 'StringConcat', 'ShowText', 'PrimitiveNode'
];

// Checks if a value is a plain string prompt (not an object or array)
export function isPlainPromptString(val: any): val is string {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    // Ignore JSON-like or array-like strings
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return false;
    // Ignore huge lists (likely not a prompt)
    if (trimmed.length > 2000 && trimmed.split(',').length > 100) return false;
    return true;
}

// Tries to find positive/negative prompts by scanning likely nodes and fields
export function fallbackFindPromptsFromPromptObject(prompt: any): ExtractedPrompts {
    let positive: string | null = null, negative: string | null = null;
    if (!prompt || typeof prompt !== 'object') return { positive, negative };

    // Collect all candidates with priorities
    const positiveCandidates: { value: string, priority: number }[] = [];
    const negativeCandidates: { value: string, priority: number }[] = [];

    // Search all nodes
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const title = node._meta?.title || '';
        const inputs = node.inputs || {};

        // Special handling for ImpactWildcardProcessor - prefer populated_text
        if (ct === 'ImpactWildcardProcessor') {
            // populated_text contains the resolved wildcard result
            const populatedText = inputs.populated_text;
            const wildcardText = inputs.wildcard_text;

            const text = isPlainPromptString(populatedText) && populatedText.trim() !== ''
                ? populatedText
                : (isPlainPromptString(wildcardText) && wildcardText.trim() !== '' ? wildcardText : null);

            if (text) {
                // ImpactWildcardProcessor gets high priority since it's the final resolved text
                if (isPositivePrompt(text) && !isNegativePrompt(text)) {
                    positiveCandidates.push({ value: text, priority: 9 });
                } else if (isNegativePrompt(text)) {
                    negativeCandidates.push({ value: text, priority: 9 });
                }
            }
            continue;
        }

        // Skip non-prompt node types for other processing
        if (!PROMPT_NODE_TYPES.includes(ct) && !ct.includes('Text') && !ct.includes('String')) continue;

        // Try text and prompt fields
        for (const key of ['text', 'prompt', 'string', 'value']) {
            const val = inputs[key];
            if (!isPlainPromptString(val) || val.trim() === '') continue;

            // Determine priority based on node type and title
            let priority = 1;
            if (/positive/i.test(title)) priority = 8;
            else if (/negative/i.test(title)) priority = 8;
            else if (ct === 'CR Prompt Text') priority = 6;
            else if (ct === 'CLIPTextEncode') priority = 5;
            else if (PROMPT_NODE_TYPES.includes(ct)) priority = 3;

            if (isPositivePrompt(val) && !isNegativePrompt(val)) {
                positiveCandidates.push({ value: val, priority });
            } else if (isNegativePrompt(val)) {
                negativeCandidates.push({ value: val, priority });
            }
        }
    }

    // Sort by priority and take the best
    positiveCandidates.sort((a, b) => b.priority - a.priority);
    negativeCandidates.sort((a, b) => b.priority - a.priority);

    if (positiveCandidates.length > 0) positive = positiveCandidates[0].value;
    if (negativeCandidates.length > 0) negative = negativeCandidates[0].value;

    return { positive, negative };
}

// Simple parser using only heuristics
export class HeuristicMetadataParser {
    constructor() {}
    // Returns the first likely positive prompt found
    positive(metadata: Metadata): string | undefined {
        const fallbackPrompts = fallbackFindPromptsFromPromptObject(metadata.prompt);
        return fallbackPrompts.positive || undefined;
    }
    // Returns the first likely negative prompt found
    negative(metadata: Metadata): string | undefined {
        const fallbackPrompts = fallbackFindPromptsFromPromptObject(metadata.prompt);
        return fallbackPrompts.negative || undefined;
    }
}
