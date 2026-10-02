// Pure Rekordbox XML builder. No `needle` access here, so it can be tested.

export const PRODUCT_VERSION = "1.0.0";

const KINDS = {
  flac: "FLAC File",
  mp3: "MP3 File",
  wav: "WAV File",
  aiff: "AIFF File",
  alac: "M4A File",
  aac: "M4A File",
};

/** Attribute-safe text: escapes markup and drops characters XML 1.0 forbids. */
export function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `file://localhost/` URL with every path segment percent-encoded as UTF-8. */
export function fileUrl(path) {
  const segments = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  const encoded = segments.map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)));
  return `file://localhost/${encoded.join("/")}`;
}

export function kindOf(codec, path) {
  if (KINDS[codec]) return KINDS[codec];
  const ext = /\.([A-Za-z0-9]+)$/.exec(path ?? "")?.[1];
  return ext ? `${ext.toUpperCase()} File` : "Audio File";
}

/** Append a DownloadedFile unless its path is already in the library. */
export function addTrack(library, file) {
  if (!file || typeof file.localPath !== "string" || !file.localPath) return { library, added: false };
  if (library.some((t) => t.localPath === file.localPath)) return { library, added: false };
  return { library: [...library, file], added: true };
}

function bitrate(t) {
  if (t.bitrateKbps) return t.bitrateKbps;
  if (t.size && t.durationSecs) return Math.round((t.size * 8) / t.durationSecs / 1000);
  return null;
}

function attrs(pairs) {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(" ");
}

function trackXml(t, id) {
  return `<TRACK ${attrs([
    ["TrackID", id],
    ["Name", t.title ?? ""],
    ["Artist", t.artist ?? ""],
    ["Album", t.album ?? ""],
    ["Kind", kindOf(t.codec, t.localPath)],
    ["Size", t.size ?? null],
    ["TotalTime", t.durationSecs ?? null],
    ["SampleRate", t.sampleRate ?? null],
    ["BitRate", bitrate(t)],
    ["TrackNumber", t.trackNumber ?? null],
    ["Location", fileUrl(t.localPath)],
  ])}/>`;
}

function playlistXml(name, ids, indent) {
  const keys = ids.map((id) => `${indent}  <TRACK Key="${id}"/>`).join("\n");
  const open = `${indent}<NODE Name="${escapeXml(name)}" Type="1" KeyType="0" Entries="${ids.length}">`;
  return ids.length ? `${open}\n${keys}\n${indent}</NODE>` : `${open}</NODE>`;
}

/** One playlist per job, named "Artist - Album" (or the first title). */
function releases(library) {
  const groups = new Map();
  library.forEach((t, i) => {
    const key = t.jobId || t.album || t.localPath;
    if (!groups.has(key)) {
      const name = t.album ? (t.artist ? `${t.artist} - ${t.album}` : t.album) : t.title || "Untitled";
      groups.set(key, { name, ids: [] });
    }
    groups.get(key).ids.push(i + 1);
  });
  const seen = new Map();
  return [...groups.values()].map((g) => {
    const n = (seen.get(g.name) ?? 0) + 1;
    seen.set(g.name, n);
    return n === 1 ? g : { ...g, name: `${g.name} (${n})` };
  });
}

/**
 * The full rekordbox.xml. Track ids are library positions, so they stay
 * stable as the library only grows.
 * @param {object[]} library DownloadedFile payloads in the order they arrived
 * @param {{ playlistName?: string, perRelease?: boolean }} options
 */
export function buildXml(library, options = {}) {
  const name = (options.playlistName || "").trim() || "Needle";
  const ids = library.map((_, i) => i + 1);
  let tree;
  if (options.perRelease) {
    const lists = releases(library);
    const children = lists.map((r) => playlistXml(r.name, r.ids, "        ")).join("\n");
    const folder = `      <NODE Type="0" Name="${escapeXml(name)}" Count="${lists.length}">`;
    tree = lists.length ? `${folder}\n${children}\n      </NODE>` : `${folder}</NODE>`;
  } else {
    tree = playlistXml(name, ids, "      ");
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<DJ_PLAYLISTS Version="1.0.0">`,
    `  <PRODUCT Name="Needle" Version="${PRODUCT_VERSION}" Company="Needle"/>`,
    `  <COLLECTION Entries="${library.length}">`,
    ...library.map((t, i) => `    ${trackXml(t, i + 1)}`),
    `  </COLLECTION>`,
    `  <PLAYLISTS>`,
    `    <NODE Type="0" Name="ROOT" Count="1">`,
    tree,
    `    </NODE>`,
    `  </PLAYLISTS>`,
    `</DJ_PLAYLISTS>`,
    ``,
  ].join("\n");
}
