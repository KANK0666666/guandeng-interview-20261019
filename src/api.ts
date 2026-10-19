import { useEffect, useState } from "react";

export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败，请重试。");
  return result as T;
}

export function useResource<T>(url: string | null, revision = 0) {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });
  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "" });
    request<T>(url, { signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: "" }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [url, revision]);
  return state;
}

export const number = (n: number | null | undefined, digits = 0) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(
        n,
      );
export const percentage = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;
export function parameters(...sources: object[]) {
  const query = new URLSearchParams();
  for (const source of sources)
    for (const [key, value] of Object.entries(source))
      if (value !== "" && value != null) query.set(key, String(value));
  return query.toString();
}
