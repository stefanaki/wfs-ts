export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      searchParams.set(key, value.join(","));
      continue;
    }

    searchParams.set(key, String(value));
  }

  return searchParams.toString();
}

export function appendQuery(url: string, query: string): string {
  if (!query) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${query}`;
}
