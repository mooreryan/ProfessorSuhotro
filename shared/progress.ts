import { type ProgressInfo } from "@huggingface/transformers";

/** Track a single file's download progress. */
interface FileProgress {
  percent: number;
  loadedMB: string;
  totalMB: string;
}

/** Hold the overall progress of all files */
interface ProgressState {
  files: Map<string, FileProgress>;
}

// This will be updated by the callbacks
let progressState: ProgressState = {
  files: new Map(),
};

// The functions we will call when progress changes
let progressListeners: Array<() => void> = [];

/** Call this to notify the listeners when the progress changes. */
function notifyProgressChanged() {
  // Create new snapshot when data changes
  progressState = { files: new Map(progressState.files) };

  for (const listener of progressListeners) {
    listener();
  }
}

function round(x: number, step: number) {
  return Math.round(x / step) * step;
}

export function handleProgress(info: ProgressInfo) {
  // We only want to show the user download progress updates, since those are
  // what is going to be taking up a noticeable amount of time.
  if (info.status !== "progress") {
    return;
  }

  const currentProgress = round(info.progress, 0.1);
  const lastProgress = progressState.files.get(info.file)?.percent ?? -1;

  if (currentProgress === lastProgress) {
    return;
  }

  // Calculate the MBs for nice display
  const loadedMB = (info.loaded / (1024 * 1024)).toFixed(2);
  const totalMB = (info.total / (1024 * 1024)).toFixed(2);

  // Update the current file's progress in the state
  progressState.files.set(info.file, {
    percent: currentProgress,
    loadedMB,
    totalMB,
  });

  // Tell the listeners that we have some more progress
  notifyProgressChanged();
}

// Subscribe function adds the listener and returns the cleanup function
export function subscribeCallback(listener: () => void) {
  progressListeners = [...progressListeners, listener];
  // To cleanup, we will need to find this listener and remove it from the
  // list
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  };
}

export function getSnapshot() {
  // Return a new object with a new Map so React can detect changes
  return progressState;
}
