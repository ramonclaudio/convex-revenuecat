import { defineApp } from "convex/server";
import revenuecat from "convex-revenuecat/convex.config.js";

const app = defineApp();
app.use(revenuecat);

export default app;
