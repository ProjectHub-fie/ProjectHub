import { createRoot } from "react-dom/client";
import App from "./App";
import AdminApp from "./AdminApp";
import { ADMIN_BASE_PATH } from "@/lib/admin-routes";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

// One deployment, two logical areas: the dashboard lives under /pbad while the
// public website keeps every other path (including nested routes such as
// /project/:slug). Deciding here keeps the dashboard router off public URLs.
const isAdminArea =
  window.location.pathname === ADMIN_BASE_PATH ||
  window.location.pathname.startsWith(`${ADMIN_BASE_PATH}/`);

createRoot(rootElement).render(isAdminArea ? <AdminApp /> : <App />);
