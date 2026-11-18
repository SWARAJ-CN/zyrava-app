import LottieView from "lottie-react-native";
import { View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import serverWake from "../../../assets/animations/server-wake.json";

/** The original PWA animation, extracted from server-wake.lottie and bundled
 * locally. A sleeping account server never has to serve its own loader. */
export function WakeAnimation() {
  const reduced = useReducedMotion();
  return (
    <View accessible accessibilityLabel="Waking up the server" style={{ width: 136, height: 136 }}>
      <LottieView
        source={serverWake}
        autoPlay={!reduced}
        loop={!reduced}
        progress={reduced ? 0.5 : undefined}
        resizeMode="contain"
        enableMergePathsAndroidForKitKatAndAbove
        style={{ width: 136, height: 136 }}
      />
    </View>
  );
}
