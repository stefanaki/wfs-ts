import type { AxiosInstance, AxiosRequestConfig } from "axios";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry
} from "geojson";
import type { WfsFilter } from "./filters/types";

export type WfsVersion = "2.0.2" | "2.0.0" | "1.1.0";

export type AxisOrderStrategy = "preserve" | "forceLonLat" | "forceLatLon";

export interface XmlOverride {
  target: string;
  position?: "before" | "after" | "replace";
  xml: string;
}

export interface RawRequestOptions {
  kvp?: Record<string, string>;
  xmlOverrides?: XmlOverride[];
  headers?: Record<string, string>;
}

export interface GeoServerOptions {
  cqlFilter?: string;
  viewParams?: string;
  formatOptions?: string;
  vendorParams?: Record<string, string>;
  xmlHints?: string[];
}

export interface WfsClientConfig {
  baseUrl: string;
  axios?: AxiosInstance;
  versionStrategy?: "auto" | WfsVersion;
  axisOrderStrategy?: AxisOrderStrategy;
  defaultHeaders?: Record<string, string>;
  auth?: AxiosRequestConfig["auth"];
  namespaces?: Partial<Record<string, string>>;
  geoserver?: {
    enabled?: boolean;
    defaultVendorParams?: Record<string, string>;
  };
  timeouts?: {
    requestMs?: number;
  };
  endpoints?: Partial<Record<WfsOperation, string>>;
}

export type WfsOperation =
  | "GetCapabilities"
  | "DescribeFeatureType"
  | "GetFeature"
  | "GetFeatureWithLock"
  | "GetPropertyValue"
  | "Transaction"
  | "LockFeature"
  | "ListStoredQueries"
  | "DescribeStoredQueries"
  | "CreateStoredQuery"
  | "DropStoredQuery";

export interface BaseOperationOptions {
  version?: WfsVersion;
  requestStyle?: "GET" | "POST";
  outputFormat?: string;
  raw?: RawRequestOptions;
}

export interface QueryPagingOptions {
  startIndex?: number;
  count?: number;
  resultType?: "results" | "hits";
}

export interface ResolveOptions {
  resolve?: "local" | "remote" | "all" | "none";
  resolveDepth?: number | "*";
  resolveTimeout?: number;
}

export interface GetCapabilitiesOptions extends BaseOperationOptions {
  acceptVersions?: WfsVersion[];
}

export interface DescribeFeatureTypeOptions extends BaseOperationOptions {
  typeNames?: string[];
}

export interface GetFeatureOptions
  extends BaseOperationOptions,
    QueryPagingOptions,
    ResolveOptions {
  typeNames: string[];
  srsName?: string;
  propertyNames?: string[];
  filter?: WfsFilter;
  bbox?: [number, number, number, number];
  geoserver?: GeoServerOptions;
}

export interface GetFeatureWithLockOptions
  extends GetFeatureOptions {
  expiry?: number;
  lockAction?: "ALL" | "SOME";
}

export interface GetPropertyValueOptions
  extends BaseOperationOptions,
    QueryPagingOptions,
    ResolveOptions {
  typeNames: string[];
  valueReference: string;
  resolvePath?: string;
  filter?: WfsFilter;
  geoserver?: GeoServerOptions;
}

export interface UpdateProperty {
  name: string;
  value?: unknown;
  action?: "replace" | "insertBefore" | "insertAfter" | "remove";
}

export interface InsertAction<
  G extends Geometry = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
> {
  kind: "insert";
  typeName: string;
  features: Feature<G, P>[];
  geometryPropertyName?: string;
  handle?: string;
  inputFormat?: string;
  srsName?: string;
}

export interface UpdateAction {
  kind: "update";
  typeName: string;
  properties: UpdateProperty[];
  filter?: WfsFilter;
  handle?: string;
  inputFormat?: string;
  srsName?: string;
}

export interface ReplaceAction<
  G extends Geometry = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
> {
  kind: "replace";
  typeName: string;
  feature: Feature<G, P>;
  geometryPropertyName?: string;
  filter: WfsFilter;
  handle?: string;
  inputFormat?: string;
  srsName?: string;
}

export interface DeleteAction {
  kind: "delete";
  typeName: string;
  filter: WfsFilter;
  handle?: string;
}

export interface NativeAction {
  kind: "native";
  vendorId: string;
  safeToIgnore: boolean;
  value?: string;
  anyXml?: string;
  handle?: string;
}

export type TransactionAction<
  G extends Geometry = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
> =
  | InsertAction<G, P>
  | UpdateAction
  | ReplaceAction<G, P>
  | DeleteAction
  | NativeAction;

export interface TransactionOptions<
  G extends Geometry = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
> extends BaseOperationOptions {
  actions: TransactionAction<G, P>[];
  lockId?: string;
  releaseAction?: "ALL" | "SOME";
  srsName?: string;
}

export interface LockFeatureOptions extends BaseOperationOptions {
  typeNames?: string[];
  filter?: WfsFilter;
  lockId?: string;
  expiry?: number;
  lockAction?: "ALL" | "SOME";
}

export interface ListStoredQueriesOptions extends BaseOperationOptions {}

export interface DescribeStoredQueriesOptions
  extends BaseOperationOptions {
  storedQueryIds?: string[];
}

export interface StoredQueryParameterDefinition {
  name: string;
  type: string;
  title?: string;
  abstract?: string;
}

export interface StoredQueryDefinition {
  id: string;
  title?: string;
  abstract?: string;
  parameters?: StoredQueryParameterDefinition[];
  queryExpressionTexts: Array<{
    returnFeatureTypes: string[];
    language: string;
    isPrivate?: boolean;
    xml: string;
  }>;
}

export interface CreateStoredQueryOptions extends BaseOperationOptions {
  definitions: StoredQueryDefinition[];
}

export interface DropStoredQueryOptions extends BaseOperationOptions {
  id: string;
}

export interface CapabilitiesOperationBinding {
  get?: string;
  post?: string;
}

export type CapabilitiesOperationMap = Partial<
  Record<WfsOperation, CapabilitiesOperationBinding>
>;

export interface ParsedCapabilities {
  serviceIdentification?: {
    title?: string;
    abstract?: string;
  };
  version?: string;
  operations: CapabilitiesOperationMap;
  raw: unknown;
}

export interface LockResult {
  lockId?: string;
  lockedResourceIds: string[];
  notLockedResourceIds: string[];
  raw: unknown;
}

export interface ActionResult {
  handle?: string;
  resourceIds: string[];
}

export interface TransactionResult {
  totalInserted?: number;
  totalUpdated?: number;
  totalReplaced?: number;
  totalDeleted?: number;
  insertResults: ActionResult[];
  updateResults: ActionResult[];
  replaceResults: ActionResult[];
  raw: unknown;
}

export interface StoredQueryListItem {
  id: string;
  titles: string[];
  returnFeatureTypes: string[];
}

export interface StoredQueryDescription {
  id: string;
  titles: string[];
  abstracts: string[];
  parameters: Array<{
    name: string;
    type: string;
  }>;
}

export interface CreateStoredQueryResult {
  status: string;
  raw: unknown;
}

export interface DropStoredQueryResult {
  status: string;
  raw: unknown;
}

export interface GetFeatureWithLockResult<
  G extends Geometry | null = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties
> extends FeatureCollection<G, P> {
  lockId?: string;
}
