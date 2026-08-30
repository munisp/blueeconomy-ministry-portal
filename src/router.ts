import { useEffect, useState } from "react";

// Hash-based routing, the same convention as the beneficiary portal: the
// static artifact needs no server-side route table and the OIDC redirect
// query string survives untouched on the path portion.
export type Route =
  | { name: "overview" }
  | { name: "approvals" }
  | { name: "approval-detail"; id: string }
  | { name: "tracking" }
  | { name: "geolibre" }
  | { name: "revenue" }
  | { name: "revenue-subsidy" }
  | { name: "revenue-settlements" }
  | { name: "revenue-assessments" };

const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

// parseRoute maps a location hash onto the portal route table. Unknown
// hashes fall back to the overview; a malformed approval id also falls back
// rather than fabricating a lookup.
export function parseRoute(hash: string): Route {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { name: "overview" };
  }
  if (segments.length === 1 && segments[0] === "approvals") {
    return { name: "approvals" };
  }
  if (segments.length === 1 && segments[0] === "tracking") {
    return { name: "tracking" };
  }
  if (segments.length === 1 && segments[0] === "geolibre") {
    return { name: "geolibre" };
  }
  if (segments.length === 1 && segments[0] === "revenue") {
    return { name: "revenue" };
  }
  if (segments.length === 2 && segments[0] === "revenue" && segments[1] === "subsidy") {
    return { name: "revenue-subsidy" };
  }
  if (segments.length === 2 && segments[0] === "revenue" && segments[1] === "settlements") {
    return { name: "revenue-settlements" };
  }
  if (segments.length === 2 && segments[0] === "revenue" && segments[1] === "assessments") {
    return { name: "revenue-assessments" };
  }
  if (segments.length === 2 && segments[0] === "approvals" && UUID_PATTERN.test(segments[1])) {
    return { name: "approval-detail", id: segments[1] };
  }
  return { name: "overview" };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "overview":
      return "#/";
    case "approvals":
      return "#/approvals";
    case "approval-detail":
      return `#/approvals/${route.id}`;
    case "tracking":
      return "#/tracking";
    case "geolibre":
      return "#/geolibre";
    case "revenue":
      return "#/revenue";
    case "revenue-subsidy":
      return "#/revenue/subsidy";
    case "revenue-settlements":
      return "#/revenue/settlements";
    case "revenue-assessments":
      return "#/revenue/assessments";
  }
}

// currentRoute reads the window hash; kept separate so tests and the hook
// share exactly one parsing implementation.
function currentRoute(): Route {
  return parseRoute(window.location.hash);
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const listener = () => setRoute(currentRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return route;
}

export function navigateTo(route: Route): void {
  window.location.hash = routeHref(route);
}
