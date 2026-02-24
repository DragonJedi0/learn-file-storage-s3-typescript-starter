import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getAssetPath, getAssetURL, mediaToExtension } from "./assets";
import { randomBytes } from "crypto";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const videoData = await getVideo(cfg.db, videoId);
  if(!videoData) throw new NotFoundError("video not found");
  if(videoData.userID !== userID){
    throw new UserForbiddenError("User not authorized");
  }

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if(!(file instanceof File)){
    throw new BadRequestError("Invalid thumbnail");
  }

  if(file.type !== "image/png" && file.type !== "image/jpeg"){
    throw new BadRequestError("Invaild file type (PNG, JPEG)");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if(file.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("File size too large");
  }

  const data = await file.arrayBuffer();
  const mediaType = file.type;

  const ext = mediaToExtension(mediaType);
  const fileId = randomBytes(32).toString("base64url");
  const filename = `${fileId}${ext}`;

  const assetPath = getAssetPath(cfg, filename);
  await Bun.write(assetPath, data);

  videoData.thumbnailURL = getAssetURL(cfg, filename);

  await updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
