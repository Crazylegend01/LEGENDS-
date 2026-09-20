import { Router, type IRouter, type Request } from "express";
import { requireUser } from "../middlewares/auth";
import { getSupabaseAdmin, isAdmin } from "../lib/supabase";

const router: IRouter = Router();

async function assertAdmin(request: Request): Promise<Request & {
  knotUser: NonNullable<Request["knotUser"]>;
}> {
  if (!request.knotUser || !(await isAdmin(request.knotUser))) {
    throw new Error("Administrator access required");
  }
  return request as Request & {
    knotUser: NonNullable<Request["knotUser"]>;
  };
}

router.get("/admin/settings", requireUser, async (request, response) => {
  try {
    await assertAdmin(request);
    const { data, error } = await getSupabaseAdmin()
      .from("platform_settings")
      .select("key,value,is_secret,is_public,description,updated_at")
      .order("key");
    if (error) throw new Error(error.message);

    response.json({
      settings: (data ?? []).map((setting) => ({
        ...setting,
        // Secret values are write-only from the admin UI.
        value: setting.is_secret ? null : setting.value,
        hasValue: Boolean(setting.value),
      })),
    });
  } catch (error) {
    response.status(403).json({
      error: error instanceof Error ? error.message : "Unable to load settings",
    });
  }
});

router.patch("/admin/settings", requireUser, async (request, response) => {
  try {
    await assertAdmin(request);
    const settings = request.body?.settings;
    if (!Array.isArray(settings) || settings.length === 0) {
      throw new Error("settings must be a non-empty array");
    }

    const rows = settings.map((setting: unknown) => {
      if (!setting || typeof setting !== "object") {
        throw new Error("Each setting must be an object");
      }
      const candidate = setting as Record<string, unknown>;
      const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
      const value = typeof candidate.value === "string" ? candidate.value : "";
      if (!/^[a-z][a-z0-9_.-]{1,100}$/.test(key)) {
        throw new Error(`Invalid setting key: ${key || "(empty)"}`);
      }
      if (value.length > 10000) throw new Error(`${key} is too long`);
      return {
        key,
        value,
        is_secret: candidate.isSecret === true,
        is_public: candidate.isPublic === true,
      };
    });

    const { data, error } = await getSupabaseAdmin()
      .from("platform_settings")
      .upsert(rows, { onConflict: "key" })
      .select("key,value,is_secret,is_public,description,updated_at");
    if (error) throw new Error(error.message);

    response.json({
      settings: (data ?? []).map((setting) => ({
        ...setting,
        value: setting.is_secret ? null : setting.value,
        hasValue: Boolean(setting.value),
      })),
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to save settings",
    });
  }
});

export default router;