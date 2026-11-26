import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { ChatError, cursor, type Message, message } from "./contracts.js";

export async function openStore(uri: string) {
  const connection = await mongoose
    .createConnection(uri, {
      serverSelectionTimeoutMS: 3000,
      socketTimeoutMS: 3000,
      bufferCommands: false,
    })
    .asPromise();
  const schema = new mongoose.Schema(
    {
      _id: { type: String, required: true },
      ticketId: { type: String, required: true },
      senderId: { type: String, required: true },
      clientMessageId: { type: String, required: true },
      body: { type: String, required: true },
      createdAt: { type: String, required: true },
    },
    { versionKey: false, bufferCommands: false },
  );
  schema.index(
    { ticketId: 1, senderId: 1, clientMessageId: 1 },
    { unique: true },
  );
  schema.index({ ticketId: 1, createdAt: 1, _id: 1 });
  const messages = connection.model("Message", schema);
  try {
    await messages.init();
  } catch (error) {
    await connection.close();
    throw error;
  }
  function toMessage(row: {
    _id: string;
    ticketId: string;
    senderId: string;
    clientMessageId: string;
    body: string;
    createdAt: string;
  }): Message {
    return message.parse({
      id: row._id,
      ticketId: row.ticketId,
      senderId: row.senderId,
      clientMessageId: row.clientMessageId,
      body: row.body,
      createdAt: row.createdAt,
    });
  }
  return {
    close: () => connection.close(),
    async save(input: Omit<Message, "id" | "createdAt">) {
      try {
        const row = new messages({
          ...input,
          _id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        await row.save({ w: "majority", j: true });
        return { message: toMessage(row), inserted: true };
      } catch (error) {
        if (
          !(error instanceof mongoose.mongo.MongoServerError) ||
          error.code !== 11000
        )
          throw error;
        const existing = await messages
          .findOne({
            ticketId: input.ticketId,
            senderId: input.senderId,
            clientMessageId: input.clientMessageId,
          })
          .lean()
          .exec();
        if (!existing) throw new ChatError("DEPENDENCY_UNAVAILABLE");
        if (existing.body !== input.body) throw new ChatError("CONFLICT");
        return { message: toMessage(existing), inserted: false };
      }
    },
    async history(ticketId: string, limit: number, encoded?: string) {
      let before: ReturnType<typeof cursor.parse> | undefined;
      if (encoded) {
        try {
          if (!/^[A-Za-z0-9_-]{1,512}$/.test(encoded)) throw new Error();
          before = cursor.parse(
            JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
          );
          if (before.ticketId !== ticketId) throw new Error();
        } catch {
          throw new ChatError("VALIDATION_ERROR");
        }
      }
      const rows = await messages
        .find({
          ticketId,
          ...(before
            ? {
                $or: [
                  { createdAt: { $lt: before.createdAt } },
                  { createdAt: before.createdAt, _id: { $lt: before.id } },
                ],
              }
            : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean()
        .exec();
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).reverse().map(toMessage);
      const oldest = page[0];
      return {
        items: page,
        nextCursor:
          hasMore && oldest
            ? Buffer.from(
                JSON.stringify({
                  ticketId,
                  createdAt: oldest.createdAt,
                  id: oldest.id,
                }),
              ).toString("base64url")
            : null,
      };
    },
  };
}
