import './validate-skills.mjs';

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const generateScript = path.join(process.cwd(), 'skills', 'stormforge-responses-image-gen', 'scripts', 'generate.mjs');
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

console.log('Script argument validation passed.');
