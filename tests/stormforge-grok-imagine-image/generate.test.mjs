import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { main, parseGrokConfig } from "../../skills/stormforge-grok-imagine-image/scripts/generate.mjs";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");

test("parses Grok model table and default selection", () => {
  const parsed = parseGrokConfig('[models]\ndefault = "grok-4.5"\n[model."grok-4.5"]\nmodel = "xai/grok-imagine-image"\nbase_url = "https://example.test/v1"\napi_key = "secret"');
  assert.equal(parsed.selected, "grok-4.5");
  assert.equal(parsed.base_url, "https://example.test/v1");
});

test("generates from local config and does not write the API key to metadata", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stormforge-grok-"));
  let requestBody; let auth;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks)); auth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const config = path.join(dir, "config.toml");
  await writeFile(config, `[models]\ndefault = "grok"\n[model."grok"]\nbase_url = "http://127.0.0.1:${port}/v1"\napi_key = "test-secret"\n`);
  try {
    const output = path.join(dir, "image.png");
    const result = await main(["--prompt", "test image", "--output", output, "--config", config, "--size", "1024x1024"]);
    assert.equal(result.status, "succeeded");
    assert.equal(requestBody.model, "xai/grok-imagine-image");
    assert.equal(requestBody.prompt, "test image");
    assert.equal(requestBody.aspect_ratio, "1:1");
    assert.equal(requestBody.resolution, "1k");
    assert.equal("size" in requestBody, false);
    assert.equal(auth, "Bearer test-secret");
    assert.deepEqual(await readFile(output), png);
    const metadata = await readFile(`${output}.json`, "utf8");
    assert.equal(metadata.includes("test-secret"), false);
    assert.equal(metadata.includes(png.toString("base64")), false);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
