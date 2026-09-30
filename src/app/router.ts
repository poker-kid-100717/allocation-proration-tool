import { useSyncExternalStore } from "react";

/**
 * Hash routing (#/lab, #/history/ALC-…): no server rewrites needed and no
 * router dependency for six screens.
 */
export interface Route {
  readonly path: string[];
  readonly query: URLSearchParams;
}

const read = () => window.location.hash.replace(/^#/, "") || "/";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, read, () => "/");
  const [pathname, search = ""] = hash.split("?");
  return { path: pathname.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}

export function navigate(to: string) {
  window.location.hash = to;
  window.scrollTo({ top: 0 });
}

export const href = (to: string) => `#${to}`;
