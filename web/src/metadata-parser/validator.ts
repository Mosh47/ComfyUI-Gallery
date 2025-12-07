// Keywords that help identify positive prompts
export const POSITIVE_KEYWORDS = [
    'positive', 'masterpiece', 'best quality', 'high quality', 'detailed', 'beautiful', 'amazing', 'stunning', 'perfect', 'photorealistic', 'professional', 'artistic', 'elegant'
];

// Keywords that help identify negative prompts
export const NEGATIVE_KEYWORDS = [
    'negative', 'bad', 'worst quality', 'low quality', 'poor quality', 'blurry', 'distorted', 'ugly', 'deformed', 'artifact', 'noise', 'overexposed', 'underexposed', 'cropped', 'out of frame'
];

// Checks if a prompt is likely positive
export function isPositivePrompt(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    const pos = POSITIVE_KEYWORDS.filter(k => lower.includes(k)).length;
    const neg = NEGATIVE_KEYWORDS.filter(k => lower.includes(k)).length;
    // If it contains strong negative keywords, it's not positive
    if (["worst quality", "low quality", "bad", "ugly", "blurry", "distorted", "deformed", "amateur", "poor quality"].some(k => lower.includes(k))) return false;
    // If it contains strong positive keywords, it's positive
    if (["masterpiece", "best quality", "high quality", "detailed", "professional", "photorealistic", "stunning", "beautiful"].some(k => lower.includes(k))) return true;
    // Otherwise, compare counts and length
    return (pos + (text.length > 50 ? 1 : 0)) > neg && pos > 0;
}

// Checks if a prompt is likely negative
export function isNegativePrompt(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    const neg = NEGATIVE_KEYWORDS.filter(k => lower.includes(k)).length;
    const pos = POSITIVE_KEYWORDS.filter(k => lower.includes(k)).length;
    // If it contains strong negative keywords, it's negative
    if (["worst quality", "low quality", "bad", "ugly", "blurry", "distorted", "deformed", "amateur", "poor quality"].some(k => lower.includes(k))) return true;
    // More negative than positive keywords, and at least one negative
    if (neg > pos && neg > 0) return true;
    // Short prompt with negative keywords is likely negative
    if (text.length < 100 && neg > 0) return true;
    return false;
}

// Cleans up and deduplicates parsed metadata
export class Validator {
    validate(parsedMetadata: Record<string, any>): Record<string, any> {
        // If positive and negative are identical, try to decide which is correct
        if (parsedMetadata.positive && parsedMetadata.negative && parsedMetadata.positive === parsedMetadata.negative) {
            if (isNegativePrompt(parsedMetadata.negative) && !isPositivePrompt(parsedMetadata.positive)) {
                parsedMetadata.positive = undefined;
            } else if (isPositivePrompt(parsedMetadata.positive) && !isNegativePrompt(parsedMetadata.negative)) {
                parsedMetadata.negative = undefined;
            } else {
                // If unsure, just clear negative
                parsedMetadata.negative = undefined;
            }
        }
        // If only negative is set, but it's actually positive, move it
        if (!parsedMetadata.positive && parsedMetadata.negative && isPositivePrompt(parsedMetadata.negative) && !isNegativePrompt(parsedMetadata.negative)) {
            parsedMetadata.positive = parsedMetadata.negative;
            parsedMetadata.negative = undefined;
        }
        return parsedMetadata;
    }
}
