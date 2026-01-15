import * as Zod from "zod";
import { WorkSchema } from "./work";

export const FinalizedChunkSchema = Zod.object({
  headingPath: Zod.array(Zod.string()).readonly(),
  totalTokens: Zod.number().min(0),
  rawText: Zod.string(),
  markdownText: Zod.string(),
  work: WorkSchema,
  title: Zod.string(),
  id: Zod.uuidv4(),
})
  .readonly()
  .refine((x) => x.rawText.length >= x.totalTokens, {
    error: "rawText.length should be >= totalTokens",
  });

export type FinalizedChunk = Zod.infer<typeof FinalizedChunkSchema>;
