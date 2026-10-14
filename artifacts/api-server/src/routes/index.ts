import { Router, type IRouter } from "express";
import healthRouter from "./health";
import garnishRouter from "./garnish";
import storageRouter from "./storage";
import tableCardsRouter from "./table-cards";

const router: IRouter = Router();

router.use(healthRouter);
router.use(garnishRouter);
router.use(storageRouter);
router.use(tableCardsRouter);

export default router;
