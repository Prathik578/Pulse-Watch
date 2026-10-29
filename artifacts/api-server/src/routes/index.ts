import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import incidentsRouter from "./incidents";
import monitorsRouter from "./monitors";
import {
  publicStatusRouter,
  statusSettingsRouter,
} from "./status-pages";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicStatusRouter);
router.use(requireAuth);
router.use(dashboardRouter);
router.use(monitorsRouter);
router.use(incidentsRouter);
router.use(statusSettingsRouter);

export default router;
