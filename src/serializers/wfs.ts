import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { compileFilterXml } from "../filters/compiler";
import type {
  CreateStoredQueryOptions,
  DescribeFeatureTypeOptions,
  DescribeStoredQueriesOptions,
  DropStoredQueryOptions,
  GetCapabilitiesOptions,
  GetFeatureOptions,
  GetFeatureWithLockOptions,
  GetPropertyValueOptions,
  ListStoredQueriesOptions,
  LockFeatureOptions,
  TransactionOptions,
  WfsVersion
} from "../types";
import { applyXmlOverrides, escapeXml, xmlAttr } from "../utils/xml";
import { featureToWfsInsertXml, geometryToGml, literalToXml } from "./gml";

interface SerializerContext {
  version: WfsVersion;
  namespaces?: Partial<Record<string, string>>;
}

const RESERVED_PREFIXES = new Set([
  "wfs",
  "gml",
  "fes",
  "ogc",
  "ows",
  "xlink",
  "xml",
  "xmlns"
]);
const ROOT_PREFIX_ORDER = ["wfs", "gml", "fes", "ogc", "ows", "xlink"];
const QNAME_PREFIX_PATTERN =
  /\b([A-Za-z_][A-Za-z0-9_.-]*):[A-Za-z_][A-Za-z0-9_.-]*/g;

