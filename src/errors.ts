import type { WfsOperation, WfsVersion } from "./types";

export interface WfsErrorContext {
  operation: WfsOperation;
  version?: WfsVersion;
  url?: string;
  method?: "GET" | "POST";
  status?: number;
  requestId?: string;
}

export class WfsError extends Error {
  readonly context: WfsErrorContext;

  constructor(message: string, context: WfsErrorContext) {
    super(message);
    this.name = "WfsError";
    this.context = context;
  }
}

export interface OwsException {
  exceptionCode?: string;
  locator?: string;
  text: string;
}

export class OwsExceptionError extends WfsError {
  readonly exceptions: OwsException[];
  readonly rawPayload: unknown;

  constructor(
    message: string,
    context: WfsErrorContext,
    exceptions: OwsException[],
    rawPayload: unknown
  ) {
    super(message, context);
    this.name = "OwsExceptionError";
    this.exceptions = exceptions;
    this.rawPayload = rawPayload;
  }
}

export function isOwsExceptionError(error: unknown): error is OwsExceptionError {
  return error instanceof OwsExceptionError;
}
