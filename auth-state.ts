import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { getSupabaseAdmin } from "./supabase";

type StoredAuthState = {
  creds: string;
  keys: Record<string, Record<string, string>>;
};

type SessionRow = {
  auth_state: StoredAuthState | null;
};

function encode(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function decode<T>(value: string): T {
  return JSON.parse(value, BufferJSON.reviver) as T;
}

async function loadState(
  userId: string,
  workspaceId: string,
): Promise<StoredAuthState> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("whatsapp_sessions")
    .select("auth_state")
    .eq("user_id", userId)
    .maybeSingle<SessionRow>();
  if (error) throw new Error(error.message);
  if (data?.auth_state) return data.auth_state;

  const fresh: StoredAuthState = { creds: encode(initAuthCreds()), keys: {} };
  const { error: insertError } = await client
    .from("whatsapp_sessions")
    .upsert({
      user_id: userId,
      workspace_id: workspaceId,
      status: "disconnected",
      auth_state: fresh,
    });
  if (insertError) throw new Error(insertError.message);
  return fresh;
}

export async function useDatabaseAuthState(params: {
  userId: string;
  workspaceId: string;
}): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const stored = await loadState(params.userId, params.workspaceId);
  const creds = decode<AuthenticationCreds>(stored.creds);
  const keys = stored.keys;

  const persist = async () => {
    const { error } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .upsert({
        user_id: params.userId,
        workspace_id: params.workspaceId,
        auth_state: { creds: encode(creds), keys },
      });
    if (error) throw new Error(error.message);
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const result: Record<string, SignalDataTypeMap[T]> = {};
          for (const id of ids) {
            const serialized = keys[type]?.[id];
            if (serialized) result[id] = decode<SignalDataTypeMap[T]>(serialized);
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const [type, values] of Object.entries(data)) {
            const typeKey = type as keyof SignalDataTypeMap;
            keys[typeKey] ??= {};
            for (const [id, value] of Object.entries(values)) {
              if (value === null) delete keys[typeKey][id];
              else keys[typeKey][id] = encode(value);
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}