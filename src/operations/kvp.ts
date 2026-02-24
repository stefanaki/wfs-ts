import { compileFilterXml } from "../filters/compiler";
import type {
  DescribeFeatureTypeOptions,
  DescribeStoredQueriesOptions,
  DropStoredQueryOptions,
  GetCapabilitiesOptions,
  GetFeatureOptions,
  GetPropertyValueOptions,
  ListStoredQueriesOptions,
  WfsOperation,
  WfsVersion
} from "../types";

export function buildCapabilitiesKvp(
  options: GetCapabilitiesOptions,
  version: WfsVersion
): Record<string, string> {
  const acceptVersions = options.acceptVersions ?? [version];

  return {
    service: "WFS",
    version,
    request: "GetCapabilities",
    acceptVersions: acceptVersions.join(","),
    ...options.raw?.kvp
  };
}

export function buildDescribeFeatureTypeKvp(
  options: DescribeFeatureTypeOptions,
  version: WfsVersion
): Record<string, string> {
  const typeParamName = version === "1.1.0" ? "typeName" : "typeNames";

  return {
    service: "WFS",
    version,
    request: "DescribeFeatureType",
    ...(options.typeNames?.length
      ? {
          [typeParamName]: options.typeNames.join(",")
        }
      : {}),
    ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
    ...options.raw?.kvp
  };
}

export function buildGetFeatureKvp(
  options: GetFeatureOptions,
  version: WfsVersion
): Record<string, string> {
  const typeParamName = version === "1.1.0" ? "typeName" : "typeNames";

  const params: Record<string, string> = {
    service: "WFS",
    version,
    request: "GetFeature",
    [typeParamName]: options.typeNames.join(",")
  };

  if (options.outputFormat) {
    params.outputFormat = options.outputFormat;
  }
  if (options.srsName) {
    params.srsName = options.srsName;
  }
  if (options.propertyNames?.length) {
    params.propertyName = options.propertyNames.join(",");
  }
  if (typeof options.startIndex === "number") {
    params.startIndex = String(options.startIndex);
  }
  if (typeof options.count === "number") {
    if (version === "1.1.0") {
      params.maxFeatures = String(options.count);
    } else {
      params.count = String(options.count);
    }
  }
  if (options.resultType) {
    params.resultType = options.resultType;
  }

  const filter = buildGetFilter(options.filter, version);
  if (filter) {
    params.filter = filter;
  }

  if (options.bbox) {
    params.bbox = options.bbox.join(",") + (options.srsName ? `,${options.srsName}` : "");
  }

  if (options.resolve) {
    params.resolve = options.resolve;
  }
  if (options.resolveDepth !== undefined) {
    params.resolveDepth = String(options.resolveDepth);
  }
  if (options.resolveTimeout !== undefined) {
    params.resolveTimeout = String(options.resolveTimeout);
  }

  applyGeoServerParams(params, options.geoserver);
  Object.assign(params, options.raw?.kvp ?? {});

  return params;
}

export function buildGetPropertyValueKvp(
  options: GetPropertyValueOptions,
  version: WfsVersion
): Record<string, string> {
  const typeParamName = version === "1.1.0" ? "typeName" : "typeNames";

  const params: Record<string, string> = {
    service: "WFS",
    version,
    request: "GetPropertyValue",
    valueReference: options.valueReference,
    [typeParamName]: options.typeNames.join(",")
  };

  if (options.resolvePath) {
    params.resolvePath = options.resolvePath;
  }
  if (typeof options.startIndex === "number") {
    params.startIndex = String(options.startIndex);
  }
  if (typeof options.count === "number") {
    params.count = String(options.count);
  }
  if (options.resultType) {
    params.resultType = options.resultType;
  }

  const filter = buildGetFilter(options.filter, version);
  if (filter) {
    params.filter = filter;
  }

  applyGeoServerParams(params, options.geoserver);
  Object.assign(params, options.raw?.kvp ?? {});

  return params;
}

export function buildSimpleKvp(
  request: WfsOperation,
  version: WfsVersion,
  raw?: Record<string, string>
): Record<string, string> {
  return {
    service: "WFS",
    version,
    request,
    ...(raw ?? {})
  };
}

export function buildDescribeStoredQueriesKvp(
  options: DescribeStoredQueriesOptions,
  version: WfsVersion
): Record<string, string> {
  const params = buildSimpleKvp("DescribeStoredQueries", version, options.raw?.kvp);
  if (options.storedQueryIds?.length) {
    params.storedQueryId = options.storedQueryIds.join(",");
  }
  return params;
}

export function buildDropStoredQueryKvp(
  options: DropStoredQueryOptions,
  version: WfsVersion
): Record<string, string> {
  const params = buildSimpleKvp("DropStoredQuery", version, options.raw?.kvp);
  params.id = options.id;
  return params;
}

export function buildListStoredQueriesKvp(
  options: ListStoredQueriesOptions,
  version: WfsVersion
): Record<string, string> {
  return buildSimpleKvp("ListStoredQueries", version, options.raw?.kvp);
}

function buildGetFilter(filter: unknown, version: WfsVersion): string | undefined {
  if (!filter) {
    return undefined;
  }

  return compileFilterXml(filter as never, {
    version,
    includeNamespaceDeclarations: true
  });
}

function applyGeoServerParams(
  params: Record<string, string>,
  geoserver: GetFeatureOptions["geoserver"] | GetPropertyValueOptions["geoserver"]
): void {
  if (!geoserver) {
    return;
  }

  if (geoserver.cqlFilter) {
    params.cql_filter = geoserver.cqlFilter;
  }
  if (geoserver.viewParams) {
    params.viewParams = geoserver.viewParams;
  }
  if (geoserver.formatOptions) {
    params.format_options = geoserver.formatOptions;
  }
  if (geoserver.vendorParams) {
    Object.assign(params, geoserver.vendorParams);
  }
}
