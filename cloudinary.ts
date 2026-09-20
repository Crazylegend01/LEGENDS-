import type { UploadApiResponse, UploadApiOptions } from "cloudinary";
import { getCloudinary } from "./config";

const MAX_IMAGE_PIXELS = 1920;
const MAX_VIDEO_WIDTH = 1280;
const MAX_VIDEO_HEIGHT = 720;

export type UploadedMedia = {
  secureUrl: string;
  publicId: string;
  resourceType: "image" | "video";
  format: string;
  bytes: number;
  width?: number;
  height?: number;
};

async function uploadBuffer(
  buffer: Buffer,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  const cloudinary = await getCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary did not return an upload result"));
          return;
        }
        resolve(result);
      },
    );
    stream.end(buffer);
  });
}

export async function uploadWhatsAppMedia(params: {
  buffer: Buffer;
  mimeType: string;
  userId: string;
}): Promise<UploadedMedia> {
  const isVideo = params.mimeType.startsWith("video/");
  const resourceType = isVideo ? "video" : "image";
  const options: UploadApiOptions = {
    resource_type: resourceType,
    folder: `knot/media/${params.userId}`,
    use_filename: false,
    unique_filename: true,
    overwrite: false,
    ...(isVideo
      ? {
          format: "mp4",
          transformation: [
            {
              width: MAX_VIDEO_WIDTH,
              height: MAX_VIDEO_HEIGHT,
              crop: "limit",
              quality: "auto:good",
              video_codec: "h264",
              audio_codec: "aac",
              bit_rate: "2m",
            },
          ],
        }
      : {
          format: "jpg",
          transformation: [
            {
              width: MAX_IMAGE_PIXELS,
              height: MAX_IMAGE_PIXELS,
              crop: "limit",
              quality: "auto:good",
              fetch_format: "jpg",
            },
          ],
        }),
  };

  const result = await uploadBuffer(params.buffer, options);
  const transformed = result.eager?.[0];

  return {
    secureUrl: transformed?.secure_url ?? result.secure_url,
    publicId: result.public_id,
    resourceType,
    format: transformed?.format ?? result.format,
    bytes: transformed?.bytes ?? result.bytes,
    width: transformed?.width ?? result.width,
    height: transformed?.height ?? result.height,
  };
}

export async function destroyCloudinaryAsset(
  publicId: string,
  resourceType: "image" | "video",
): Promise<void> {
  const cloudinary = await getCloudinary();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}