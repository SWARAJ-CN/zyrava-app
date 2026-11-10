import { useEffect, useState, type JSX } from "react";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { getTrendingSlides, type TrendingSlide } from "@/lib/trending";

/* The web page exported `metadata` ("Create account · ZYRAVA" / description)
   and ran `dynamic = "force-dynamic"`; document metadata has no native twin,
   so both are dropped. Same mount-effect trend fill as the login route — the
   shared 5-minute module cache means only one of the two screens ever fans
   out to the catalogue per window. */
export default function RegisterScreen(): JSX.Element {
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

  return <AuthScreen mode="register" initialSlides={slides} />;
}
