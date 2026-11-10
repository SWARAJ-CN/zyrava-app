import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { useOffline } from "@/components/providers/OfflineProvider";
import { IMPORT_LIMITS } from "@/lib/offline";
import { formatBytes } from "@/lib/format";

/**
 * The way in for audio the user already owns. A folder is one click where the
 * browser can hand back a directory tree; everywhere else the same files are
 * reachable by picking them directly.
 *
 * Native swap: the hidden `<input type=file webkitdirectory>` becomes the
 * OfflineProvider's own `importFiles()` — expo-document-picker opened as a
 * multi-select over all file types, and the AUDIO_EXT extension filter plus
 * the IMPORT_LIMITS caps (maxFiles / maxBytes) are enforced inside the ported
 * lib/offline `collectPickedFiles`, which feeds the same `importing` progress
 * this sheet reads. showDirectoryPicker has no RN twin, so the folder branch's
 * copy stays exactly as the "can't open a whole folder" note below.
 */
export function ImportSongsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canPickFolder, importFolder, importFiles, importing, locals } = useOffline();

  const busy = importing !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Songs on your device"
      description="Add audio you own and it plays here with no connection at all."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <View className="flex-col gap-3">
        <View className="flex-row flex-wrap gap-2.5">
          {canPickFolder ? (
            <Button
              variant="primary"
              onClick={() => void importFolder()}
              disabled={busy}
              loading={busy}
            >
              <Icon name="music" className="size-4" />
              Choose a folder
            </Button>
          ) : null}
          <Button
            variant={canPickFolder ? "outline" : "primary"}
            onClick={() => void importFiles()}
            disabled={busy}
          >
            <Icon name="plus" className="size-4" />
            Choose files
          </Button>
        </View>

        {busy ? (
          <View className="flex-row items-center gap-2">
            <Icon name="loader" className="size-3.5 motion-safe:animate-spin text-muted" />
            <Text className="text-xs text-muted">
              {importing && importing.total
                ? `Adding ${importing.done} of ${importing.total}…`
                : "Looking through that folder…"}
            </Text>
          </View>
        ) : (
          <Text className="text-xs text-muted">
            {canPickFolder
              ? "The folder is remembered, so adding what landed in it later is one click."
              : "This browser can't open a whole folder — pick the files themselves."}
          </Text>
        )}

        <View className="flex-row flex-wrap gap-px overflow-hidden rounded-lg border border-separator bg-separator">
          <View className="w-1/2 bg-surface px-3 py-2">
            <Text className="text-xs text-faint-foreground">Songs here</Text>
            <Text className="mt-0.5 text-sm font-semibold text-foreground">{locals.length}</Text>
          </View>
          <View className="w-1/2 bg-surface px-3 py-2">
            <Text className="text-xs text-faint-foreground">Room used</Text>
            <Text className="mt-0.5 text-sm font-semibold text-foreground">
              {formatBytes(locals.reduce((sum, track) => sum + track.bytes, 0))}
            </Text>
          </View>
        </View>

        <Text className="text-[11px] text-faint-foreground">
          Up to {IMPORT_LIMITS.maxFiles} files at a time, none larger than{" "}
          {formatBytes(IMPORT_LIMITS.maxBytes)}. Names like “Artist - Title” are read as the
          artist and the song.
        </Text>
      </View>
    </Modal>
  );
}
