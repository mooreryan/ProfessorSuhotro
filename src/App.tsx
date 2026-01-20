import * as Transformers from "@huggingface/transformers";
import type { HighlighterCore } from "@shikijs/types";
import { Suspense, use, useState } from "react";
import * as ShikiCore from "react-shiki/core";
import dbUrl from "../db/db.json?url";
import * as ChunkDB from "../scripts/lib/chunk-database";
import * as Embeddings from "../shared/embeddings";
import * as Result from "../shared/result";
import "./App.css";

let highlighterCache: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterCache) return highlighterCache;

  const hl = ShikiCore.createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ],
    langs: [import("@shikijs/langs/markdown")],
    engine: ShikiCore.createOnigurumaEngine(import("shiki/wasm")),
  });
  highlighterCache = hl;
  return highlighterCache;
}

let dbResultCache: Promise<
  Result.Result<ChunkDB.ChunkDatabase, string>
> | null = null;

function fetchDb(
  url: string,
): Promise<Result.Result<ChunkDB.ChunkDatabase, string>> {
  if (dbResultCache) return dbResultCache;

  const doFetchDb = async () => {
    // Wrap it in a try so that we can clear the cache on unexpected errors.
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return Result.error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return ChunkDB.deserializeChunkDatabase(json);
    } catch (error) {
      return Result.error(`Failed to fetch database: ${error}`);
    }
  };

  const result = doFetchDb().catch((error) => {
    // Clear the cache if there is some unhandled error.
    dbResultCache = null;
    throw error;
  });
  dbResultCache = result;
  return dbResultCache;
}

function App() {
  const [hasConsented, setHasConsented] = useState(false);
  if (!hasConsented) {
    return <Consent onConsent={() => setHasConsented(true)} />;
  }

  const dbObjectPromise = fetchDb(dbUrl);
  const dbResult = use(dbObjectPromise);

  // Put it outside of here so we can avoid the suspense/download if the chunkdb
  // won't serialize.
  if (Result.isOk(dbResult)) {
    return (
      <Suspense fallback={<Loading />}>
        <ProfessorContent db={dbResult.value} />
      </Suspense>
    );
  } else {
    return (
      <div>
        <h1 className="text-4xl font-bold">Professor Suhotro</h1>
        <p>Error loading chunk database: {dbResult.error}</p>
      </div>
    );
  }
}

function Consent({ onConsent }: { onConsent: () => void }) {
  return (
    <div>
      <IntroContent />
      <h2 className="font-bold">Before we begin</h2>
      <p className="mt-2">
        To get started, we need to download a few search models (roughly 100
        MB). If you are on a mobile device or have a slow connection, this could
        take a few minutes. We’ll cache these files so you don't have to
        download them again next time.
      </p>
      <p className="mt-2">
        Because the search runs entirely in your browser, your questions stay
        private and never leave your computer.
      </p>
      <p className="mt-2">Sound good?</p>{" "}
      <button className="btn btn-primary btn-block mt-2" onClick={onConsent}>
        Start App!
      </button>
    </div>
  );
}

type DataSources = {
  "Applied Python Programming": boolean;
  "The Python Tutorial": boolean;
};

function ProfessorContent({ db }: { db: ChunkDB.ChunkDatabase }) {
  const [searchResult, setSearchResult] = useState<
    Result.Result<ChunkDB.ChunkWithScore[], string> | undefined
  >(undefined);
  const [dataSources, setDataSources] = useState<DataSources>({
    "Applied Python Programming": true,
    "The Python Tutorial": true,
  });

  const { pipelinePromise } = Embeddings.usePipeline();

  // Use `use` to unwrap the pipeline promise for the Suspense component
  const pipeline = use(pipelinePromise);

  const highlighterPromise = getHighlighter();
  const highlighter = use(highlighterPromise);

  // const query = "Why is Python a good language to learn for bioinformatics?";

  let searchResultDisplay;
  if (searchResult === undefined) {
    searchResultDisplay = <></>;
  } else if (Result.isOk(searchResult)) {
    searchResultDisplay = [];
    const length = Math.min(searchResult.value.length, 25);
    for (let i = 0; i < length; i++) {
      const chunkWithScore = searchResult.value[i];
      if (dataSources[chunkWithScore.chunk.work]) {
        const jsx = (
          <ChunkWithScoreView
            chunkWithScore={chunkWithScore}
            key={chunkWithScore.chunk.id}
            highlighter={highlighter}
          />
        );
        searchResultDisplay.push(jsx);
      }
    }
  } else {
    searchResultDisplay = <p>Search result error: {searchResult.error}</p>;
  }

  return (
    <div className="">
      <IntroContent />

      <Instructions />

      <SearchForm
        db={db}
        pipeline={pipeline}
        setSearchResult={setSearchResult}
        dataSources={dataSources}
        setDataSources={setDataSources}
      />
      {searchResultDisplay}
    </div>
  );
}

