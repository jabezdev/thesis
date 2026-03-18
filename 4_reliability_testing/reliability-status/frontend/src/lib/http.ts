export class HttpError extends Error {
  status: number;
  url: string;
  isReliabilityBackend: boolean;
  responseBody: string;

  constructor(status: number, url: string, message?: string, isReliabilityBackend = false, responseBody = "") {
    super(message || `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.isReliabilityBackend = isReliabilityBackend;
    this.responseBody = responseBody;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  const strippedPath = path.startsWith("/api/") ? path.slice(4) : path;
  const candidates = strippedPath !== path ? [path, strippedPath] : [path];
  let lastHttpError: HttpError | null = null;

  try {
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const response = await fetch(candidate, {
        credentials: "include",
        ...init,
        signal: controller.signal
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const responseBody = await response.text();
      const isReliabilityBackend = response.headers.get("x-reliability-status-backend") === "true";
      const error = new HttpError(response.status, candidate, undefined, isReliabilityBackend, responseBody);

      // If /api is stripped by an upstream, retry once without /api before surfacing the error.
      if (error.status === 404 && i === 0 && candidates.length > 1) {
        lastHttpError = error;
        continue;
      }

      throw error;
    }

    if (lastHttpError) {
      throw lastHttpError;
    }

    throw new HttpError(0, path, "Network error");
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpError(0, path, "Request timeout");
    }
    throw new HttpError(0, path, "Network error");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" });
}

export async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  return requestJson<TResponse>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function postNoContent(path: string): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  const strippedPath = path.startsWith("/api/") ? path.slice(4) : path;
  const candidates = strippedPath !== path ? [path, strippedPath] : [path];
  let lastHttpError: HttpError | null = null;

  try {
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const response = await fetch(candidate, {
        method: "POST",
        credentials: "include",
        signal: controller.signal
      });

      if (response.ok) {
        return;
      }

      const responseBody = await response.text();
      const isReliabilityBackend = response.headers.get("x-reliability-status-backend") === "true";
      const error = new HttpError(response.status, candidate, undefined, isReliabilityBackend, responseBody);

      if (error.status === 404 && i === 0 && candidates.length > 1) {
        lastHttpError = error;
        continue;
      }

      throw error;
    }

    if (lastHttpError) {
      throw lastHttpError;
    }

    throw new HttpError(0, path, "Network error");
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpError(0, path, "Request timeout");
    }
    throw new HttpError(0, path, "Network error");
  } finally {
    clearTimeout(timeout);
  }
}
