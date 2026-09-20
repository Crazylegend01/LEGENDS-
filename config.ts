function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseConfig() {
  return {
    url: requiredEnv("SUPABASE_URL"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

let cloudinaryClient: typeof import("cloudinary").v2 | undefined;

export async function getCloudinary(): Promise<typeof import("cloudinary").v2> {
  let cloudinaryUrl = requiredEnv("CLOUDINARY_URL")
    .replace(/^CLOUDINARY_URL=/i, "")
    .trim();
  if (
    (cloudinaryUrl.startsWith('"') && cloudinaryUrl.endsWith('"')) ||
    (cloudinaryUrl.startsWith("'") && cloudinaryUrl.endsWith("'"))
  ) {
    cloudinaryUrl = cloudinaryUrl.slice(1, -1);
  }
  if (!cloudinaryUrl.startsWith("cloudinary://")) {
    throw new Error(
      "CLOUDINARY_URL must be a Cloudinary URL beginning with cloudinary://",
    );
  }
  if (!cloudinaryClient) {
    const { v2 } = await import("cloudinary");
    v2.config({ cloudinary_url: cloudinaryUrl });
    cloudinaryClient = v2;
  }
  return cloudinaryClient;
}

export function hasBackendConfiguration(): boolean {
  return Boolean(
    process.env["SUPABASE_URL"] &&
      process.env["SUPABASE_SERVICE_ROLE_KEY"] &&
      process.env["CLOUDINARY_URL"],
  );
}