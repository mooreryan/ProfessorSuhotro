export const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

// The sentence-transformers/all-MiniLM-L6-v2 was trained at 256, even though
// the underlying transformer 512.
//
// We use a lower max, because the max is really more like a target any way...
//
// Even 200 still gets 66/807 chunks with > 256 tokens. May need to go and
// adjust it.
export const MAX_TOKENS = 200;
export const TARGET_TOKENS = 200;

// How many tokens of overlap to carry between chunks
export const OVERLAP_TOKENS = 20;
