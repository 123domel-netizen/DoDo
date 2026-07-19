import { useEffect, useState } from "react";
import { Hash } from "lucide-react";
import { signedUrlFor } from "@/lib/chat/upload";

interface ChannelIconProps {
  iconUrl: string | null | undefined;
  size?: number;
  className?: string;
}

/** Ikona kanału z bucketu prywatnego (signed URL) albo Hash. */
export function ChannelIcon({ iconUrl, size = 15, className = "" }: ChannelIconProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!iconUrl) {
      setSrc(null);
      return;
    }
    void signedUrlFor(iconUrl).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [iconUrl]);

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
