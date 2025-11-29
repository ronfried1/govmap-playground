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
    govmap?: any
  }
}

type MapConfig = any

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

type PlaygroundMethodId =
  | "getLayerEntities"
  | "getEntities"
  | "identify"
  | "zoomToGeometry"
  | "getLayerExtent"
  | "custom";

type PlaygroundFieldType = "text" | "number" | "textarea";

type PlaygroundField = {
  key: string;
  label: string;
  type: PlaygroundFieldType;
  placeholder?: string;
  helper?: string;
};

type PlaygroundMethod = {
  id: PlaygroundMethodId;
  label: string;
  description: string;
  fields: PlaygroundField[];
};

type PlaygroundRun = {
  methodId: PlaygroundMethodId;
  methodName: string;
  payload: unknown;
  result: unknown;
  success: boolean;
  startedAt: number;
  endedAt: number;
  note?: string;
};

type PlaygroundHistoryItem = {
  id: string;
  methodId: PlaygroundMethodId;
  methodName: string;
  payloadPreview: string;
  success: boolean;
  timestamp: number;
};

const GOVMAP_SCRIPT_URL = "https://www.govmap.gov.il/govmap/api/govmap.api.js";
const MAP_ELEMENT_ID = "govmap-stage";
const MAX_LOGS = 40;
const PLAYGROUND_STORAGE_KEY = "govmap-playground";
const METHOD_HISTORY_MAX = 10;
const DEFAULT_ACTIVE_LAYER = "layer_215978";
const ENV_GOVMAP_TOKEN = import.meta.env.VITE_GOVMAP_TOKEN ?? "";
const PLAYGROUND_TIMEOUT_MS = 8000;
const DEFAULT_LAYERS = ["SUB_GUSH_ALL", "PARCEL_ALL", "layer_215978", "nadlan"];

const defaultConfig: MapConfig = {
  token: ENV_GOVMAP_TOKEN,
  centerX: 200000,
  centerY: 630000,
  level: 7,
  background: 2,
  layersMode: 1,
  isEmbeddedToggle: false,
  identifyOnClick: false,
  showXY: true,
  zoomButtons: true,
  language: "en",
};

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function safeStringify(value: unknown, space = 2) {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    console.warn("Failed to stringify value", error);
    return String(value);
  }
}

