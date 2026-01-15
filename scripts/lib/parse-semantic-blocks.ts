import {
  type Code,
  type Heading,
  type List,
  type Root,
  type RootContent,
} from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import { MAX_TOKENS, TARGET_TOKENS } from "../../shared/constants";
import { type SemanticBlock } from "./chunk-with-context";
import { countTokens } from "./tokens";

/** Parse the root of the markdown tree into an array of `SemanticBlocks`.
 *
 * Does a semi-reasonable job of keeping "atomic" units together, and well as
 * ensuring that blocks don't have too many tokens in them.
 */
export async function parseSemanticBlocks(
  tree: Root,
): Promise<readonly SemanticBlock[]> {
  const nodeToSemanticBlocks = async (node: RootContent) => {
    if (node.type === "yaml") {
      return [];
    }

    if (node.type === "heading") {
      const block = await headingNodeToSemanticBlock(node);
      return [block];
    }

    if (node.type === "list") {
      return splitListIntoBlocks(node);
    }

    return splitRegularNodeIntoBlocks(node);
  };

  const allBlocks: SemanticBlock[] = [];
  for (const node of tree.children) {
    const blocks = await nodeToSemanticBlocks(node);
    allBlocks.push(...blocks);
  }

  return allBlocks;
}

async function headingNodeToSemanticBlock(
  node: Heading,
): Promise<SemanticBlock> {
  const text = toString(node);
  const markdown = toMarkdown({ type: "root", children: [node] });

  const heading = {
    type: "heading",
    node,
    text,
    markdown,
    tokens: await countTokens(text),
    headingLevel: node.depth,
  };

  return heading;
}

/**
 * Split lists by items, but keep list items together
 */
async function splitListIntoBlocks(
  listNode: List,
): Promise<readonly SemanticBlock[]> {
  const semanticBlocks: SemanticBlock[] = [];

  for (const item of listNode.children) {
    const text = toString(item);

    const list: List = {
      type: "list",
      ordered: listNode.ordered,
      start: listNode.start,
      spread: listNode.spread,
      children: [item],
    };

    const markdown = toMarkdown({
      type: "root",
      children: [list],
    });

    semanticBlocks.push({
      type: "listItem",
      node: item,
      text,
      markdown,
      tokens: await countTokens(text),
    });
  }

  return semanticBlocks;
}

async function splitRegularNodeIntoBlocks(
  node: RootContent,
): Promise<readonly SemanticBlock[]> {
  // "Regular" blocks, like paragraph, code, blockquote, table, etc.
  const text = toString(node);
  const markdown = toMarkdown({ type: "root", children: [node] });
  const tokens = await countTokens(text);

  // Try to split oversized blocks, but if we can't just roll with it and let
  // the downstream encoding system truncate it.
  if (tokens > MAX_TOKENS) {
    return splitOversizedBlock(node, text, markdown, tokens);
  }

  const block = {
    type: node.type,
    node,
    text,
    markdown,
    tokens,
  };

  return [block];
}

/** Splits large blocks into ones that are below the target size.
 *
 * This function tries its best to split blocks while accounting for the fact
 * that blocks should be atomic. So, if none of the rules of the function
 * successfully split the block below the size limit, we just return the block
 * as is and let downstream embedding models handle/truncate it.
 */
async function splitOversizedBlock(
  node: RootContent,
  text: string,
  markdown: string,
  tokens: number,
): Promise<readonly SemanticBlock[]> {
  let result: readonly SemanticBlock[] | null = null;

  // Try strategy 1: Split code blocks on blank lines
  if (node.type === "code") {
    result = await trySplitCodeBlock(node);
  }

  // Try strategy 2: Split paragraphs on sentence boundaries
  if (!result && node.type === "paragraph") {
    result = await trySplitParagraph(node, text);
  }

  // Can't split: return as-is and let embedding model truncate
  if (!result) {
    result = [
      {
        type: node.type,
        node,
        text,
        markdown,
        tokens,
      },
    ];
  }

  return result;
}

/**
 * Attempts to split a code block at blank lines when it exceeds
 * `TARGET_TOKENS`. Returns null if splitting is not successful.
 */
