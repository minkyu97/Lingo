import "./style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "./App.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OptionsApp />
    </StrictMode>,
  );
}