/*

<div className="flex flex-row items-center justify-between mb-1">
  <h1 className="text-2xl font-bold mb-2">Professor Suhotro</h1>
  <img src="/little-suhotro.png" alt="Professor Suhotro" />
</div>

*/

function IntroContent() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center mb-1">
        <a href="https://bioinformatics.udel.edu/2024/01/20/phd-student-suhotro-gorai-awarded-research-grant/">
          <img
            src="/little-suhotro.png"
            alt="Professor Suhotro"
            height={70}
            width={70}
          />
        </a>
        <h1 className="text-4xl font-bold mb-2 text-primary">
          Professor Suhotro
        </h1>
      </div>
      <p className="mb-2">
        Hi! I'm Professor Suhotro, and I'm here to help you find answers to your
        Python questions!
      </p>
      <p className="mb-2 text-xs text-zinc-500">
        I get my data from the book{" "}
        <a className="link" href="https://appliedpythonprogramming.com/">
          Applied Python Programming for Life Scientists
        </a>{" "}
        and from{" "}
        <a
          className="link"
          href="https://docs.python.org/3/tutorial/index.html"
        >
          The Python Tutorial
        </a>
        .
      </p>
    </div>
  );
}

function Instructions() {
  return (
    <div id="instructions" className="mb-2 text-sm">
      <p>
        Ask a question or search for a topic. Try asking questions like,{" "}
        <i>"How do I parse FASTA files?"</i>,{" "}
        <i>"Should I use a tuple or a list?"</i>, or search for topics like
        loops, pandas, or data visualization.
      </p>
    </div>
  );
}

