import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolveGlobalConfig, validateTaskConfig } from "../../skills/stormforge-image-gen/scripts/config.mjs";

test("configuration loads preferences and higher-priority environment values", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-config-"));
  const home = path.join(temp, "home");
  const project = path.join(temp, "project");
  try {
    await mkdir(path.join(home, ".stormforge-skills"), { recursive: true });
    await mkdir(path.join(project, ".stormforge-skills"), { recursive: true });
    await writeFile(path.join(home, ".stormforge-skills", "image-gen.json"), JSON.stringify({ size: "1024x1024", quality: "low" }));
    await writeFile(path.join(project, ".stormforge-skills", "image-gen.json"), JSON.stringify({ quality: "medium" }));
    await writeFile(path.join(project, ".stormforge-skills", ".env"), "OPENAI_BASE_URL=http://project.example/v1\n");
    const config = await resolveGlobalConfig({}, { cwd: project, homeDir: home, env: { OPENAI_API_KEY: "env-key", OPENAI_IMAGE_MODEL: "custom-image" } });
    assert.equal(config.baseUrl, "http://project.example/v1");
    assert.equal(config.model, "custom-image");
    assert.equal(config.size, "1024x1024");
    assert.equal(config.quality, "medium");
    assert.equal(config.apiKey, "env-key");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("credential-like preference fields are rejected", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-config-secret-"));
  const home = path.join(temp, "home");
  const project = path.join(temp, "project");
  try {
    await mkdir(path.join(project, ".stormforge-skills"), { recursive: true });
    await writeFile(path.join(project, ".stormforge-skills", "image-gen.json"), JSON.stringify({ apiKey: "do-not-allow" }));
    await assert.rejects(() => resolveGlobalConfig({}, { cwd: project, homeDir: home, env: {} }), /Credential-like field/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("transparent background is rejected for gpt-image-2", () => {
  assert.throws(() => validateTaskConfig({ apiKey: "x", baseUrl: "http://localhost", model: "gpt-image-2", output: "x.png", background: "transparent" }), /does not support transparent/);
});
