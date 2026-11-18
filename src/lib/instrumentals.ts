import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { getItem, setItem } from "./store";

export type Instrumental = { uri: string; name: string };
const MAX_BYTES = 100 * 1024 * 1024;
const extensions = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"]);
const root = () => new Directory(Paths.document, "zyrava-instrumentals");
const key = (id: string) => `zyrava.instrumental.${encodeURIComponent(id)}`;

export function getInstrumental(id: string): Instrumental | null {
  try {
    const value = JSON.parse(getItem(key(id)) ?? "null") as Instrumental | null;
    if (!value || typeof value.name !== "string" || typeof value.uri !== "string") return null;
    if (!value.uri.startsWith(`${root().uri.replace(/\/$/, "")}/`)) return null;
    return new File(value.uri).exists ? value : null;
  } catch {
    return null;
  }
}

/** Keeps a local instrumental paired with its exact catalogue song, without uploading it. */
export async function pickInstrumental(id: string): Promise<Instrumental | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "audio/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const extension = asset.name.split(".").pop()?.toLowerCase() ?? "";
  if (!extensions.has(extension))
    throw new Error("Choose an MP3, M4A, AAC, WAV, FLAC, OGG or Opus instrumental.");
  const source = new File(asset.uri);
  if (!source.exists || source.size <= 0)
    throw new Error("That audio file is empty or unavailable.");
  if (source.size > MAX_BYTES) throw new Error("Choose an instrumental smaller than 100 MB.");
  const directory = root();
  directory.create({ idempotent: true, intermediates: true });
  const previous = getInstrumental(id);
  const target = new File(
    directory,
    `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  );
  try {
    await source.copy(target);
    const saved = { uri: target.uri, name: asset.name };
    setItem(key(id), JSON.stringify(saved));
    // The picker is opened after the provider switches back to original audio.
    if (previous && previous.uri !== saved.uri) {
      try {
        new File(previous.uri).delete();
      } catch {
        /* replacement remains usable */
      }
    }
    return saved;
  } catch (error) {
    if (target.exists) target.delete();
    throw error;
  }
}
