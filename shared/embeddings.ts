/**
 * @module embeddings
 * Functions to help with embedding texts and running similarity searches on
 * embedded texts.
 *
 * Uses the feature extraction pipeline from transformers.js, nad wraps some of
 * the tensor math that comes from that package and the onnx runtime.
 */

import { useSyncExternalStore } from "react";
import * as Transformers from "@huggingface/transformers";
import * as Progress from "./progress";
import * as Constant from "./constants";
import * as Result from "./result";

let pipeline: Promise<Transformers.FeatureExtractionPipeline> | null = null;

/** You should pass false for progress when embedding the book locally. */
export function getPipeline(
  progress: boolean,
): Promise<Transformers.FeatureExtractionPipeline> {
  if (pipeline) return pipeline;

  const progress_callback = progress ? Progress.handleProgress : undefined;

  // TS can't infer this type, so set a variable manually here.
  const tmp = Transformers.pipeline("feature-extraction", Constant.MODEL_NAME, {
    progress_callback,
    dtype: "fp32",
  });

  pipeline = tmp;
  return pipeline;
}

export function usePipeline() {
  // Subscribe to progress changes so React will re-render when the progress
  // updates
  const progress = useSyncExternalStore(
    Progress.subscribeCallback,
    // Get the current state
    Progress.getSnapshot,
    // Server side snapshot ...we aren't using that here, but still need it
    Progress.getSnapshot,
  );

  return { pipelinePromise: getPipeline(true), progress };
}

/**
 * Extract features from the given texts.
 */
export async function extractFeatures(
  featureExtractionPipeline: Transformers.FeatureExtractionPipeline,
  texts: readonly string[],
): Promise<Transformers.Tensor> {
  // The embedding pipeline probably doesn't mutate this, but it's type is not
  // readonly, so we copy it to be safe.
  const textsCopy = [...texts];

  return await featureExtractionPipeline(textsCopy, {
    // Average token embeddings
    pooling: "mean",
    // Unit-length vectors: this allows us to use matmul for cos sim
    normalize: true,
  });
}

export async function extractFeaturesInBatches(
  featureExtractionPipeline: Transformers.FeatureExtractionPipeline,
  texts: readonly string[],
  batchSize: number,
): Promise<Transformers.Tensor> {
  const allEmbeddings: Transformers.Tensor[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    console.log(`Processing ${i} to ${i + batchSize}`);
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await featureExtractionPipeline(batch, {
      pooling: "mean",
      normalize: true,
    });
    allEmbeddings.push(embeddings);
  }

  return Transformers.cat(allEmbeddings, 0);
}

/**
 * Transpose the dimensions of a 2D tensor. Does not modify original, but
 * returns a transposed copy. I have no idea if that is a deep or shallow copy
 * though! (I believe it is a deep copy, check the permute function in tensor.js
 * for why I think so.)
 */
function transpose(tensor: Transformers.Tensor) {
  return tensor.transpose(1, 0);
}

/**
 * Do not mix up the order of the inputs! The rows of the returned Tensor will
 * be the queries, and the columns will be the targets. This lets you iterate in
 * row-major order over the queries!
 */
export async function similarity(
  db: Transformers.Tensor,
  query: Transformers.Tensor,
): Promise<Transformers.Tensor | undefined> {
  // Transpose the query rather than the DB, since the DB is much larger.
  const queryTranspose = transpose(query);

  if (!canMultiply(db.dims, queryTranspose.dims)) return undefined;

  const result = await Transformers.matmul(db, queryTranspose);

  // Transpose it back at the end so we can iterate in row-major order to go
  // query by query rather than first by DB entry
  return transpose(result);
}

function canMultiply(aDims: number[], bDims: number[]): boolean {
  return aDims.length === 2 && bDims.length === 2 && aDims[1] === bDims[0];
}

export function getValuesByIndices(
  tensor: Transformers.Tensor,
  indices: readonly number[],
) {
  // Pretty sure this can crash...
  return indices.map((index) => tensor._getitem(index));
}

/**
 * Finds the best results from similarity scores using the knee point method.
 *
 * @param scores - Unsorted array of similarity scores (indices map to DB entries)
 * @returns Array of DB indices for results above the knee point, sorted by score descending
 */
export function findBestResults(scores: Float32Array | number[]): number[] {
  // Create array of {index, score} pairs
  const indexed = Array.from(scores, (score, index) => ({ index, score }));

  // Sort by score descending
  indexed.sort((a, b) => b.score - a.score);

  // Extract sorted scores for knee point calculation
  const sortedScores = indexed.map((item) => item.score);

  // Find knee point
  const cutoff = findKneePoint(sortedScores);

  // Return the indices of top results (already sorted by score)
  return indexed.slice(0, cutoff).map((item) => item.index);
}

