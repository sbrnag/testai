/* ────────────────────────────────────────────────────────────────────────
   Minimal ZIP reader — enough to list an archive and pull single entries
   back out, with no external library.

   Listing parses the End of Central Directory record and walks the central
   directory, so it never touches the compressed payload. Extraction inflates
   one entry at a time using the platform's own DecompressionStream, which
   keeps a large archive off the heap until a page is actually previewed.

   Not handled: ZIP64 (archives over 4 GB or 65535 entries) and encrypted
   entries. Both report a clear error rather than returning wrong data.
   ──────────────────────────────────────────────────────────────────────── */

const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
const textDecoder = new TextDecoder();

/** Locate the End of Central Directory record, scanning back over the comment. */
function findEOCD(view){
  const max = Math.min(view.byteLength, 65557);         // 22 byte record + max comment
  for (let i = 22; i <= max; i++){
    const p = view.byteLength - i;
    if (view.getUint32(p, true) === EOCD_SIG) return p;
  }
  return -1;
}

/**
 * List the entries in a ZIP file.
 * @returns {Promise<Array<{name,dir,size,compressedSize,method,offset,date}>>}
 */
export async function listZip(file){
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('Not a ZIP archive, or the file is truncated.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff)
    throw new Error('ZIP64 archives are not supported in this prototype.');

  const entries = [];
  for (let i = 0; i < count; i++){
    if (view.getUint32(p, true) !== CEN_SIG) break;
    const flag     = view.getUint16(p + 8,  true);
    const method   = view.getUint16(p + 10, true);
    const dosTime  = view.getUint16(p + 12, true);
    const dosDate  = view.getUint16(p + 14, true);
    const compSize = view.getUint32(p + 20, true);
    const size     = view.getUint32(p + 24, true);
    const nameLen  = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const cmtLen   = view.getUint16(p + 32, true);
    const offset   = view.getUint32(p + 42, true);
    const name     = textDecoder.decode(new Uint8Array(buf, p + 46, nameLen));

    entries.push({
      name, size, compressedSize: compSize, method, offset,
      dir: name.endsWith('/'),
      encrypted: !!(flag & 0x1),
      /* A zero DOS timestamp means the writer left it unset — decoding it
         anyway yields a bogus 1979 date, so report no date instead. */
      date: dosDate ? new Date(
        1980 + ((dosDate >> 9) & 0x7f), ((dosDate >> 5) & 0xf) - 1, dosDate & 0x1f,
        (dosTime >> 11) & 0x1f, (dosTime >> 5) & 0x3f, (dosTime & 0x1f) * 2) : null,
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { entries, buffer: buf };
}

/** Inflate one entry and return it as a Blob of the given MIME type. */
export async function readEntry(buffer, entry, type = 'application/octet-stream'){
  if (entry.encrypted) throw new Error('Entry is password protected.');
  const view = new DataView(buffer);
  if (view.getUint32(entry.offset, true) !== LOC_SIG)
    throw new Error('Corrupt local header for ' + entry.name);

  const nameLen  = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start    = entry.offset + 30 + nameLen + extraLen;
  const bytes    = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new Blob([bytes], { type });          // stored
  if (entry.method !== 8) throw new Error('Unsupported compression method ' + entry.method);
  if (typeof DecompressionStream === 'undefined')
    throw new Error('This browser cannot inflate ZIP entries.');

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).blob().then(b => new Blob([b], { type }));
}

/* ── helpers the bulk-upload view needs ─────────────────────────────────── */

export const SHEET_RX = /\.(pdf|jpe?g|png|tiff?|webp)$/i;
/** Archive noise that should never be treated as an answer sheet. */
const JUNK_RX = /(^|\/)(__MACOSX\/|\.DS_Store|Thumbs\.db|\._)/i;

export const isSheet = e => !e.dir && SHEET_RX.test(e.name) && !JUNK_RX.test(e.name);

export const mimeOf = name =>
  /\.pdf$/i.test(name)          ? 'application/pdf'
  : /\.png$/i.test(name)        ? 'image/png'
  : /\.tiff?$/i.test(name)      ? 'image/tiff'
  : /\.webp$/i.test(name)       ? 'image/webp'
  : 'image/jpeg';

/** Page count for a PDF, by counting page objects. Images are a single page. */
export function countPages(bytes, name){
  if (!/\.pdf$/i.test(name)) return 1;
  const text = textDecoder.decode(bytes.slice(0, Math.min(bytes.length, 4_000_000)));
  const m = text.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 1;
}
