import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { main } from "../../skills/stormforge-image-gen/scripts/main.mjs";

function fakePng(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from("IHDR").copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

const silentLogger = { info() {}, verbose() {}, debug() {}, warn() {}, error() {} };

test("text generation sends JSON and preserves returned Base64 bytes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-images-api-"));
  const png = fakePng(2048, 1152);
  let requestBody;
  const { server, baseUrl } = await listen((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks));
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "req-test" });
      response.end(JSON.stringify({ data: [{ b64_json: png.toString("base64"), revised_prompt: "refined" }] }));
    });
  });
  try {
    const output = path.join(temp, "out.png");
    const result = await main(["--prompt", "test", "--output", output, "--base-url", baseUrl, "--api-key", "test", "--model", "gpt-image-2"], { logger: silentLogger, cwd: temp, env: {} });
    assert.equal(result.exitCode, 0);
    assert.equal(requestBody.output_format, "png");
    assert.equal(requestBody.size, "2048x1152");
    assert.equal(requestBody.n, 1);
    assert.deepEqual(await readFile(output), png);
    const metadata = JSON.parse(await readFile(`${output}.json`, "utf8"));
    assert.equal(metadata.requestIds["x-request-id"], "req-test");
    assert.equal(metadata.outputs[0].revisedPrompt, "refined");
    assert.equal(JSON.stringify(metadata).includes(png.toString("base64")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});

test("reference editing sends multipart image[] and supports URL responses", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-images-edit-"));
  const input = fakePng(64, 64);
  const outputPng = fakePng(1024, 1024);
  const inputPath = path.join(temp, "input.png");
  await writeFile(inputPath, input);
  let multipart = "";
  const { server, baseUrl } = await listen((request, response) => {
    if (request.url === "/asset.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(outputPng);
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      multipart = Buffer.concat(chunks).toString("latin1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ url: `${baseUrl.replace(/\/v1$/, "")}/asset.png` }] }));
    });
  });
  try {
    const output = path.join(temp, "edit.png");
    const result = await main(["--prompt", "edit", "--input-image", inputPath, "--output", output, "--size", "1024x1024", "--base-url", baseUrl, "--api-key", "test"], { logger: silentLogger, cwd: temp, env: {} });
    assert.equal(result.exitCode, 0);
    assert.match(multipart, /name="image\[\]"/);
    assert.match(multipart, /name="prompt"/);
    assert.deepEqual(await readFile(output), outputPng);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});

test("auto n strategy falls back only when relay explicitly rejects n", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-images-n-"));
  const png = fakePng(1024, 1024);
  const counts = [];
  const { server, baseUrl } = await listen((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks));
      counts.push(body.n);
      if (body.n > 1) {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "n is not supported; n must be 1" } }));
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
      }
    });
  });
  try {
    const output = path.join(temp, "concept.png");
    const result = await main(["--prompt", "two", "--output", output, "--size", "1024x1024", "--n", "2", "--base-url", baseUrl, "--api-key", "test"], { logger: silentLogger, cwd: temp, env: {} });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(counts, [2, 1, 1]);
    assert.equal(result.result.outputs.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});

test("strict-size preserves a mismatched response under a diagnostic filename and fails", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-images-size-"));
  const returned = fakePng(1024, 1024);
  const { server, baseUrl } = await listen((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: returned.toString("base64") }] }));
    });
  });
  try {
    const output = path.join(temp, "strict.png");
    const result = await main([
      "--prompt", "size check", "--output", output, "--size", "2048x1152",
      "--strict-size", "--base-url", baseUrl, "--api-key", "test",
    ], { logger: silentLogger, cwd: temp, env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.error.message, /size did not match/);
    assert.deepEqual(await readFile(path.join(temp, "strict.size-mismatch.png")), returned);
    const metadata = JSON.parse(await readFile(`${output}.json`, "utf8"));
    assert.equal(metadata.outputs[0].dimensions.width, 1024);
    assert.match(metadata.warnings[0], /2048x1152/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
