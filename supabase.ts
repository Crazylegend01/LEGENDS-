import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Request } from "express";
import { getSupabaseConfig } from "./config";

let adminClient: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

export function getBearerToken(request: Request): string | null {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export async function authenticateRequest(request: Request): Promise<User> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error("Authentication required");
  }

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Invalid or expired Supabase session");
  }
  return data.user;
}

export async function isAdmin(user: User): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to verify administrator access");
  }

  return data?.role === "admin";
}

export async function assertWorkspaceAccess(
  user: User,
  workspaceId: string,
): Promise<void> {
  if (await isAdmin(user)) return;

  const { data, error } = await getSupabaseAdmin()
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error("Unable to verify workspace access");
  if (!data) throw new Error("You do not have access to this workspace");
}