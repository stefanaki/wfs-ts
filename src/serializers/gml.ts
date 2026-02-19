import type { Feature, GeoJsonProperties, Geometry, Position } from "geojson";
import type { WfsVersion } from "../types";
import { escapeXml, xmlAttr } from "../utils/xml";

interface GeometryToGmlOptions {
  version: WfsVersion;
  srsName?: string;
}

interface FeatureToXmlOptions {
  version: WfsVersion;
  typeName: string;
  feature: Feature<Geometry, GeoJsonProperties>;
  geometryPropertyName?: string;
  srsName?: string;
}

const QNAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
const NCNAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function geometryToGml(geometry: Geometry, options: GeometryToGmlOptions): string {
  const gmlPrefix = options.version === "1.1.0" ? "gml" : "gml";
  const srsAttr = xmlAttr("srsName", options.srsName);

  switch (geometry.type) {
    case "Point":
      return `<${gmlPrefix}:Point${srsAttr}><${gmlPrefix}:pos>${coords(geometry.coordinates)}</${gmlPrefix}:pos></${gmlPrefix}:Point>`;
    case "LineString":
      return `<${gmlPrefix}:LineString${srsAttr}><${gmlPrefix}:posList>${coordList(geometry.coordinates)}</${gmlPrefix}:posList></${gmlPrefix}:LineString>`;
    case "Polygon":
      return polygonToGml(geometry.coordinates, gmlPrefix, srsAttr);
    case "MultiPoint":
      return `<${gmlPrefix}:MultiPoint${srsAttr}>${geometry.coordinates
        .map(
          (point) =>
            `<${gmlPrefix}:pointMember><${gmlPrefix}:Point><${gmlPrefix}:pos>${coords(point)}</${gmlPrefix}:pos></${gmlPrefix}:Point></${gmlPrefix}:pointMember>`
        )
        .join("")}</${gmlPrefix}:MultiPoint>`;
    case "MultiLineString":
      return `<${gmlPrefix}:MultiLineString${srsAttr}>${geometry.coordinates
        .map(
          (line) =>
            `<${gmlPrefix}:lineStringMember><${gmlPrefix}:LineString><${gmlPrefix}:posList>${coordList(line)}</${gmlPrefix}:posList></${gmlPrefix}:LineString></${gmlPrefix}:lineStringMember>`
        )
        .join("")}</${gmlPrefix}:MultiLineString>`;
    case "MultiPolygon":
      return `<${gmlPrefix}:MultiPolygon${srsAttr}>${geometry.coordinates
        .map(
          (polygon) =>
            `<${gmlPrefix}:polygonMember>${polygonToGml(polygon, gmlPrefix, "")}</${gmlPrefix}:polygonMember>`
        )
        .join("")}</${gmlPrefix}:MultiPolygon>`;
    default:
      return "";
  }
}

export function featureToWfsInsertXml(options: FeatureToXmlOptions): string {
  const [prefix, localTypeName] = splitQName(options.typeName);
  const featureTag = prefix ? `${prefix}:${localTypeName}` : localTypeName;
  const geometryProperty = options.geometryPropertyName ?? "geometry";

  const propertiesXml = Object.entries(options.feature.properties ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      tagValue(resolvePropertyTagName(key, prefix), value)
    )
    .join("");

  const geometryTag = resolvePropertyTagName(geometryProperty, prefix);
  const geometryXml = options.feature.geometry
    ? `<${geometryTag}>${geometryToGml(options.feature.geometry, {
        version: options.version,
        srsName: options.srsName
      })}</${geometryTag}>`
    : "";

  const idAttr = options.feature.id ? xmlAttr("gml:id", options.feature.id) : "";

  return `<${featureTag}${idAttr}>${propertiesXml}${geometryXml}</${featureTag}>`;
}

export function literalToXml(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return escapeXml(value);
  }

  return escapeXml(JSON.stringify(value));
}

export function qNameValueReference(value: string, version: WfsVersion): string {
  const prefix = version === "1.1.0" ? "ogc" : "fes";
  const element = version === "1.1.0" ? "PropertyName" : "ValueReference";
  return `<${prefix}:${element}>${escapeXml(value)}</${prefix}:${element}>`;
}

function polygonToGml(
  rings: Position[][],
  gmlPrefix: string,
  srsAttr: string
): string {
  const outer = rings[0] ?? [];
  const inners = rings.slice(1);

  return `<${gmlPrefix}:Polygon${srsAttr}><${gmlPrefix}:exterior><${gmlPrefix}:LinearRing><${gmlPrefix}:posList>${coordList(
    outer
  )}</${gmlPrefix}:posList></${gmlPrefix}:LinearRing></${gmlPrefix}:exterior>${inners
    .map(
      (inner) =>
        `<${gmlPrefix}:interior><${gmlPrefix}:LinearRing><${gmlPrefix}:posList>${coordList(inner)}</${gmlPrefix}:posList></${gmlPrefix}:LinearRing></${gmlPrefix}:interior>`
    )
    .join("")}</${gmlPrefix}:Polygon>`;
}

function coords(position: Position): string {
  return position.join(" ");
}

function coordList(positions: Position[]): string {
  return positions.map((position) => position.join(" ")).join(" ");
}

function splitQName(typeName: string): [string | undefined, string] {
  const normalized = typeName.trim();
  if (!normalized) {
    throw new Error("typeName must be a non-empty QName");
  }

  if (normalized.includes(":")) {
    const [prefix, local] = normalized.split(":", 2);
    if (!prefix || !local || !QNAME_PATTERN.test(normalized)) {
      throw new Error(`Invalid typeName QName "${typeName}"`);
    }
    return [prefix, local];
  }

  if (!NCNAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid typeName "${typeName}"`);
  }

  return [undefined, normalized];
}

function resolvePropertyTagName(
  propertyName: string,
  defaultPrefix?: string
): string {
  const normalized = propertyName.trim();
  if (!normalized) {
    throw new Error("Property name must be a non-empty QName");
  }

  if (normalized.includes(":")) {
    if (!QNAME_PATTERN.test(normalized)) {
      throw new Error(`Invalid property QName "${propertyName}"`);
    }
    return normalized;
  }

  if (!NCNAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid property name "${propertyName}"`);
  }

  return defaultPrefix ? `${defaultPrefix}:${normalized}` : normalized;
}

function tagValue(tag: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}
