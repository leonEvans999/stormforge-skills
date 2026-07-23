import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skillsDir = path.join(root, 'skills');

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) data[item[1]] = item[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return data;
}

const errors = [];
const warnings = [];

if (!existsSync(skillsDir)) {
  errors.push('Missing skills/ directory.');
} else {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  if (skillDirs.length === 0) {
    errors.push('No skill directories found in skills/.');
  }

  for (const skillName of skillDirs) {
    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(`${skillName}: missing SKILL.md`);
      continue;
    }

    const text = await readFile(skillPath, 'utf8');
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter) {
      errors.push(`${skillName}: SKILL.md missing YAML frontmatter`);
      continue;
    }

    if (!frontmatter.name) errors.push(`${skillName}: frontmatter missing name`);
    if (!frontmatter.description) errors.push(`${skillName}: frontmatter missing description`);
    if (frontmatter.name && frontmatter.name !== skillName) {
      warnings.push(`${skillName}: frontmatter name is "${frontmatter.name}"; expected "${skillName}"`);
    }
    if (frontmatter.description && frontmatter.description.length < 40) {
      warnings.push(`${skillName}: description is very short; skill triggering may be weak`);
    }
  }
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Skill validation passed.');
