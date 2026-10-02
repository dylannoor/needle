// Keeps rekordbox.xml in sync with every verified download.
import { addTrack, buildXml } from "./xml.js";

export const DEFAULTS = {
  xmlPath: "~/Music/Needle/rekordbox.xml",
  playlistName: "Needle",
  perRelease: false,
};

// Tracks added per job, announced once when the job completes.
const addedByJob = new Map();
let queue = Promise.resolve();

async function settings() {
  return { ...DEFAULTS, ...((await needle.settings.get()) || {}) };
}

async function write(library, s) {
  await needle.fs.writeText(s.xmlPath, buildXml(library, s));
}

async function onCompleted(job) {
  const added = addedByJob.get(job.jobId) || 0;
  addedByJob.delete(job.jobId);
  if (!added) return;
  const s = await settings();
  const tracks = added === 1 ? "1 track" : `${added} tracks`;
  const where = s.perRelease ? "Rekordbox" : `the ${s.playlistName || "Needle"} playlist`;
  await needle.notify(`Added ${tracks} to ${where}`, s.xmlPath);
}

async function onVerified(file) {
  const s = await settings();
  const before = (await needle.storage.get("library")) || [];
  const { library, added } = addTrack(before, file);
  if (added) await needle.storage.set("library", library);
  await write(library, s);
  if (added) addedByJob.set(file.jobId, (addedByJob.get(file.jobId) || 0) + 1);
}

// One event at a time, so two files never read the same library and both
// write, and a job's completion is handled after its last file.
function serial(handler) {
  return (payload) => {
    const run = queue.then(() => handler(payload));
    queue = run.catch(() => {});
    return run;
  };
}

needle.on("download.verified", serial(onVerified));
needle.on("download.completed", serial(onCompleted));

// Rewrite on start so changed settings apply without waiting for a download.
queue = (async () => {
  const library = (await needle.storage.get("library")) || [];
  if (library.length) await write(library, await settings());
})().catch((e) => {
  // Keep the queue alive, but let Needle show the error.
  setTimeout(() => {
    throw e;
  });
});
