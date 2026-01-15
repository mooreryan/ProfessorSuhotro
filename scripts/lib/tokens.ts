import { Tiktoken } from "js-tiktoken";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import * as Constant from "../../shared/constants";
import * as Transformers from "@huggingface/transformers";

const autoTokenizer = await Transformers.AutoTokenizer.from_pretrained(
  Constant.MODEL_NAME,
);

/**
 * Count tokens in the given text.
 *
 * Tries to use the same model we will use for embedding. If that fails, falls
 * back to using tiktoken as an approximate count.
 *
 * Note that tiktoken often reports lower token counts than the
 * `sentence-transformers/all-MiniLM-L6-v2` model does.
 *
 */
export async function countTokens(text: string): Promise<number> {
  const result = await countTokensUsingModel(text);

  if (result) return result;

  return countTokensUsingTiktoken(text);
}

async function countTokensUsingModel(
  text: string,
): Promise<number | undefined> {
  const result = await autoTokenizer(text);

  if (!("input_ids" in result)) return;
  if (!("ort_tensor" in result.input_ids)) return;
  if (!("dims" in result.input_ids.ort_tensor)) return;

  const inputIds = result.input_ids as Transformers.Tensor;

  if (inputIds.dims.length !== 2) return;
  if (inputIds.dims[0] !== 1) return;

  return inputIds.dims[1];
}

const encoding = new Tiktoken(o200k_base);
function countTokensUsingTiktoken(text: string): number {
  return encoding.encode(text).length;
}
