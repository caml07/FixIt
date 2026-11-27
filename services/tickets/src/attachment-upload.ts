import { Busboy, type BusboyInstance } from "@fastify/busboy";
import type { Request } from "express";
import { attachmentTypes, checkAttachmentContent, imageLimit, videoLimit, type AttachmentType } from "./attachment-media.js";

type Upload = { status: 200; contentType: AttachmentType; bytes: Buffer; version: number } |
  { status: 413 | 415 | 422 };

export async function readAttachmentUpload(req: Request): Promise<Upload> {
  const contentType = req.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return { status: 415 };
  const requestLimit = videoLimit + 16 * 1024;
  if (Number(req.get("content-length")) > requestLimit) return { status: 413 };
  let parser: BusboyInstance;
  try {
    parser = Busboy({ headers: { ...req.headers, "content-type": contentType },
      limits: { parts: 2, files: 1, fields: 1, fileSize: videoLimit, fieldSize: 16, headerSize: 4096, headerPairs: 10 } });
  } catch {
    return { status: 422 };
  }
  return new Promise((resolve) => {
    let settled = false;
    let type: AttachmentType | undefined;
    let version: number | undefined;
    let requestBytes = 0;
    let fileBytes = 0;
    let rejected: 413 | 415 | 422 | undefined;
    const chunks: Buffer[] = [];
    const deadline = setTimeout(() => finish({ status: 422 }), 30_000);
    function count(chunk: Buffer) {
      requestBytes += chunk.length;
      if (requestBytes > requestLimit) finish({ status: 413 });
    }
    function invalid() { finish({ status: 422 }); }
    function disconnected() { if (!req.complete) invalid(); }
    function finish(result: Upload) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.removeListener("data", count);
      req.removeListener("close", disconnected);
      req.removeListener("error", invalid);
      req.unpipe(parser);
      if (!parser.writableFinished) parser.destroy();
      resolve(result);
    }
    parser.on("error", invalid);
    function invalidPart() { rejected ??= 422; }
    parser.on("partsLimit", invalidPart).on("fieldsLimit", invalidPart).on("filesLimit", invalidPart);
    parser.on("field", (name, value, truncatedName, truncatedValue) => {
      if (name !== "expectedVersion" || truncatedName || truncatedValue || !/^[1-9][0-9]{0,9}$/.test(value) ||
          Number(value) > 2_147_483_647) return invalidPart();
      version = Number(value);
    });
    parser.on("file", (name, file, _filename, encoding, mime) => {
      file.on("error", invalid);
      if (settled) { file.resume(); return; }
      if (name !== "file" || !["7bit", "8bit", "binary"].includes(encoding)) {
        file.resume();
        return invalidPart();
      }
      type = attachmentTypes.find((candidate) => candidate === mime);
      if (!type) {
        file.resume();
        rejected ??= 415;
        return;
      }
      const limit = type === "video/mp4" ? videoLimit : imageLimit;
      file.on("limit", () => { rejected ??= 413; });
      file.on("data", (chunk: Buffer) => {
        if (settled || rejected) return;
        fileBytes += chunk.length;
        if (fileBytes > limit) rejected = 413;
        else chunks.push(chunk);
      });
    });
    parser.on("finish", () => {
      if (rejected) return finish({ status: rejected });
      if (!type || version === undefined || !fileBytes) return invalid();
      const bytes = Buffer.concat(chunks, fileBytes);
      if (!checkAttachmentContent[type](bytes)) return finish({ status: 415 });
      finish({ status: 200, bytes, contentType: type, version });
    });
    if (req.destroyed) return invalid();
    req.once("close", disconnected);
    req.once("error", invalid);
    req.on("data", count);
    req.pipe(parser);
  });
}
