/* global __dirname */
// Native extension for the pinned audio-api package. Reapplied on every install/EAS build.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../node_modules/react-native-audio-api/android/src/main");
const marker = "// ZYRAVA_NOTIFICATION_LIKE_V1";
function patch(relative, transform) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(marker)) return;
  const replace = (text, from, to) => {
    if (!text.includes(from))
      throw new Error(`Audio API changed; review Zyrava notification patch: ${relative}`);
    return text.replace(from, to);
  };
  fs.writeFileSync(file, transform(source, replace));
}
patch("java/com/swmansion/audioapi/system/notification/PlaybackNotification.kt", (s, r) => {
  s = r(
    s,
    "  companion object {",
    `  companion object {
    ${marker}
    const val ACTION_LIKE = "com.zyrava.PLAYBACK_LIKE"
    fun emitLike(module: AudioAPIModule?, songId: String?) {
      if (songId.isNullOrEmpty()) return
      val context = module?.reactContext?.get() ?: return
      context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("zyravaPlaybackLike", com.facebook.react.bridge.Arguments.createMap().apply { putString("songId", songId) })
    }
`
  );
  s = r(
    s,
    "  private var isPlaying: Boolean = false",
    `  private var zyravaLiked = false
  private var zyravaLikeEnabled = false
  private var zyravaSongId: String? = null
  private var isPlaying: Boolean = false`
  );
  s = r(
    s,
    '          if (action == "SkipForward") {',
    `          if (action == ACTION_LIKE && zyravaLikeEnabled) {
            emitLike(audioAPIModule.get(), zyravaSongId)
          } else if (action == "SkipForward") {`
  );
  s = r(
    s,
    '    if (info.hasKey("title")) title',
    `    if (info.hasKey("zyravaLiked")) zyravaLiked = info.getBoolean("zyravaLiked")
    if (info.hasKey("zyravaLikeEnabled")) zyravaLikeEnabled = info.getBoolean("zyravaLikeEnabled")
    if (info.hasKey("zyravaSongId")) zyravaSongId = info.getString("zyravaSongId")
    updatePlaybackActionState()
    if (info.hasKey("title")) title`
  );
  s = r(
    s,
    "    pb = builder",
    `    if (zyravaLikeEnabled && !zyravaSongId.isNullOrEmpty()) {
      builder.addCustomAction(PlaybackStateCompat.CustomAction.Builder(
        ACTION_LIKE, if (zyravaLiked) "Unlike song" else "Like song",
        if (zyravaLiked) R.drawable.zyrava_heart_filled else R.drawable.zyrava_heart_outline
      ).build())
    }
    pb = builder`
  );
  s = r(
    s,
    "    if (actionsList.size > 3) {",
    `    if (zyravaLikeEnabled && !zyravaSongId.isNullOrEmpty()) {
      val likeIntent = Intent(ACTION_LIKE).apply {
        action = ACTION_LIKE
        setPackage(context.packageName)
        putExtra("songId", zyravaSongId)
      }
      val likePending = PendingIntent.getBroadcast(context, zyravaSongId.hashCode(), likeIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      notificationBuilder?.addAction(NotificationCompat.Action(
        if (zyravaLiked) R.drawable.zyrava_heart_filled else R.drawable.zyrava_heart_outline,
        if (zyravaLiked) "Unlike song" else "Like song", likePending
      ))
    }
    if (actionsList.size > 3) {`
  );
  return s;
});
patch("java/com/swmansion/audioapi/system/notification/PlaybackNotificationReceiver.kt", (s, r) =>
  r(
    s,
    "    when (intent?.action) {",
    `    ${marker}
    when (intent?.action) {
      PlaybackNotification.ACTION_LIKE -> {
        PlaybackNotification.emitLike(audioAPIModule, intent.getStringExtra("songId"))
      }
`
  )
);
const heart =
  "M12,21.35L10.55,20.03C5.4,15.36 2,12.28 2,8.5C2,5.42 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.09C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.42 22,8.5C22,12.28 18.6,15.36 13.45,20.04Z";
fs.mkdirSync(path.join(root, "res/drawable"), { recursive: true });
for (const filled of [true, false])
  fs.writeFileSync(
    path.join(root, `res/drawable/zyrava_heart_${filled ? "filled" : "outline"}.xml`),
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="${filled ? "#FFFFFFFF" : "#00000000"}" android:strokeColor="#FFFFFFFF" android:strokeWidth="${filled ? "0" : "1.7"}" android:pathData="${heart}"/></vector>\n`
  );

patch("java/com/swmansion/audioapi/system/MediaSessionManager.kt", (s, r) =>
  r(
    s,
    "    playbackFilter.addAction(PlaybackNotificationReceiver.ACTION_SKIP_BACKWARD)",
    `    playbackFilter.addAction(PlaybackNotificationReceiver.ACTION_SKIP_BACKWARD)
    ${marker}
    playbackFilter.addAction("com.zyrava.PLAYBACK_LIKE")`
  )
);