/**
 * Finds the "elbow point" in a sorted array of scores.
 */
function findKneePoint(scores: number[]): number {
  if (scores.length <= 2) {
    return scores.length;
  }

  const n = scores.length;
  const firstPoint = { x: 0, y: scores[0]! };
  const lastPoint = { x: n - 1, y: scores[n - 1]! };

  let maxDistance = 0;
  let kneeIndex = n;

  for (let i = 1; i < n - 1; i++) {
    const point = { x: i, y: scores[i]! };
    const distance = perpendicularDistance(point, firstPoint, lastPoint);

    if (distance > maxDistance) {
      maxDistance = distance;
      kneeIndex = i;
    }
  }

  return kneeIndex;
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
): number {
  // This is a factored version of the wikipedia formula
  const numerator = Math.abs(
    (lineEnd.x - lineStart.x) * (lineStart.y - point.y) -
      (lineStart.x - point.x) * (lineEnd.y - lineStart.y),
  );

  const denominator = Math.sqrt(
    Math.pow(lineEnd.x - lineStart.x, 2) + Math.pow(lineEnd.y - lineStart.y, 2),
  );

  return numerator / denominator;
}

import * as Zod from "zod";

export const TensorDataSchema = Zod.object({
  dataType: Zod.literal("float32"),
  data: Zod.array(Zod.number()),
  dimensions: Zod.tuple([Zod.number().min(0), Zod.number().min(0)]),
})
  .readonly()
  .refine((x) => x.data.length === x.dimensions[0] * x.dimensions[1], {
    message: "data.length !== dimensions[0] * dimensions[1]",
  });

export type TensorData = Zod.infer<typeof TensorDataSchema>;

export function createTensorData(
  tensor: Transformers.Tensor,
): Result.Result<TensorData, string> {
  if (tensor.type !== "float32") {
    return Result.error("Tensor must be of type float32");
  }

  // TODO: again, I'm not sure if the tensor.data field will work correctly if
  // it is on webgpu...

  if (!(tensor.data instanceof Float32Array)) {
    return Result.error("Tensor data must be a Float32Array");
  }

  if (tensor.dims.length !== 2) {
    return Result.error("Tensor dimensions must be 2D");
  }

  const tensorData: TensorData = {
    dataType: tensor.type,
    data: Array.from(tensor.data),
    dimensions: [tensor.dims[0], tensor.dims[1]],
  };

  return Result.ok(tensorData);
}

export function serializeTensor(
  tensor: Transformers.Tensor,
): Result.Result<string, string> {
  const tensorDataResult = createTensorData(tensor);

  if (!tensorDataResult.ok) {
    return Result.error(
      `Failed to create TensorData ${tensorDataResult.error}`,
    );
  }

  const jsonString = JSON.stringify(tensorDataResult.value, undefined, 2);

  return Result.ok(jsonString);
}

export function deserializeTensor(
  jsonString: string,
): Result.Result<Transformers.Tensor, string> {
  const json = JSON.parse(jsonString);
  const parseResult = TensorDataSchema.safeParse(json);

  if (!parseResult.success) {
    return Result.error(parseResult.error.message);
  }

  const tensorData = parseResult.data;

  if (!checkTensorDataDimensions(tensorData)) {
    return Result.error("Tensor data dimensions do not match");
  }

  return tensorFromTensorData(tensorData);
}

function checkTensorDataDimensions(tensorData: TensorData): boolean {
  return (
    tensorData.data.length ===
    Math.round(tensorData.dimensions[0] * tensorData.dimensions[1])
  );
}

export function tensorFromTensorData(
  tensorData: TensorData,
): Result.Result<Transformers.Tensor, string> {
  try {
    // I'm not even sure this can fail...but let's be sure.
    const floatArray = new Transformers.Tensor(
      tensorData.dataType,
      tensorData.data,
      tensorData.dimensions,
    );
    return Result.ok(floatArray);
  } catch (error) {
    return Result.error(`Failed to create Float32Array: ${error}`);
  }
}

export function tensorEqualEnough(
  a: Transformers.Tensor,
  b: Transformers.Tensor,
): boolean {
  // TODO: will the data field work on webgpu?
  return (
    a.type === b.type &&
    a.data.length === b.data.length &&
    a.dims === b.dims &&
    arrayValuesEqual(a.data, b.data)
  );
}

function arrayValuesEqual(
  a: Transformers.DataArray,
  b: Transformers.DataArray,
): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}
