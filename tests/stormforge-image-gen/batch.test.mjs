import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { executeBatch, loadBatchFile } from "../../skills/stormforge-image-gen/scripts/batch.mjs";
import { atomicWrite, sha256 } from "../../skills/stormforge-image-gen/scripts/utils.mjs";

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,0,0,0,4,0]);

test("batch normalizes aliases, writes state, and resumes verified outputs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-batch-"));
  try {
    const batchPath = path.join(temp, "batch.json");
    await writeFile(batchPath, JSON.stringify({ version: 1, jobs: 2, defaults: { size: "1024x1024" }, tasks: [
      { id: "one", prompt: "one", image: "one.png" },
      { id: "two", prompt: "two", output: "two.png" },
    ] }));
    const batch = await loadBatchFile(batchPath);
    assert.equal(batch.statePath, path.join(temp, "batch.results.json"));
    assert.equal(batch.tasks[0].output, path.join(temp, "one.png"));
    let calls = 0;
    const runTask = async (task) => {
      calls += 1;
      await atomicWrite(task.output, png);
      return { status: "succeeded", outputs: [{ path: task.output, sha256: await sha256(png) }] };
    };
    const first = await executeBatch(batch, { globalConfig: { jobs: 2, startIntervalMs: 0 }, cli: { jobs: 2, startIntervalMs: 0 }, runTask });
    assert.equal(first.succeeded, 2);
    assert.equal(calls, 2);
    const second = await executeBatch(batch, { globalConfig: { jobs: 2, startIntervalMs: 0 }, cli: { resume: true, jobs: 2, startIntervalMs: 0 }, runTask: async () => { throw new Error("must not run"); } });
    assert.equal(second.succeeded, 2);
    assert.equal(second.results.filter((item) => item.status === "skipped").length, 2);
    const state = JSON.parse(await readFile(batch.statePath, "utf8"));
    assert.equal(Object.keys(state.tasks).length, 2);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("batch rejects duplicate IDs and output collisions", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-batch-collision-"));
  try {
    const duplicate = path.join(temp, "duplicate.json");
    await writeFile(duplicate, JSON.stringify({ tasks: [
      { id: "same", prompt: "a", output: "a.png" },
      { id: "same", prompt: "b", output: "b.png" },
    ] }));
    await assert.rejects(() => loadBatchFile(duplicate), /Duplicate batch task id/);
    const collision = path.join(temp, "collision.json");
    await writeFile(collision, JSON.stringify({ tasks: [
      { prompt: "a", output: "same.png" },
      { prompt: "b", image: "same.png" },
    ] }));
    await assert.rejects(() => loadBatchFile(collision), /output collision/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("dry-run validates batch without writing state", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-batch-dry-"));
  try {
    const batchPath = path.join(temp, "dry.json");
    await writeFile(batchPath, JSON.stringify({ tasks: [{ prompt: "dry", output: "dry.png" }] }));
    const batch = await loadBatchFile(batchPath);
    const result = await executeBatch(batch, { globalConfig: { jobs: 1, startIntervalMs: 0 }, cli: { dryRun: true, jobs: 1, startIntervalMs: 0 }, runTask: async () => ({ status: "validated" }) });
    assert.equal(result.succeeded, 1);
    assert.equal(result.statePath, undefined);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("batch continues independent tasks after one task fails", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "stormforge-batch-failure-"));
  try {
    const batchPath = path.join(temp, "failure.json");
    await writeFile(batchPath, JSON.stringify({ tasks: [
      { id: "good", prompt: "good", output: "good.png" },
      { id: "bad", prompt: "bad", output: "bad.png" },
    ] }));
    const batch = await loadBatchFile(batchPath);
    const calls = [];
    const result = await executeBatch(batch, {
      globalConfig: { jobs: 2, startIntervalMs: 0 },
      cli: { jobs: 2, startIntervalMs: 0 },
      runTask: async (task) => {
        calls.push(task.id);
        if (task.id === "bad") throw new Error("simulated failure");
        await atomicWrite(task.output, png);
        return { status: "succeeded", outputs: [{ path: task.output, sha256: await sha256(png) }] };
      },
    });
    assert.deepEqual(calls.sort(), ["bad", "good"]);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    const state = JSON.parse(await readFile(batch.statePath, "utf8"));
    assert.equal(state.tasks.good.status, "succeeded");
    assert.equal(state.tasks.bad.status, "failed");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
