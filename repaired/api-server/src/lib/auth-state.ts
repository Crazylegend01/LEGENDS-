import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { getSupabaseAdmin } from "./supabase";

type StoredAuthFile = {
  file_name: string;
  file_data: unknown;
};

function encode(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

function keyFileName(type: string, id: string): string {
  return `keys/${type}-${id}.json`;
}

async function readAuthFiles(
  userId: string,
  workspaceId: string,
): Promise<Map<string, unknown>> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("whatsapp_session_files")
    .select("file_name,file_data")
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  const files = new Map<string, unknown>(
    ((data ?? []) as StoredAuthFile[]).map((file) => [
      file.file_name,
      file.file_data,
    ]),
  );

  if (!files.has("creds.json")) {
    files.set("creds.json", encode(initAuthCreds()));
    const { error: sessionError } = await client
      .from("whatsapp_sessions")
      .upsert({
        user_id: userId,
        workspace_id: workspaceId,
        status: "disconnected",
      });
    if (sessionError) throw new Error(sessionError.message);
    await saveAuthFile(userId, workspaceId, "creds.json", files.get("creds.json"));
  }

  return files;
}

async function saveAuthFile(
  userId: string,
  workspaceId: string,
  fileName: string,
  fileData: unknown,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("whatsapp_session_files")
    .upsert({
      user_id: userId,
      workspace_id: workspaceId,
      file_name: fileName,
      file_data: fileData,
    });
  if (error) throw new Error(error.message);
}

async function deleteAuthFile(userId: string, fileName: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("whatsapp_session_files")
    .delete()
    .eq("user_id", userId)
    .eq("file_name", fileName);
  if (error) throw new Error(error.message);
}

export async function clearDatabaseAuthState(userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("whatsapp_session_files")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function useDatabaseAuthState(params: {
  userId: string;
  workspaceId: string;
}): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const files = await readAuthFiles(params.userId, params.workspaceId);
  const creds = decode<AuthenticationCreds>(files.get("creds.json"));

  const saveCreds = async () => {
    await saveAuthFile(
      params.userId,
      params.workspaceId,
      "creds.json",
      encode(creds),
    );
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
            const fileData = files.get(keyFileName(String(type), id));
            if (fileData !== undefined) {
              result[id] = decode<SignalDataTypeMap[T]>(fileData);
            }
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const [type, values] of Object.entries(data)) {
            for (const [id, value] of Object.entries(values)) {
              const fileName = keyFileName(type, id);
              if (value === null) {
                files.delete(fileName);
                await deleteAuthFile(params.userId, fileName);
              } else {
                const fileData = encode(value);
                files.set(fileName, fileData);
                await saveAuthFile(
                  params.userId,
                  params.workspaceId,
                  fileName,
                  fileData,
                );
              }
            }
          }
        },
      },
    },
    saveCreds,
  };
}