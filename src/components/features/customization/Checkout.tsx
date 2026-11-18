import { useMemo, useRef } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { checkoutHtml, type CustomizationPayment } from "@/lib/customization-payment";
import { API_URL } from "@/lib/env";

/** No session cookies, bearer tokens, or payment secrets enter the WebView.
 * Its redirect is only a prompt to check the order with our authenticated API.
 */
export function Checkout({
  payment,
  onClose,
}: {
  payment: CustomizationPayment;
  onClose: () => void;
}) {
  const finished = useRef(false);
  const callback = `${API_URL}/api/customization/payments/mobile-return`;
  const source = useMemo(
    () => ({ html: checkoutHtml(payment, callback), baseUrl: API_URL }),
    [payment, callback]
  );
  const close = () => {
    if (!finished.current) {
      finished.current = true;
      onClose();
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#121218" }}>
        <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: "white", fontWeight: "700" }}>Secure checkout</Text>
          <Pressable onPress={close} accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: "#37c9a4" }}>Close & check payment</Text>
          </Pressable>
        </View>
        <WebView
          source={source}
          originWhitelist={["https://*", "http://*", "about:blank"]}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
          onShouldStartLoadWithRequest={(request) => {
            if (request.url.split("?")[0] === callback) {
              close();
              return false;
            }
            return /^(https?:|about:blank)/.test(request.url);
          }}
          onError={close}
        />
      </SafeAreaView>
    </Modal>
  );
}
