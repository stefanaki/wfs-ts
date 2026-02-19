import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  Position
} from "geojson";
import type { AxisOrderStrategy, GetFeatureWithLockResult } from "../types";
import {
  asArray,
  pickFirst
} from "../utils/xml";
import {
  collectNodesByLocalName,
  getNodeByLocalName,
  localName,
  maybeSwap,
  parseNumbers,
  parseXml,
  valueText
} from "./helpers";

interface ParseFeatureCollectionOptions {
  axisOrderStrategy: AxisOrderStrategy;
}

export function parseFeatureCollection(
  payload: unknown,
  options: ParseFeatureCollectionOptions
): GetFeatureWithLockResult<Geometry | null, GeoJsonProperties> {
  if (isGeoJsonFeatureCollection(payload)) {
    return payload;
  }

  if (typeof payload !== "string") {
    return emptyFeatureCollection();
  }

  const parsed = parseXml(payload);
  const fcNode =
    getNodeByLocalName(parsed, "FeatureCollection") ??
    getNodeByLocalName(parsed, "SimpleFeatureCollection");

  if (!fcNode) {
    return emptyFeatureCollection();
  }

  const members = [
    ...collectNodesByLocalName(fcNode, "member"),
    ...collectNodesByLocalName(fcNode, "featureMember"),
    ...flattenFeatureMembersContainers(
      collectNodesByLocalName(fcNode, "featureMembers")
    )
  ];

  const features = members
    .map((member) => parseMemberToFeature(member, options.axisOrderStrategy))
    .filter(
      (feature): feature is Feature<Geometry | null, GeoJsonProperties> =>
        !!feature
    );

  const result: GetFeatureWithLockResult<Geometry | null, GeoJsonProperties> = {
    type: "FeatureCollection",
    features
  };

  const lockId = pickFirst(
    valueText((fcNode as Record<string, unknown>)["@_lockId"]),
    valueText((fcNode as Record<string, unknown>)["@_lockid"])
  );

  if (lockId) {
    result.lockId = lockId;
  }

  return result;
}

function parseMemberToFeature(
  member: Record<string, unknown>,
  axisOrderStrategy: AxisOrderStrategy
): Feature<Geometry | null, GeoJsonProperties> | undefined {
  const featureContainer = unwrapFeatureContainer(member);
  if (!featureContainer) {
    return undefined;
  }

  const record = featureContainer as Record<string, unknown>;
  const id =
    (record["@_gml:id"] as string | undefined) ??
    (record["@_fid"] as string | undefined) ??
    (record["@_id"] as string | undefined);

  const properties: GeoJsonProperties = {};
  let geometry: Geometry | null = null;

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_")) {
      continue;
    }

    const propName = localName(key);
    const geom = parseGeometryDeep(value, axisOrderStrategy);
    if (geom && !geometry) {
      geometry = geom;
      continue;
    }

    properties[propName] = normalizeValue(value);
  }

  return {
    type: "Feature",
    id,
    geometry,
    properties
  };
}

function unwrapFeatureContainer(member: unknown): unknown {
  if (!member || typeof member !== "object") {
    return undefined;
  }

  const record = member as Record<string, unknown>;
  const candidateEntries = Object.entries(record).filter(
    ([key]) => !key.startsWith("@_")
  );

  if (candidateEntries.length === 1) {
    return candidateEntries[0]?.[1];
  }

  if (candidateEntries.length > 1) {
    const [, value] = candidateEntries.find(
      ([key]) => !["Tuple", "SimpleFeatureCollection"].includes(localName(key))
    ) ?? [undefined, undefined];
    return value;
  }

  return undefined;
}

function flattenFeatureMembersContainers(
  containers: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (key.startsWith("@_")) {
        continue;
      }

      for (const item of asArray(value)) {
        if (item && typeof item === "object") {
          out.push({
            [key]: item
          });
        }
      }
    }
  }

  return out;
}

function parseGeometryDeep(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  inheritedSrsName?: string
): Geometry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const srsName =
    (record["@_srsName"] as string | undefined) ?? inheritedSrsName;

  for (const [key, child] of Object.entries(record)) {
    const nodeName = localName(key);
    if (key.startsWith("@_")) {
      continue;
    }

    const geometry = parseGeometryNode(nodeName, child, axisOrderStrategy, srsName);
    if (geometry) {
      return geometry;
    }
  }

  for (const child of Object.values(record)) {
    const geometry = parseGeometryDeep(child, axisOrderStrategy, srsName);
    if (geometry) {
      return geometry;
    }
  }

  return undefined;
}

function parseGeometryNode(
  nodeName: string,
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const rawNodeSrsName =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)["@_srsName"]
      : undefined;
  const nodeSrsName =
    typeof rawNodeSrsName === "string" ? rawNodeSrsName : srsName;

  switch (nodeName) {
    case "Point":
      return parsePoint(value, axisOrderStrategy, nodeSrsName);
    case "LineString":
    case "Curve":
      return parseLineString(value, axisOrderStrategy, nodeSrsName);
    case "Polygon":
    case "Surface":
      return parsePolygon(value, axisOrderStrategy, nodeSrsName);
    case "MultiPoint":
      return parseMultiPoint(value, axisOrderStrategy, nodeSrsName);
    case "MultiLineString":
    case "MultiCurve":
      return parseMultiLineString(value, axisOrderStrategy, nodeSrsName);
    case "MultiPolygon":
    case "MultiSurface":
      return parseMultiPolygon(value, axisOrderStrategy, nodeSrsName);
    default:
      return undefined;
  }
}

