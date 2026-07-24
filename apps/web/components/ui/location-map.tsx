"use client";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type LocationMapPoint = {
  readonly key: string;
  readonly label: string;
  readonly longitude: number;
  readonly latitude: number;
};

type LocationMapProps = {
  readonly className?: string;
  readonly points: readonly LocationMapPoint[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
};

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    openStreetMap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "openStreetMap",
      type: "raster",
      source: "openStreetMap",
    },
  ],
};

export function LocationMap({
  className,
  points,
  selectedKey,
  onSelect,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markerElementsRef = useRef<
    ReadonlyMap<string, HTMLButtonElement>
  >(new Map());
  const onSelectRef = useRef(onSelect);
  const selectedKeyRef = useRef(selectedKey);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return;
    }

    const map = new maplibregl.Map({
      attributionControl: {
        compact: true,
      },
      center: [-1.7, 52.7],
      container: containerRef.current,
      cooperativeGestures: true,
      maxZoom: 12,
      minZoom: 3,
      style: MAP_STYLE,
      zoom: 4.6,
    });

    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerElementsRef.current = new Map();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (map === null) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    const markerElements = new Map<string, HTMLButtonElement>();
    markersRef.current = points.map((point) => {
      const markerButton = document.createElement("button");
      markerButton.className = "lens-map-marker";
      markerButton.dataset.selected = String(
        point.key === selectedKeyRef.current,
      );
      markerButton.setAttribute("aria-label", `Focus ${point.label}`);
      markerButton.type = "button";
      markerButton.addEventListener("click", () => {
        onSelectRef.current(point.key);
      });
      markerElements.set(point.key, markerButton);

      return new maplibregl.Marker({
        anchor: "center",
        element: markerButton,
      })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
    });
    markerElementsRef.current = markerElements;

    const moveToPoints = () => {
      if (points.length === 0) {
        return;
      }

      if (points.length === 1) {
        const point = points[0];
        map.easeTo({
          center: [point.longitude, point.latitude],
          duration: 600,
          zoom: 8.4,
        });
        return;
      }

      const bounds = points.reduce(
        (currentBounds, point) =>
          currentBounds.extend([point.longitude, point.latitude]),
        new maplibregl.LngLatBounds(),
      );
      map.fitBounds(bounds, {
        duration: 600,
        maxZoom: 8.4,
        padding: 42,
      });
    };

    if (map.loaded()) {
      moveToPoints();
    } else {
      map.once("load", moveToPoints);
    }

    return () => {
      map.off("load", moveToPoints);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerElementsRef.current = new Map();
    };
  }, [points]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, key) => {
      element.dataset.selected = String(key === selectedKey);
    });
  }, [selectedKey]);

  return (
    <div
      aria-label="Map of locations in this analysis"
      className={cn("lens-map relative overflow-hidden", className)}
      ref={containerRef}
      role="region"
    />
  );
}
