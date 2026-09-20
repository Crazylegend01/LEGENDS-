import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import multer from "multer";
import { requireUser } from "../middlewares/auth";
import {
  destroyCloudinaryAsset,
  uploadWhatsAppMedia,
} from "../lib/cloudinary";
import { assertWorkspaceAccess, getSupabaseAdmin, isAdmin } from "../lib/supabase";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, allowedMimeTypes.has(file.mimetype));
  },
});

function getRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function parseSchedule(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("scheduledFor must be an ISO date");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("scheduledFor must be an ISO date");
  return date.toISOString();
}

router.post(
  "/media/upload",
  requireUser,
  upload.single("file"),
  async (request, response) => {
    const user = request.knotUser;
    if (!user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    let uploaded: Awaited<ReturnType<typeof uploadWhatsAppMedia>> | undefined;
    try {
      if (!request.file) throw new Error("A media file is required");
      if (!allowedMimeTypes.has(request.file.mimetype)) {
        throw new Error("Unsupported media type");
      }

      const workspaceId = getRequiredString(request.body.workspaceId, "workspaceId");
      const caption =
        typeof request.body.caption === "string"
          ? request.body.caption.trim()
          : "";
      if (caption.length > 4096) throw new Error("caption is too long");

      await assertWorkspaceAccess(user, workspaceId);
      const scheduledFor = parseSchedule(request.body.scheduledFor);
      uploaded = await uploadWhatsAppMedia({
        buffer: request.file.buffer,
        mimeType: request.file.mimetype,
        userId: user.id,
      });

      const { data, error } = await getSupabaseAdmin()
        .from("media_queue")
        .insert({
          user_id: user.id,
          workspace_id: workspaceId,
          cloudinary_url: uploaded.secureUrl,
          cloudinary_public_id: uploaded.publicId,
          resource_type: uploaded.resourceType,
          mime_type: request.file.mimetype,
          bytes: uploaded.bytes,
          caption,
          scheduled_for: scheduledFor,
          status: "pending",
          attempts: 0,
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      response.status(201).json({ item: data });
    } catch (error) {
      if (uploaded) {
        await destroyCloudinaryAsset(uploaded.publicId, uploaded.resourceType).catch(
          () => undefined,
        );
      }
      response.status(400).json({
        error: error instanceof Error ? error.message : "Unable to upload media",
      });
    }
  },
);

router.get("/media/queue", requireUser, async (request, response) => {
  const user = request.knotUser;
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  const workspaceId = request.query["workspaceId"];
  try {
    const admin = await isAdmin(user);
    let query = getSupabaseAdmin()
      .from("media_queue")
      .select("*")
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (typeof workspaceId === "string" && workspaceId) {
      await assertWorkspaceAccess(user, workspaceId);
      query = query.eq("workspace_id", workspaceId);
    }
    if (!admin) {
      query = query.eq("user_id", user.id);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    response.json({ items: data ?? [] });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to load queue",
    });
  }
});

router.delete("/media/queue/:id", requireUser, async (request, response) => {
  const user = request.knotUser;
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const { data: item, error: lookupError } = await getSupabaseAdmin()
      .from("media_queue")
      .select("id,user_id,workspace_id,cloudinary_public_id,resource_type")
      .eq("id", request.params["id"])
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!item) {
      response.status(404).json({ error: "Queue item not found" });
      return;
    }
    if (!(await isAdmin(user)) && item.user_id !== user.id) {
      response.status(403).json({ error: "You can only delete your own queue items" });
      return;
    }
    await assertWorkspaceAccess(user, item.workspace_id);
    const { error } = await getSupabaseAdmin()
      .from("media_queue")
      .delete()
      .eq("id", item.id);
    if (error) throw new Error(error.message);
    if (item.cloudinary_public_id && item.resource_type) {
      await destroyCloudinaryAsset(item.cloudinary_public_id, item.resource_type).catch(
        () => undefined,
      );
    }
    response.status(204).send();
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to delete queue item",
    });
  }
});

router.post("/media/queue/text", requireUser, async (request, response) => {
  const user = request.knotUser;
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const workspaceId = getRequiredString(request.body.workspaceId, "workspaceId");
    const caption = getRequiredString(request.body.caption, "caption");
    if (caption.length > 4096) throw new Error("caption is too long");
    await assertWorkspaceAccess(user, workspaceId);
    const { data, error } = await getSupabaseAdmin()
      .from("media_queue")
      .insert({
        id: randomUUID(),
        user_id: user.id,
        workspace_id: workspaceId,
        caption,
        status: "pending",
        scheduled_for: parseSchedule(request.body.scheduledFor),
        attempts: 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    response.status(201).json({ item: data });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to queue text",
    });
  }
});

export default router;