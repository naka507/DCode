import { inflateSync } from "node:zlib";

/**
 * Minimal readers for the two raster formats the brand assets use.
 *
 * The brand contract is about pixels — which variant carries light art and
 * which carries dark art — so a test that only asserts file names cannot
 * catch a polarity flip. These decode just enough to measure it, without
 * adding an image dependency to the test tree.
 */

/** Decode a non-interlaced 8-bit RGB/RGBA PNG into raw channel bytes. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const prior =
      y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const above = prior ? prior[i] : 0;
      const upperLeft = prior && i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += (left + above) >> 1;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
      } else if (filter !== 0) {
        throw new Error(`unknown PNG filter ${filter}`);
      }
      current[i] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/**
 * Read a GIF's global colour table, background index, and the transparent
 * index declared by its first Graphic Control Extension.
 *
 * The mascot GIFs are two-colour: one transparent entry and one ink entry, so
 * the ink's luminance alone states which theme the asset is drawn for.
 */
export function gifHeader(buffer) {
  if (buffer.toString("ascii", 0, 3) !== "GIF") throw new Error("not a GIF");
  const packed = buffer[10];
  const hasTable = Boolean(packed >> 7);
  const tableSize = 2 ** ((packed & 0x07) + 1);
  const backgroundIndex = buffer[11];
  const palette = [];
  let pos = 13;
  if (hasTable) {
    for (let i = 0; i < tableSize; i += 1) {
      palette.push([buffer[pos], buffer[pos + 1], buffer[pos + 2]]);
      pos += 3;
    }
  }
  // Walk the extension blocks to the first Graphic Control Extension. Pillow
  // writes a NETSCAPE2.0 application extension (the loop count) ahead of it, so
  // the GCE is not necessarily the first block after the colour table.
  let transparentIndex = null;
  let disposal = null;
  let duration = null;
  while (pos < buffer.length) {
    const marker = buffer[pos];
    if (marker === 0x2c || marker === 0x3b) break; // image descriptor / trailer
    if (marker !== 0x21) break; // not an extension: stop rather than guess
    const label = buffer[pos + 1];
    if (label === 0xf9) {
      const size = buffer[pos + 2];
      const block = buffer.subarray(pos + 3, pos + 3 + size);
      disposal = (block[0] >> 2) & 0x07;
      if (block[0] & 0x01) transparentIndex = block[3];
      duration = block.readUInt16LE(1);
      break;
    }
    // Any other extension: skip its sub-blocks up to the zero terminator.
    pos += 2;
    while (pos < buffer.length && buffer[pos] !== 0) pos += buffer[pos] + 1;
    pos += 1;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    tableSize,
    backgroundIndex,
    transparentIndex,
    disposal,
    duration,
    palette,
  };
}

/** Median luminance of a PNG's pixels whose alpha is at least `minAlpha`. */
export function opaqueMedianLuminance(png, minAlpha = 200) {
  const { channels, pixels } = png;
  const values = [];
  for (let i = 0; i < pixels.length; i += channels) {
    const alpha = channels === 4 ? pixels[i + 3] : 255;
    if (alpha < minAlpha) continue;
    values.push(
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
    );
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Luminance of the one palette entry a two-colour GIF draws with. */
export function gifInkLuminance(header) {
  const ink = header.palette
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => index !== header.transparentIndex)
    .map(({ entry }) => 0.299 * entry[0] + 0.587 * entry[1] + 0.114 * entry[2]);
  if (ink.length === 0) return null;
  return Math.max(...ink);
}
