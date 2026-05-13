import { runPipeline } from "../pipeline/run.mjs";

runPipeline().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
