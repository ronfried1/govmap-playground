import { useEffect, useMemo, useRef, useState } from "react";

const GOVMAP_SCRIPT_URL = "https://www.govmap.gov.il/govmap/api/govmap.api.js";
const MAP_ELEMENT_ID = "map-standalone";
const DEFAULT_LAYERS = ["SUB_GUSH_ALL", "PARCEL_ALL", "layer_215978", "nadlan"];
const ENV_GOVMAP_TOKEN = import.meta.env.VITE_GOVMAP_TOKEN ?? "";

function useGovmapScript() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (typeof window === "undefined" || status !== "idle") return;
    setStatus("loading");
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOVMAP_SCRIPT_URL}"]`);
    const markReady = () => setStatus("ready");
    if (existing) {
      if (window.govmap) markReady();
      else {
        existing.addEventListener("load", markReady, { once: true });
        existing.addEventListener(
          "error",
          () => setStatus("error"),
          { once: true },
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = GOVMAP_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = markReady;
    script.onerror = () => setStatus("error");
    document.body.appendChild(script);
  }, [status]);

  return status;
}

function MapStandalone() {
  const scriptStatus = useGovmapScript();
  const mounted = useRef(false);
  const payload = useMemo(
    () => ({
      token: ENV_GOVMAP_TOKEN,
      layers: DEFAULT_LAYERS,
      background: "2",
      layersMode: 1,
      isEmbeddedToggle: false,
      identifyOnClick: false,
      showXY: true,
      zoomButtons: true,
      bgButton: false,
      language: "en",
    }),
    [],
  );

  useEffect(() => {
    if (scriptStatus !== "ready" || mounted.current) return;
    mounted.current = true;
    const mount = async () => {
      try {
        await window.govmap?.createMap(MAP_ELEMENT_ID, payload);
      } catch (error) {
        console.error("Standalone map failed to init", error);
      }
    };
    mount();
    return () => {
      try {
        window.govmap?.dispose?.(MAP_ELEMENT_ID);
      } catch (error) {
        console.warn("Failed to dispose standalone map", error);
      }
    };
  }, [payload, scriptStatus]);

  return (
    <div style={{ padding: "1rem", maxWidth: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <div>
          <h1>Standalone GovMap</h1>
          <p>Quick view using the same settings as your original map.tsx.</p>
        </div>
        <a
          href="/"
          style={{
            display: "inline-flex",
            padding: "0.55rem 0.9rem",
            borderRadius: "0.65rem",
            border: "1px solid #cbd5f5",
            textDecoration: "none",
            color: "#0f172a",
            fontWeight: 600,
          }}
        >
          Back to main
        </a>
      </div>
      <div
        id={MAP_ELEMENT_ID}
        style={{
          width: "100%",
          height: "640px",
          border: "1px solid #e2e8f0",
          borderRadius: "0.9rem",
          overflow: "hidden",
          background: "#0f172a",
        }}
      />
      <p style={{ color: "#475569" }}>
        Token from env ({ENV_GOVMAP_TOKEN ? "present" : "missing"}), layers: {DEFAULT_LAYERS.join(", ")}.
      </p>
    </div>
  );
}

export default MapStandalone;