async function trySplitCodeBlock(
  node: Code,
): Promise<readonly SemanticBlock[] | null> {
  const lines = node.value.split("\n");
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  for (const line of lines) {
    // Add this line to the current chunk
    currentChunk.push(line);

    // Then count the tokens in the current chunk
    const chunkText = currentChunk.join("\n");
    const chunkTokens = await countTokens(chunkText);

    // We save the current chunk and start a new one if the chunk is too big and
    // we are on a blank line. We include the blank line check for ending the
    // current chunk because we are treating the newline as a heuristic for
    // natural break point in the code. (Sometimes functions or other "real"
    // semantic units have blank lines in them, so it won't always keep
    // those together, but it's a reasonable heuristic.)
    if (chunkTokens > TARGET_TOKENS && isEmptyWhenTrimmed(line)) {
      chunks.push([...currentChunk]);
      currentChunk = [];
    }
  }

  // After processing the lines, we may have some leftover data in the final
  // chunk, so add that one too.
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // If we only have one chunk at this point, no splitting occurred, so return
  // null.
  if (chunks.length <= 1) {
    return null;
  }

  // If we are here, we successfully split the code block, so we need to create
  // the semantic blocks from the chunked data rather than the original.
  const blocks: SemanticBlock[] = [];
  for (const chunk of chunks) {
    blocks.push(await createCodeBlockFromChunk(chunk, node));
  }

  return blocks;
}

/**
 * Creates a SemanticBlock from a chunk of code lines.
 *
 * The metadata associated with the `originalNode` is copied over to the
 * resulting `SemanticBlock`.
 */
async function createCodeBlockFromChunk(
  lines: string[],
  originalNode: Code,
): Promise<SemanticBlock> {
  const chunkValue = lines.join("\n");
  const chunkNode: Code = {
    type: "code",
    lang: originalNode.lang,
    meta: originalNode.meta,
    value: chunkValue,
  };
  const chunkMarkdown = toMarkdown({
    type: "root",
    children: [chunkNode],
  });

  return {
    type: "code",
    node: chunkNode,
    text: chunkValue,
    markdown: chunkMarkdown,
    tokens: await countTokens(chunkValue),
  };
}

/**
 * Attempts to split a paragraph at sentence boundaries when it exceeds
 * `TARGET_TOKENS`.
 *
 * Not doing anything sophisticated here, e.g., `"Mr. Rodgers"` will be split
 * into too "sentences": `["Mr.", "Rodgers"]`, but it's good enough for our
 * purposes.
 *
 * Returns null if splitting is not successful.
 */
async function trySplitParagraph(
  node: RootContent,
  text: string,
): Promise<readonly SemanticBlock[] | null> {
  // Use the lookbehind on the ending punctuation so that it stays with the
  // sentence to which it's attached.
  const sentences = text.split(/(?<=[.!?])\s+/);

  if (sentences.length <= 1) {
    return null;
  }

  const chunks = await groupSentencesIntoChunks(sentences);

  // Only return chunks if we successfully split
  if (chunks.length <= 1) {
    return null;
  }

  const blocks: SemanticBlock[] = [];
  for (const chunk of chunks) {
    blocks.push(await createParagraphBlockFromSentences(chunk, node));
  }
  return blocks;
}
/**
 * Groups sentences into chunks that don't exceed TARGET_TOKENS.
 */
async function groupSentencesIntoChunks(
  sentences: readonly string[],
): Promise<readonly string[][]> {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = await countTokens(sentence);

    if (
      currentTokens + sentenceTokens > TARGET_TOKENS &&
      currentChunk.length > 0
    ) {
      chunks.push([...currentChunk]);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Creates a SemanticBlock from a chunk of sentences.
 */
async function createParagraphBlockFromSentences(
  sentences: readonly string[],
  originalNode: RootContent,
): Promise<SemanticBlock> {
  const chunkText = sentences.join(" ");
  return {
    type: "paragraph",
    // TODO: shouldn't we be creating a new node for this?
    node: originalNode,
    text: chunkText,
    markdown: chunkText + "\n",
    tokens: await countTokens(chunkText),
  };
}

function isEmptyWhenTrimmed(string: string) {
  return string.trim().length === 0;
}
