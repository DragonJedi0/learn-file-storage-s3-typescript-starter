import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";
import path from "path";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaToExtension(mediaType: string): string{
  const fileExtension = mediaType.split("/");

  if(fileExtension.length != 2){
    return ".bin";
  }

  return `.${fileExtension[1]}`;
}

export function getAssetPath(cfg: ApiConfig, fileName: string){
  return path.join(cfg.assetsRoot, fileName);
}

export function getAssetURL(cfg: ApiConfig, fileName: string) {
  return `http://localhost:${cfg.port}/assets/${fileName}`;
}
