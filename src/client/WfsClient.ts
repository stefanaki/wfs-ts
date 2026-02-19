import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { DEFAULT_WFS_VERSION, GEOJSON_OUTPUT_FORMATS } from "../core/constants";
import { WfsTransport, type TransportResponse } from "../core/transport";
import { getVersionFallbackChain, resolveInitialVersion } from "../core/version";
import { OwsExceptionError, type OwsException } from "../errors";
import type {
  CapabilitiesOperationBinding,
  CreateStoredQueryOptions,
  CreateStoredQueryResult,
  DescribeFeatureTypeOptions,
  DescribeStoredQueriesOptions,
  DropStoredQueryOptions,
  DropStoredQueryResult,
  GetCapabilitiesOptions,
  GetFeatureOptions,
  GetFeatureWithLockOptions,
  GetFeatureWithLockResult,
  GetPropertyValueOptions,
  ListStoredQueriesOptions,
  LockFeatureOptions,
  LockResult,
  ParsedCapabilities,
  StoredQueryDescription,
  StoredQueryListItem,
  TransactionOptions,
  TransactionResult,
  WfsClientConfig,
  WfsOperation,
  WfsVersion
} from "../types";
import {
  buildCapabilitiesKvp,
  buildDescribeFeatureTypeKvp,
  buildDescribeStoredQueriesKvp,
  buildDropStoredQueryKvp,
  buildGetFeatureKvp,
  buildGetPropertyValueKvp,
  buildListStoredQueriesKvp,
  buildSimpleKvp
} from "../operations/kvp";
import { parseCapabilities } from "../parsers/capabilities";
import { parseFeatureCollection } from "../parsers/featureCollection";
import { parseLockResult } from "../parsers/lock";
import {
  parseOwsExceptionPayload
} from "../parsers/owsException";
import {
  parseCreateStoredQuery,
  parseDescribeStoredQueries,
  parseDropStoredQuery,
  parseListStoredQueries,
  parseValueCollection
} from "../parsers/storedQueries";
import { parseTransactionResult } from "../parsers/transaction";
import {
  buildGetCapabilitiesXml,
  buildCreateStoredQueryXml,
  buildDescribeFeatureTypeXml,
  buildDescribeStoredQueriesXml,
  buildDropStoredQueryXml,
  buildGetFeatureWithLockXml,
  buildGetFeatureXml,
  buildGetPropertyValueXml,
  buildListStoredQueriesXml,
  buildLockFeatureXml,
  buildTransactionXml
} from "../serializers/wfs";

interface SendOperationParams {
  operation: WfsOperation;
  version: WfsVersion;
  requestStyle: "GET" | "POST";
  kvp?: Record<string, string>;
  xml?: string;
  rawHeaders?: Record<string, string>;
}

export class WfsClient {
  private readonly config: WfsClientConfig;
  private readonly transport: WfsTransport;
  private negotiatedVersion?: WfsVersion;
  private capabilities?: ParsedCapabilities;

  constructor(config: WfsClientConfig) {
    this.config = {
      versionStrategy: "auto",
      axisOrderStrategy: "preserve",
      ...config
    };
    this.transport = new WfsTransport(this.config);
  }

  async getCapabilities(options: GetCapabilitiesOptions = {}): Promise<ParsedCapabilities> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "GET";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "GetCapabilities",
      version,
      requestStyle,
      kvp: buildCapabilitiesKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildGetCapabilitiesXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    const parsed = parseCapabilities(response.rawData);
    this.capabilities = parsed;
    if (this.config.versionStrategy === "auto") {
      const parsedVersion = parsed.version as WfsVersion | undefined;
      if (parsedVersion) {
        this.negotiatedVersion = parsedVersion;
      }
    }

