import { useEffect, useMemo, useRef } from "react";
import * as L from "leaflet";
import { CATEGORIES } from "../lib/categories";
import type { Incident } from "../lib/supabase";
import { zipCenter } from "../lib/geo";

interface Props {
  incidents: Incident[];
  activeZip: string | null;
  onResolve: (id: string) => Promise<void>;
}

// Sensitive categories → show circle instead of pin
const SENSITIVE_CATEGORIES = ["open_garage_door", "unattended_package"];
const FUZZY_RADIUS_METERS = 800; // ~0.5 miles

function buildPinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="wt-pin" style="background:${color}"><div class="wt-pin-inner"></div></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  });
}

export default function MapView({ incidents, activeZip, onResolve }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Record<string, L.Layer>>({});

  const filtered = useMemo(
    () =>
      incidents.filter(
        (i) => i.status === "active" && (!activeZip || i.zip_code === activeZip)
      ),
    [incidents, activeZip]
  );

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Recenter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (activeZip) {
      map.flyTo(zipCenter(activeZip), 12, { duration: 0.8 });
    } else if (filtered.length > 0) {
      const bounds = L.latLngBounds(
        filtered
          .filter((i) => i.latitude != null && i.longitude != null)
          .map((i) => [i.latitude!, i.longitude!]) as [number, number][]
      );
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [activeZip]);

  // Sync markers + circles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(filtered.map((i) => i.id));

    // Remove old layers
    Object.keys(layersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(layersRef.current[id]);
        delete layersRef.current[id];
      }
    });

    filtered.forEach((inc) => {
      if (inc.latitude == null || inc.longitude == null) return;

      const isSensitive = SENSITIVE_CATEGORIES.includes(inc.category);
      const existing = layersRef.current[inc.id];

      if (isSensitive) {
        // Circle for sensitive categories
        if (existing && existing instanceof L.Circle) {
          existing.setLatLng([inc.latitude, inc.longitude]);
          existing.setRadius(FUZZY_RADIUS_METERS);
          existing.setPopupContent(popupHtml(inc));
        } else {
          if (existing) map.removeLayer(existing);

          const circle = L.circle([inc.latitude, inc.longitude], {
            radius: FUZZY_RADIUS_METERS,
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: 0.15,
            weight: 2,
          }).addTo(map);

          circle.bindPopup(popupHtml(inc));
          circle.on("popupopen", (e) => {
            const root = (e.popup.getElement() as HTMLElement)?.querySelector("[data-resolve]");
            root?.addEventListener("click", async () => {
              await onResolve(inc.id);
            });
          });

          layersRef.current[inc.id] = circle;
        }
      } else {
        // Normal pin
        const meta = CATEGORIES[inc.category];
        const icon = buildPinIcon(meta.pinColor);

        if (existing && existing instanceof L.Marker) {
          existing.setIcon(icon);
          existing.setLatLng([inc.latitude, inc.longitude]);
          existing.setPopupContent(popupHtml(inc));
        } else {
          if (existing) map.removeLayer(existing);

          const marker = L.marker([inc.latitude, inc.longitude], { icon }).addTo(map);
          marker.bindPopup(popupHtml(inc));
          marker.on("popupopen", (e) => {
            const root = (e.popup.getElement() as HTMLElement)?.querySelector("[data-resolve]");
            root?.addEventListener("click", async () => {
              await onResolve(inc.id);
            });
          });

          layersRef.current[inc.id] = marker;
        }
      }
    });
  }, [filtered, onResolve]);

  function popupHtml(inc: Incident): string {
    const meta = CATEGORIES[inc.category];
    const latStr = inc.latitude != null ? inc.latitude.toFixed(5) : "—";
    const lngStr = inc.longitude != null ? inc.longitude.toFixed(5) : "—";

    return `
      <div style="min-width:220px;max-width:260px;font-family:inherit">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:600;color:${meta.pinColor};text-transform:uppercase;letter-spacing:0.04em">${meta.label}</span>
        </div>
        <div style="font-size:14px;font-weight:600;color:#f1f5f9;margin-bottom:4px">${escapeHtml(inc.title)}</div>
        ${inc.description ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;line-height:1.4">${escapeHtml(inc.description)}</div>` : ""}
        ${inc.location_description ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">${escapeHtml(inc.location_description)} · ${inc.zip_code}</div>` : ""}
        <div style="font-size:11px;color:#38bdf8;margin-bottom:8px;font-family:monospace">${latStr}, ${lngStr}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span style="font-size:11px;color:#94a3b8">${inc.verifications} neighbor${inc.verifications === 1 ? "" : "s"} verified</span>
          <button data-resolve style="font-size:12px;font-weight:600;color:#34d399;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:4px 10px;cursor:pointer">Mark as Resolved</button>
        </div>
      </div>
    `;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-2xl" />
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400 backdrop-blur-md">
        {filtered.length} active incident{filtered.length === 1 ? "" : "s"} on map
        {activeZip ? ` · ${activeZip}` : " · all zones"}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
