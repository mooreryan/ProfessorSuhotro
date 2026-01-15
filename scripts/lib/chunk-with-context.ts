// Basic idea:
//
// for each block:
//   if isHeading -> update heading stack
//
//   if current chunk + block > MAX_TOKENS:
//     finalize current chunk
//     calculate overlap
//     start fresh
//
//   add block to current chunk

import type { RootContent } from "mdast";
import * as Constant from "../../shared/constants";
import { MAX_TOKENS } from "../../shared/constants";
import type { FinalizedChunk } from "./finalized-chunk";
import * as Stack from "./immutable-stack";
import { countTokens } from "./tokens";
import type { Work } from "./work";
/**
 * A `SemanticBlock` is a block of content that you don't want to break apart,
 * e.g., a single `li`, a sentence, etc.
 *
 * A `Chunk` is made up of at least one of these.
 */
export interface SemanticBlock {
  /** The type of the `SemanticBlock`. */
  readonly type: string;

  /** The node, i.e., the entity that `unified` gives you. */
  readonly node: RootContent;

  /**
   * Text content of the node. Will include headings for context. You should use
   * this field when generating embeddings.
   */
  readonly text: string;

  /**
   * The original content as markdown. May not have exactly the same markup
   * literals, but you can still use this to display to users.
   */
  readonly markdown: string;

  /** The number of tokens in the block. */
  readonly tokens: number;
}

interface Heading extends SemanticBlock {
  readonly type: "heading";

  /** The level of the heading. */
  readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6;
}

function isHeading(semanticBlock: SemanticBlock): semanticBlock is Heading {
  return semanticBlock.type === "heading";
}

interface HeadingDatum {
  readonly text: string;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Chunks blocks with heading context and overlap between chunks.
 */
export async function chunkWithContext(
  blocks: readonly SemanticBlock[],
  work: Work,
  title: string,
): Promise<readonly FinalizedChunk[]> {
  const chunks: FinalizedChunk[] = [];
  let headingStack: Stack.Stack<HeadingDatum> = Stack.create();
  let currentBlocks: SemanticBlock[] = [];
  let overlapBlocks: SemanticBlock[] = [];

  for (const block of blocks) {
    if (isHeading(block)) {
      headingStack = updateHeadingStack(headingStack, block);
    }

    // Check if adding this block would exceed the limit
    const currentTokens = currentBlocks.reduce((sum, b) => sum + b.tokens, 0);
    const wouldExceed = currentTokens + block.tokens > MAX_TOKENS;

    if (currentBlocks.length > 0 && wouldExceed) {
      // Finalize current chunk
      chunks.push(
        await finalizeChunk(
          currentBlocks,
          overlapBlocks,
          headingStack,
          work,
          title,
        ),
      );

      // Prepare overlap for next chunk
      overlapBlocks = calculateOverlap(currentBlocks);
      currentBlocks = [];
    }

    // Add block to current chunk
    currentBlocks.push(block);
  }

  // Finalize remaining blocks
  if (currentBlocks.length > 0) {
    chunks.push(
      await finalizeChunk(
        currentBlocks,
        overlapBlocks,
        headingStack,
        work,
        title,
      ),
    );
  }

  return chunks;
}

/**
 * Updates the heading stack to maintain proper nesting.
 * Pops any headings at the same or deeper level, then pushes the new heading.
 */
function updateHeadingStack(
  headings: Stack.Stack<HeadingDatum>,
  heading: Heading,
): Stack.Stack<HeadingDatum> {
  // Remove headings at same or deeper level
  while (
    Stack.peek(headings) &&
    Stack.peek(headings)!.level >= heading.headingLevel
  ) {
    const result = Stack.pop(headings);
    headings = result.stack;
  }

  return Stack.push(headings, {
    text: heading.text,
    level: heading.headingLevel,
  });
}

/**
 * Calculates overlap blocks from the end of the current chunk.
 */
function calculateOverlap(blocks: readonly SemanticBlock[]): SemanticBlock[] {
  const overlap: SemanticBlock[] = [];
  let tokens = 0;

  // Work backwards from the end
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;

    // Add blocks until we hit the overlap limit
    if (tokens + block.tokens <= Constant.OVERLAP_TOKENS) {
      overlap.unshift(block);
      tokens += block.tokens;
    } else {
      break;
    }
  }

  return overlap;
}

/**
 * Creates the final chunk with heading context and overlap.
 */
async function finalizeChunk(
  blocks: SemanticBlock[],
  overlapBlocks: SemanticBlock[],
  headings: Stack.Stack<HeadingDatum>,
  work: Work,
  title: string,
): Promise<FinalizedChunk> {
  const headingPath = headings.items.map((h) => h.text);

  // Build the text that will be embedded
  const parts: string[] = [];

  // Heading breadcrumb
  if (headingPath.length > 0) {
    parts.push(`# ${headingPath.join(" > ")}`);
  }

  // Overlap from previous chunk
  if (overlapBlocks.length > 0) {
    parts.push(overlapBlocks.map((b) => b.text).join("\n\n"));
  }

  // Main content
  parts.push(blocks.map((b) => b.text).join("\n\n"));

  const textWithContext = parts.join("\n\n");
  const totalTokens = await countTokens(textWithContext);

  // Displayable markdown
  //
  // TODO: this works okay, but some things that shouldn't have newlines do,
  // like tight list elements and such. I think I need to address it at the
  // block level maybe? Though, it would probably require a bit of a rewrite to
  // keep certain elements together and looking nice.
  const markdownParts: string[] = [];
  if (overlapBlocks.length > 0) {
    markdownParts.push(overlapBlocks.map((b) => b.markdown).join("\n"));
  }
  markdownParts.push(blocks.map((b) => b.markdown).join("\n"));
  const markdown = markdownParts.join("\n");

  return {
    headingPath,
    totalTokens,
    rawText: textWithContext,
    markdownText: markdown,
    work: work,
    title,
    id: crypto.randomUUID(),
  };
}