function SearchForm({
  db,
  pipeline,
  setSearchResult,
  dataSources,
  setDataSources,
}: {
  db: ChunkDB.ChunkDatabase;
  pipeline: Transformers.FeatureExtractionPipeline;
  setSearchResult: React.Dispatch<
    React.SetStateAction<
      Result.Result<ChunkDB.ChunkWithScore[], string> | undefined
    >
  >;
  dataSources: DataSources;
  setDataSources: React.Dispatch<React.SetStateAction<DataSources>>;
}) {
  return (
    <div className="">
      <div className="">
        <form
          className=""
          onSubmit={handleSearchFormSubmit(db, pipeline, setSearchResult)}
        >
          <fieldset className="flex flex-col mt-1">
            <legend className="label">Data Sources</legend>

            <span className="text-xs">
              <p className="mt-0.5 mb-1.5 text-[0.6rem]">
                Select all data sources you want to search!
              </p>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="check-applied-python-programming"
                  name="check-work"
                  value="applied-python-programming"
                  className="mr-1.5 w-3 h-3"
                  checked={dataSources["Applied Python Programming"]}
                  onChange={(e) =>
                    setDataSources({
                      ...dataSources,
                      "Applied Python Programming": e.target.checked,
                    })
                  }
                ></input>
                <label htmlFor="check-applied-python-programming">
                  Applied Python Programming
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="check-the-python-tutorial"
                  name="check-work"
                  value="the-python-tutorial"
                  className="mr-1.5 w-3 h-3"
                  checked={dataSources["The Python Tutorial"]}
                  onChange={(e) =>
                    setDataSources({
                      ...dataSources,
                      "The Python Tutorial": e.target.checked,
                    })
                  }
                ></input>
                <label htmlFor="check-the-python-tutorial">
                  The Python Tutorial
                </label>
              </div>
            </span>
          </fieldset>

          <label
            htmlFor="searchQuery"
            className="label mb-1 mt-1"
            hidden={false}
          >
            Enter your question:
          </label>
          <textarea
            className="textarea w-full my-1"
            id="searchQuery"
            name="searchQuery"
          />

          <div className="">
            <button className="btn btn-block btn-sm btn-primary mt-2">
              Submit
            </button>
            <button
              className="btn btn-block btn-sm mt-1"
              onClick={(e) => {
                e.preventDefault();
                setSearchResult(undefined);
                const form = e.currentTarget.form;
                if (form) {
                  form.reset();
                }
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function handleSearchFormSubmit(
  db: ChunkDB.ChunkDatabase,
  pipeline: Transformers.FeatureExtractionPipeline,
  setSearchResult: React.Dispatch<
    React.SetStateAction<
      Result.Result<ChunkDB.ChunkWithScore[], string> | undefined
    >
  >,
) {
  return async function (event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const formJson = Object.fromEntries(formData.entries());
    if ("searchQuery" in formJson) {
      const searchQuery = formJson.searchQuery.toString();
      // setSearchQuery(() => searchQuery.toString());
      const newSearchResult = await ChunkDB.search(db, pipeline, searchQuery);
      setSearchResult(newSearchResult);
    }
  };
}

function ChunkWithScoreView({
  chunkWithScore,
  highlighter,
}: {
  chunkWithScore: ChunkDB.ChunkWithScore;
  highlighter: HighlighterCore;
}) {
  const work = chunkWithScore.chunk.work;
  const headingPath = chunkWithScore.chunk.headingPath.join(" › ");

  // TODO: to get a link to the section working we need:
  // 1. the chapter's URL thing, which would be xyz in this: blah.com/xyz/#something else
  // 2. the slugified section name, which is the final entry in the headingPath. Ideally you have the same slug logic as is used by the quarto site.
  // 3. Some sections have specific names like {#sec-apple-pie}, in this case the url uses those special names

  return (
    <div className="card bg-base-200 my-4 card-border">
      <div className="card-body">
        <h2 className="card-title">{headingPath}</h2>
        <p>From: {work}</p>
        <p>Similarity score: {chunkWithScore.score.toFixed(2)}</p>
        <MarkdownCode
          code={chunkWithScore.chunk.markdownText}
          highlighter={highlighter}
        />
      </div>
    </div>
  );
}

function MarkdownCode({
  code,
  highlighter,
}: {
  code: string;
  highlighter: HighlighterCore;
}) {
  //m-5 whitespace-pre-wrap wrap-break-word
  return (
    <div className="shiki-wrapper my-1">
      <ShikiCore.ShikiHighlighter
        highlighter={highlighter}
        language="markdown"
        theme={{
          light: "github-light",
          dark: "github-dark",
        }}
        showLanguage={false}
        style={
          {
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          } as React.CSSProperties
        }
      >
        {code}
      </ShikiCore.ShikiHighlighter>
    </div>
  );
}

function Loading() {
  const { progress } = Embeddings.usePipeline();

  // Check if all files are at 100%
  //
  // After the files are done, a few more things have to happen to initialize
  // the runtime (like downloading WASM bundles).
  const allFilesDownloaded = Array.from(progress.files.values()).every(
    (fileInfo) => fileInfo.percent === 100,
  );

  return (
    <>
      <h2>Loading pipeline...</h2>

      {Array.from(progress.files.entries()).map(([fileName, fileInfo]) => {
        return (
          <div key={fileName} style={{ margin: "20px 0" }}>
            <div>
              <strong>{fileName}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <progress
                value={fileInfo.percent}
                max={100}
                style={{ flex: 1 }}
              />
              <span style={{ width: "50px", textAlign: "right" }}>
                {fileInfo.percent.toFixed(1)}%
              </span>
            </div>

            <div style={{ fontSize: "12px", color: "#666" }}>
              {fileInfo.loadedMB} MB / {fileInfo.totalMB} MB
            </div>
          </div>
        );
      })}

      {allFilesDownloaded && (
        <div
          style={{
            marginTop: "20px",
            fontStyle: "italic",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            className="spinner"
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid #f3f3f3",
              borderTop: "2px solid #3498db",
              borderRadius: "50%",
            }}
          ></div>
          Initializing runtime... (should be quicker than the file downloads)
        </div>
      )}
    </>
  );
}

export default App;
