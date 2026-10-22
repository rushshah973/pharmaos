"use client";

import { useEffect } from "react";

/**
 * Starts downloading the 3D scene bundle (three.js, Drei, post-processing) while the page's data is still loading,
 * so the scene is ready when WarehouseView mounts instead of starting the download only then.
 */
export function Preload3D() {
  useEffect(() => {
    void import("./Scene3D");
  }, []);
  return null;
}
