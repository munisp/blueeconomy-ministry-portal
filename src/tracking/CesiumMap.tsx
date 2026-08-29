// CesiumMap is the PRIMARY 3D engine for the tracking console: self-hosted,
// ion-free CesiumJS (decision D5). The ion token is emptied in
// cesium-setup, the base layer is the deployment-configured raster tile
// template (render-gated, D8), the EllipsoidTerrainProvider default is kept
// (no ion terrain), and every widget that would call a Cesium-hosted
// service (geocoder, base-layer picker) is disabled. Cesium runtime assets
// are served from the portal's own /cesium directory (vite static copy).
import "./cesium-setup";
import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  ImageryLayer,
  LabelStyle,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { GeoZone, SOSAlert, VesselSummary } from "./geo-model";
import { isStalePosition, isUnmatchedTrack, vesselKey, vesselLatitude, vesselLongitude } from "./geo-model";
import { SOS_COLOR, STALE_OPACITY, TRACK_COLOR, UNMATCHED_COLOR, ZONE_FILL_COLOR, ZONE_OUTLINE_COLOR, vesselColorHex } from "./map-style";

// NIGERIA_INITIAL_VIEW frames the Nigeria EEZ / Gulf of Guinea AoI on first
// render (approximate centre 4.0°E, 6.5°N); it is camera framing only, not
// data.
const NIGERIA_INITIAL_VIEW = { longitude: 4.0, latitude: 6.5, heightMeters: 3_800_000 };

export interface TrackingMapProperties {
  tileUrl: string;
  tileAttribution?: string;
  vessels: VesselSummary[];
  zones: GeoZone[];
  sosAlerts: SOSAlert[];
  trackLine: [number, number][] | null;
  selectedKey: string | null;
  nowMs: number;
  onSelectVessel: (key: string | null) => void;
  // onEngineError reports a truthful engine-initialisation failure (for
  // example WebGL context creation refused) so the console can surface the
  // honest map-unavailable state instead of a blank pane.
  onEngineError?: (message: string) => void;
}

function hexColor(hex: string, alpha = 1): Color {
  return Color.fromCssColorString(hex).withAlpha(alpha);
}

