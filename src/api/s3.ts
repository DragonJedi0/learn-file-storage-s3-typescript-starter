import type { ApiConfig } from "../config";

export async function uploadVideoToS3(cfg: ApiConfig, key: string, proccessedFilePath: string, contentType: string){
    const s3File = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
    const file = Bun.file(proccessedFilePath);

    await s3File.write(file, { type: contentType });
}