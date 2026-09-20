import app from "./app";
import { logger } from "./lib/logger";
import { hasBackendConfiguration } from "./lib/config";
import { startWhatsAppWorker } from "./lib/whatsapp";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (hasBackendConfiguration()) {
  startWhatsAppWorker();
} else {
  logger.warn(
    "Media upload and WhatsApp worker routes are disabled until Supabase and Cloudinary environment variables are configured",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