export function CesiumMap(properties: TrackingMapProperties) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sourcesRef = useRef<{ vessels: CustomDataSource; zones: CustomDataSource; sos: CustomDataSource; track: CustomDataSource } | null>(null);
  const onSelectRef = useRef(properties.onSelectVessel);
  onSelectRef.current = properties.onSelectVessel;

  // Construct the viewer once; the tile template is part of the deployment
  // configuration and changes only with a redeploy, so rebuilding on config
  // change is intentionally not supported.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let viewer: Viewer;
    try {
      viewer = new Viewer(container, {
        baseLayer: new ImageryLayer(
          new UrlTemplateImageryProvider({
            url: properties.tileUrl,
            credit: properties.tileAttribution ?? "",
          }),
        ),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: true,
        sceneModePicker: true,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: true,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
    } catch (error) {
      // WebGL/context creation failed; the console surfaces the honest
      // map-unavailable state.
      viewerRef.current = null;
      properties.onEngineError?.(`the Cesium 3D engine could not start (${error instanceof Error ? error.message : "WebGL unavailable"})`);
      return;
    }
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(NIGERIA_INITIAL_VIEW.longitude, NIGERIA_INITIAL_VIEW.latitude, NIGERIA_INITIAL_VIEW.heightMeters),
    });
    const vessels = new CustomDataSource("vessels");
    const zones = new CustomDataSource("zones");
    const sos = new CustomDataSource("sos");
    const track = new CustomDataSource("track");
    void viewer.dataSources.add(zones);
    void viewer.dataSources.add(track);
    void viewer.dataSources.add(vessels);
    void viewer.dataSources.add(sos);
    sourcesRef.current = { vessels, zones, sos, track };
    viewerRef.current = viewer;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(event.position);
      const entity = picked?.id;
      const key = entity?.properties?.vesselKey?.getValue();
      onSelectRef.current(typeof key === "string" ? key : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      sourcesRef.current = null;
      viewerRef.current = null;
      viewer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronise the entity collections with the latest polled truth. The
  // collections are rebuilt wholesale per refresh; at the pilot's vessel
  // counts (API page cap 5,000) entity churn stays well inside budget, and
  // the geo architecture's primitive-collection upgrade path (D5) remains
  // available when counts grow.
  useEffect(() => {
    const sources = sourcesRef.current;
    const viewer = viewerRef.current;
    if (sources === null || viewer === null) {
      return;
    }
    const { vessels, zones, sos, track } = sources;

    zones.entities.removeAll();
    for (const zone of properties.zones) {
      if (zone.polygon === null || zone.polygon.length < 4) {
        continue;
      }
      const flat = zone.polygon.flatMap(([lon, lat]) => [lon, lat]);
      zones.entities.add({
        id: `zone:${zone.zoneId}`,
        polygon: {
          hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
          material: hexColor(ZONE_FILL_COLOR, 0.1),
          outline: true,
          outlineColor: hexColor(ZONE_OUTLINE_COLOR, 0.65),
        },
        polyline: {
          positions: Cartesian3.fromDegreesArray(flat),
          width: 2,
          material: hexColor(ZONE_OUTLINE_COLOR, 0.65),
          clampToGround: true,
        },
      });
    }

    track.entities.removeAll();
    if (properties.trackLine !== null && properties.trackLine.length >= 2) {
      const flat = properties.trackLine.flatMap(([lon, lat]) => [lon, lat]);
      track.entities.add({
        id: "track:selected",
        polyline: {
          positions: Cartesian3.fromDegreesArray(flat),
          width: 3,
          material: hexColor(TRACK_COLOR, 0.9),
          clampToGround: true,
        },
      });
    }

    vessels.entities.removeAll();
    for (const vessel of properties.vessels) {
      const key = vesselKey(vessel);
      const unmatched = isUnmatchedTrack(vessel);
      const stale = isStalePosition(vessel, properties.nowMs);
      const base = vesselColorHex(vessel.sourceClass, unmatched);
      const selected = properties.selectedKey === key;
      vessels.entities.add({
        id: `vessel:${key}`,
        position: Cartesian3.fromDegrees(vesselLongitude(vessel), vesselLatitude(vessel)),
        properties: { vesselKey: key },
        point: {
          pixelSize: selected ? 15 : unmatched ? 11 : 9,
          color: hexColor(base, stale ? STALE_OPACITY : 0.95),
          outlineColor: unmatched ? hexColor(UNMATCHED_COLOR) : Color.BLACK.withAlpha(0.7),
          outlineWidth: unmatched ? 2.5 : 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: selected
          ? {
              text: vessel.shipName ?? (vessel.mmsi !== "" ? vessel.mmsi : "unmatched report"),
              font: "600 13px Inter, sans-serif",
              fillColor: Color.WHITE,
              style: LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cartesian2(0, -22),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
      });
    }

    sos.entities.removeAll();
    for (const alert of properties.sosAlerts) {
      const lat = alert.latitudeMicros / 1_000_000;
      const lon = alert.longitudeMicros / 1_000_000;
      sos.entities.add({
        id: `sos:${alert.sosAlertId}`,
        position: Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 15,
          color: hexColor(SOS_COLOR, alert.state === "RESOLVED" ? 0.4 : 0.95),
          outlineColor: Color.WHITE.withAlpha(0.9),
          outlineWidth: 2.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    viewer.scene.requestRender();
  }, [properties.vessels, properties.zones, properties.sosAlerts, properties.trackLine, properties.selectedKey, properties.nowMs]);

  return <div ref={containerRef} className="tracking-map__canvas" data-testid="cesium-map" />;
}
