interface CliMediaDownload {
  fileName: string;
  url: string | null;
  status: "ready" | "preparing" | "unavailable" | "failed";
  reason: string | null;
}

export interface CliRoundVideoDownload extends CliMediaDownload {
  roundNumber: number;
}

export interface CliSegmentVideoDownload extends CliMediaDownload {
  segmentId: string;
  sequence: number;
}

type SelectedDownload = (CliRoundVideoDownload | CliSegmentVideoDownload | (CliMediaDownload & { kind: "participant_video" | "interview_audio" })) & { label: string };

export function selectResponseMediaDownloads(
  mediaVersion: string | undefined,
  downloads: {
    videos: CliRoundVideoDownload[];
    segments?: CliSegmentVideoDownload[];
    participantVideo?: CliMediaDownload;
    audio?: CliMediaDownload;
  },
): SelectedDownload[] {
  const continuous = mediaVersion === "continuous_v2" || mediaVersion === "live_s2s_v1";
  const media: SelectedDownload[] = continuous && downloads.segments
    ? downloads.segments.map(segment => ({ ...segment, label: `Segment ${segment.sequence}` }))
    : downloads.videos.map(video => ({ ...video, label: `Round ${video.roundNumber}` }));
  if (downloads.participantVideo) {
    media.push({ ...downloads.participantVideo, kind: "participant_video", label: "Participant video" });
  }
  if (downloads.audio) {
    media.push({ ...downloads.audio, kind: "interview_audio", label: "Interview audio" });
  }
  return media;
}
