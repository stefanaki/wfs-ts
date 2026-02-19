#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const wfs20Path = path.join(repoRoot, "namespaces/wfs20/schemas.opengis.net/wfs/2.0/wfs.xsd");
const wfs11Path = path.join(repoRoot, "namespaces/wfs11/schemas.opengis.net/wfs/1.1.0/wfs.xsd");
const typesPath = path.join(repoRoot, "src/types.ts");

const [wfs20, wfs11, typesSource] = await Promise.all([
  readFile(wfs20Path, "utf8"),
  readFile(wfs11Path, "utf8"),
  readFile(typesPath, "utf8")
]);

const sourceFile = ts.createSourceFile(typesPath, typesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const failures = [];
const passes = [];

const allSome20 = getXsdSimpleTypeEnum(wfs20, "AllSomeType");
const allSome11 = getXsdSimpleTypeEnum(wfs11, "AllSomeType");
const resultType20 = getXsdSimpleTypeEnum(wfs20, "ResultTypeType");
const resultType11 = getXsdSimpleTypeEnum(wfs11, "ResultTypeType");
const resolve20 = getXsdSimpleTypeEnum(wfs20, "ResolveValueType");
const updateAction20 = getXsdSimpleTypeEnum(wfs20, "UpdateActionType");

checkExact(
  "QueryPagingOptions.resultType",
  getInterfacePropertyStringLiterals(sourceFile, "QueryPagingOptions", "resultType"),
  intersectSameValues(resultType20, resultType11),
  "Must match wfs:ResultTypeType in both WFS 1.1 and WFS 2.0"
);

checkExact(
  "GetFeatureWithLockOptions.lockAction",
  getInterfacePropertyStringLiterals(sourceFile, "GetFeatureWithLockOptions", "lockAction"),
  intersectSameValues(allSome20, allSome11),
  "Must match wfs:AllSomeType in both WFS 1.1 and WFS 2.0"
);

checkExact(
  "LockFeatureOptions.lockAction",
  getInterfacePropertyStringLiterals(sourceFile, "LockFeatureOptions", "lockAction"),
  intersectSameValues(allSome20, allSome11),
  "Must match wfs:AllSomeType in both WFS 1.1 and WFS 2.0"
);

checkExact(
  "TransactionOptions.releaseAction",
  getInterfacePropertyStringLiterals(sourceFile, "TransactionOptions", "releaseAction"),
  intersectSameValues(allSome20, allSome11),
  "Must match wfs:AllSomeType in both WFS 1.1 and WFS 2.0"
);

checkExact(
  "ResolveOptions.resolve",
  getInterfacePropertyStringLiterals(sourceFile, "ResolveOptions", "resolve"),
  resolve20,
  "Must match wfs:ResolveValueType in WFS 2.0"
);

checkExact(
  "UpdateProperty.action",
  getInterfacePropertyStringLiterals(sourceFile, "UpdateProperty", "action"),
  updateAction20,
  "Must match wfs:UpdateActionType in WFS 2.0"
);

checkResolveDepthStar();
checkWfsVersionCompatibility();

if (failures.length > 0) {
  console.error("Type-to-XSD coherence validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Type-to-XSD coherence validation passed (${passes.length} checks):`);
for (const pass of passes) {
  console.log(`- ${pass}`);
}

function checkExact(label, actual, expected, context) {
  if (actual.length === 0) {
    failures.push(`${label}: no string literal union values found in TypeScript type.`);
    return;
  }

  const extra = actual.filter((value) => !expected.includes(value));
  const missing = expected.filter((value) => !actual.includes(value));

  if (extra.length > 0 || missing.length > 0) {
    failures.push(
      `${label}: mismatch (${context}). expected=${format(expected)} actual=${format(actual)} missing=${format(missing)} extra=${format(extra)}`
    );
    return;
  }

  passes.push(`${label} = ${format(actual)}`);
}

function checkResolveDepthStar() {
  const values = getInterfacePropertyStringLiterals(sourceFile, "ResolveOptions", "resolveDepth");
  if (!values.includes("*")) {
    failures.push("ResolveOptions.resolveDepth: expected '*' literal to match wfs:positiveIntegerWithStar/wfs:StarStringType.");
    return;
  }
  passes.push("ResolveOptions.resolveDepth includes '*' (wfs:StarStringType).");
}

function checkWfsVersionCompatibility() {
  const values = getTypeAliasStringLiterals(sourceFile, "WfsVersion");
  if (values.length === 0) {
    failures.push("WfsVersion: no string literal union values found.");
    return;
  }

  const invalid = values.filter((value) => value !== "1.1.0" && !/^2\.0\.\d+$/.test(value));
  if (invalid.length > 0) {
    failures.push(
      `WfsVersion: values must be 1.1.0 or match 2.0.x per wfs:VersionStringType pattern. invalid=${format(invalid)}`
    );
    return;
  }

  if (!values.includes("1.1.0")) {
    failures.push("WfsVersion: missing '1.1.0' support.");
    return;
  }

  if (!values.some((value) => /^2\.0\.\d+$/.test(value))) {
    failures.push("WfsVersion: must include at least one 2.0.x value to satisfy WFS 2.0 pattern.");
    return;
  }

  passes.push(`WfsVersion literals are compatible with WFS 1.1 and WFS 2.0 pattern: ${format(values)}.`);
}

function getXsdSimpleTypeEnum(xml, simpleTypeName) {
  const escaped = escapeRegex(simpleTypeName);
  const simpleTypePattern = new RegExp(`<xsd:simpleType\\s+name=\"${escaped}\">([\\s\\S]*?)<\\/xsd:simpleType>`, "m");
  const match = simpleTypePattern.exec(xml);
  if (!match?.[1]) {
    return [];
  }

  const body = match[1];
  const enumPattern = /<xsd:enumeration\s+value="([^"]+)"\s*\/?>/g;
  const values = [];
  let enumMatch;
  while ((enumMatch = enumPattern.exec(body)) !== null) {
    if (enumMatch[1]) {
      values.push(enumMatch[1]);
    }
  }

  return uniqueSorted(values);
}

function getTypeAliasStringLiterals(sf, typeAliasName) {
  let values = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isTypeAliasDeclaration(node)) {
      return;
    }

    if (node.name.text !== typeAliasName) {
      return;
    }

    values = extractStringLiteralsFromTypeNode(node.type);
  });

  return uniqueSorted(values);
}

function getInterfacePropertyStringLiterals(sf, interfaceName, propertyName) {
  let values = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) {
      return;
    }

    for (const member of node.members) {
      if (!ts.isPropertySignature(member)) {
        continue;
      }
      if (!member.name || !ts.isIdentifier(member.name) || member.name.text !== propertyName) {
        continue;
      }
      if (!member.type) {
        continue;
      }
      values = extractStringLiteralsFromTypeNode(member.type);
      break;
    }
  });

  return uniqueSorted(values);
}

function extractStringLiteralsFromTypeNode(typeNode) {
  const values = [];

  const visit = (node) => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      values.push(node.literal.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(typeNode);
  return values;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function intersectSameValues(a, b) {
  return uniqueSorted(a.filter((value) => b.includes(value)));
}

function format(values) {
  return `[${values.join(", ")}]`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
