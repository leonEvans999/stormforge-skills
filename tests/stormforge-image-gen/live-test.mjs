import path from "node:path";
import { main } from "../../skills/stormforge-image-gen/scripts/main.mjs";

if (process.env.STORMFORGE_RUN_LIVE_IMAGE_TESTS !== "1") {
  console.log("Live image test skipped: set STORMFORGE_RUN_LIVE_IMAGE_TESTS=1 to enable it.");
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Live image test requires OPENAI_API_KEY.");
  process.exit(2);
}

const output = path.resolve("outputs", "live-tests", "gpt-image-2-smoke.png");
const { exitCode } = await main([
  "--prompt", "A simple centered blue glass sphere on a neutral light gray background, clean studio lighting, no text",
  "--output", output,
  "--size", "1024x1024",
  "--quality", "low",
  "--overwrite",
  "--no-metadata",
]);
process.exitCode = exitCode;
