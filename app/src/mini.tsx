import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MiniApp } from "./MiniApp";
import "./base.css";
import "./mini.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>,
);
