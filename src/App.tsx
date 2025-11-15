import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./index.css";
import { convertDbfToCsv } from "./utils/dbf";

declare global {
  interface Window {
    govmap?: {
      createMap: (
        elementId: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      dispose?: (elementId: string) => void;
    };
  }
}

type MapConfig = {
  token: string;
  centerX: number;
  centerY: number;
  level: number;
  background: string;
  identifyOnClick: boolean;
  showXY: boolean;
  zoomButtons: boolean;
  bgButton: boolean;
  language: string;
};

type MapStatus = "idle" | "initializing" | "ready" | "error";

type StreetDealsResult = {
  upstreamUrl: string;
  status: number;
  ok: boolean;
  data: unknown;
};

type DbfSummary = {
  fileName: string;
  declaredRecords: number;
  parsedRecords: number;
  fields: number;
  headerLength: number;
  recordLength: number;
};

const GOVMAP_SCRIPT_URL = "https://www.govmap.gov.il/govmap/api/govmap.api.js";
const MAP_ELEMENT_ID = "govmap-stage";
const MAX_LOGS = 40;

const defaultConfig: MapConfig = {
  token: "",
  centerX: 200000,
  centerY: 630000,
  level: 11,
  background: "4",
  identifyOnClick: true,
  showXY: true,
  zoomButtons: true,
  bgButton: true,
  language: "en",
};

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function App() {
  const [scriptStatus, setScriptStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [mapStatus, setMapStatus] = useState<MapStatus>("idle");
  const [draftConfig, setDraftConfig] = useState<MapConfig>(defaultConfig);
  const [appliedConfig, setAppliedConfig] = useState<MapConfig>(defaultConfig);
  const [layers, setLayers] = useState<string[]>(["16"]);
  const [pendingLayer, setPendingLayer] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [streetDealsForm, setStreetDealsForm] = useState({
    lot: "12422",
    parcel: "2",
    limit: "",
    offset: "",
  });
  const [streetDealsLoading, setStreetDealsLoading] = useState(false);
  const [streetDealsError, setStreetDealsError] = useState<string | null>(null);
  const [streetDealsData, setStreetDealsData] =
    useState<StreetDealsResult | null>(null);
  const [dbfFile, setDbfFile] = useState<File | null>(null);
  const [dbfCsvUrl, setDbfCsvUrl] = useState<string | null>(null);
  const [dbfSummary, setDbfSummary] = useState<DbfSummary | null>(null);
  const [dbfError, setDbfError] = useState<string | null>(null);
  const [dbfBusy, setDbfBusy] = useState(false);
  const isFirstRender = useRef(true);

  const appendLog = useCallback((message: string) => {
    setLogs((prev) => {
      const next = [`[${formatTimestamp()}] ${message}`, ...prev];
      return next.slice(0, MAX_LOGS);
    });
  }, []);

  const ensureScript = useCallback(() => {
    if (typeof window === "undefined" || scriptStatus !== "idle") return;
    setScriptStatus("loading");

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOVMAP_SCRIPT_URL}"]`,
    );

    const markReady = () => {
      setScriptStatus("ready");
      appendLog("GovMap API script loaded.");
    };

    if (existing) {
      if (window.govmap) {
        markReady();
      } else {
        existing.addEventListener("load", markReady, { once: true });
        existing.addEventListener(
          "error",
          () => {
            setScriptStatus("error");
            appendLog("Failed to load existing GovMap script tag.");
          },
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
    script.onerror = () => {
      setScriptStatus("error");
      appendLog("Failed to download GovMap API script.");
    };
    document.body.appendChild(script);
  }, [appendLog, scriptStatus]);

  useEffect(() => {
    ensureScript();
  }, [ensureScript]);

  const teardownMap = useCallback(() => {
    try {
      window.govmap?.dispose?.(MAP_ELEMENT_ID);
    } catch (error) {
      console.error("Failed to dispose GovMap instance", error);
    }
  }, []);

  const rebuildMap = useCallback(
    async (config?: MapConfig, overrideLayers?: string[]) => {
      if (!window.govmap) {
        appendLog("GovMap global is not ready yet.");
        return;
      }

      setMapStatus("initializing");
      teardownMap();

      const nextConfig = config ?? appliedConfig;
      const nextLayers = overrideLayers ?? layers;

      const payload: Record<string, unknown> = {
        token: nextConfig.token || undefined,
        level: Number(nextConfig.level) || undefined,
        center: {
          x: Number(nextConfig.centerX),
          y: Number(nextConfig.centerY),
        },
        background: nextConfig.background || undefined,
        layers: nextLayers.length ? nextLayers : undefined,
        identifyOnClick: nextConfig.identifyOnClick,
        showXY: nextConfig.showXY,
        zoomButtons: nextConfig.zoomButtons,
        bgButton: nextConfig.bgButton,
        language: nextConfig.language,
      };

      try {
        await window.govmap.createMap(MAP_ELEMENT_ID, payload);
        setMapStatus("ready");
        appendLog(
          `Map revived (layers: ${nextLayers.join(", ") || "none"}, level ${
            payload.level ?? "auto"
          }).`,
        );
      } catch (error) {
        console.error(error);
        setMapStatus("error");
        appendLog("Failed to create GovMap iframe. Check console for details.");
      }
    },
    [appliedConfig, appendLog, layers, teardownMap],
  );

  useEffect(() => {
    if (scriptStatus !== "ready" || !isFirstRender.current) return;
    isFirstRender.current = false;
    rebuildMap(defaultConfig, layers);
  }, [layers, rebuildMap, scriptStatus]);

  useEffect(() => () => teardownMap(), [teardownMap]);

  const handleApplyConfig = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAppliedConfig(draftConfig);
      rebuildMap(draftConfig);
    },
    [draftConfig, rebuildMap],
  );

  const handleLayerAdd = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = pendingLayer.trim();
      if (!trimmed) return;
      if (layers.includes(trimmed)) {
        appendLog(`Layer ${trimmed} already attached.`);
        setPendingLayer("");
        return;
      }
      const updated = [...layers, trimmed];
      setLayers(updated);
      setPendingLayer("");
      rebuildMap(appliedConfig, updated);
    },
    [appendLog, appliedConfig, layers, pendingLayer, rebuildMap],
  );

  const handleLayerRemove = useCallback(
    (layerId: string) => {
      const updated = layers.filter((layer) => layer !== layerId);
      setLayers(updated);
      rebuildMap(appliedConfig, updated);
    },
    [appliedConfig, layers, rebuildMap],
  );

  const resetToDefaults = useCallback(() => {
    setDraftConfig(defaultConfig);
    setAppliedConfig(defaultConfig);
    setLayers(["16"]);
    rebuildMap(defaultConfig, ["16"]);
    appendLog("Reset configuration back to defaults.");
  }, [appendLog, rebuildMap]);

  const prettyStreetDealsJson = useMemo(() => {
    if (!streetDealsData) return "";
    try {
      return JSON.stringify(streetDealsData.data, null, 2);
    } catch (error) {
      return String(streetDealsData.data);
    }
  }, [streetDealsData]);

  const dbfDownloadName = useMemo(() => {
    if (!dbfSummary) return "dbf-export.csv";
    const base = dbfSummary.fileName.replace(/\.dbf$/i, "") || "dbf-export";
    return `${base}.csv`;
  }, [dbfSummary]);

  useEffect(
    () => () => {
      if (dbfCsvUrl) {
        URL.revokeObjectURL(dbfCsvUrl);
      }
    },
    [dbfCsvUrl],
  );

  const handleStreetDealsCall = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { lot, parcel, limit, offset } = streetDealsForm;
      if (!lot.trim() || !parcel.trim()) {
        setStreetDealsError("Lot and parcel are required.");
        return;
      }

      setStreetDealsLoading(true);
      setStreetDealsError(null);
      setStreetDealsData(null);

      const search = new URLSearchParams();
      if (limit.trim()) search.set("limit", limit.trim());
      if (offset.trim()) search.set("offset", offset.trim());
      const queryString = search.toString();
      const resourceId = `${lot.trim()}-${parcel.trim()}`;
      const url = `/api/govmap/api/real-estate/street-deals/${resourceId}${
        queryString ? `?${queryString}` : ""
      }`;

      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "GovMap upstream error.");
        }
        setStreetDealsData(payload as StreetDealsResult);
        appendLog(`Street deals fetched for ${resourceId}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setStreetDealsError(message);
        appendLog(`Street deals request failed: ${message}`);
      } finally {
        setStreetDealsLoading(false);
      }
    },
    [appendLog, streetDealsForm],
  );

  const handleDbfFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setDbfFile(nextFile);
    setDbfSummary(null);
    setDbfError(null);
    setDbfCsvUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleDbfConvert = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!dbfFile) {
        setDbfError("Select a DBF file first.");
        return;
      }

      setDbfBusy(true);
      setDbfError(null);
      setDbfSummary(null);
      setDbfCsvUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      try {
        const buffer = await dbfFile.arrayBuffer();
        const result = convertDbfToCsv(buffer);
        const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
        const objectUrl = URL.createObjectURL(blob);
        setDbfCsvUrl(objectUrl);
        setDbfSummary({
          fileName: dbfFile.name,
          declaredRecords: result.recordCount,
          parsedRecords: result.parsedRecords,
          fields: result.fields.length,
          headerLength: result.headerLength,
          recordLength: result.recordLength,
        });
        appendLog(
          `Converted DBF "${dbfFile.name}" (${result.parsedRecords} row${
            result.parsedRecords === 1 ? "" : "s"
          }).`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse DBF file.";
        setDbfError(message);
        appendLog(`DBF conversion failed: ${message}`);
      } finally {
        setDbfBusy(false);
      }
    },
    [appendLog, dbfFile],
  );

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">GovMap Lab</p>
          <h1>Standalone reverse-engineering pad</h1>
          <p>
            Load the official govmap iframe, switch layers on the fly, and poke the
            undocumented street-deals endpoint without CORS drama.
          </p>
        </div>
        <div className="status-chip" data-state={mapStatus}>
          <span>Map status:</span>
          <strong>{mapStatus}</strong>
        </div>
      </header>

      <section className="layout">
        <div className="column">
          <article className="card">
            <header>
              <div>
                <p className="eyebrow">Embedded iframe</p>
                <h2>GovMap instance</h2>
              </div>
              <p className="script-state" data-state={scriptStatus}>
                Script {scriptStatus}
              </p>
            </header>
            <div className="map-shell">
              <div id={MAP_ELEMENT_ID} className="map-target" aria-live="polite" />
              {mapStatus === "error" && (
                <div className="map-overlay">
                  <strong>Map failed to load.</strong>
                  <span>Check your token, layer IDs, and browser console.</span>
                </div>
              )}
            </div>
            <p className="hint">
              Coordinates use the Israeli TM Grid (EPSG:2039). Layer IDs accept
              numeric or textual values from the GovMap layer catalogue.
            </p>
          </article>

          <article className="card">
            <header>
              <div>
                <p className="eyebrow">Event log</p>
                <h2>Recent actions</h2>
              </div>
              <button type="button" onClick={() => setLogs([])}>
                Clear
              </button>
            </header>
            <div className="log-box">
              {logs.length === 0 ? (
                <p className="empty">Waiting for activity…</p>
              ) : (
                logs.map((entry) => (
                  <p key={entry} className="log-entry">
                    {entry}
                  </p>
                ))
              )}
            </div>
          </article>
        </div>

        <div className="column">
          <article className="card">
            <header>
              <div>
                <p className="eyebrow">Bootstrap</p>
                <h2>Map configuration</h2>
              </div>
              <button type="button" onClick={resetToDefaults}>
                Reset
              </button>
            </header>
            <form className="form" onSubmit={handleApplyConfig}>
              <label>
                <span>API token</span>
                <input
                  placeholder="Paste your govmap token"
                  value={draftConfig.token}
                  onChange={(event) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      token: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="grid">
                <label>
                  <span>Center X</span>
                  <input
                    type="number"
                    value={draftConfig.centerX}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        centerX: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Center Y</span>
                  <input
                    type="number"
                    value={draftConfig.centerY}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        centerY: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="grid">
                <label>
                  <span>Zoom level</span>
                  <input
                    type="number"
                    value={draftConfig.level}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        level: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Background code</span>
                  <input
                    value={draftConfig.background}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        background: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                <span>Language</span>
                <input
                  value={draftConfig.language}
                  onChange={(event) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      language: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="toggles">
                {(["identifyOnClick", "showXY", "zoomButtons", "bgButton"] as Array<
                  keyof Pick<MapConfig, "identifyOnClick" | "showXY" | "zoomButtons" | "bgButton">
                >).map((key) => (
                  <label key={key} className="toggle">
                    <input
                      type="checkbox"
                      checked={draftConfig[key]}
                      onChange={(event) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    <span>{key}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="primary">
                Apply & refresh map
              </button>
            </form>
          </article>

          <article className="card">
            <header>
              <div>
                <p className="eyebrow">Layers</p>
                <h2>Layer manager</h2>
              </div>
            </header>
            <form className="layer-form" onSubmit={handleLayerAdd}>
              <input
                placeholder="16, PARCEL_HOKS, GASSTATIONS…"
                value={pendingLayer}
                onChange={(event) => setPendingLayer(event.target.value)}
              />
              <button type="submit">Add layer</button>
            </form>
            <div className="chips">
              {layers.length === 0 ? (
                <span className="empty">No layers attached.</span>
              ) : (
                layers.map((layer) => (
                  <span key={layer} className="chip">
                    {layer}
                    <button
                      type="button"
                      aria-label={`Remove layer ${layer}`}
                      onClick={() => handleLayerRemove(layer)}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </article>

          <article className="card">
            <header>
              <div>
                <p className="eyebrow">REST explorer</p>
                <h2>Street deals (layer 16)</h2>
                <p className="subtitle">
                  Uses the Vite dev proxy (`/api/govmap`) to reach the upstream
                  endpoint without CORS.
                </p>
              </div>
            </header>
            <form className="form" onSubmit={handleStreetDealsCall}>
              <div className="grid">
                <label>
                  <span>Lot</span>
                  <input
                    value={streetDealsForm.lot}
                    onChange={(event) =>
                      setStreetDealsForm((prev) => ({
                        ...prev,
                        lot: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Parcel</span>
                  <input
                    value={streetDealsForm.parcel}
                    onChange={(event) =>
                      setStreetDealsForm((prev) => ({
                        ...prev,
                        parcel: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="grid">
                <label>
                  <span>Limit</span>
                  <input
                    value={streetDealsForm.limit}
                    onChange={(event) =>
                      setStreetDealsForm((prev) => ({
                        ...prev,
                        limit: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Offset</span>
                  <input
                    value={streetDealsForm.offset}
                    onChange={(event) =>
                      setStreetDealsForm((prev) => ({
                        ...prev,
                        offset: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button type="submit" className="primary" disabled={streetDealsLoading}>
                {streetDealsLoading ? "Fetching…" : "Fetch street deals"}
              </button>
              {streetDealsError && <p className="error">{streetDealsError}</p>}
            </form>
            <div className="response-box">
              {streetDealsData ? (
                <>
                  <div className="response-meta">
                    <span>
                      Status: {streetDealsData.status} {streetDealsData.ok ? "✅" : "⚠️"}
                    </span>
                    <a href={streetDealsData.upstreamUrl} target="_blank" rel="noreferrer">
                      Open upstream URL
                    </a>
                  </div>
                  <pre>{prettyStreetDealsJson}</pre>
                </>
              ) : (
                <p className="empty">
                  Run the request to inspect the JSON payload GovMap returns for a
                  specific lot/parcel combination.
                </p>
              )}
            </div>
          </article>

          <article className="card">
            <header>
              <div>
                <p className="eyebrow">Utilities</p>
                <h2>DBF → CSV converter</h2>
                <p className="subtitle">Runs entirely in your browser; nothing gets uploaded.</p>
              </div>
            </header>
            <form className="form" onSubmit={handleDbfConvert}>
              <label>
                <span>DBF file</span>
                <input
                  type="file"
                  accept=".dbf,application/dbase"
                  onChange={handleDbfFileChange}
                />
              </label>
              <button type="submit" className="primary" disabled={dbfBusy}>
                {dbfBusy ? "Converting…" : "Convert to CSV"}
              </button>
              {dbfError && <p className="error">{dbfError}</p>}
            </form>
            {dbfSummary ? (
              <div className="response-box">
                <div className="dbf-summary">
                  <span>
                    <strong>Fields:</strong> {dbfSummary.fields}
                  </span>
                  <span>
                    <strong>Declared records:</strong> {dbfSummary.declaredRecords}
                  </span>
                  <span>
                    <strong>Parsed records:</strong> {dbfSummary.parsedRecords}
                  </span>
                  <span>
                    <strong>Record length:</strong> {dbfSummary.recordLength} bytes
                  </span>
                  <span>
                    <strong>Header length:</strong> {dbfSummary.headerLength} bytes
                  </span>
                </div>
                {dbfCsvUrl && (
                  <a className="download-link" href={dbfCsvUrl} download={dbfDownloadName}>
                    Download {dbfDownloadName}
                  </a>
                )}
              </div>
            ) : (
              <p className="hint">Select a DBF export to convert it locally.</p>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}

export default App;
