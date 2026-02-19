import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import type { WfsClientConfig } from "../types";

export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  data?: string;
  timeoutMs?: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  rawData: string;
  contentType: string;
  url: string;
  method: "GET" | "POST";
}

export class WfsTransport {
  private readonly client: AxiosInstance;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs?: number;

  constructor(config: WfsClientConfig) {
    this.client = config.axios ?? axios.create({});
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.timeoutMs = config.timeouts?.requestMs;
  }

  async request(req: TransportRequest, auth?: AxiosRequestConfig["auth"]): Promise<TransportResponse> {
    const response = await this.client.request({
      url: req.url,
      method: req.method,
      params: req.params,
      data: req.data,
      auth,
      headers: {
        ...this.defaultHeaders,
        ...req.headers
      },
      timeout: req.timeoutMs ?? this.timeoutMs,
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true
    });

    const contentType = String(response.headers["content-type"] ?? "");
    const rawData = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const parsed = parseBody(rawData, contentType);

    return {
      status: response.status,
      headers: response.headers as Record<string, string>,
      data: parsed,
      rawData,
      contentType,
      method: req.method,
      url: req.url
    };
  }
}

function parseBody(data: string, contentType: string): unknown {
  if (!data) {
    return "";
  }

  const lower = contentType.toLowerCase();
  if (lower.includes("json") || data.trim().startsWith("{") || data.trim().startsWith("[")) {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  return data;
}
