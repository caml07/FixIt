import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileAttachmentStorage } from "../dist/attachment-storage.js";

test("private filesystem storage rejects unsafe keys and preserves an existing object", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fixit-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new FileAttachmentStorage(root);
  const key = randomUUID();
  const bytes = Buffer.from("isolated test bytes");
  await assert.rejects(storage.put("../outside", bytes));
  await assert.rejects(storage.open("../outside", bytes.length));
  await assert.rejects(storage.remove("../outside"));
  await storage.put(key, bytes);
  await assert.rejects(storage.put(key, Buffer.from("replacement")));
  await assert.rejects(storage.open(key, bytes.length + 1));
  const chunks = [];
  for await (const chunk of await storage.open(key, bytes.length)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  await storage.remove(key);
  await storage.remove(key);
  assert.deepEqual(await readdir(root), []);
});
