import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

type LoggerContext = {
  module: string;
  requestId?: string;
};

type RouteLogger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  child: (fields: LogFields) => RouteLogger;
};

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function normalizeFields(fields?: LogFields) {
  if (!fields) {
    return {};
  }

  const cloned = { ...fields };
  if ("error" in cloned && cloned.error) {
    cloned.error = stringifyError(cloned.error);
  }

  return cloned;
}

function writeLog(level: LogLevel, payload: LogFields) {
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function createLoggerFromContext(context: LoggerContext & { extra?: LogFields }): RouteLogger {
  const base = {
    module: context.module,
    requestId: context.requestId ?? null,
    ...(context.extra ?? {}),
  };

  const log = (level: LogLevel, event: string, fields?: LogFields) => {
    writeLog(level, {
      ts: new Date().toISOString(),
      level,
      event,
      ...base,
      ...normalizeFields(fields),
    });
  };

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    child: (fields) =>
      createLoggerFromContext({
        ...context,
        extra: {
          ...(context.extra ?? {}),
          ...fields,
        },
      }),
  };
}

export function createRouteLogger(context: LoggerContext): RouteLogger {
  return createLoggerFromContext(context);
}

export function getRequestId(input: Request | Headers | null | undefined) {
  const headers = input instanceof Request ? input.headers : input;
  const incoming =
    headers?.get("x-request-id")?.trim() ||
    headers?.get("x-correlation-id")?.trim() ||
    headers?.get("x-trace-id")?.trim();
  return incoming || randomUUID();
}

export function withTiming<T>(callback: () => Promise<T>) {
  const startedAt = Date.now();
  return callback().then((result) => ({
    result,
    elapsedMs: Date.now() - startedAt,
  }));
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
