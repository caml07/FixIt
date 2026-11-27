import { crc32 } from "node:zlib";

export const imageLimit = 5 * 1024 * 1024;
export const videoLimit = 25 * 1024 * 1024;
export const attachmentTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4"] as const;
export type AttachmentType = typeof attachmentTypes[number];

function png(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return false;
  let imageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (offset === 8 && (type !== "IHDR" || size !== 13 || !bytes.readUInt32BE(offset + 8) ||
        !bytes.readUInt32BE(offset + 12) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1)) return false;
    if (type === "IDAT" && size > 0) imageData = true;
    if (type === "IEND") return imageData && size === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function jpeg(bytes: Buffer): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let frame = false;
  let scan = false;
  let scanData = false;
  let inScan = false;
  for (let offset = 2; offset < bytes.length;) {
    if (inScan) {
      const marker = bytes.indexOf(0xff, offset);
      if (marker < 0) return false;
      scanData ||= marker > offset;
      offset = marker;
    }
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) {
      scanData ||= marker === 0;
      continue;
    }
    inScan = false;
    if (marker === 0xd9) return frame && scan && scanData && offset === bytes.length;
    if (marker < 0xc0 || marker === 0xd8 || offset + 2 > bytes.length) return false;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 11 || size !== 8 + 3 * bytes[offset + 7] ||
          !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false;
      frame = true;
    }
    if (marker === 0xda) {
      if (!frame || size < 8 || size !== 6 + 2 * bytes[offset + 2]) return false;
      scan = inScan = true;
    }
    offset += size;
  }
  return false;
}

function webpChunks(bytes: Buffer, start: number, end: number, allowAnimation: boolean): boolean {
  let image = false;
  let animation = false;
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) return false;
    const type = bytes.toString("latin1", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const next = data + size + (size % 2);
    if (next > end || (size % 2 && bytes[next - 1] !== 0)) return false;
    if (type === "VP8 " || type === "VP8L") {
      const valid = type === "VP8 "
        ? size > 10 && (bytes[data] & 1) === 0 && bytes.readUIntBE(data + 3, 3) === 0x9d012a &&
          (bytes.readUInt16LE(data + 6) & 0x3fff) !== 0 && (bytes.readUInt16LE(data + 8) & 0x3fff) !== 0
        : size > 5 && bytes[data] === 0x2f && (bytes[data + 4] & 0xe0) === 0;
      if (!valid || image) return false;
      image = true;
    }
    if (type === "ANMF") {
      if (!allowAnimation || size < 24 || !webpChunks(bytes, data + 16, data + size, false)) return false;
      animation = true;
    }
    offset = next;
  }
  return image || animation;
}

function webp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString("latin1", 8, 12) === "WEBP" &&
    webpChunks(bytes, 12, bytes.length, true);
}

function mp4(bytes: Buffer): boolean {
  let fileType = false;
  let videoTrack = false;
  let mediaData = false;
  function walk(start: number, end: number, parent: string, media?: { video: boolean; visualSample: boolean }): boolean {
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) return false;
      let size = bytes.readUInt32BE(offset);
      let header = 8;
      const type = bytes.toString("latin1", offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > end || bytes.readUInt32BE(offset + 8) !== 0) return false;
        header = 16;
        size = bytes.readUInt32BE(offset + 12);
      } else if (size === 0) size = end - offset;
      if (size < header || size > end - offset) return false;
      const data = offset + header;
      const next = offset + size;
      if (parent === "" && type === "ftyp") {
        if (fileType || offset !== 0 || next - data < 8 || (next - data) % 4 !== 0) return false;
        const brand = bytes.toString("latin1", data, data + 4);
        if (!/^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV|cmf[cv])$/.test(brand)) return false;
        fileType = true;
      }
      if (parent === "" && type === "mdat" && next > data) mediaData = true;
      if (parent === "mdia" && media && type === "hdlr" && next - data >= 24 &&
          bytes.toString("latin1", data + 8, data + 12) === "vide") media.video = true;
      if (parent === "stsd" && media && next - data >= 78 && bytes.readUInt16BE(data + 6) > 0 &&
          bytes.readUInt16BE(data + 24) > 0 && bytes.readUInt16BE(data + 26) > 0) media.visualSample = true;
      if (parent === "trak" && type === "mdia") {
        const track = { video: false, visualSample: false };
        if (!walk(data, next, type, track)) return false;
        videoTrack ||= track.video && track.visualSample;
      }
      if (((parent === "" && type === "moov") || (parent === "moov" && type === "trak") ||
           (parent === "mdia" && type === "minf") || (parent === "minf" && type === "stbl")) &&
          !walk(data, next, type, media)) return false;
      if (parent === "stbl" && type === "stsd" && (next - data < 8 || !walk(data + 8, next, type, media))) return false;
      offset = next;
    }
    return true;
  }
  return walk(0, bytes.length, "") && fileType && mediaData && videoTrack;
}

export const checkAttachmentContent: Record<AttachmentType, (bytes: Buffer) => boolean> = {
  "image/jpeg": jpeg, "image/png": png, "image/webp": webp, "video/mp4": mp4
};
