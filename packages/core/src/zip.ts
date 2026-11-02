// ZIP phase: a minimal, bounded ZIP reader (same algorithm as the Python reference) and a deterministic writer.
import { Inflate, deflateSync } from "fflate";
import { ENTRY_NAME } from "./paths.js";
import type { Collector } from "./report.js";
import { CONSTANTS, LIMITS } from "./spec.js";

const SIG_EOCD = 0x06054b50;
const SIG_CDH = 0x02014b50;
const SIG_LFH = 0x04034b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX32 = 0xffffffff;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01: the fixed timestamp of every entry we write
const INFLATE_CHUNK = 16 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Raw-deflate decode that never holds more than usize + one chunk of output. Bytes after the end of the
 * deflate stream are ignored (as browsers and the Python reference do); a truncated stream is an error.
 */
function inflateBounded(comp: Uint8Array, usize: number): Uint8Array | null {
  const out = new Uint8Array(usize);
  let total = 0;
  let overflow = false;
  const inf = new Inflate((chunk) => {
    if (total + chunk.length > usize) {
      overflow = true;
      throw new Error("entry larger than declared");
    }
    out.set(chunk, total);
    total += chunk.length;
  });
  try {
    if (comp.length === 0) inf.push(comp, true);
    for (let i = 0; i < comp.length; i += INFLATE_CHUNK) {
      inf.push(comp.subarray(i, i + INFLATE_CHUNK), i + INFLATE_CHUNK >= comp.length);
    }
  } catch {
    return null;
  }
  return !overflow && total === usize ? out : null;
}

interface CdEntry {
  raw: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const latin1 = (raw: Uint8Array) => String.fromCharCode(...raw);

/** Run every ZIP-phase check. Returns name -> bytes for file entries, or null if any error was found. */
export function readZip(data: Uint8Array, c: Collector): Map<string, Uint8Array> | null {
  const n = data.length;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (n < 22) {
    c.add("ZIP_NOT_ZIP");
    return null;
  }
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    c.add("ZIP_NOT_ZIP");
    return null;
  }
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const diskEntries = dv.getUint16(eocd + 8, true);
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (
    (eocd >= 20 && dv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) ||
    disk !== 0 ||
    cdDisk !== 0 ||
    diskEntries !== total ||
    total === 0xffff ||
    cdSize === MAX32 ||
    cdOff === MAX32
  ) {
    c.add("ZIP_UNSUPPORTED_FEATURE");
    return null;
  }
  if (total > LIMITS.maxEntries) {
    c.add("ZIP_TOO_MANY_ENTRIES");
    return null;
  }
  if (cdOff + cdSize > eocd) {
    c.add("ZIP_NOT_ZIP");
    return null;
  }

  const infos: CdEntry[] = [];
  let p = cdOff;
  for (let k = 0; k < total; k++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== SIG_CDH) {
      c.add("ZIP_NOT_ZIP");
      return null;
    }
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    if (p + 46 + nlen + xlen + clen > eocd) {
      c.add("ZIP_NOT_ZIP");
      return null;
    }
    infos.push({
      raw: data.subarray(p + 46, p + 46 + nlen),
      flags: dv.getUint16(p + 8, true),
      method: dv.getUint16(p + 10, true),
      crc: dv.getUint32(p + 16, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nlen + xlen + clen;
  }

  const files: (CdEntry & { name: string })[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const e of infos) {
    const name = latin1(e.raw);
    if (e.raw.some((b) => b >= 0x80)) {
      c.add("ZIP_INVALID_NAME", name);
    } else {
      const core = name.endsWith("/") ? name.slice(0, -1) : name;
      if (
        core.startsWith("/") ||
        core.includes("\\") ||
        core.split("/").some((s) => s === "" || s === "." || s === "..")
      ) {
        c.add("ZIP_UNSAFE_PATH", name);
      } else if (!ENTRY_NAME.test(core)) {
        c.add("ZIP_INVALID_NAME", name);
      }
    }
    if (e.flags & 0x41) c.add("ZIP_ENCRYPTED_ENTRY", name);
    if ((e.method !== 0 && e.method !== 8) || [e.csize, e.usize, e.offset].includes(MAX32)) {
      c.add("ZIP_UNSUPPORTED_FEATURE", name);
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) c.add("ZIP_DUPLICATE_ENTRY", name);
    seen.add(lower);
    if (e.usize > LIMITS.maxEntryBytes) c.add("ZIP_SIZE_LIMIT", name);
    totalBytes += e.usize;
    if (
      e.usize >= LIMITS.compressionRatioMinBytes &&
      (e.csize === 0 || e.usize / e.csize > LIMITS.maxCompressionRatio)
    ) {
      c.add("ZIP_RATIO_LIMIT", name);
    }
    if (!name.endsWith("/")) files.push({ ...e, name });
  }
  if (totalBytes > LIMITS.maxTotalBytes) c.add("ZIP_SIZE_LIMIT");
  if (c.fatal()) return null;

  const entries = new Map<string, Uint8Array>();
  for (const e of files) {
    let content: Uint8Array | null = null;
    if (e.offset + 30 <= n && dv.getUint32(e.offset, true) === SIG_LFH) {
      const start =
        e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
      if (start + e.csize <= cdOff) {
        const comp = data.subarray(start, start + e.csize);
        content =
          e.method === 0
            ? e.csize === e.usize
              ? comp.slice()
              : null
            : inflateBounded(comp, e.usize);
      }
    }
    if (content === null || crc32(content) !== e.crc) c.add("ZIP_CORRUPT", e.name);
    else entries.set(e.name, content);
  }

  let first: CdEntry | null = null;
  for (const e of infos) if (first === null || e.offset < first.offset) first = e;
  if (first === null || latin1(first.raw) !== "mimetype") {
    c.add("ZIP_MIMETYPE_NOT_FIRST");
  } else {
    if (first.method !== 0) c.add("ZIP_MIMETYPE_COMPRESSED", "mimetype");
    if (first.offset + 30 <= n && dv.getUint16(first.offset + 28, true) !== 0)
      c.add("ZIP_MIMETYPE_EXTRA_FIELD", "mimetype");
    const mt = entries.get("mimetype");
    const expected = CONSTANTS.containerMimetype as string;
    if (mt && (mt.length !== expected.length || latin1(mt) !== expected))
      c.add("ZIP_MIMETYPE_INVALID", "mimetype");
  }
  return c.fatal() ? null : entries;
}

/** Deterministic ZIP: given order, fixed 1980-01-01 timestamps, no extra fields. */
export function writeZip(
  entries: { name: string; data: Uint8Array; compress: boolean }[],
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data, compress } of entries) {
    const raw = new TextEncoder().encode(name);
    const comp = compress ? deflateSync(data, { level: 9 }) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);
    const local = new Uint8Array(30 + raw.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LFH, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, raw.length, true);
    local.set(raw, 30);
    const central = new Uint8Array(46 + raw.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CDH, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, raw.length, true);
    cv.setUint32(42, offset, true);
    central.set(raw, 46);
    locals.push(local, comp);
    centrals.push(central);
    offset += local.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
