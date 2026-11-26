import { Platform } from "@prisma/client";
import { shopeeConnector } from "./shopee";
import { tiktokConnector } from "./tiktok";
import type { ChannelConnector } from "./types";

const CONNECTORS: Record<Platform, ChannelConnector> = {
  [Platform.SHOPEE]: shopeeConnector,
  [Platform.TIKTOK]: tiktokConnector,
};

export function getChannelConnector(platform: Platform): ChannelConnector {
  return CONNECTORS[platform];
}

export function listChannelConnectors(): ChannelConnector[] {
  return Object.values(CONNECTORS);
}
