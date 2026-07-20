import { useEffect, useState } from "react";
import { Hash } from "lucide-react";
import { signedUrlFor } from "@/lib/chat/upload";
import {
  findChannelPreset,
  parseChannelPresetId,
} from "@/lib/chat/channelPresets";

interface ChannelIconProps {
  iconUrl: string | null | undefined;
  size?: number;
  className?: string;
}

/** Ikona kanału: preset emoji, publiczny URL, albo plik z bucketu (signed URL). */
export function ChannelIcon({ iconUrl, size = 15, className = "" }: ChannelIconProps) {
  const [src, setSrc] = useState<string | null>(null);
  const presetId = parseChannelPresetId(iconUrl);
  const preset = presetId ? findChannelPreset(presetId) : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!iconUrl || presetId || /^https?:\/\//i.test(iconUrl)) {
      setSrc(iconUrl && /^https?:\/\//i.test(iconUrl) ? iconUrl : null);
      return;
    }
    void signedUrlFor(iconUrl).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [iconUrl, presetId]);

  if (preset) {
    const fontSize = Math.max(10, Math.round(size * 0.52));
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{
          width: size,
          height: size,
          background: preset.bg,
          fontSize,
          lineHeight: 1,
        }}
        role="img"
        aria-label={preset.label}
      >
        {preset.emoji}
      </span>
    );
  }

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return <Hash size={size} className={className} />;
}
