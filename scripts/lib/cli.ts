import { parseArgs } from "node:util";
import fs from "node:fs";
import * as Result from "../../shared/result";

type Args = {
  readonly inputPaths: readonly string[];
  readonly outputPath: string;
};

/**
 * Parse the input files from the CLI args.
 *
 * Exits the program if the CLI args are no good.
 */
export function parseCliArgs(): Result.Result<Args, string> {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length < 2) {
    return Result.error("Error: at least two path arguments are required");
  }

  const [outputPath, ...inputPaths] = positionals;

  // Quick check to ensure that outputPath does not currently point to a file
  // that exists. We don't care about any potential race conditions here.
  if (fs.existsSync(outputPath)) {
    return Result.error(`Output file ${outputPath} already exists`);
  }

  return Result.ok({ outputPath, inputPaths });
}

export const USAGE = "USAGE -- args: <output.json> <input.md> [... inputs ...]";
