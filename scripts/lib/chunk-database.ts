import {
  FeatureExtractionPipeline,
  type Tensor,
} from "@huggingface/transformers";
import type { FinalizedChunk } from "./finalized-chunk";
import { FinalizedChunkSchema } from "./finalized-chunk";
import * as Embeddings from "../../shared/embeddings";
import * as Result from "../../shared/result";
import * as Constant from "../../shared/constants";
import * as Zod from "zod";

export interface ChunkDatabase {
  readonly chunks: readonly FinalizedChunk[];
  readonly embeddings: Tensor;
  readonly metadata: {
    embeddingModel: string;
    dimension: number;
    createdAt: string;
  };
}

interface SerializableChunkDatabase {
  readonly chunks: readonly FinalizedChunk[];
  readonly embeddings: Embeddings.TensorData;
  readonly metadata: {
    embeddingModel: string;
    dimension: number;
    createdAt: string;
  };
}

function chunkDatabaseFromSerializableChunkDatabase(
  serializableChunkDatabase: SerializableChunkDatabase,
): Result.Result<ChunkDatabase, string> {
  const tensorResult = Embeddings.tensorFromTensorData(
    serializableChunkDatabase.embeddings,
  );

  if (Result.isError(tensorResult)) {
    return Result.error(`Invalid embeddings: ${tensorResult.error}`);
  }

  const chunkDb = {
    chunks: serializableChunkDatabase.chunks,
    embeddings: tensorResult.value,
    metadata: serializableChunkDatabase.metadata,
  };

  return Result.ok(chunkDb);
}

// NOTE: you can have fields in this schema that aren't present in the interface
// it satisfies so watch out.
const SerializableChunkDatabaseSchema = Zod.object({
  chunks: Zod.array(FinalizedChunkSchema),
  embeddings: Embeddings.TensorDataSchema,
  metadata: Zod.object({
    embeddingModel: Zod.string(),
    dimension: Zod.number(),
    createdAt: Zod.string(),
  }),
}).readonly() satisfies Zod.ZodType<SerializableChunkDatabase>;

export function deserializeChunkDatabase(
  x: object,
): Result.Result<ChunkDatabase, string> {
  const result = SerializableChunkDatabaseSchema.safeParse(x);

  if (!result.success) {
    return Result.error(`Invalid chunk database: ${result.error}`);
  }

  return chunkDatabaseFromSerializableChunkDatabase(result.data);
}

export function serializeChunkDatabase(
  db: ChunkDatabase,
): Result.Result<string, string> {
  const tensorDataResult = Embeddings.createTensorData(db.embeddings);

  if (Result.isError(tensorDataResult)) {
    return Result.error(
      `Failed to serialize embeddings: ${tensorDataResult.error}`,
    );
  }

  const serializable: SerializableChunkDatabase = {
    chunks: db.chunks,
    embeddings: tensorDataResult.value,
    metadata: db.metadata,
  };

  const jsonString = JSON.stringify(serializable, undefined, 2);

  return Result.ok(jsonString);
}

async function embedChunks(
  pipeline: FeatureExtractionPipeline,
  chunks: readonly FinalizedChunk[],
): Promise<Tensor> {
  const texts = chunks.map((chunk) => chunk.rawText);
  const batch_size = 25;
  return await Embeddings.extractFeaturesInBatches(pipeline, texts, batch_size);
}

export async function create(
  featureExtractionPipeline: FeatureExtractionPipeline,
  chunks: readonly FinalizedChunk[],
): Promise<Result.Result<ChunkDatabase, string>> {
  const now = new Date().toISOString();

  const embeddedChunks = await embedChunks(featureExtractionPipeline, chunks);

  if (embeddedChunks.dims.length !== 2) {
    return Result.error("Invalid embeddings dimensions");
  }

  const [numFeatures, vectorLength] = embeddedChunks.dims;

  if (numFeatures !== chunks.length) {
    return Result.error("Mismatch between number of features and chunks");
  }

  if (!vectorLength) {
    return Result.error("Invalid vector length");
  }

  const db: ChunkDatabase = {
    chunks,
    embeddings: embeddedChunks,
    metadata: {
      embeddingModel: Constant.MODEL_NAME,
      dimension: vectorLength,
      createdAt: now,
    },
  };

  return Result.ok(db);
}

export interface ChunkWithScore {
  chunk: FinalizedChunk;
  score: number;
}

export async function search(
  db: ChunkDatabase,
  pipeline: FeatureExtractionPipeline,
  query: string,
): Promise<Result.Result<ChunkWithScore[], string>> {
  const embeddedQuery = await Embeddings.extractFeatures(pipeline, [query]);
  const similarityTensor = await Embeddings.similarity(
    db.embeddings,
    embeddedQuery,
  );
  if (!similarityTensor) return Result.error("Failed to compute similarity");

  const similarityData = similarityTensor._getitem(0).data;

  if (!(similarityData instanceof Float32Array)) {
    return Result.error("Invalid similarity data type");
  }

  const bestIndices = Embeddings.findBestResults(similarityData);

  const best = bestIndices.map((index) => {
    return {
      score: similarityData[index]!,
      chunk: db.chunks[index]!,
    };
  });

  return Result.ok(best);
}
