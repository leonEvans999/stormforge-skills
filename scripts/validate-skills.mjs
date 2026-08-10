import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const skillsDir = path.join(root, "skills");
const errors = [];
const warnings = [];

function parseFrontmatter(text) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) data[item[1]] = item[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return data;
}

async function collectFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full));
    else files.push(full);
  }
  return files;
}

if (!existsSync(skillsDir)) errors.push("Missing skills/ directory.");
else {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!skillDirs.length) errors.push("No skill directories found in skills/.");
  for (const skillName of skillDirs) {
    if (!skillName.startsWith("stormforge-")) errors.push(`${skillName}: skill names must start with stormforge-`);
    const skillRoot = path.join(skillsDir, skillName);
    const skillPath = path.join(skillRoot, "SKILL.md");
    const agentPath = path.join(skillRoot, "agents", "openai.yaml");
    if (!existsSync(skillPath)) { errors.push(`${skillName}: missing SKILL.md`); continue; }
    if (!existsSync(agentPath)) errors.push(`${skillName}: missing agents/openai.yaml`);
    const text = await readFile(skillPath, "utf8");
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter) { errors.push(`${skillName}: SKILL.md missing YAML frontmatter`); continue; }
    if (!frontmatter.name) errors.push(`${skillName}: frontmatter missing name`);
    if (!frontmatter.description) errors.push(`${skillName}: frontmatter missing description`);
    if (frontmatter.name && frontmatter.name !== skillName) errors.push(`${skillName}: frontmatter name is ${frontmatter.name}; expected ${skillName}`);
    if (frontmatter.name && !frontmatter.name.startsWith("stormforge-")) errors.push(`${skillName}: frontmatter name must start with stormforge-`);
    if (frontmatter.description && frontmatter.description.length < 40) warnings.push(`${skillName}: description is very short; skill triggering may be weak`);
  }
}

const docsDir = path.join(root, "docs");
if (existsSync(docsDir)) {
  for (const file of await collectFiles(docsDir)) {
    if (!/\.(md|mdx|txt)$/i.test(file)) continue;
    const text = await readFile(file, "utf8");
    if (/[\u3400-\u9fff]/u.test(text)) errors.push(`${path.relative(root, file)}: docs must remain English-only`);
  }
}

for (const readme of ["README.md", "README.zh.md"]) if (!existsSync(path.join(root, readme))) errors.push(`Missing ${readme}`);
const readme = existsSync(path.join(root, "README.md")) ? await readFile(path.join(root, "README.md"), "utf8") : "";
const readmeZh = existsSync(path.join(root, "README.zh.md")) ? await readFile(path.join(root, "README.zh.md"), "utf8") : "";
if ((readme && !readme.includes("stormforge-image-gen")) || (readmeZh && !readmeZh.includes("stormforge-image-gen"))) errors.push("README files must list stormforge-image-gen");
if ((readme && !readme.includes("stormforge-responses-image-gen")) || (readmeZh && !readmeZh.includes("stormforge-responses-image-gen"))) errors.push("README files must list stormforge-responses-image-gen");
if ((readme.match(/^## /gm) || []).length !== (readmeZh.match(/^## /gm) || []).length) errors.push("README.md and README.zh.md must have matching section counts");

for (const file of await collectFiles(root)) {
  const relative = path.relative(root, file);
  if (relative.startsWith(".git")) continue;
  if (relative.startsWith(`outputs${path.sep}`)) continue;
  if (!/\.(md|mjs|json|yaml|yml|ps1|txt)$/i.test(file)) continue;
  const text = await readFile(file, "utf8");
  if (/sk-[A-Za-z0-9]{20,}/.test(text) || /Bearer\s+[A-Za-z0-9._-]{20,}/i.test(text)) errors.push(`${relative}: possible credential found`);
}

try {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer" }).toString("utf8").split("\0").filter(Boolean);
  for (const file of tracked) {
    const normalized = file.replaceAll("\\", "/");
    if ((normalized.startsWith("outputs/") || normalized === ".env" || normalized.startsWith(".env.") || normalized.endsWith("/.env")) && !normalized.endsWith(".env.example")) {
      errors.push(`${file}: generated output or environment file must not be tracked`);
    }
  }
} catch { warnings.push("Unable to inspect Git tracked files for generated outputs."); }

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) { for (const error of errors) console.error(`ERROR: ${error}`); process.exit(1); }
const count = existsSync(skillsDir) ? (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length : 0;
console.log(`Skill validation passed (${count} skills).`);
