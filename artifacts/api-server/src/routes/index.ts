import { Router, type IRouter } from "express";
import healthRouter from "./health";
import garnishRouter from "./garnish";
import storageRouter from "./storage";
import tableCardsRouter from "./table-cards";
import partnersRouter from "./partners";
import publicV1Router from "./public-v1";

const router: IRouter = Router();

router.use(healthRouter);
router.use(garnishRouter);
router.use(storageRouter);
router.use(tableCardsRouter);
router.use(partnersRouter);
router.use(publicV1Router);

export default router;
