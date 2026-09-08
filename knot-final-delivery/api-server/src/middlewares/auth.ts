import type { NextFunction, Request, Response } from "express";
import { authenticateRequest } from "../lib/supabase";

export async function requireUser(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    request.knotUser = await authenticateRequest(request);
    next();
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Authentication required",
    });
  }
}