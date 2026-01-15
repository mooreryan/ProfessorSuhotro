import * as Zod from "zod";
import * as Fs from "node:fs";
import * as Result from "../../shared/result";
import { WorkSchema } from "./work";

const InputSchema = Zod.object({
  type: Zod.enum(["markdown", "text"]),
  work: WorkSchema,
  title: Zod.string(),
  file: Zod.string(),
})
  .readonly()
  // The file should exist
  .refine((x) => Fs.existsSync(x.file));

export type Input = Zod.infer<typeof InputSchema>;

const ConfigSchema = Zod.object({
  output: Zod.string(),
  input: Zod.array(InputSchema),
})
  .readonly()
  // The output file should not exist!
  .refine((value) => !Fs.existsSync(value.output), {
    message: "expected output file to NOT exist",
    path: ["output"],
  });

type Config = Zod.infer<typeof ConfigSchema>;

/**
 * Parse the input files from the CLI args.
 *
 * Exits the program if the CLI args are no good.
 */
export function parseCliArgs(args: string[]): Result.Result<Config, string> {
  if (args.length !== 1) {
    return Result.error("Error: exactly one argument -- the config.json file");
  }

  const configPath = args[0];
  const configText = Fs.readFileSync(configPath, "utf8");
  const configJson = JSON.parse(configText);
  const configResult = ConfigSchema.safeParse(configJson);

  if (!configResult.success) {
    return Result.error(`Invalid config.json file: ${configResult.error}`);
  }

  return Result.ok(configResult.data);
}
