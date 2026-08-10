import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { normalizeCliArgs, parseArgs } from "../../skills/stormforge-image-gen/scripts/arguments.mjs";
import { mergeGenerationLayers, sizeFromAspectRatio, validateGptImage2Size, validateTaskConfig } from "../../skills/stormforge-image-gen/scripts/config.mjs";
import { loadImageInputs, loadMask } from "../../skills/stormforge-image-gen/scripts/image-input.mjs";
import { buildGenerationRequest, isRetryable, retryDelayMs } from "../../skills/stormforge-image-gen/scripts/image-api.mjs";

function fakePng(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from("IHDR").copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("CLI compatibility aliases normalize and conflicting aliases fail", () => {
  const parsed = normalizeCliArgs(parseArgs(["--prompt", "x", "--image", "out.png", "--tool-size", "1024x1024", "--tool-quality", "low", "--count", "2"]));
  assert.equal(parsed.output, "out.png");
  assert.equal(parsed.size, "1024x1024");
  assert.equal(parsed.quality, "low");
  assert.equal(parsed.count, "2");
  assert.throws(() => normalizeCliArgs(parseArgs(["--prompt", "x", "--output", "a.png", "--image", "b.png"])), /Conflicting values/);
});

test("gpt-image-2 exact size and aspect-ratio rules", () => {
  assert.equal(validateGptImage2Size("2048x1152"), "2048x1152");
  assert.equal(sizeFromAspectRatio("16:9", "2k"), "2048x1152");
  assert.equal(sizeFromAspectRatio("9:16", "4k"), "2160x3840");
  assert.doesNotThrow(() => validateGptImage2Size(sizeFromAspectRatio("1:3", "1k")));
  assert.doesNotThrow(() => validateGptImage2Size(sizeFromAspectRatio("3:4", "4k")));
  assert.throws(() => validateGptImage2Size("160x160"), /at least 655,360/);
  assert.throws(() => validateGptImage2Size("2048x1150"), /multiples of 16/);
});

test("higher-priority aspect ratio clears inherited exact size", () => {
  const merged = mergeGenerationLayers({ size: "1024x1024", quality: "medium" }, { ar: "16:9", resolution: "2k" });
  assert.equal(merged.size, undefined);
  const config = validateTaskConfig({ ...merged, apiKey: "test", baseUrl: "http://localhost", model: "gpt-image-2", output: "out.png" });
  assert.equal(config.size, "2048x1152");
});

test("raw Base64, data URLs, file images, and matching masks load safely", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-image-input-"));
  try {
    const bytes = Buffer.concat([fakePng(32, 48), Buffer.from([0xff, 0xff, 0xff])]);
    assert.match(bytes.toString("base64"), /\//);
    const imagePath = path.join(temp, "input.png");
    const maskPath = path.join(temp, "mask.png");
    await writeFile(imagePath, bytes);
    await writeFile(maskPath, bytes);
    const inputs = await loadImageInputs([imagePath, bytes.toString("base64"), `data:image/png;base64,${bytes.toString("base64")}`]);
    assert.equal(inputs.length, 3);
    assert.deepEqual(inputs[0].dimensions, { width: 32, height: 48 });
    const mask = await loadMask(maskPath, [inputs[0]]);
    assert.equal(mask.mime, "image/png");
    await assert.rejects(() => loadImageInputs(["https://example.com/image.png"]), /Remote image URLs/);
    await assert.rejects(() => loadImageInputs(["not base64!!"]), /Invalid image Base64/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("generation payload uses Images API field names", () => {
  const body = buildGenerationRequest({ model: "gpt-image-2", prompt: "hello", size: "1024x1024", quality: "high", format: "webp", compression: 80, background: "auto", moderation: "auto", count: 2 });
  assert.deepEqual(body, { model: "gpt-image-2", prompt: "hello", size: "1024x1024", quality: "high", background: "auto", output_format: "webp", output_compression: 80, moderation: "auto", n: 2 });
});

test("retry classification and Retry-After delay", () => {
  assert.equal(isRetryable({ status: 429, retryable: true }), true);
  assert.equal(isRetryable({ status: 400, retryable: false }), false);
  assert.equal(retryDelayMs(1, { retryAfterMs: 1200 }), 1200);
});