function parsePoint(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const text =
    extractNodeTextByLocalName(value, "pos") ??
    extractNodeTextByLocalName(value, "coordinates");
  if (!text) {
    return undefined;
  }

  const coords = parseNumbers(text);
  if (coords.length < 2) {
    return undefined;
  }

  return {
    type: "Point",
    coordinates: maybeSwap(coords, axisOrderStrategy, srsName) as Position
  };
}

function parseLineString(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const text =
    extractNodeTextByLocalName(value, "posList") ??
    extractNodeTextByLocalName(value, "coordinates") ??
    extractNodeTextByLocalName(value, "pos");
  if (!text) {
    return undefined;
  }

  const dims = inferDimension(value);
  const positions = toPositions(parseNumbers(text), dims).map((position) =>
    maybeSwap(position, axisOrderStrategy, srsName)
  );

  if (positions.length === 1) {
    return {
      type: "LineString",
      coordinates: [positions[0] as Position, positions[0] as Position]
    };
  }

  return {
    type: "LineString",
    coordinates: positions as Position[]
  };
}

function parsePolygon(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rings: Position[][] = [];

  const exterior =
    extractNodeByPath(record, ["exterior", "LinearRing", "posList"]) ??
    extractNodeByPath(record, ["outerBoundaryIs", "LinearRing", "coordinates"]);

  if (exterior) {
    const dims = inferDimension(value);
    rings.push(
      toPositions(parseNumbers(String(exterior)), dims).map((position) =>
        maybeSwap(position, axisOrderStrategy, srsName)
      ) as Position[]
    );
  }

  const interiorNodes = [
    ...asArray(extractNodeByPath(record, ["interior"])),
    ...asArray(extractNodeByPath(record, ["innerBoundaryIs"]))
  ];

  for (const interior of interiorNodes) {
    const interiorText =
      extractNodeByPath(interior as Record<string, unknown>, ["LinearRing", "posList"]) ??
      extractNodeByPath(interior as Record<string, unknown>, ["LinearRing", "coordinates"]);

    if (interiorText) {
      const dims = inferDimension(value);
      rings.push(
        toPositions(parseNumbers(String(interiorText)), dims).map((position) =>
          maybeSwap(position, axisOrderStrategy, srsName)
        ) as Position[]
      );
    }
  }

  if (rings.length === 0) {
    return undefined;
  }

  return {
    type: "Polygon",
    coordinates: rings
  };
}

function parseMultiPoint(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const points = collectNodesByLocalName(value, "Point")
    .map((node) => parsePoint(node, axisOrderStrategy, srsName))
    .filter((g): g is Extract<Geometry, { type: "Point" }> => !!g)
    .map((g) => g.coordinates as Position);

  if (points.length === 0) {
    return undefined;
  }

  return {
    type: "MultiPoint",
    coordinates: points
  };
}

function parseMultiLineString(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const lines = [
    ...collectNodesByLocalName(value, "LineString"),
    ...collectNodesByLocalName(value, "Curve")
  ]
    .map((node) => parseLineString(node, axisOrderStrategy, srsName))
    .filter((g): g is Extract<Geometry, { type: "LineString" }> => !!g)
    .map((g) => g.coordinates);

  if (lines.length === 0) {
    return undefined;
  }

  return {
    type: "MultiLineString",
    coordinates: lines
  };
}

function parseMultiPolygon(
  value: unknown,
  axisOrderStrategy: AxisOrderStrategy,
  srsName?: string
): Geometry | undefined {
  const polygons = [
    ...collectNodesByLocalName(value, "Polygon"),
    ...collectNodesByLocalName(value, "Surface")
  ]
    .map((node) => parsePolygon(node, axisOrderStrategy, srsName))
    .filter((g): g is Extract<Geometry, { type: "Polygon" }> => !!g)
    .map((g) => g.coordinates);

  if (polygons.length === 0) {
    return undefined;
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons
  };
}

function inferDimension(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 2;
  }

  const dim = (value as Record<string, unknown>)["@_srsDimension"];
  if (typeof dim === "number") {
    return Math.max(2, dim);
  }
  if (typeof dim === "string") {
    const parsed = Number(dim);
    if (Number.isFinite(parsed)) {
      return Math.max(2, parsed);
    }
  }

  return 2;
}

function toPositions(numbers: number[], dimension: number): number[][] {
  const positions: number[][] = [];
  for (let i = 0; i < numbers.length; i += dimension) {
    const chunk = numbers.slice(i, i + dimension);
    if (chunk.length >= 2) {
      positions.push(chunk);
    }
  }
  return positions;
}

function extractNodeTextByLocalName(value: unknown, nodeName: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (localName(key) === nodeName) {
      const text = valueText(child);
      if (text !== undefined) {
        return text;
      }
    }
  }

  return undefined;
}

function extractNodeByPath(
  value: Record<string, unknown>,
  path: string[]
): string | unknown | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    const record = current as Record<string, unknown>;
    let next: unknown;
    for (const [key, candidate] of Object.entries(record)) {
      if (localName(key) === segment) {
        next = candidate;
        break;
      }
    }

    if (next === undefined) {
      return undefined;
    }

    current = Array.isArray(next) ? next[0] : next;
  }

  return typeof current === "object" ? valueText(current) : current;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => !k.startsWith("@_"));
  if (keys.length === 0) {
    return null;
  }

  if (keys.length === 1) {
    const only = keys[0];
    if (!only) {
      return null;
    }
    return normalizeValue(record[only]);
  }

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[localName(key)] = normalizeValue(record[key]);
  }
  return out;
}

function isGeoJsonFeatureCollection(payload: unknown): payload is FeatureCollection {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.type === "FeatureCollection" &&
    Array.isArray(record.features)
  );
}

function emptyFeatureCollection(): GetFeatureWithLockResult<Geometry | null, GeoJsonProperties> {
  return {
    type: "FeatureCollection",
    features: []
  };
}