    return parsed;
  }

  async describeFeatureType(options: DescribeFeatureTypeOptions): Promise<unknown> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "GET";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "DescribeFeatureType",
      version,
      requestStyle,
      kvp: buildDescribeFeatureTypeKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildDescribeFeatureTypeXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return response.data;
  }
  
  async getFeature<
    G extends Geometry = Geometry,
    P extends GeoJsonProperties = GeoJsonProperties
  >(options: GetFeatureOptions): Promise<FeatureCollection<G, P>> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "GET";
    const serializerContext = this.createSerializerContext(version);
    const geoserver = this.withGeoServerDefaults(options.geoserver);

    const baseOptions: GetFeatureOptions = {
      ...options,
      geoserver,
      outputFormat: options.outputFormat ?? GEOJSON_OUTPUT_FORMATS[0]
    };

    try {
      const response = await this.sendOperation({
        operation: "GetFeature",
        version,
        requestStyle,
        kvp: buildGetFeatureKvp(baseOptions, version),
        xml:
          requestStyle === "POST"
            ? buildGetFeatureXml(baseOptions, serializerContext)
            : undefined,
        rawHeaders: options.raw?.headers
      });

      return this.parseFeatureResponse<G, P>(response);
    } catch (error) {
      if (!this.isOutputFormatException(error)) {
        throw error;
      }

      const fallbackOptions: GetFeatureOptions = {
        ...baseOptions,
        outputFormat: undefined
      };

      const retry = await this.sendOperation({
        operation: "GetFeature",
        version,
        requestStyle,
        kvp: buildGetFeatureKvp(fallbackOptions, version),
        xml:
          requestStyle === "POST"
            ? buildGetFeatureXml(fallbackOptions, serializerContext)
            : undefined,
        rawHeaders: options.raw?.headers
      });

      return this.parseFeatureResponse<G, P>(retry);
    }
  }

  async getFeatureWithLock<
    G extends Geometry = Geometry,
    P extends GeoJsonProperties = GeoJsonProperties
  >(options: GetFeatureWithLockOptions): Promise<GetFeatureWithLockResult<G, P>> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const requestOptions: GetFeatureWithLockOptions = {
      ...options,
      outputFormat: options.outputFormat ?? GEOJSON_OUTPUT_FORMATS[0]
    };

    const response = await this.sendOperation({
      operation: "GetFeatureWithLock",
      version,
      requestStyle,
      kvp: {
        ...buildGetFeatureKvp(requestOptions, version),
        request: "GetFeatureWithLock",
        expiry: options.expiry ? String(options.expiry) : undefined,
        lockAction: options.lockAction
      } as Record<string, string>,
      xml:
        requestStyle === "POST"
          ? buildGetFeatureWithLockXml(requestOptions, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return this.parseFeatureResponse<G, P>(response);
  }

  async getPropertyValue<T = unknown>(options: GetPropertyValueOptions): Promise<T[]> {
    const version = await this.resolveVersion(options.version);
    const serializerContext = this.createSerializerContext(version);

    if (version === "1.1.0") {
      const collection = await this.getFeature({
        ...options,
        outputFormat: options.outputFormat
      });
      return collection.features
        .map((feature) =>
          this.resolveValueReference<T>(feature.properties, options.valueReference)
        )
        .filter((value): value is T => value !== undefined);
    }

    const requestStyle = options.requestStyle ?? "GET";
    const response = await this.sendOperation({
      operation: "GetPropertyValue",
      version,
      requestStyle,
      kvp: buildGetPropertyValueKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildGetPropertyValueXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    if (Array.isArray(response.data)) {
      return response.data as T[];
    }

    return parseValueCollection<T>(response.rawData);
  }

  async transaction<
    G extends Geometry = Geometry,
    P extends GeoJsonProperties = GeoJsonProperties
  >(options: TransactionOptions<G, P>): Promise<TransactionResult> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "Transaction",
      version,
      requestStyle,
      kvp: {
        ...buildSimpleKvp("Transaction", version, options.raw?.kvp)
      },
      xml:
        requestStyle === "POST"
          ? buildTransactionXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseTransactionResult(response.rawData);
  }

  async lockFeature(options: LockFeatureOptions): Promise<LockResult> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "LockFeature",
      version,
      requestStyle,
      kvp: {
        ...buildSimpleKvp("LockFeature", version, options.raw?.kvp),
        ...(options.lockId ? { lockId: options.lockId } : {}),
        ...(options.expiry ? { expiry: String(options.expiry) } : {}),
        ...(options.lockAction ? { lockAction: options.lockAction } : {})
      },
      xml:
        requestStyle === "POST"
          ? buildLockFeatureXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseLockResult(response.rawData);
  }

  async listStoredQueries(
    options: ListStoredQueriesOptions = {}
  ): Promise<StoredQueryListItem[]> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "ListStoredQueries",
      version,
      requestStyle,
      kvp: buildListStoredQueriesKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildListStoredQueriesXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseListStoredQueries(response.rawData);
  }

  async describeStoredQueries(
    options: DescribeStoredQueriesOptions = {}
  ): Promise<StoredQueryDescription[]> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "DescribeStoredQueries",
      version,
      requestStyle,
      kvp: buildDescribeStoredQueriesKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildDescribeStoredQueriesXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseDescribeStoredQueries(response.rawData);
  }

  async createStoredQuery(
    options: CreateStoredQueryOptions
  ): Promise<CreateStoredQueryResult> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "CreateStoredQuery",
      version,
      requestStyle,
      kvp: buildSimpleKvp("CreateStoredQuery", version, options.raw?.kvp),
      xml:
        requestStyle === "POST"
          ? buildCreateStoredQueryXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseCreateStoredQuery(response.rawData);
  }

  async dropStoredQuery(
    options: DropStoredQueryOptions
  ): Promise<DropStoredQueryResult> {
    const version = await this.resolveVersion(options.version);
    const requestStyle = options.requestStyle ?? "POST";
    const serializerContext = this.createSerializerContext(version);

    const response = await this.sendOperation({
      operation: "DropStoredQuery",
      version,
      requestStyle,
      kvp: buildDropStoredQueryKvp(options, version),
      xml:
        requestStyle === "POST"
          ? buildDropStoredQueryXml(options, serializerContext)
          : undefined,
      rawHeaders: options.raw?.headers
    });

    return parseDropStoredQuery(response.rawData);
  }

  private async resolveVersion(explicit?: WfsVersion): Promise<WfsVersion> {
    if (explicit) {
      return explicit;
    }

    if (this.config.versionStrategy && this.config.versionStrategy !== "auto") {
      return this.config.versionStrategy;
    }

    if (this.negotiatedVersion) {
      return this.negotiatedVersion;
    }

    const preferred = resolveInitialVersion(this.config);
    const fallback = getVersionFallbackChain(preferred, this.config.versionStrategy);

    for (const version of fallback) {
      try {
        const response = await this.transport.request(
          {
            method: "GET",
            url: this.config.baseUrl,
            params: buildCapabilitiesKvp({}, version)
          },
          this.config.auth
        );

        this.ensureNoError({
          operation: "GetCapabilities",
          version,
          response
        });

        const capabilities = parseCapabilities(response.rawData);
        this.capabilities = capabilities;
        this.negotiatedVersion =
          (capabilities.version as WfsVersion | undefined) ?? version;
        return this.negotiatedVersion;
      } catch {
        continue;
      }
    }

    this.negotiatedVersion = DEFAULT_WFS_VERSION;
    return this.negotiatedVersion;
  }

  private async sendOperation(params: SendOperationParams): Promise<TransportResponse> {
    const endpoint = this.resolveEndpoint(params.operation, params.requestStyle);

    const response = await this.transport.request(
      {
        method: params.requestStyle,
        url: endpoint,
        params: params.requestStyle === "GET" ? params.kvp : undefined,
        data: params.requestStyle === "POST" ? params.xml : undefined,
        headers: {
          ...(params.requestStyle === "POST"
            ? { "Content-Type": "text/xml; charset=UTF-8" }
            : {}),
          ...(params.rawHeaders ?? {})
        }
      },
      this.config.auth
    );

    this.ensureNoError({
      operation: params.operation,
      version: params.version,
      response
    });

    return response;
  }

  private ensureNoError(args: {
    operation: WfsOperation;
    version: WfsVersion;
    response: TransportResponse;
  }): void {
    const { response } = args;
    const owsExceptions = parseOwsExceptionPayload(response.data);

    if (response.status >= 400 || owsExceptions.length > 0) {
      const exceptions = owsExceptions.length > 0 ? owsExceptions : this.defaultException(response.status);
      throw new OwsExceptionError(
        `WFS ${args.operation} failed with status ${response.status}`,
        {
          operation: args.operation,
          version: args.version,
          url: response.url,
          method: response.method,
          status: response.status
        },
        exceptions,
        response.data
      );
    }
  }

  private defaultException(status: number): OwsException[] {
    return [
      {
        exceptionCode: "HTTP_ERROR",
        text: `HTTP request failed with status ${status}`
      }
    ];
  }

  private resolveEndpoint(operation: WfsOperation, style: "GET" | "POST"): string {
    const explicit = this.config.endpoints?.[operation];
    if (explicit) {
      return explicit;
    }

    const fromCapabilities = this.capabilities?.operations?.[operation];
    if (fromCapabilities) {
      return this.pickBinding(fromCapabilities, style) ?? this.config.baseUrl;
    }

    return this.config.baseUrl;
  }

  private pickBinding(
    binding: CapabilitiesOperationBinding,
    style: "GET" | "POST"
  ): string | undefined {
    return style === "GET"
      ? binding.get ?? binding.post
      : binding.post ?? binding.get;
  }

  private parseFeatureResponse<
    G extends Geometry,
    P extends GeoJsonProperties
  >(response: TransportResponse): GetFeatureWithLockResult<G, P> {
    const parsed = parseFeatureCollection(response.data, {
      axisOrderStrategy: this.config.axisOrderStrategy ?? "preserve"
    });

    if (parsed.features.length > 0) {
      return parsed as GetFeatureWithLockResult<G, P>;
    }

    const xmlFallback = parseFeatureCollection(response.rawData, {
      axisOrderStrategy: this.config.axisOrderStrategy ?? "preserve"
    });

    return xmlFallback as GetFeatureWithLockResult<G, P>;
  }

  private isOutputFormatException(error: unknown): boolean {
    if (!(error instanceof OwsExceptionError)) {
      return false;
    }

    return error.exceptions.some((exception) => {
      const lowerText = exception.text.toLowerCase();
      const lowerCode = (exception.exceptionCode ?? "").toLowerCase();
      return (
        lowerText.includes("outputformat") ||
        lowerCode.includes("invalidparametervalue") ||
        lowerCode.includes("operationprocessingfailed")
      );
    });
  }

  private withGeoServerDefaults(
    geoserver: GetFeatureOptions["geoserver"]
  ): GetFeatureOptions["geoserver"] {
    if (!this.config.geoserver?.enabled) {
      return geoserver;
    }

    return {
      ...geoserver,
      vendorParams: {
        ...(this.config.geoserver.defaultVendorParams ?? {}),
        ...(geoserver?.vendorParams ?? {})
      }
    };
  }

  private createSerializerContext(version: WfsVersion): {
    version: WfsVersion;
    namespaces?: Partial<Record<string, string>>;
  } {
    return {
      version,
      namespaces: this.config.namespaces
    };
  }

  private resolveValueReference<T = unknown>(
    properties: GeoJsonProperties | null | undefined,
    valueReference: string
  ): T | undefined {
    if (!properties || typeof properties !== "object") {
      return undefined;
    }

    const direct = properties[valueReference];
    if (direct !== undefined) {
      return direct as T;
    }

    const localReference = this.localName(valueReference);
    if (localReference !== valueReference) {
      const localDirect = properties[localReference];
      if (localDirect !== undefined) {
        return localDirect as T;
      }
    }

    for (const path of this.valueReferencePaths(valueReference)) {
      const pathValue = this.readPath(properties as Record<string, unknown>, path);
      if (pathValue !== undefined) {
        return pathValue as T;
      }
    }

    return undefined;
  }

  private valueReferencePaths(valueReference: string): string[][] {
    const normalized = valueReference.trim();
    if (!normalized) {
      return [];
    }

    const separator = normalized.includes("/") ? "/" : normalized.includes(".") ? "." : undefined;
    if (!separator) {
      return [];
    }

    const segments = normalized.split(separator).filter(Boolean);
    if (segments.length === 0) {
      return [];
    }

    const localSegments = segments.map((segment) => this.localName(segment));
    if (segments.join("\u0000") === localSegments.join("\u0000")) {
      return [segments];
    }

    return [segments, localSegments];
  }

  private readPath(
    source: Record<string, unknown>,
    path: string[]
  ): unknown | undefined {
    let current: unknown = source;

    for (const segment of path) {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      const record = current as Record<string, unknown>;
      if (segment in record) {
        current = record[segment];
        continue;
      }

      const localSegment = this.localName(segment);
      const fallbackKey = Object.keys(record).find(
        (candidate) => this.localName(candidate) === localSegment
      );

      if (!fallbackKey) {
        return undefined;
      }

      current = record[fallbackKey];
    }

    return current;
  }

  private localName(value: string): string {
    const index = value.indexOf(":");
    return index >= 0 ? value.slice(index + 1) : value;
  }
}

export function createWfsClient(config: WfsClientConfig): WfsClient {
  return new WfsClient(config);
}

export default WfsClient;
