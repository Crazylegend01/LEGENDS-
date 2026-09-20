import { Router, type IRouter } from "express";
import { requireUser } from "../middlewares/auth";
import { assertWorkspaceAccess } from "../lib/supabase";
import {
  getSessionStatus,
  requestWhatsAppPairingCode,
  startWhatsAppSession,
  stopWhatsAppSession,
} from "../lib/whatsapp";

const router: IRouter = Router();

router.get("/whatsapp/session", requireUser, async (request, response) => {
  if (!request.knotUser) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    response.json(await getSessionStatus(request.knotUser.id));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to read session",
    });
  }
});

router.post("/whatsapp/session/start", requireUser, async (request, response) => {
  const user = request.knotUser;
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const workspaceId = request.body.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new Error("workspaceId is required");
    }
    await assertWorkspaceAccess(user, workspaceId);
    await startWhatsAppSession(user.id, workspaceId);
    response.status(202).json(await getSessionStatus(user.id));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to start session",
    });
  }
});

router.post(
  "/whatsapp/session/pairing-code",
  requireUser,
  async (request, response) => {
    const user = request.knotUser;
    if (!user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const { workspaceId, phoneNumber } = request.body;
      if (typeof workspaceId !== "string" || !workspaceId) {
        throw new Error("workspaceId is required");
      }
      if (typeof phoneNumber !== "string" || !phoneNumber) {
        throw new Error("phoneNumber is required");
      }
      await assertWorkspaceAccess(user, workspaceId);
      const pairingCode = await requestWhatsAppPairingCode({
        userId: user.id,
        workspaceId,
        phoneNumber,
      });
      response.status(202).json({
        pairingCode,
        ...(await getSessionStatus(user.id)),
      });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to create pairing code",
      });
    }
  },
);

router.delete("/whatsapp/session", requireUser, async (request, response) => {
  if (!request.knotUser) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    await stopWhatsAppSession(request.knotUser.id);
    response.status(204).send();
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to stop session",
    });
  }
});

export default router;