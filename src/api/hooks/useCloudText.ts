import { useMutation } from "@tanstack/react-query";
import { api } from "../client";

// Text features. Synchronous V1 endpoints - no V2 job queue involvement.
// Errors surface via { error, kind,... } envelopes mapped from modules.cloud.errors.

interface PromptEnhanceRequest {
  prompt: string;
  provider: string;
  model: string;
  system_prompt?: string | undefined;
  nsfw?: boolean | undefined;
}

interface PromptEnhanceResponse {
  enhanced: string;
  provider: string;
  model: string;
}

export function useCloudPromptEnhance() {
  return useMutation({
    mutationFn: (req: PromptEnhanceRequest) =>
      api.post<PromptEnhanceResponse>("/sdapi/v1/cloud/prompt-enhance", req),
  });
}

interface CloudCaptionRequest {
  image: string; // base64
  provider: string;
  model: string;
  prompt?: string | undefined;
}

interface CloudCaptionResponse {
  caption: string;
  provider: string;
  model: string;
}

export function useCloudCaption() {
  return useMutation({
    mutationFn: (req: CloudCaptionRequest) =>
      api.post<CloudCaptionResponse>("/sdapi/v1/cloud/caption", req),
  });
}

interface CloudVqaRequest {
  image: string; // base64
  question: string;
  provider: string;
  model: string;
}

interface CloudVqaResponse {
  answer: string;
  provider: string;
  model: string;
}

export function useCloudVqa() {
  return useMutation({
    mutationFn: (req: CloudVqaRequest) => api.post<CloudVqaResponse>("/sdapi/v1/cloud/vqa", req),
  });
}
