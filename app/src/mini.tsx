import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MiniApp } from "./MiniApp";
import { applyAppearance, readAppearance } from "./appearance";
import "./base.css";
import "./mini.css";
applyAppearance(readAppearance());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>,
);
