import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mediaRouter from "./media";
import uploadUiRouter from "./upload-ui";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mediaRouter);
router.use(whatsappRouter);
router.use(uploadUiRouter);

export default router;
