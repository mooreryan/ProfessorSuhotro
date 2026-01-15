import { expect, describe, test } from "vitest";
import * as Embedding from "../shared/embeddings";
import * as Transformers from "@huggingface/transformers";
import * as Result from "../shared/result";

function expectTensorEqual(a: Transformers.Tensor, b: Transformers.Tensor) {
  expect(a.type).toEqual(b.type);
  expect(a.data.length).toEqual(b.data.length);
  expect(a.dims).toEqual(b.dims);
  expect(a.data).toEqual(b.data);
}

describe("serializing tensors", () => {
  test("roundtrips of serializing and deserializing work", () => {
    const tensor = new Transformers.Tensor(
      "float32",
      [1, 2, 3, 4, 5, 6],
      [2, 3],
    );

    const serialized = Embedding.serializeTensor(tensor);

    if (Result.isError(serialized)) {
      throw new Error(`Failed to serialize tensor: ${serialized.error}`);
    }

    const deserialized = Embedding.deserializeTensor(serialized.value);

    if (Result.isError(deserialized)) {
      throw new Error(`Failed to deserialize tensor: ${deserialized.error}`);
    }

    expectTensorEqual(deserialized.value, tensor);
  });
});
