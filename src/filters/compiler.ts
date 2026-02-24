import type { Geometry } from "geojson";
import type { WfsVersion } from "../types";
import type {
  BetweenFilter,
  ComparisonFilter,
  IdFilter,
  LikeFilter,
  LogicalFilter,
  NullFilter,
  SpatialFilter,
  WfsFilter
} from "./types";
import { escapeXml, xmlAttr } from "../utils/xml";
import { geometryToGml, literalToXml, qNameValueReference } from "../serializers/gml";

interface CompileFilterOptions {
  version: WfsVersion;
  srsName?: string;
  includeNamespaceDeclarations?: boolean;
}

const COMPARISON_TAG_MAP: Record<ComparisonFilter["op"], string> = {
  eq: "PropertyIsEqualTo",
  neq: "PropertyIsNotEqualTo",
  lt: "PropertyIsLessThan",
  lte: "PropertyIsLessThanOrEqualTo",
  gt: "PropertyIsGreaterThan",
  gte: "PropertyIsGreaterThanOrEqualTo"
};

const SPATIAL_TAG_MAP: Record<SpatialFilter["op"], string> = {
  bbox: "BBOX",
  intersects: "Intersects",
  within: "Within",
  contains: "Contains",
  disjoint: "Disjoint",
  touches: "Touches",
  overlaps: "Overlaps",
  crosses: "Crosses"
};

export function compileFilterXml(
  filter: WfsFilter,
  options: CompileFilterOptions
): string {
  const prefix = options.version === "1.1.0" ? "ogc" : "fes";
  const nsAttrs = options.includeNamespaceDeclarations
    ? filterNamespaceAttrs(options.version)
    : "";
  return `<${prefix}:Filter${nsAttrs}>${compileFilterBody(
    filter,
    options
  )}</${prefix}:Filter>`;
}

function filterNamespaceAttrs(version: WfsVersion): string {
  if (version === "1.1.0") {
    return ' xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"';
  }

  return ' xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"';
}

function compileFilterBody(filter: WfsFilter, options: CompileFilterOptions): string {
  switch (filter.op) {
    case "and":
    case "or":
    case "not":
      return compileLogicalFilter(filter, options);
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return compileComparisonFilter(filter, options.version);
    case "like":
      return compileLikeFilter(filter, options.version);
    case "between":
      return compileBetweenFilter(filter, options.version);
    case "isNull":
      return compileNullFilter(filter, options.version);
    case "id":
      return compileIdFilter(filter, options.version);
    case "bbox":
    case "intersects":
    case "within":
    case "contains":
    case "disjoint":
    case "touches":
    case "overlaps":
    case "crosses":
      return compileSpatialFilter(filter, options);
    default:
      return "";
  }
}

function compileLogicalFilter(
  filter: LogicalFilter,
  options: CompileFilterOptions
): string {
  const prefix = options.version === "1.1.0" ? "ogc" : "fes";

  if (filter.op === "not") {
    const first = filter.filters[0];
    if (!first) {
      return "";
    }
    return `<${prefix}:Not>${compileFilterBody(first, options)}</${prefix}:Not>`;
  }

  const tag = filter.op === "and" ? "And" : "Or";
  return `<${prefix}:${tag}>${filter.filters
    .map((f) => compileFilterBody(f, options))
    .join("")}</${prefix}:${tag}>`;
}

function compileComparisonFilter(filter: ComparisonFilter, version: WfsVersion): string {
  const prefix = version === "1.1.0" ? "ogc" : "fes";
  const tag = COMPARISON_TAG_MAP[filter.op];
  return `<${prefix}:${tag}${xmlAttr("matchCase", filter.matchCase)}>${qNameValueReference(
    filter.property,
    version
  )}<${prefix}:Literal>${literalToXml(filter.value)}</${prefix}:Literal></${prefix}:${tag}>`;
}

function compileLikeFilter(filter: LikeFilter, version: WfsVersion): string {
  const prefix = version === "1.1.0" ? "ogc" : "fes";
  return `<${prefix}:PropertyIsLike${xmlAttr(
    "wildCard",
    filter.wildCard ?? "*"
  )}${xmlAttr("singleChar", filter.singleChar ?? ".")}${xmlAttr(
    "escapeChar",
    filter.escapeChar ?? "!"
  )}${xmlAttr("matchCase", filter.matchCase)}>${qNameValueReference(
    filter.property,
    version
  )}<${prefix}:Literal>${escapeXml(filter.value)}</${prefix}:Literal></${prefix}:PropertyIsLike>`;
}

function compileBetweenFilter(filter: BetweenFilter, version: WfsVersion): string {
  const prefix = version === "1.1.0" ? "ogc" : "fes";
  return `<${prefix}:PropertyIsBetween>${qNameValueReference(
    filter.property,
    version
  )}<${prefix}:LowerBoundary><${prefix}:Literal>${literalToXml(
    filter.lower
  )}</${prefix}:Literal></${prefix}:LowerBoundary><${prefix}:UpperBoundary><${prefix}:Literal>${literalToXml(
    filter.upper
  )}</${prefix}:Literal></${prefix}:UpperBoundary></${prefix}:PropertyIsBetween>`;
}

function compileNullFilter(filter: NullFilter, version: WfsVersion): string {
  const prefix = version === "1.1.0" ? "ogc" : "fes";
  return `<${prefix}:PropertyIsNull>${qNameValueReference(filter.property, version)}</${prefix}:PropertyIsNull>`;
}

function compileIdFilter(filter: IdFilter, version: WfsVersion): string {
  if (version === "1.1.0") {
    return filter.ids.map((id) => `<ogc:FeatureId fid="${escapeXml(id)}"/>`).join("");
  }

  return filter.ids.map((id) => `<fes:ResourceId rid="${escapeXml(id)}"/>`).join("");
}

function compileSpatialFilter(
  filter: SpatialFilter,
  options: CompileFilterOptions
): string {
  const prefix = options.version === "1.1.0" ? "ogc" : "fes";
  const tag = SPATIAL_TAG_MAP[filter.op];

  if (filter.op === "bbox") {
    const bbox = geometryBounds(filter.geometry);
    return `<${prefix}:${tag}>${qNameValueReference(
      filter.property,
      options.version
    )}<gml:Envelope${xmlAttr("srsName", filter.srsName ?? options.srsName)}><gml:lowerCorner>${bbox[0]} ${bbox[1]}</gml:lowerCorner><gml:upperCorner>${bbox[2]} ${bbox[3]}</gml:upperCorner></gml:Envelope></${prefix}:${tag}>`;
  }

  return `<${prefix}:${tag}>${qNameValueReference(filter.property, options.version)}${geometryToGml(
    filter.geometry,
    {
      version: options.version,
      srsName: filter.srsName ?? options.srsName
    }
  )}</${prefix}:${tag}>`;
}

function geometryBounds(geometry: Geometry): [number, number, number, number] {
  const positions: number[][] = [];

  const collect = (coords: unknown): void => {
    if (!Array.isArray(coords)) {
      return;
    }

    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      positions.push(coords as number[]);
      return;
    }

    for (const child of coords) {
      collect(child);
    }
  };

  switch (geometry.type) {
    case "Point":
    case "LineString":
    case "Polygon":
    case "MultiPoint":
    case "MultiLineString":
    case "MultiPolygon":
      collect(geometry.coordinates);
      break;
    default:
      break;
  }

  if (positions.length === 0) {
    return [0, 0, 0, 0];
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const position of positions) {
    const [x, y] = position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return [minX, minY, maxX, maxY];
}
