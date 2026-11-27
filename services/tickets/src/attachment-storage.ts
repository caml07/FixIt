import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";

export const attachmentKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachmentStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  open(key: string, size: number): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export class FileAttachmentStorage implements AttachmentStorage {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error("Attachment storage must use an absolute private directory.");
  }

  private path(key: string) {
    if (!attachmentKey.test(key)) throw new Error("Invalid attachment storage key.");
    return join(this.directory, key);
  }

  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    const file = await open(path, "wx", 0o600);
    try {
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      await rm(path, { force: true }).catch((cleanupError: unknown) => {
        throw new AggregateError([error, cleanupError], "Incomplete attachment requires cleanup.");
      });
      throw error;
    }
  }

  async open(key: string, size: number) {
    const file = await open(this.path(key), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== size) throw new Error("Attachment storage is inconsistent.");
      return file.createReadStream();
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}
