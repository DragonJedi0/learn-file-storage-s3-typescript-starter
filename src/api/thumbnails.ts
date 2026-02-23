import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const fileData = await req.formData();
  const fileThumbnail = fileData.get("thumbnail");
  if(!(fileThumbnail instanceof File)){
    throw new BadRequestError("Invalid thumbnail");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if(fileThumbnail.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("File size too large");
  }

  const thumbnail: Thumbnail = {
    data: await fileThumbnail.arrayBuffer(),
    mediaType: fileThumbnail.type
  }
  const videoData = await getVideo(cfg.db, videoId);
  if(!videoData) throw new NotFoundError("video not found");
  if(videoData?.userID !== userID){
    throw new UserForbiddenError("User not authorized");
  }

  const base64Encoded = Buffer.from(thumbnail.data).toString("base64");
  const base64DataURL = `data:${thumbnail.mediaType};base64,${base64Encoded}`;

  videoData.thumbnailURL = base64DataURL;

  await updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
