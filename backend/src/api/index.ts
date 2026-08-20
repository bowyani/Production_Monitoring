import { Router } from "express";
import { machinesRouter } from "./machines";
import { jobsRouter } from "./jobs";
import { alarmsRouter } from "./alarms";
import { adminRouter } from "./admin";
import { kpiRouter } from "./kpi";
import { systemRouter } from "./system";
import { importRouter } from "./import";

export const apiV1Router = Router();

apiV1Router.use(machinesRouter);
apiV1Router.use(jobsRouter);
apiV1Router.use(alarmsRouter);
apiV1Router.use(adminRouter);
apiV1Router.use(kpiRouter);
apiV1Router.use(systemRouter);
apiV1Router.use(importRouter);
