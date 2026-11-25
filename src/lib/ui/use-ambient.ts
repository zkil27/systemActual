"use client";

import { useEffect } from "react";
import { registerAmbientShop, type AmbientShop } from "@/lib/ui/ambient";

/**
 * Show a shop's colors in the background while this component is mounted and
 * `shop` is set. Pass null to leave the field on Kyna pink.
 */
export function useAmbientShop(shop: AmbientShop | null | undefined): void {
  useEffect(() => {
    if (!shop) return;
    return registerAmbientShop(shop);
  }, [shop]);
}
