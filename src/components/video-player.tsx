"use client";

import { useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import type { SeekTarget } from "@/lib/types";

interface VideoPlayerProps {
  hlsUrl: string;
  onTimeUpdate: (timeMs: number) => void;
  seekTo: SeekTarget | null;
}

export function VideoPlayer({ hlsUrl, onTimeUpdate, seekTo }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSeekId = useRef<number>(-1);

  // Initialize HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error("HLS fatal error:", data.type, data.details);
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = hlsUrl;
    }
  }, [hlsUrl]);

  // Time update handler
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      onTimeUpdate(Math.round(video.currentTime * 1000));
    }
  }, [onTimeUpdate]);

  // Seek when seekTo changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seekTo || seekTo.id === lastSeekId.current) return;
    lastSeekId.current = seekTo.id;
    video.currentTime = seekTo.timeMs / 1000;
    if (video.paused) {
      video.play().catch(() => {});
    }
  }, [seekTo]);

  return (
    <div className="rounded-lg overflow-hidden bg-surface-container-lowest">
      <video
        ref={videoRef}
        controls
        className="w-full aspect-video"
        onTimeUpdate={handleTimeUpdate}
        playsInline
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
}
