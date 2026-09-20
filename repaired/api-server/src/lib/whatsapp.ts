import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import QRCode from "qrcode";
import { logger } from "./logger";
import {
  clearDatabaseAuthState,
  useDatabaseAuthState,
} from "./auth-state";
import { getSupabaseAdmin } from "./supabase";

const STATUS_JID = "status@broadcast";
const sessionMap = new Map<string, { socket: WASocket; stopping: boolean }>();
const sessionLogger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });
let migrationWarningLogged = false;

type QueueItem = {
  id: string;
  user_id: string;
  workspace_id: string;
  cloudinary_url: string | null;
  caption: string;
  resource_type: "image" | "video" | null;
  mime_type: string | null;
};

async function setSessionStatus(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .update(patch)
    .eq("user_id", userId);
  if (error) logger.warn({ err: error }, "Unable to persist WhatsApp session status");
}

export async function getSessionStatus(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .select(
      "user_id,workspace_id,status,phone_number,qr_code,pairing_code,last_error,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: "disconnected", userId };
  return {
    ...data,
    qrDataUrl: data.qr_code ? await QRCode.toDataURL(data.qr_code) : null,
    pairingCode: data.pairing_code ?? null,
  };
}

export async function startWhatsAppSession(
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (sessionMap.has(userId)) return;
  const { error: sessionError } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .upsert(
      {
        user_id: userId,
        workspace_id: workspaceId,
        status: "connecting",
        last_error: null,
      },
      { onConflict: "user_id" },
    );
  if (sessionError) throw new Error(sessionError.message);
  const auth = await useDatabaseAuthState({ userId, workspaceId });
  const socket = makeWASocket({
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, sessionLogger),
    },
    printQRInTerminal: false,
    logger: sessionLogger,
    markOnlineOnConnect: false,
  });
  const session = { socket, stopping: false };
  sessionMap.set(userId, session);
  await setSessionStatus(userId, {
    workspace_id: workspaceId,
    status: "connecting",
    last_error: null,
    pairing_code: null,
  });

  socket.ev.on("creds.update", () => {
    void auth.saveCreds().catch((error) => {
      logger.error({ err: error, userId }, "Unable to save WhatsApp credentials");
    });
  });

  socket.ev.on("connection.update", (update) => {
    void (async () => {
      if (update.qr) {
        await setSessionStatus(userId, {
          status: "qr",
          qr_code: update.qr,
          pairing_code: null,
          last_error: null,
        });
      }
      if (update.connection === "open") {
        await setSessionStatus(userId, {
          status: "connected",
          qr_code: null,
          pairing_code: null,
          phone_number: socket.user?.id?.split(":")[0] ?? null,
          last_error: null,
        });
      }
      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as Boom)?.output
          ?.statusCode;
        sessionMap.delete(userId);
        if (
          !session.stopping &&
          statusCode !== DisconnectReason.loggedOut
        ) {
          await setSessionStatus(userId, {
            status: "reconnecting",
            last_error: "WhatsApp connection closed; retrying",
          });
          setTimeout(() => {
            void startWhatsAppSession(userId, workspaceId).catch((error) =>
              logger.error({ err: error, userId }, "WhatsApp reconnect failed"),
            );
          }, 5_000);
        } else {
          await setSessionStatus(userId, {
            status: statusCode === DisconnectReason.loggedOut ? "logged_out" : "disconnected",
            qr_code: null,
          });
        }
      }
    })().catch((error) => {
      logger.error({ err: error, userId }, "WhatsApp connection event failed");
    });
  });
}

export async function stopWhatsAppSession(userId: string): Promise<void> {
  const session = sessionMap.get(userId);
  if (session) {
    session.stopping = true;
    session.socket.end(undefined);
    sessionMap.delete(userId);
  }
  await setSessionStatus(userId, {
    status: "disconnected",
    qr_code: null,
    pairing_code: null,
    last_error: null,
  });
  await clearDatabaseAuthState(userId);
}

export async function requestWhatsAppPairingCode(params: {
  userId: string;
  workspaceId: string;
  phoneNumber: string;
}): Promise<string> {
  const phoneNumber = params.phoneNumber.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(phoneNumber)) {
    throw new Error("Enter a WhatsApp phone number with country code");
  }

  await startWhatsAppSession(params.userId, params.workspaceId);
  const session = sessionMap.get(params.userId);
  if (!session) throw new Error("WhatsApp session could not be started");
  if (session.socket.authState?.creds.registered) {
    throw new Error("This WhatsApp session is already linked");
  }

  const pairingCode = await session.socket.requestPairingCode(phoneNumber);
  await setSessionStatus(params.userId, {
    workspace_id: params.workspaceId,
    status: "pairing",
    qr_code: null,
    pairing_code: pairingCode,
    last_error: null,
  });
  return pairingCode;
}

export async function restoreWhatsAppSessions(): Promise<void> {
  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .select("user_id,workspace_id,status")
    .in("status", ["connected", "connecting", "qr", "pairing", "reconnecting"]);
  if (error) throw new Error(error.message);

  for (const session of data ?? []) {
    void startWhatsAppSession(session.user_id, session.workspace_id).catch(
      (restoreError) => {
        logger.error(
          { err: restoreError, userId: session.user_id },
          "Unable to restore WhatsApp session",
        );
      },
    );
  }
}

export async function sendQueueItem(item: QueueItem): Promise<void> {
  const session = sessionMap.get(item.user_id);
  if (!session) throw new Error("WhatsApp session is not connected");
  const content = item.cloudinary_url
    ? item.resource_type === "video"
      ? {
          video: { url: item.cloudinary_url },
          caption: item.caption || undefined,
          mimetype: item.mime_type ?? "video/mp4",
        }
      : {
          image: { url: item.cloudinary_url },
          caption: item.caption || undefined,
        }
    : { text: item.caption };
  await session.socket.sendMessage(STATUS_JID, content);
}

async function claimDueItems(workerId: string): Promise<QueueItem[]> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_due_media_queue", {
    p_worker_id: workerId,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueItem[];
}

async function completeItem(item: QueueItem): Promise<void> {
  await getSupabaseAdmin()
    .from("media_queue")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", item.id)
    .eq("status", "processing");
}

async function failItem(item: QueueItem, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Broadcast failed";
  await getSupabaseAdmin()
    .from("media_queue")
    .update({
      status: "failed",
      last_error: message.slice(0, 2000),
    })
    .eq("id", item.id)
    .eq("status", "processing");
}

export async function processDueQueue(): Promise<void> {
  const workerId = randomUUID();
  let items: QueueItem[];
  try {
    items = await claimDueItems(workerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("claim_due_media_queue") &&
      !migrationWarningLogged
    ) {
      migrationWarningLogged = true;
      logger.warn(
        "WhatsApp worker is waiting for the Knot broadcast Supabase migration",
      );
    }
    throw error;
  }
  for (const item of items) {
    try {
      await sendQueueItem(item);
      await completeItem(item);
    } catch (error) {
      await failItem(item, error);
      logger.error({ err: error, queueId: item.id }, "Queue broadcast failed");
    }
  }
}

export function startWhatsAppWorker(): void {
  cron.schedule("* * * * *", () => {
    void processDueQueue().catch((error) => {
      logger.error({ err: error }, "Queue worker tick failed");
    });
  });
  logger.info("WhatsApp queue worker scheduled every minute");
  void restoreWhatsAppSessions().catch((error) => {
    logger.warn(
      { err: error },
      "WhatsApp session restore is waiting for the Supabase linking migration",
    );
  });
}