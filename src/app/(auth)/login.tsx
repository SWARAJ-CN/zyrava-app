import { useEffect, useState, type JSX } from "react";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { getTrendingSlides, type TrendingSlide } from "@/lib/trending";

/* The web page exported `metadata` ("Sign in · ZYRAVA" / description) and ran
   `dynamic = "force-dynamic"`; document metadata has no native twin, so both
   are dropped. The carousel is filled from the catalogue at open time — the
   web did it server-side, here it happens in a mount effect over the same
   `getTrendingSlides`, whose 5-minute module cache keeps repeat opens off
   the catalogue API. */
export default function LoginScreen(): JSX.Element {
  const [slides, setSlides] = useState<TrendingSlide[]>([]);

  useEffect(() => {
    let alive = true;
    getTrendingSlides()
      .then((next) => {
        if (alive) setSlides(next);
      })
      .catch(() => {
        /* the carousel's own fallback is the safety net */
      });
    return () => {
      alive = false;
    };
  }, []);

  return <AuthScreen mode="login" initialSlides={slides} />;
}
