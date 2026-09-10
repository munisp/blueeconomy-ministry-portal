export interface DashboardPageProps {
  baseUrl: string;
  token: string | null;
  /**
   * geo-service origin from the approved registry, or null when the
   * deployment does not configure one. Geospatial pages fail closed on null.
   */
  geoBaseUrl: string | null;
  /** Deployment-configured map style URL (same-origin path or HTTPS), if any. */
  tileStyleUrl?: string;
  /** Deployment-configured default map viewport, if any. */
  defaultBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}
