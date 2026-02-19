#!/usr/bin/env node
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const namespacesDir = path.join(repoRoot, "namespaces");

const targets = [
  {
    name: "wfs20",
    outDir: path.join(namespacesDir, "wfs20"),
    roots: [
      "https://schemas.opengis.net/wfs/2.0/wfs.xsd",
      "https://schemas.opengis.net/filter/2.0/filterAll.xsd",
      "https://schemas.opengis.net/ows/1.1.0/owsAll.xsd",
      "https://schemas.opengis.net/gml/3.2.1/gml.xsd"
    ]
  },
  {
    name: "wfs11",
    outDir: path.join(namespacesDir, "wfs11"),
    roots: [
      "https://schemas.opengis.net/wfs/1.1.0/wfs.xsd",
      "https://schemas.opengis.net/filter/1.1.0/filter.xsd",
      "https://schemas.opengis.net/gml/3.1.1/base/gml.xsd"
    ]
  }
];

const visited = new Set();

await Promise.all(targets.map((target) => syncTarget(target)));
console.log("Schema sync completed.");

async function syncTarget(target) {
  await mkdir(target.outDir, { recursive: true });
  for (const rootUrl of target.roots) {
    await crawlSchema(rootUrl, target.outDir);
  }
}

async function crawlSchema(url, outDir) {
  const key = `${outDir}::${url}`;
  if (visited.has(key)) {
    return;
  }
  visited.add(key);

  if (!shouldDownload(url)) {
    return;
  }

  const body = await fetchText(url);
  if (!body) {
    return;
  }

  const outputFile = toOutputPath(url, outDir);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, body, "utf8");

  const locations = extractSchemaLocations(body);
  for (const schemaLocation of locations) {
    const resolved = resolveSchemaLocation(url, schemaLocation);
    if (!resolved || !shouldDownload(resolved)) {
      continue;
    }
    await crawlSchema(resolved, outDir);
  }
}

function toOutputPath(url, outDir) {
  const parsed = new URL(url);
  const cleanPath = parsed.pathname.replace(/^\/+/, "");
  return path.join(outDir, parsed.hostname, cleanPath);
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

function resolveSchemaLocation(baseUrl, location) {
  if (!location) {
    return undefined;
  }

  if (location.startsWith("http://") || location.startsWith("https://")) {
    return location.replace(/^http:\/\//, "https://");
  }

  try {
    const resolved = new URL(location, baseUrl);
    resolved.protocol = "https:";
    return resolved.toString();
  } catch {
    return undefined;
  }
}

function shouldDownload(url) {
  if (!url.endsWith(".xsd")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return ["schemas.opengis.net", "www.w3.org"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "wfs-ts-schema-sync"
      }
    });

    if (!response.ok) {
      console.warn(`Failed to fetch ${url}: ${response.status}`);
      return undefined;
    }

    return await response.text();
  } catch (error) {
    console.warn(`Failed to fetch ${url}: ${String(error)}`);
    return undefined;
  }
}
