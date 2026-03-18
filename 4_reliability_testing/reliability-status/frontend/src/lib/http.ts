export class HttpError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string, message?: string) {
    super(message || `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(path, {
      credentials: "include",
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new HttpError(response.status, path);
    }

    return (await response.json()) as T;
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

  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new HttpError(response.status, path);
    }
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
