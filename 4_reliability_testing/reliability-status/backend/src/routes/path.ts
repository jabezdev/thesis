export function normalizeApiPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

export function canonicalApiPath(pathname: string): string {
  const normalized = normalizeApiPath(pathname);
  const withPrefix = normalized === "/api" || normalized.startsWith("/api/") ? normalized : `/api${normalized}`;
  return normalizeApiPath(withPrefix);
}

export function matchesApiLogicalPath(pathname: string, logicalPath: string): boolean {
  const normalizedPath = normalizeApiPath(pathname);
  const normalizedLogical = normalizeApiPath(logicalPath.startsWith("/") ? logicalPath : `/${logicalPath}`);

  const withApi = normalizeApiPath(`/api${normalizedLogical}`);

  return (
    normalizedPath === normalizedLogical ||
    normalizedPath === withApi ||
    normalizedPath.endsWith(normalizedLogical) ||
    normalizedPath.endsWith(withApi)
  );
}
