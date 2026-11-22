import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyAppearance, readAppearance } from "./appearance";
import "./styles.css";
applyAppearance(readAppearance());
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
