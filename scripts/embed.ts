#!/usr/bin/env bun

import * as Fs from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import * as Embedding from "../shared/embeddings";
import * as Result from "../shared/result";
import * as ChunkDb from "./lib/chunk-database";
import type { FinalizedChunk } from "./lib/finalized-chunk";
import * as Config from "./lib/config";
import { processMarkdownFile } from "./lib/process-markdown-file";
import * as Tokens from "./lib/tokens";
import type { Work } from "./lib/work";

/**
 * We can use the exact number here since our splitting procedure is much
 * simpler than for the markdown files.
 */
const TEXT_MAX_TOKENS = 256;
const TEXT_OVERLAP_TOKENS = 85;

export const USAGE = "USAGE -- args: <config.json>";

async function main(): Promise<void> {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
  });
  const argsResult = Config.parseCliArgs(positionals);

  if (Result.isError(argsResult)) {
    console.error(argsResult.error);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const args = argsResult.value;

  const showPipelineProgress = false;
  const featureExtractionPipeline =
    await Embedding.getPipeline(showPipelineProgress);

  const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkFrontmatter);

  const allChunks = [];

  for (const input of args.input) {
    console.log(`Processing: ${input.file}`);

    let chunks;
    if (input.type === "markdown") {
      chunks = await processMarkdownFile(markdownProcessor, input);
    } else {
      chunks = await processDocument(input);
    }
    allChunks.push(...chunks);
  }

  console.log(`Total chunks: ${allChunks.length}`);

  console.log("Creating DB");
  const dbResult = await ChunkDb.create(featureExtractionPipeline, allChunks);

  if (Result.isError(dbResult)) {
    const message = `There was an error while creating DB: ${dbResult.error}\n`;
    Fs.writeFileSync(process.stderr.fd, message);
    process.exitCode = 1;
    return;
  }

  const serializeResult = ChunkDb.serializeChunkDatabase(dbResult.value);

  if (Result.isError(serializeResult)) {
    const message = `There was an error while serializing DB: ${serializeResult.error}\n`;
    Fs.writeFileSync(process.stderr.fd, message);
    process.exitCode = 1;
    return;
  }

  Fs.writeFileSync(args.output, serializeResult.value);
}

// Basic document processing

async function processDocument(
  input: Config.Input,
): Promise<Readonly<FinalizedChunk>[]> {
  const rawText = Fs.readFileSync(input.file, "utf8");

  const texts = splitText(rawText);

  const chunks: FinalizedChunk[] = [];
  let current = emptyBasicChunk();
  for (const text of texts) {
    const newTokens = await Tokens.countTokens(text);

    // Adding this chunk would put us over the limit
    if (current.totalTokens + newTokens >= TEXT_MAX_TOKENS) {
      const finalized = finalizeBasicChunk(current, input.work, input.title);
      chunks.push(finalized);

      // Start the next chunk with some overlap from the end of the current
      // chunk.
      current = getOverlapChunks(current, TEXT_OVERLAP_TOKENS);
    }

    // We can safely add this chunk.
    current.chunks.push(text);
    current.tokenCounts.push(newTokens);
    current.totalTokens += newTokens;
  }

  return chunks;
}

type BasicChunk = {
  chunks: string[];
  /**
   * Track tokens per chunk so that it's easier to select overlapping chunks
   * that fit the size we are looking for.
   */
  tokenCounts: number[];
  totalTokens: number;
};

function emptyBasicChunk(): BasicChunk {
  return { chunks: [], tokenCounts: [], totalTokens: 0 };
}

/**
 * Extract the last N segments from a chunk to use as overlap for the next
 * chunk.
 *
 * Works backwards from the end until we get about `targetOverlap` tokens.
 */
function getOverlapChunks(
  basicChunk: BasicChunk,
  targetOverlap: number,
): BasicChunk {
  let accumulatedTokens = 0;
  const overlapChunks: string[] = [];
  const overlapTokenCounts: number[] = [];

  // Work backwards from the end
  for (let i = basicChunk.chunks.length - 1; i >= 0; i--) {
    const newTokens = basicChunk.tokenCounts[i];

    // Stop if we've gotten enough, but make sure to take at least one segment.
    if (
      accumulatedTokens > 0 &&
      accumulatedTokens + newTokens > targetOverlap
    ) {
      break;
    }

    overlapChunks.unshift(basicChunk.chunks[i]);
    overlapTokenCounts.unshift(newTokens);
    accumulatedTokens += newTokens;
  }

  return {
    chunks: overlapChunks,
    tokenCounts: overlapTokenCounts,
    totalTokens: accumulatedTokens,
  };
}

/**
 * Raw text and markdown text will be the same for these.
 *
 * We use `""` as the joiner here, so don't forget to use the splitter that
 * keeps the newlines tacked onto the end of the raw text.
 */
function finalizeBasicChunk(
  basicChunk: BasicChunk,
  work: Work,
  title: string,
): FinalizedChunk {
  const text = basicChunk.chunks.join("");

  return {
    headingPath: ["The Python Tutorial"],
    totalTokens: basicChunk.totalTokens,
    rawText: text,
    markdownText: text,
    work,
    title,
    id: crypto.randomUUID(),
  };
}

function splitText(text: string): string[] {
  return splitWithSeparators(text, /(\n\n+)/);
}

/** DON'T FORGET THE CAPTURING GROUP IN THE REGEX. */
function splitWithSeparators(text: string, separator: RegExp): string[] {
  const parts = text.split(separator);
  const result = [];

  for (let i = 0; i < parts.length; i += 2) {
    const thisText = parts[i];
    const sep = parts[i + 1] || "";
    if (thisText) {
      result.push(thisText + sep);
    }
  }

  return result;
}

await main();
