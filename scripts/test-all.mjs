import './validate-skills.mjs';

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const generateScript = path.join(process.cwd(), 'skills', 'stormforge-responses-image-gen', 'scripts', 'generate.mjs');

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd() });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) => resolve({
      status: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

const invalidQuality = spawnSync(process.execPath, [
  generateScript,
  '--prompt', 'test',
  '--image', 'outputs/test.png',
  '--model', 'test-model',
  '--base-url', 'http://127.0.0.1',
  '--api-key', 'test-key',
  '--tool-quality', 'ultra',
], { encoding: 'utf8' });

if (invalidQuality.status !== 1 || !invalidQuality.stderr.includes('Invalid tool quality: ultra')) {
  console.error('Quality argument validation failed.');
  process.exit(1);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'stormforge-responses-image-gen-'));
const fixturePath = path.join(tempDir, 'reference.png');
const outputPath = path.join(tempDir, 'output.png');
const overrideOutputPath = path.join(tempDir, 'override.png');
const fixtureBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
await writeFile(fixturePath, fixtureBytes);

const requestBodies = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const responseBody = {
      output: [{
        type: 'image_generation_call',
        revised_prompt: 'A refined visual design brief.',
        result: `data:image/png;base64,${fixtureBytes.toString('base64')}`,
      }],
    };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(responseBody));
  });
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const withInputImage = await runNode([
    generateScript,
    '--prompt', 'Create a polished variation.',
    '--input-image', fixturePath,
    '--input-image', fixtureBytes.toString('base64'),
    '--image', outputPath,
    '--model', 'test-model',
    '--base-url', baseUrl,
    '--api-key', 'test-key',
  ]);

  if (withInputImage.status !== 0) {
    console.error('Base64 input-image integration test failed.');
    console.error(withInputImage.stdout);
    console.error(withInputImage.stderr);
    process.exit(1);
  }

  const requestBody = requestBodies[0];
  const content = requestBody?.input?.[0]?.content;
  const inputImages = content?.filter((item) => item?.type === 'input_image');
  const expectedDataUrl = `data:image/png;base64,${fixtureBytes.toString('base64')}`;
  const tool = requestBody?.tools?.[0];
  if (
    !Array.isArray(requestBody?.input) ||
    content?.[0]?.type !== 'input_text' ||
    content?.[0]?.text !== 'Create a polished variation.' ||
    inputImages?.length !== 2 ||
    inputImages.some((item) => item.image_url !== expectedDataUrl) ||
    tool?.type !== 'image_generation' ||
    tool?.model !== undefined ||
    tool?.size !== '2048x1152' ||
    tool?.quality !== 'high'
  ) {
    console.error('Default request shape was incorrect.');
    process.exit(1);
  }

  const outputBytes = await readFile(outputPath);
  if (!outputBytes.equals(fixtureBytes)) {
    console.error('Generated output was not written correctly.');
    process.exit(1);
  }

  const metadata = JSON.parse(await readFile(`${outputPath}.json`, 'utf8'));
  if (
    metadata.revised_prompt !== 'A refined visual design brief.' ||
    metadata.tool_model !== null ||
    metadata.quality !== 'high' ||
    metadata.size !== '2048x1152' ||
    JSON.stringify(metadata).includes(fixtureBytes.toString('base64'))
  ) {
    console.error('Generation metadata was incorrect or leaked image data.');
    process.exit(1);
  }

  const override = await runNode([
    generateScript,
    '--prompt', 'Override defaults.',
    '--image', overrideOutputPath,
    '--model', 'test-model',
    '--tool-model', 'relay-image-model',
    '--tool-size', '1024x1024',
    '--tool-quality', 'low',
    '--no-metadata',
    '--base-url', baseUrl,
    '--api-key', 'test-key',
  ]);

  if (override.status !== 0) {
    console.error('Explicit tool override integration test failed.');
    console.error(override.stdout);
    console.error(override.stderr);
    process.exit(1);
  }

  const overrideTool = requestBodies[1]?.tools?.[0];
  const overrideMetadataExists = await access(`${overrideOutputPath}.json`).then(() => true, () => false);
  if (
    overrideTool?.model !== 'relay-image-model' ||
    overrideTool?.size !== '1024x1024' ||
    overrideTool?.quality !== 'low' ||
    await readFile(overrideOutputPath).then((bytes) => !bytes.equals(fixtureBytes)) ||
    overrideMetadataExists
  ) {
    console.error('Explicit tool override request shape was incorrect.');
    process.exit(1);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Script defaults, overrides, metadata, file input-image, and direct Base64 input-image tests passed.');
