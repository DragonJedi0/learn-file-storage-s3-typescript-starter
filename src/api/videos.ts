import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetPath, mediaToExtension } from "./assets";
import { randomBytes } from "crypto";
import { uploadVideoToS3 } from "./s3";
import { parseArgs } from "util";
import { getPositionOfLineAndCharacter } from "typescript";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoData = await getVideo(cfg.db, videoId);
  if(!videoData) throw new NotFoundError("video not found");
  if(videoData.userID !== userID){
    throw new UserForbiddenError("User not authorized");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if(!(file instanceof File)){
    throw new BadRequestError("Invalid video");
  }

  if(file.type !== "video/mp4"){
    throw new BadRequestError("Invaild file type (MP4)");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if(file.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("File size too large");
  }

  const data = await file.arrayBuffer();
  const mediaType = file.type;

  const ext = mediaToExtension(mediaType);
  const fileId = randomBytes(32).toString("hex");
  const filename = `${fileId}${ext}`;

  const assetPath = getAssetPath(cfg, filename);
  await Bun.write(assetPath, data);

  const aspectRatio = await getVideoAspectRatio(assetPath);
  const key = `${aspectRatio}/${filename}`;

  await uploadVideoToS3(cfg, key, assetPath, mediaType);

  videoData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;

  await updateVideo(cfg.db, videoData);

  await Bun.file(assetPath).delete();

  return respondWithJSON(200, null);
}

async function getVideoAspectRatio(filePath: string){
  const proc = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  if(await proc.exited !== 0){
    throw new Error(stderrText);
  }

  const data = JSON.parse(stdoutText);

  const { width, height } = data.streams[0];

  const aspectRatio = Math.floor(width/height);

  switch(aspectRatio){
    case 1:
      return "landscape";
    case 0:
      return "portrait";
    
    default:
      return "other";
  }
}