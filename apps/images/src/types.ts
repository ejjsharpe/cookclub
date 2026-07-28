export type Env = Cloudflare.Env;

// Re-export service types for convenience
export type {
  ImageService,
  PresignedUrlResponse,
  VerifyResponse,
  MoveResult,
  MoveResponse,
  NormalizeImageResponse,
  UploadImageResponse,
} from "./service";

export interface TransformOptions {
  width: number;
  height?: number;
  fit: "cover" | "contain" | "scale-down" | "crop";
  format: "auto";
  quality: number;
  metadata: "none";
  anim: false;
  sharpen?: number;
}

export interface PresignedUrlRequest {
  key: string;
  contentType: string;
  expiresIn?: number;
  maxFileSize?: number;
}
