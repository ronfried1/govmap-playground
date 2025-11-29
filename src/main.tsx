import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MapStandalone from "./map";

const path = window.location.pathname.toLowerCase();
const isStandaloneMap = path.startsWith("/map") || path.startsWith("/standalone");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isStandaloneMap ? <MapStandalone /> : <App />}</React.StrictMode>,
);
