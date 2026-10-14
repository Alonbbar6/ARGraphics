import { Router, type IRouter } from "express";
import healthRouter from "./health";
import garnishRouter from "./garnish";

const router: IRouter = Router();

router.use(healthRouter);
router.use(garnishRouter);

export default router;
