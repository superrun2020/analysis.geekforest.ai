import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import "./globals.css";
import ProductBrainPage from "./page";
import SharedReportPage from "./shared-report/page";
import SharedReportByIdPage from "./shared-report/[shareId]/page";

function RouterShim() {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  const sharedMatch = pathname.match(/^\/shared-report\/([^/]+)$/);
  if (sharedMatch) {
    return <SharedReportByIdPage params={{ shareId: decodeURIComponent(sharedMatch[1]) }} />;
  }
  if (pathname === "/shared-report") return <SharedReportPage />;
  return <ProductBrainPage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#2563eb",
          colorInfo: "#2563eb",
          borderRadius: 12,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
        },
      }}
    >
      <AntdApp>
        <RouterShim />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