export function buildGetCapabilitiesXml(
  options: GetCapabilitiesOptions,
  ctx: SerializerContext
): string {
  const ns = resolveRootNamespaces(ctx, new Set<string>());
  const acceptVersionsXml = (options.acceptVersions ?? [])
    .map((version) => `<ows:Version>${escapeXml(version)}</ows:Version>`)
    .join("");

  const xml = `<wfs:GetCapabilities${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}">${
    acceptVersionsXml
      ? `<ows:AcceptVersions>${acceptVersionsXml}</ows:AcceptVersions>`
      : ""
  }</wfs:GetCapabilities>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildDescribeFeatureTypeXml(
  options: DescribeFeatureTypeOptions,
  ctx: SerializerContext
): string {
  const requiredPrefixes = new Set<string>();
  collectTypeNamePrefixes(options.typeNames ?? [], requiredPrefixes);
  const ns = resolveRootNamespaces(ctx, requiredPrefixes);

  const typeNames = (options.typeNames ?? [])
    .map((typeName) => `<wfs:TypeName>${escapeXml(typeName)}</wfs:TypeName>`)
    .join("");

  const xml = `<wfs:DescribeFeatureType${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}"${xmlAttr(
    "outputFormat",
    options.outputFormat
  )}>${typeNames}</wfs:DescribeFeatureType>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildGetFeatureXml(
  options: GetFeatureOptions,
  ctx: SerializerContext
): string {
  const requiredPrefixes = new Set<string>();
  collectTypeNamePrefixes(options.typeNames, requiredPrefixes);
  for (const propertyName of options.propertyNames ?? []) {
    collectQNamePrefixes(propertyName, requiredPrefixes);
  }
  if (options.filter) {
    collectFilterPrefixes(options.filter, requiredPrefixes);
  }

  const ns = resolveRootNamespaces(ctx, requiredPrefixes);
  const queryAttributeName = ctx.version === "1.1.0" ? "typeName" : "typeNames";
  const projectionXml = (options.propertyNames ?? [])
    .map(
      (propertyName) =>
        `<wfs:PropertyName>${escapeXml(propertyName)}</wfs:PropertyName>`
    )
    .join("");

  const filterXml = buildFilterSegment(options, ctx.version);
  const query = `<wfs:Query ${queryAttributeName}="${escapeXml(
    joinTypeNamesForXml(options.typeNames)
  )}"${xmlAttr("srsName", options.srsName)}>${projectionXml}${filterXml}</wfs:Query>`;

  const countAttr =
    ctx.version === "1.1.0"
      ? xmlAttr("maxFeatures", options.count)
      : xmlAttr("count", options.count);

  const xml = `<wfs:GetFeature${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}"${xmlAttr(
    "outputFormat",
    options.outputFormat
  )}${xmlAttr("startIndex", options.startIndex)}${countAttr}${xmlAttr(
    "resultType",
    options.resultType
  )}${xmlAttr("resolve", options.resolve)}${xmlAttr(
    "resolveDepth",
    options.resolveDepth
  )}${xmlAttr(
    "resolveTimeout",
    options.resolveTimeout
  )}>${query}${buildGeoServerHints(options.geoserver?.xmlHints)}</wfs:GetFeature>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildGetFeatureWithLockXml(
  options: GetFeatureWithLockOptions,
  ctx: SerializerContext
): string {
  const baseGetFeatureXml = buildGetFeatureXml(options, ctx)
    .replace("<wfs:GetFeature", "<wfs:GetFeatureWithLock")
    .replace("</wfs:GetFeature>", "</wfs:GetFeatureWithLock>");

  const lockAttr = `${xmlAttr("expiry", options.expiry)}${xmlAttr(
    "lockAction",
    options.lockAction
  )}`;

  const updated = baseGetFeatureXml.replace(
    /^<wfs:GetFeatureWithLock([^>]*)>/,
    `<wfs:GetFeatureWithLock$1${lockAttr}>`
  );

  return applyXmlOverrides(updated, options.raw?.xmlOverrides);
}

export function buildGetPropertyValueXml(
  options: GetPropertyValueOptions,
  ctx: SerializerContext
): string {
  const requiredPrefixes = new Set<string>();
  collectTypeNamePrefixes(options.typeNames, requiredPrefixes);
  collectQNamePrefixes(options.valueReference, requiredPrefixes);
  if (options.filter) {
    collectFilterPrefixes(options.filter, requiredPrefixes);
  }

  const ns = resolveRootNamespaces(ctx, requiredPrefixes);
  const queryAttributeName = ctx.version === "1.1.0" ? "typeName" : "typeNames";

  const query = `<wfs:Query ${queryAttributeName}="${escapeXml(
    joinTypeNamesForXml(options.typeNames)
  )}">${buildFilterSegment(options, ctx.version)}</wfs:Query>`;

  const countAttr =
    ctx.version === "1.1.0"
      ? xmlAttr("maxFeatures", options.count)
      : xmlAttr("count", options.count);

  const xml = `<wfs:GetPropertyValue${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}" valueReference="${escapeXml(
    options.valueReference
  )}"${xmlAttr("resolvePath", options.resolvePath)}${xmlAttr(
    "startIndex",
    options.startIndex
  )}${countAttr}${xmlAttr("resultType", options.resultType)}${xmlAttr(
    "resolve",
    options.resolve
  )}${xmlAttr("resolveDepth", options.resolveDepth)}${xmlAttr(
    "resolveTimeout",
    options.resolveTimeout
  )}>${query}${buildGeoServerHints(
    options.geoserver?.xmlHints
  )}</wfs:GetPropertyValue>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildTransactionXml<
  G extends Geometry = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
>(options: TransactionOptions<G, P>, ctx: SerializerContext): string {
  const requiredPrefixes = new Set<string>();
  collectTransactionPrefixes(
    options.actions as TransactionOptions<Geometry, GeoJsonProperties>["actions"],
    requiredPrefixes
  );
  const ns = resolveRootNamespaces(ctx, requiredPrefixes);

  const actionsXml = options.actions
    .map((action) => {
      switch (action.kind) {
        case "insert":
          return `<wfs:Insert${xmlAttr("handle", action.handle)}${xmlAttr(
            "inputFormat",
            action.inputFormat
          )}${xmlAttr("srsName", action.srsName ?? options.srsName)}>${action.features
            .map((feature) =>
              featureToWfsInsertXml({
                version: ctx.version,
                typeName: action.typeName,
                feature,
                srsName: action.srsName ?? options.srsName,
                geometryPropertyName: action.geometryPropertyName
              })
            )
            .join("")}</wfs:Insert>`;
        case "update":
          return `<wfs:Update typeName="${escapeXml(action.typeName)}"${xmlAttr(
            "handle",
            action.handle
          )}${xmlAttr("inputFormat", action.inputFormat)}${xmlAttr(
            "srsName",
            action.srsName ?? options.srsName
          )}>${action.properties
            .map((property) => serializeUpdateProperty(property, ctx.version))
            .join("")}${
            action.filter
              ? compileFilterXml(action.filter, {
                  version: ctx.version,
                  srsName: action.srsName ?? options.srsName
                })
              : ""
          }</wfs:Update>`;
        case "replace":
          return `<wfs:Replace${xmlAttr("handle", action.handle)}${xmlAttr(
            "inputFormat",
            action.inputFormat
          )}${xmlAttr(
            "srsName",
            action.srsName ?? options.srsName
          )}>${featureToWfsInsertXml({
            version: ctx.version,
            typeName: action.typeName,
            feature: action.feature,
            srsName: action.srsName ?? options.srsName,
            geometryPropertyName: action.geometryPropertyName
          })}${compileFilterXml(action.filter, {
            version: ctx.version,
            srsName: action.srsName ?? options.srsName
          })}</wfs:Replace>`;
        case "delete":
          return `<wfs:Delete typeName="${escapeXml(action.typeName)}"${xmlAttr(
            "handle",
            action.handle
          )}>${compileFilterXml(action.filter, {
            version: ctx.version,
            srsName: options.srsName
          })}</wfs:Delete>`;
        case "native":
          return `<wfs:Native vendorId="${escapeXml(
            action.vendorId
          )}" safeToIgnore="${String(action.safeToIgnore)}"${xmlAttr(
            "handle",
            action.handle
          )}>${action.anyXml ?? escapeXml(action.value ?? "")}</wfs:Native>`;
        default:
          return "";
      }
    })
    .join("");

  const xml = `<wfs:Transaction${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}"${xmlAttr(
    "lockId",
    options.lockId
  )}${xmlAttr("releaseAction", options.releaseAction)}${xmlAttr(
    "srsName",
    options.srsName
  )}>${actionsXml}</wfs:Transaction>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildLockFeatureXml(
  options: LockFeatureOptions,
  ctx: SerializerContext
): string {
  const requiredPrefixes = new Set<string>();
  collectTypeNamePrefixes(options.typeNames ?? [], requiredPrefixes);
  if (options.filter) {
    collectFilterPrefixes(options.filter, requiredPrefixes);
  }

  const ns = resolveRootNamespaces(ctx, requiredPrefixes);
  const queryElementName = ctx.version === "1.1.0" ? "wfs:Lock" : "wfs:Query";
  const queryAttributeName = ctx.version === "1.1.0" ? "typeName" : "typeNames";

  const queryXml =
    options.typeNames && options.typeNames.length > 0
      ? `<${queryElementName} ${queryAttributeName}="${escapeXml(
          joinTypeNamesForXml(options.typeNames)
        )}">${
          options.filter
            ? compileFilterXml(options.filter, {
                version: ctx.version
              })
            : ""
        }</${queryElementName}>`
      : "";

  const xml = `<wfs:LockFeature${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}"${xmlAttr(
    "lockId",
    options.lockId
  )}${xmlAttr("expiry", options.expiry)}${xmlAttr(
    "lockAction",
    options.lockAction
  )}>${queryXml}</wfs:LockFeature>`;

  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildListStoredQueriesXml(
  options: ListStoredQueriesOptions,
  ctx: SerializerContext
): string {
  const ns = resolveRootNamespaces(ctx, new Set<string>());
  const xml = `<wfs:ListStoredQueries${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}"/>`;
  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildDescribeStoredQueriesXml(
  options: DescribeStoredQueriesOptions,
  ctx: SerializerContext
): string {
  const ns = resolveRootNamespaces(ctx, new Set<string>());
  const idsXml = (options.storedQueryIds ?? [])
    .map((id) => `<wfs:StoredQueryId>${escapeXml(id)}</wfs:StoredQueryId>`)
    .join("");

  const xml = `<wfs:DescribeStoredQueries${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}">${idsXml}</wfs:DescribeStoredQueries>`;
  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildCreateStoredQueryXml(
  options: CreateStoredQueryOptions,
  ctx: SerializerContext
): string {
  const ns = resolveRootNamespaces(ctx, new Set<string>());

  const defsXml = options.definitions
    .map((definition) => {
      const parameterXml = (definition.parameters ?? [])
        .map(
          (parameter) =>
            `<wfs:Parameter name="${escapeXml(parameter.name)}" type="${escapeXml(
              parameter.type
            )}">${parameter.title ? `<wfs:Title>${escapeXml(parameter.title)}</wfs:Title>` : ""}${
              parameter.abstract ? `<wfs:Abstract>${escapeXml(parameter.abstract)}</wfs:Abstract>` : ""
            }</wfs:Parameter>`
        )
        .join("");

      const queryExpressionXml = definition.queryExpressionTexts
        .map(
          (query) =>
            `<wfs:QueryExpressionText returnFeatureTypes="${escapeXml(
              query.returnFeatureTypes.join(" ")
            )}" language="${escapeXml(query.language)}" isPrivate="${String(
              query.isPrivate ?? false
            )}">${query.xml}</wfs:QueryExpressionText>`
        )
        .join("");

      return `<wfs:StoredQueryDefinition id="${escapeXml(definition.id)}">${
        definition.title ? `<wfs:Title>${escapeXml(definition.title)}</wfs:Title>` : ""
      }${
        definition.abstract ? `<wfs:Abstract>${escapeXml(definition.abstract)}</wfs:Abstract>` : ""
      }${parameterXml}${queryExpressionXml}</wfs:StoredQueryDefinition>`;
    })
    .join("");

  const xml = `<wfs:CreateStoredQuery${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}">${defsXml}</wfs:CreateStoredQuery>`;
  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function buildDropStoredQueryXml(
  options: DropStoredQueryOptions,
  ctx: SerializerContext
): string {
  const ns = resolveRootNamespaces(ctx, new Set<string>());
  const xml = `<wfs:DropStoredQuery${rootXmlns(
    ns
  )} service="WFS" version="${ctx.version}" id="${escapeXml(options.id)}"/>`;
  return applyXmlOverrides(xml, options.raw?.xmlOverrides);
}

export function rootXmlns(namespaces: Record<string, string>): string {
  const orderedEntries: Array<[string, string]> = [];

  for (const prefix of ROOT_PREFIX_ORDER) {
    const uri = namespaces[prefix];
    if (uri) {
      orderedEntries.push([prefix, uri]);
    }
  }

  const extraEntries = Object.entries(namespaces)
    .filter(([prefix]) => !ROOT_PREFIX_ORDER.includes(prefix))
    .filter(([, uri]) => !!uri)
    .sort(([a], [b]) => a.localeCompare(b));
  orderedEntries.push(...extraEntries);

  return orderedEntries
    .map(([prefix, uri]) => ` xmlns:${prefix}="${escapeXml(uri)}"`)
    .join("");
}

function resolveRootNamespaces(
  ctx: SerializerContext,
  requiredPrefixes: Set<string>
): Record<string, string> {
  const namespaces = defaultNamespacesForVersion(ctx.version);

  for (const [prefix, uri] of Object.entries(ctx.namespaces ?? {})) {
    if (!uri) {
      continue;
    }
    namespaces[prefix] = uri;
  }

  for (const prefix of requiredPrefixes) {
    if (RESERVED_PREFIXES.has(prefix)) {
      continue;
    }
    if (!namespaces[prefix]) {
      throw new Error(
        `Missing namespace mapping for prefix "${prefix}". Provide it via WfsClientConfig.namespaces.`
      );
    }
  }

  return namespaces;
}

function defaultNamespacesForVersion(
  version: WfsVersion
): Record<string, string> {
  if (version === "1.1.0") {
    return {
      wfs: "http://www.opengis.net/wfs",
      gml: "http://www.opengis.net/gml",
      fes: "http://www.opengis.net/ogc",
      ogc: "http://www.opengis.net/ogc",
      ows: "http://www.opengis.net/ows",
      xlink: "http://www.w3.org/1999/xlink"
    };
  }

  return {
    wfs: "http://www.opengis.net/wfs/2.0",
    gml: "http://www.opengis.net/gml/3.2",
    fes: "http://www.opengis.net/fes/2.0",
    ogc: "http://www.opengis.net/fes/2.0",
    ows: "http://www.opengis.net/ows/1.1",
    xlink: "http://www.w3.org/1999/xlink"
  };
}

function collectTypeNamePrefixes(typeNames: string[], out: Set<string>): void {
  for (const typeName of typeNames) {
    for (const token of typeName.split(/[\s,]+/).filter(Boolean)) {
      const candidate = token.includes("=") ? token.split("=", 1)[0] : token;
      if (!candidate) {
        continue;
      }
      collectQNamePrefixes(candidate, out);
    }
  }
}

function collectQNamePrefixes(value: string, out: Set<string>): void {
  for (const match of value.matchAll(QNAME_PREFIX_PATTERN)) {
    const prefix = match[1];
    if (prefix) {
      out.add(prefix);
    }
  }
}

function collectFilterPrefixes(filter: unknown, out: Set<string>): void {
  if (!filter || typeof filter !== "object") {
    return;
  }

  const node = filter as Record<string, unknown>;
  const op = node.op;
  if (typeof op !== "string") {
    return;
  }

  switch (op) {
    case "and":
    case "or":
    case "not": {
      const filters = Array.isArray(node.filters) ? node.filters : [];
      for (const child of filters) {
        collectFilterPrefixes(child, out);
      }
      return;
    }
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "like":
    case "between":
    case "isNull":
    case "bbox":
    case "intersects":
    case "within":
    case "contains":
    case "disjoint":
    case "touches":
    case "overlaps":
    case "crosses":
      if (typeof node.property === "string") {
        collectQNamePrefixes(node.property, out);
      }
      return;
    default:
      return;
  }
}

function collectTransactionPrefixes(
  actions: TransactionOptions<Geometry, GeoJsonProperties>["actions"],
  out: Set<string>
): void {
  for (const action of actions) {
    switch (action.kind) {
      case "insert":
        collectQNamePrefixes(action.typeName, out);
        if (action.geometryPropertyName) {
          collectQNamePrefixes(action.geometryPropertyName, out);
        }
        for (const feature of action.features) {
          collectFeaturePropertyPrefixes(feature, out);
        }
        break;
      case "update":
        collectQNamePrefixes(action.typeName, out);
        for (const property of action.properties) {
          collectQNamePrefixes(property.name, out);
        }
        if (action.filter) {
          collectFilterPrefixes(action.filter, out);
        }
        break;
      case "replace":
        collectQNamePrefixes(action.typeName, out);
        if (action.geometryPropertyName) {
          collectQNamePrefixes(action.geometryPropertyName, out);
        }
        collectFeaturePropertyPrefixes(action.feature, out);
        collectFilterPrefixes(action.filter, out);
        break;
      case "delete":
        collectQNamePrefixes(action.typeName, out);
        collectFilterPrefixes(action.filter, out);
        break;
      case "native":
        break;
      default:
        break;
    }
  }
}

function collectFeaturePropertyPrefixes(
  feature: Feature<Geometry, GeoJsonProperties>,
  out: Set<string>
): void {
  for (const key of Object.keys(feature.properties ?? {})) {
    collectQNamePrefixes(key, out);
  }
}

function joinTypeNamesForXml(typeNames: string[]): string {
  return typeNames.join(" ");
}

function buildFilterSegment(
  options: { filter?: unknown; bbox?: [number, number, number, number] },
  version: WfsVersion
): string {
  if (options.filter) {
    return compileFilterXml(options.filter as never, { version });
  }

  if (options.bbox) {
    const [minX, minY, maxX, maxY] = options.bbox;
    const filterPrefix = version === "1.1.0" ? "ogc" : "fes";
    const propNameTag = version === "1.1.0" ? "PropertyName" : "ValueReference";

    return `<${filterPrefix}:Filter><${filterPrefix}:BBOX><${filterPrefix}:${propNameTag}>geometry</${filterPrefix}:${propNameTag}><gml:Envelope><gml:lowerCorner>${minX} ${minY}</gml:lowerCorner><gml:upperCorner>${maxX} ${maxY}</gml:upperCorner></gml:Envelope></${filterPrefix}:BBOX></${filterPrefix}:Filter>`;
  }

  return "";
}

function buildGeoServerHints(hints: string[] | undefined): string {
  if (!hints || hints.length === 0) {
    return "";
  }
  return hints.join("");
}

function serializeUpdateProperty(
  property: { name: string; value?: unknown; action?: string },
  version: WfsVersion
): string {
  if (version === "1.1.0") {
    return `<wfs:Property><wfs:Name>${escapeXml(property.name)}</wfs:Name>${
      property.value !== undefined
        ? `<wfs:Value>${literalToXml(property.value)}</wfs:Value>`
        : ""
    }</wfs:Property>`;
  }

  return `<wfs:Property><wfs:ValueReference${xmlAttr("action", property.action)}>${escapeXml(
    property.name
  )}</wfs:ValueReference>${
    property.value !== undefined
      ? `<wfs:Value>${literalToXml(property.value)}</wfs:Value>`
      : ""
  }</wfs:Property>`;
}

export function buildGeometryFilterFromFeature(
  feature: Feature,
  version: WfsVersion,
  propertyName = "geometry"
): string {
  if (!feature.geometry) {
    return "";
  }

  const prefix = version === "1.1.0" ? "ogc" : "fes";
  const propertyTag = version === "1.1.0" ? "PropertyName" : "ValueReference";

  return `<${prefix}:Filter><${prefix}:Intersects><${prefix}:${propertyTag}>${escapeXml(
    propertyName
  )}</${prefix}:${propertyTag}>${geometryToGml(feature.geometry, {
    version
  })}</${prefix}:Intersects></${prefix}:Filter>`;
}
