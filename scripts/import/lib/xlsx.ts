/**
 * Minimal .xlsx reader — just enough to pull a sheet out as rows of strings.
 * An .xlsx file is a ZIP of XML parts; we inflate the entries we need and
 * regex out the cell values. Deliberately dependency-free: the project only
 * ever reads a couple of tiny commissioner-authored workbooks, and pulling in
 * a full spreadsheet library for that isn't worth the install weight.
 *
 * Supports: stored + deflated ZIP entries, shared strings, inline strings.
 * Not supported (not needed here): formulas, dates as serial numbers, styles.
 */
import { inflateRawSync } from "node:zlib";

function unzip(buf: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record)");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    try {
      files[name] = method === 0 ? data : inflateRawSync(data);
    } catch {
      // A part we can't inflate is a part we don't need.
      files[name] = Buffer.alloc(0);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface SheetData {
  name: string;
  /** Rows of cell text, indexed by column letter. */
  rows: Record<string, string>[];
}

/** Reads every worksheet in the workbook at `path`. */
export function readXlsx(path: string, readFile: (p: string) => Buffer): SheetData[] {
  const files = unzip(readFile(path));

  const shared: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"]?.toString("utf8");
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const text = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
      shared.push(decodeEntities(text));
    }
  }

  const names: string[] = [];
  const wbXml = files["xl/workbook.xml"]?.toString("utf8");
  if (wbXml) for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]*)"/g)) names.push(decodeEntities(m[1]));

  const sheets: SheetData[] = [];
  const sheetNames = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();

  sheetNames.forEach((partName, idx) => {
    const xml = files[partName].toString("utf8");
    const rows: Record<string, string>[] = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: Record<string, string> = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const col = c[1];
        const type = c[2];
        const inline = c[3].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        const v = c[3].match(/<v>([\s\S]*?)<\/v>/);
        let val = inline ? decodeEntities(inline[1]) : v ? v[1] : "";
        if (type === "s" && v) val = shared[Number(v[1])] ?? "";
        if (val !== "") row[col] = val;
      }
      if (Object.keys(row).length) rows.push(row);
    }
    sheets.push({ name: names[idx] ?? partName, rows });
  });

  return sheets;
}
