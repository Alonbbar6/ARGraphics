import { Router, type IRouter } from "express";
import healthRouter from "./health";
import argraphicsRouter from "./argraphics";
import storageRouter from "./storage";
import tableCardsRouter from "./table-cards";
import partnersRouter from "./partners";
import publicV1Router from "./public-v1";
import localStorageRouter from "./local-storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(argraphicsRouter);
router.use(storageRouter);
router.use(tableCardsRouter);
router.use(partnersRouter);
router.use(publicV1Router);
router.use(localStorageRouter);

export default router;
