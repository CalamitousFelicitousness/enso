import type { ComponentProps } from "react";
import { useMediaSrc } from "@/hooks/useMediaSrc";

type ImgProps = Omit<ComponentProps<"img">, "src" | "onError"> & { image: string };
type VideoProps = Omit<ComponentProps<"video">, "src" | "onError"> & { video: string };

/** An <img> of a server file, loaded once the session is known and again once after a renewal. */
export function MediaImg({ image, alt, ...props }: ImgProps) {
  const media = useMediaSrc(image);
  return <img {...props} alt={alt} src={media.src} onError={media.onError} />;
}

/** A <video> of a server file, loaded once the session is known and again once after a renewal. */
export function MediaVideo({ video, ...props }: VideoProps) {
  const media = useMediaSrc(video);
  // eslint-disable-next-line jsx-a11y/media-has-caption -- generated video has no caption track
  return <video {...props} src={media.src} onError={media.onError} />;
}
