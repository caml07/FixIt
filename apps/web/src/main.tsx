import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element was not found.");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
