import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { getAssetPath, mediaToExtension } from "./assets";
import { randomBytes } from "crypto";
import { uploadVideoToS3 } from "./s3";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = await getVideo(cfg.db, videoId);
  if(!video) throw new NotFoundError("video not found");
  if(video.userID !== userID){
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
  
  const processedVideoPath = await processVideoForFastStart(assetPath);
  await uploadVideoToS3(cfg, key, processedVideoPath, mediaType);

  video.videoURL = `${key}`;

  await updateVideo(cfg.db, video);

  await Bun.file(assetPath).delete();

  const signedVideo = await dbVideoToSignedVideo(cfg, video);
  return respondWithJSON(200, signedVideo);
}

export async function getVideoAspectRatio(filePath: string){
  const proc = Bun.spawn(
    [
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
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  if(exitCode !== 0){
    throw new Error(`ffprobe error: ${stderrText}`);
  }

  const data = JSON.parse(stdoutText);
  if(!data.streams || data.streams.length === 0){
    throw new Error("No video streams found");
  }

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

export async function processVideoForFastStart(inputFilePath: string) {
  const outputPath = `${inputFilePath}.processed`;
  const proc = Bun.spawn([
    "ffmpeg",
    "-i",
    inputFilePath,
    "-movflags",
    "faststart",
    "-map_metadata",
    "0",
    "-codec",
    "copy",
    "-f",
    "mp4",
    outputPath
  ], {
    stderr: "pipe"
  });

  const stderrText = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  if(exitCode !== 0){
    throw new Error(`ffmpeg error: ${stderrText}`);
  }

  return outputPath;
}

export function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
  const url = cfg.s3Client.presign(key, {
    expiresIn: expireTime,
  });

  return url;
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if(!video.videoURL){
    throw new BadRequestError("Video does not have key");
  }
  video.videoURL = generatePresignedURL(cfg, video.videoURL, 3600);
  return video;
}