function summarizePayload(payload: unknown, limit = 220) {
  const raw = safeStringify(payload, 0);
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = PLAYGROUND_TIMEOUT_MS) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms. Check token/auth.`)), ms),
    ),
  ]);
}

function App() {
  const [scriptStatus, setScriptStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [mapStatus, setMapStatus] = useState<MapStatus>("idle");
  const [draftConfig, setDraftConfig] = useState<MapConfig>(defaultConfig);
  const [appliedConfig, setAppliedConfig] = useState<MapConfig>(defaultConfig);
  const [layers, setLayers] = useState<string[]>(DEFAULT_LAYERS);
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
  const [activeLayerName, setActiveLayerName] = useState(DEFAULT_ACTIVE_LAYER);
  const [selectedMethod, setSelectedMethod] = useState<PlaygroundMethodId>("getLayerEntities");
  const [methodParams, setMethodParams] = useState<Record<PlaygroundMethodId, Record<string, unknown>>>({
    getLayerEntities: { layerName: DEFAULT_ACTIVE_LAYER, where: "" },
    getEntities: { layerName: DEFAULT_ACTIVE_LAYER, objectIds: "" },
    identify: { x: 200000, y: 630000, level: 12 },
    zoomToGeometry: {
      wkt: "POLYGON((199900 630000,199950 630050,199900 630100,199850 630050,199900 630000))",
      srid: 2039,
      color: "#de3b8a",
      name: "wkt-geometry",
    },
    getLayerExtent: { layerName: DEFAULT_ACTIVE_LAYER },
    custom: { methodName: "getLayerEntities", rawPayload: '{ "layerName": "nadlan" }' },
  });
  const [playgroundResult, setPlaygroundResult] = useState<PlaygroundRun | null>(null);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundBusy, setPlaygroundBusy] = useState(false);
  const [playgroundHistory, setPlaygroundHistory] = useState<PlaygroundHistoryItem[]>([]);
  const isFirstRender = useRef(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PLAYGROUND_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        activeLayer?: string;
        selectedMethod?: PlaygroundMethodId;
        methodParams?: Record<PlaygroundMethodId, Record<string, unknown>>;
        history?: PlaygroundHistoryItem[];
      };
      if (parsed.activeLayer) setActiveLayerName(parsed.activeLayer);
      if (parsed.selectedMethod) setSelectedMethod(parsed.selectedMethod);
      if (parsed.methodParams) {
        setMethodParams((prev) => ({ ...prev, ...parsed.methodParams }));
      }
      if (parsed.history) setPlaygroundHistory(parsed.history);
    } catch (error) {
      console.warn("Failed to restore playground state", error);
    }
  }, []);

  useEffect(() => {
    try {
      const payload = {
        activeLayer: activeLayerName,
        selectedMethod,
        methodParams,
        history: playgroundHistory,
      };
      localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("Failed to persist playground state", error);
    }
  }, [activeLayerName, methodParams, playgroundHistory, selectedMethod]);

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
        // visibleLayers:nextLayers,
        layers: nextLayers,
        background: nextConfig.background,
        layersMode: nextConfig.layersMode ?? 1,
        isEmbeddedToggle: nextConfig.isEmbeddedToggle ?? false,
        identifyOnClick: nextConfig.identifyOnClick,
        showXY: nextConfig.showXY,
        zoomButtons: nextConfig.zoomButtons,
        bgButton: nextConfig.bgButton,
        language: nextConfig.language,
      };
      console.log("payload", payload);
      
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
      appendLog("Base map configuration is locked. Edit .env and reload to change token/settings.");
      setAppliedConfig(defaultConfig);
      setDraftConfig(defaultConfig);
      rebuildMap(defaultConfig, DEFAULT_LAYERS);
    },
    [appendLog, rebuildMap],
  );

  const handleLayerAdd = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      appendLog("Layer list is locked to defaults. Use map legend toggles instead.");
      setPendingLayer("");
    },
    [appendLog],
  );

  const handleLayerRemove = useCallback(
    (layerId: string) => {
      appendLog(`Layer list is locked; cannot remove ${layerId}. Use map legend toggles instead.`);
    },
    [appendLog],
  );

  const resetToDefaults = useCallback(() => {
    setDraftConfig(defaultConfig);
    setAppliedConfig(defaultConfig);
    setLayers(DEFAULT_LAYERS);
    rebuildMap(defaultConfig, DEFAULT_LAYERS);
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

  const playgroundMethods = useMemo<PlaygroundMethod[]>(
    () => [
      {
        id: "getLayerEntities",
        label: "getLayerEntities",
        description: "Fetch all entities for a layer (supports where/paging).",
        fields: [
          { key: "layerName", label: "Layer name", type: "text", placeholder: "nadlan" },
          { key: "where", label: "Where clause", type: "text", placeholder: "1=1" },
          { key: "pageNumber", label: "Page number", type: "number", placeholder: "1" },
          { key: "pageSize", label: "Page size", type: "number", placeholder: "500" },
        ],
      },
      {
        id: "getEntities",
        label: "getEntities",
        description: "Try govmap.getEntities if available; falls back to getLayerEntities.",
        fields: [
          { key: "layerName", label: "Layer name", type: "text", placeholder: "nadlan" },
          {
            key: "objectIds",
            label: "Object IDs (comma separated)",
            type: "text",
            placeholder: "12345,12346",
          },
        ],
      },
      {
        id: "identify",
        label: "identifyByXYAndLayer",
        description: "Run identify for X/Y against a layer at the current zoom level.",
        fields: [
          { key: "x", label: "X (TM Grid)", type: "number", placeholder: "200000" },
          { key: "y", label: "Y (TM Grid)", type: "number", placeholder: "630000" },
          { key: "level", label: "Zoom level", type: "number", placeholder: "12" },
          { key: "layerName", label: "Layer name", type: "text", placeholder: "nadlan" },
        ],
      },
      {
        id: "zoomToGeometry",
        label: "zoomToGeometry (displayGeometries)",
        description: "Display WKT on the map (uses displayGeometries under the hood).",
        fields: [
          {
            key: "wkt",
            label: "WKT geometry",
            type: "textarea",
            placeholder: "POLYGON((...))",
          },
          { key: "srid", label: "SRID", type: "number", placeholder: "2039" },
          { key: "color", label: "Color", type: "text", placeholder: "#de3b8a" },
          { key: "name", label: "Name", type: "text", placeholder: "test-geometry" },
        ],
      },
      {
        id: "getLayerExtent",
        label: "getLayerExtent (via getLayerData)",
        description: "Fetch layer metadata/extent using getLayerData.",
        fields: [{ key: "layerName", label: "Layer name", type: "text", placeholder: "nadlan" }],
      },
      {
        id: "custom",
        label: "Custom method",
        description: "Call any window.govmap method with raw JSON payload.",
        fields: [
          { key: "methodName", label: "Method name", type: "text", placeholder: "getLayerEntities" },
          {
            key: "rawPayload",
            label: "Raw payload (JSON)",
            type: "textarea",
            placeholder: '{ "layerName": "nadlan" }',
            helper: "Leave empty to send undefined.",
          },
        ],
      },
    ],
    [],
  );

  const dbfDownloadName = useMemo(() => {
    if (!dbfSummary) return "dbf-export.csv";
    const base = dbfSummary.fileName.replace(/\.dbf$/i, "") || "dbf-export";
    return `${base}.csv`;
  }, [dbfSummary]);

  const currentMethod = useMemo(
    () => playgroundMethods.find((item) => item.id === selectedMethod) ?? playgroundMethods[0],
    [playgroundMethods, selectedMethod],
  );

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

  const updateMethodParam = useCallback(
    (methodId: PlaygroundMethodId, key: string, value: unknown) => {
      setMethodParams((prev) => ({
        ...prev,
        [methodId]: {
          ...(prev[methodId] ?? {}),
          [key]: value,
        },
      }));
    },
    [],
  );

  const resolveProgressResult = useCallback(async (output: unknown) => {
    if (
      output &&
      typeof output === "object" &&
      "progress" in output &&
      typeof (output as { progress?: unknown }).progress === "function"
    ) {
      return new Promise<unknown>((resolve) => {
        let lastChunk: unknown = null;
        // @ts-expect-error GovMap progress API
        output.progress((data: unknown) => {
          lastChunk = data;
          if ((data as { isCompleted?: boolean })?.isCompleted) {
            resolve(data);
          }
        });
        setTimeout(() => resolve(lastChunk ?? { message: "Request dispatched; no completion event yet." }), 1500);
      });
    }
    return output;
  }, []);

  const handlePlaygroundRun = useCallback(async () => {
    if (!window.govmap) {
      setPlaygroundError("GovMap global is not ready yet.");
      appendLog("GovMap playground: govmap is undefined.");
      return;
    }
    if (mapStatus !== "ready") {
      setPlaygroundError("Map is not ready yet. Wait for status 'ready'.");
      appendLog("GovMap playground: map not ready.");
      return;
    }

    const method = playgroundMethods.find((item) => item.id === selectedMethod);
    if (!method) return;

    const params = methodParams[selectedMethod] ?? {};
    const resolveLayerName = () => {
      const candidate = String(
        (params as { layerName?: string }).layerName ||
          activeLayerName ||
          layers[0] ||
          DEFAULT_ACTIVE_LAYER,
      ).trim();
      if (candidate.toLowerCase() === "undefined" || candidate.toLowerCase() === "null") {
        return DEFAULT_ACTIVE_LAYER;
      }
      return candidate || DEFAULT_ACTIVE_LAYER;
    };
    let payload: Record<string, unknown> | undefined;
    let callResult: unknown;
    let methodName = method.label;

    setPlaygroundBusy(true);
    setPlaygroundError(null);

    try {
      switch (selectedMethod) {
        case "getLayerEntities": {
          const layerName = resolveLayerName();
          if (!layerName) {
            throw new Error("Missing layerName. Set Active layer or provide Layer name.");
          }
          const where = String(params.where || "").trim();
          const pageNumber = Number(params.pageNumber || "") || undefined;
          const pageSize = Number(params.pageSize || "") || undefined;
          payload = {
            layerName,
            where: where || undefined,
            pageNumber,
            pageSize,
          };
          if (typeof window.govmap.getLayerEntities !== "function") {
            throw new Error("govmap.getLayerEntities is not available in this build.");
          }
          callResult = await withTimeout(
            window.govmap.getLayerEntities(payload, MAP_ELEMENT_ID),
            "getLayerEntities",
          );
          break;
        }
        case "getEntities": {
          const layerName = resolveLayerName();
          if (!layerName) {
            throw new Error("Missing layerName. Set Active layer or provide Layer name.");
          }
          const objectIdsRaw = String(params.objectIds || "").trim();
          const objectIds = objectIdsRaw
            ? objectIdsRaw
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean)
            : [];
          payload = {
            layerName,
            objectIds,
          };
          if (typeof window.govmap.getEntities === "function") {
            callResult = await withTimeout(
              window.govmap.getEntities(payload, MAP_ELEMENT_ID),
              "getEntities",
            );
          } else if (typeof window.govmap.getLayerEntities === "function") {
            methodName = "getLayerEntities (fallback)";
            callResult = await withTimeout(
              window.govmap.getLayerEntities(payload, MAP_ELEMENT_ID),
              "getLayerEntities",
            );
          } else {
            throw new Error("Neither govmap.getEntities nor govmap.getLayerEntities are available.");
          }
          break;
        }
        case "identify": {
          const x = Number(params.x ?? 0);
          const y = Number(params.y ?? 0);
          const level = Number(params.level ?? 0) || undefined;
          const layerName = resolveLayerName();
          if (!layerName) {
            throw new Error("Missing layerName. Set Active layer or provide Layer name.");
          }
          payload = {
            x,
            y,
            level,
            layers: [layerName],
          };
          if (typeof window.govmap.identifyByXYAndLayer !== "function") {
            throw new Error("govmap.identifyByXYAndLayer is not available in this build.");
          }
          callResult = await withTimeout(
            window.govmap.identifyByXYAndLayer(x, y, [layerName], MAP_ELEMENT_ID),
            "identifyByXYAndLayer",
          );
          break;
        }
        case "zoomToGeometry": {
          const wkt = String(params.wkt || "").trim();
          const srid = Number(params.srid ?? 2039) || 2039;
          const color = String(params.color || "#de3b8a");
          const name = String(params.name || "geometry");
          payload = {
            wkt,
            srid,
            color,
            name,
          };
          if (typeof window.govmap.displayGeometries !== "function") {
            throw new Error("govmap.displayGeometries is not available in this build.");
          }
          callResult = await withTimeout(
            resolveProgressResult(window.govmap.displayGeometries(payload, MAP_ELEMENT_ID)),
            "displayGeometries",
          );
          break;
        }
        case "getLayerExtent": {
          const layerName = resolveLayerName();
          if (!layerName) {
            throw new Error("Missing layerName. Set Active layer or provide Layer name.");
          }
          payload = { layerName };
          if (typeof window.govmap.getLayerData !== "function") {
            throw new Error("govmap.getLayerData is not available in this build.");
          }
          callResult = await withTimeout(
            window.govmap.getLayerData(payload, MAP_ELEMENT_ID),
            "getLayerData",
          );
          break;
        }
        case "custom": {
          const methodNameInput = String(params.methodName || "").trim();
          methodName = methodNameInput || "custom";
          const rawPayload = String(params.rawPayload || "").trim();
          let parsedPayload: unknown;
          if (rawPayload) {
            try {
              parsedPayload = JSON.parse(rawPayload);
            } catch (error) {
              throw new Error("Failed to parse JSON payload for custom method.");
            }
          }
          const fn = methodNameInput ? (window.govmap as Record<string, unknown>)[methodNameInput] : null;
          if (typeof fn !== "function") {
            throw new Error(`govmap.${methodNameInput || "?"} is not a function.`);
          }
          payload = (parsedPayload ?? undefined) as Record<string, unknown>;
          callResult = await resolveProgressResult(
            fn.length > 1 ? fn(parsedPayload, MAP_ELEMENT_ID) : fn(parsedPayload),
          );
          break;
        }
        default:
          throw new Error("Unsupported method selection.");
      }

      const finalizedResult = await resolveProgressResult(callResult);
      const now = Date.now();
      const run: PlaygroundRun = {
        methodId: selectedMethod,
        methodName,
        payload,
        result: finalizedResult,
        success: true,
        startedAt: now,
        endedAt: now,
      };
      setPlaygroundResult(run);
      setPlaygroundHistory((prev) => {
        const next: PlaygroundHistoryItem[] = [
          {
            id: `${now}-${selectedMethod}`,
            methodId: selectedMethod,
            methodName,
            payloadPreview: summarizePayload(payload),
            success: true,
            timestamp: now,
          },
          ...prev,
        ].slice(0, METHOD_HISTORY_MAX);
        return next;
      });
      appendLog(`Playground: ${methodName} executed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown playground error.";
      setPlaygroundError(message);
      const now = Date.now();
      setPlaygroundHistory((prev) => {
        const next: PlaygroundHistoryItem[] = [
          {
            id: `${now}-${selectedMethod}-error`,
            methodId: selectedMethod,
            methodName,
            payloadPreview: summarizePayload(payload),
            success: false,
            timestamp: now,
          },
          ...prev,
        ].slice(0, METHOD_HISTORY_MAX);
        return next;
      });
      appendLog(`Playground failed (${methodName}): ${message}`);
    } finally {
      setPlaygroundBusy(false);
    }
  }, [
    activeLayerName,
    appendLog,
    mapStatus,
    methodParams,
    playgroundMethods,
    resolveProgressResult,
    selectedMethod,
  ]);

  const clearPlaygroundHistory = useCallback(() => setPlaygroundHistory([]), []);

  const logResultToConsole = useCallback(() => {
    if (!playgroundResult) return;
    // eslint-disable-next-line no-console
    console.log("GovMap playground result", playgroundResult);
    appendLog("Playground result dumped to console.");
  }, [appendLog, playgroundResult]);

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
        <div className="hero-actions">
          <a className="nav-button" href="/map">
            Open standalone map
          </a>
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
                <p className="eyebrow">Playground</p>
                <h2>GovMap methods</h2>
                <p className="subtitle">Run docs APIs (getLayerEntities, identify, etc.) on the fly.</p>
              </div>
              <button type="button" onClick={clearPlaygroundHistory}>
                Clear history
              </button>
            </header>
            <div className="form">
              <label>
                <span>Active layer</span>
                <input
                  value={activeLayerName}
                  onChange={(event) => setActiveLayerName(event.target.value)}
                  placeholder="nadlan"
                />
              </label>
              <label>
                <span>Method</span>
                <select
                  value={selectedMethod}
                  onChange={(event) => setSelectedMethod(event.target.value as PlaygroundMethodId)}
                  style={{ padding: "0.6rem 0.8rem", borderRadius: "0.65rem", border: "1px solid #cbd5f5" }}
                >
                  {playgroundMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.label}
                    </option>
                  ))}
                </select>
                <span className="hint">{currentMethod?.description}</span>
              </label>
              {currentMethod?.fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  {field.type === "textarea" ? (
                    <textarea
                      value={String((methodParams[selectedMethod] ?? {})[field.key] ?? "")}
                      onChange={(event) => updateMethodParam(selectedMethod, field.key, event.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={String((methodParams[selectedMethod] ?? {})[field.key] ?? "")}
                      onChange={(event) =>
                        updateMethodParam(
                          selectedMethod,
                          field.key,
                          field.type === "number" ? Number(event.target.value) : event.target.value,
                        )
                      }
                      placeholder={field.placeholder}
                    />
                  )}
                  {field.helper && <span className="hint">{field.helper}</span>}
                </label>
              ))}
              <button type="button" className="primary" onClick={handlePlaygroundRun} disabled={playgroundBusy}>
                {playgroundBusy ? "Running..." : "Run method"}
              </button>
              {playgroundError && <p className="error">{playgroundError}</p>}
            </div>
            <div className="response-box">
              <div className="response-meta">
                <span>Last run</span>
                <span>{playgroundResult ? formatTimestamp(new Date(playgroundResult.endedAt)) : "n/a"}</span>
              </div>
              {playgroundResult ? (
                <>
                  <p className="hint">Payload: {summarizePayload(playgroundResult.payload)}</p>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.3rem 0" }}>
                    <button type="button" onClick={logResultToConsole}>
                      Log to console
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const text = safeStringify(playgroundResult.result);
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(text);
                          appendLog("Playground result copied to clipboard.");
                        }
                      }}
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre>{safeStringify(playgroundResult.result)}</pre>
                </>
              ) : (
                <p className="empty">Run a method to see the response here (full payload is also in console).</p>
              )}
            </div>
            <div className="response-box">
              <div className="response-meta">
                <strong>History</strong>
                <span>{playgroundHistory.length} saved</span>
              </div>
              {playgroundHistory.length === 0 ? (
                <p className="empty">No runs yet.</p>
              ) : (
                playgroundHistory.map((entry) => (
                  <p key={entry.id} className="log-entry">
                    {formatTimestamp(new Date(entry.timestamp))} | {entry.methodName} |{" "}
                    {entry.success ? "ok" : "error"} | {entry.payloadPreview}
                  </p>
                ))
              )}
            </div>
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
                <p className="empty">Waiting for activity...</p>
              ) : (
                logs.map((entry, index) => (
                  <p key={`${entry}-${index}`} className="log-entry">
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
                <p className="subtitle">Static setup to mirror the Landwisely map.</p>
              </div>
              <button type="button" onClick={resetToDefaults}>
                Reload defaults
              </button>
            </header>
            <div className="response-box">
              <p className="hint">Edit .env and reload to change these values.</p>
              <div className="dbf-summary">
                <span>
                  <strong>Token:</strong> {appliedConfig.token ? "from env" : "missing"}
                </span>
                <span>
                  <strong>Layers:</strong> {layers.join(", ")}
                </span>
                <span>
                  <strong>Background:</strong> {appliedConfig.background}
                </span>
                <span>
                  <strong>Identify on click:</strong> {appliedConfig.identifyOnClick ? "yes" : "no"}
                </span>
                <span>
                  <strong>Layers mode:</strong> {appliedConfig.layersMode ?? 1}
                </span>
                <span>
                  <strong>Zoom buttons:</strong> {appliedConfig.zoomButtons ? "yes" : "no"}
                </span>
              </div>
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
