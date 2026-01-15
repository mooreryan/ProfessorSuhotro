import { type Root } from "mdast";
import fs from "node:fs";
import { type Processor } from "unified";
import { chunkWithContext } from "./chunk-with-context";
import * as Config from "./config";
import type { FinalizedChunk } from "./finalized-chunk";
import { parseSemanticBlocks } from "./parse-semantic-blocks";

export async function processMarkdownFile(
  markdownProcessor: Processor<
    Root,
    undefined,
    undefined,
    undefined,
    undefined
  >,
  input: Config.Input,
): Promise<readonly FinalizedChunk[]> {
  const text = fs.readFileSync(input.file, "utf8");
  const parseTree = markdownProcessor.parse(text);
  const tree = (await markdownProcessor.run(parseTree)) as Root;

  // Convert to semantic blocks
  const blocks = await parseSemanticBlocks(tree);

  // Chunk with heading context and overlap
  return chunkWithContext(blocks, input.work, input.title);
}
