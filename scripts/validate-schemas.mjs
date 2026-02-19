#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const namespacesDir = path.join(repoRoot, "namespaces");

const validationRoots = [
  path.join(namespacesDir, "wfs20"),
  path.join(namespacesDir, "wfs11")
];
const existingRoots = [];
for (const root of validationRoots) {
  if (await fileExists(root)) {
    existingRoots.push(root);
  }
}
if (existingRoots.length === 0) {
  existingRoots.push(namespacesDir);
}

const files = (
  await Promise.all(existingRoots.map((root) => listXsdFiles(root)))
).flat();
const missing = [];

for (const file of files) {
  const body = await readFile(file, "utf8");
  const references = extractSchemaLocations(body);
  for (const schemaLocation of references) {
    if (!schemaLocation || schemaLocation.startsWith("http://") || schemaLocation.startsWith("https://")) {
      continue;
    }

    const resolved = path.resolve(path.dirname(file), schemaLocation);
    if (!(await fileExists(resolved))) {
      missing.push({
        file,
        schemaLocation,
        resolved
      });
    }
  }
}

if (missing.length > 0) {
  console.error(`Found ${missing.length} unresolved local schema references:`);
  for (const item of missing) {
    console.error(`- ${path.relative(repoRoot, item.file)} -> ${item.schemaLocation} (missing: ${path.relative(repoRoot, item.resolved)})`);
  }
  process.exit(1);
}

console.log(`Validated ${files.length} XSD files. All local schemaLocation references resolve.`);

async function listXsdFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listXsdFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".xsd")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractSchemaLocations(xml) {
  const pattern = /schemaLocation\s*=\s*"([^"]+)"/g;
  const found = [];
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    if (match[1]) {
      found.push(match[1]);
    }
  }
  return found;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
