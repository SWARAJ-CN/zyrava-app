import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCommunity } from "@/components/providers/CommunityProvider";
import { MAX_CHAT_MESSAGE, type ChatPerson, type MessageItem } from "@/lib/community";

/* ------------------------------------------------------------------ *
 * Native port of the web Community ChatPanel.
 *
 * Every rail, row, copy string, timer-free behaviour and business rule is
 * preserved; the room is text-only on purpose, exactly like the web. Platform
 * substitutions only:
 *  • The panel is a full-screen surface (`fixed inset-0` → `absolute inset-0`).
 *    Escape-close and the body-scroll-lock are dropped — there are no keyboard
 *    listeners on native; closing goes through `onClose` (the (app)/chat route
 *    modal) falling back to the provider's `closeChat`, which also hides the
 *    overlay mount in AppChrome.
 *  • The thread scroll area becomes an inverted FlatList: offset 0 sits at the
 *    newest bubble, so the web's "within 160px of the bottom" pin check reads
 *    `contentOffset.y < 160` and the "scrollTop ≤ 48 → loadOlder" trigger
 *    reads as the remaining distance to the oldest end. Day separators are
 *    emitted per inverted row so they still paint above each day's bubbles.
 *  • Enter-to-send is the keyboard's Send key (`keyboardReturnKey="send"` +
 *    `onSubmitEditing`). Shift+Enter starting a line is not a thing on a
 *    native soft keyboard — the composer is multiline and keeps the hint copy.
 *  • Presence dots read from `onlineIds` (the live socket set); the text
 *    states ("Online now" / "Last seen …") keep using `person.online` like
 *    the web.
 *  • Web-only affordances dropped: hover transitions, `aria-*` state (mapped
 *    to accessibility props), the desktop empty-thread pane (`md:flex` —
 *    phones never showed it), `dock-scroll` overflow styling.
 *  • Token bridge: the web's `border-dock-line` maps to `border-separator`,
 *    `bg-dock-active` to `bg-surface-secondary` (mobile has no dock tokens).
 * ------------------------------------------------------------------ */

type Rail = "threads" | "people" | "requests";

const ROW = "flex-row w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-[13px]";

/** The presence dot every list shares, so green means the same thing anywhere. */
function Presence({ online, size = "md" }: { online: boolean; size?: "sm" | "md" }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      className={cn(
        "flex-none rounded-full",
        size === "md" ? "size-2.5" : "size-2",
        online ? "bg-[oklch(0.78_0.16_150)]" : "bg-faint-foreground/45"
      )}
    />
  );
}

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  // Intl works in Hermes (PORTING_CONVENTIONS #8); the web's
  // toLocaleDateString(day, month short) is the app's own formatDate.
  return formatDate(value, { day: "numeric", month: "short" });
}

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDate(value, { day: "numeric", month: "short", year: "numeric" });
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="px-2.5 pb-2 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted">
      {children}
    </Text>
  );
}

function Avatar({ person, online }: { person: ChatPerson; online: boolean }) {
  return (
    <View className="relative flex-none">
      <View className="size-9 items-center justify-center rounded-full bg-surface-secondary">
        <Text className="text-[13px] font-semibold text-foreground">{initials(person.name)}</Text>
      </View>
      <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-[2px]">
        <Presence online={online} size="sm" />
      </View>
    </View>
  );
}

/** One row in the inverted thread list: a bubble or a day separator. */
type ChatRow =
  | { key: string; kind: "day"; day: string }
  | { key: string; kind: "message"; message: MessageItem };

/**
 * The community room: who asked to talk, the threads you have, and everyone
 * else on the dock. Text only by design — the app is for listening, and a plain
 * thread is the one thing nobody has to moderate.
 *
 * `onClose` dismisses the surface it was mounted in (the (app)/chat route).
 * Without it — AppChrome's overlay mount — the provider's `closeChat` is the
 * whole close, exactly like the web.
 */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const {
    chatOpen,
    closeChat,
    connected,
    loading,
    error,
    conversations,
    requests,
    people,
    peopleQuery,
    activeConversation,
    activeId,
    messages,
    olderLoading,
    typingUsers,
    onlineIds,
    searchPeople,
    selectConversation,
    loadOlder,
    sendText,
    retryMessage,
    askToChat,
    respondTo,
    reportTyping,
    reportTypingStop,
  } = useCommunity();

  const insets = useSafeAreaInsets();
  const [rail, setRail] = useState<Rail>("threads");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [askBusy, setAskBusy] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatRow> | null>(null);
  const composerRef = useRef<TextInputInstance | null>(null);
  /* Inverted list: offset 0 is the newest bubble, so "pinned to the bottom"
     is the web's `scrollHeight - scrollTop - clientHeight < 160` check. */
  const nearBottomRef = useRef(true);

  // Escape closes; the page behind must not scroll while the room is open.
  // On native both are the route modal's job — the keyboard listener is
  // dropped and body-scroll-lock has no equivalent: this surface is taken
  // over by the (app)/chat route (or AppChrome's overlay), and closing calls
  // onClose (route dismiss) plus closeChat (provider state), see closePanel.

  const unreadThreads = useMemo(
    () => conversations.reduce((total, thread) => total + thread.unread, 0),
    [conversations]
  );

  /* Stay pinned to the newest message unless the reader has scrolled up to
     look at history — yanking them down mid-read is worse than a quiet update. */
  useEffect(() => {
    if (!activeId) return;
    const list = listRef.current;
    if (!list) return;
    if (nearBottomRef.current) list.scrollToOffset({ offset: 0, animated: false });
  }, [messages, activeId, typingUsers.length]);

  const onThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      nearBottomRef.current = contentOffset.y < 160;
      // The inverted list's distance to its far end equals the web's scrollTop
      // at the top of the plain scroller — the ≤ 48px older-page trigger.
      const distanceToTop = contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceToTop <= 48) loadOlder();
    },
    [loadOlder]
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const delivered = await sendText(text);
    setSending(false);
    if (delivered) {
      setDraft("");
      reportTypingStop();
    }
    composerRef.current?.focus();
  }, [draft, sending, sendText, reportTypingStop]);

  const typingLabel = useMemo(() => {
    if (!typingUsers.length) return null;
    const names = typingUsers
      .map((id) => (activeConversation?.user.id === id ? activeConversation.user.name : null))
      .filter(Boolean);
    if (!names.length) return "typing…";
    return `${names[0]} ${names.length > 1 ? "and others are" : "is"} typing…`;
  }, [typingUsers, activeConversation]);

  /* Messages run newest → oldest for the inverted FlatList, and a separator is
     emitted whenever the day changes along that walk — which paints each day
     label above that day's bubbles, mirroring the web's grouping. */
  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = [];
    let previousDay: string | null = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      out.push({ key: `m:${message.id}`, kind: "message", message });
      const day = dayLabel(message.createdAt);
      if (day !== previousDay) {
        out.push({ key: `d:${day}`, kind: "day", day });
        previousDay = day;
      }
    }
    return out;
  }, [messages]);

  const isOnline = useCallback((id: string) => onlineIds.has(id), [onlineIds]);

  if (!chatOpen) return null;

  const railCounts: Record<Rail, number> = {
    threads: unreadThreads,
    people: 0,
    requests: requests.incoming.length,
  };

  const closePanel = () => {
    // Route-dismiss first so navigation can start; closeChat always runs so
    // the provider state (badge, activeId) resets like the web regardless of
    // how this surface was mounted.
    onClose?.();
    closeChat();
  };

  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel="ZYRAVA community chat"
      className="absolute inset-0 z-50 flex-col bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {/* Head */}
      <View className="h-16 flex-none flex-row items-center gap-3 border-b border-separator px-3">
        <View className="size-8 flex-none items-center justify-center rounded-[0.6rem] bg-accent">
          <Icon name="message" className="size-4 text-accent-foreground" strokeWidth={2.2} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[12.5px] font-bold uppercase leading-none tracking-[0.22em] text-foreground" numberOfLines={1}>
            Community
          </Text>
          <View className="mt-1.5 flex-row items-center gap-1.5">
            <Presence online={connected} size="sm" />
            <Text
              className="text-[10px] font-medium uppercase leading-none tracking-[0.16em] text-muted"
              numberOfLines={1}
            >
              {connected ? "Live" : "Reconnecting"}
            </Text>
          </View>
        </View>
        <Button variant="ghost" size="icon" onClick={closePanel} title="Close community">
          <Icon name="x" className="size-4" />
        </Button>
      </View>

      {error ? (
        <Text className="flex-none border-b border-separator bg-danger-soft/40 px-4 py-2 text-[12px] text-danger">
          {error}
        </Text>
      ) : null}

      {!activeId ? (
        <View className="min-h-0 flex-1 flex-col border-r border-separator">
          <View className="flex-none flex-row gap-1 border-b border-separator px-2.5 py-2.5">
            {(["threads", "requests", "people"] as Rail[]).map((entry) => (
              <Pressable
                key={entry}
                accessibilityRole="button"
                accessibilityState={{ selected: rail === entry }}
                onPress={() => setRail(entry)}
                className={cn(
                  "min-h-8 flex-1 items-center justify-center rounded-full px-2.5",
                  rail === entry ? "bg-accent" : "bg-surface-secondary/50"
                )}
              >
                <Text
                  className={cn(
                    "text-[11.5px] font-semibold capitalize",
                    rail === entry ? "text-accent-foreground" : "text-muted"
                  )}
                >
                  {entry}
                  {/* margin is ignored on nested Text — the gap rides on a space. */}
                  {railCounts[entry] ? <Text className="tabular-nums"> {railCounts[entry]}</Text> : null}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView className="min-h-0 flex-1" contentContainerClassName="flex-col px-2.5 py-3">
            {rail === "people" ? (
              <View className="flex-col gap-2">
                <View className="relative">
                  {/* Icon takes classes only for color/size (react-native-svg
                      cannot be styled by Uniwind), so the absolute placement —
                      the web's start-2.5 top-1/2 -translate-y-1/2 on the LTR
                      app — lives on a pointer-transparent wrapper. */}
                  <View pointerEvents="none" className="absolute left-2.5 top-3">
                    <Icon name="search" className="size-4 text-muted" strokeWidth={1.9} />
                  </View>
                  <TextInput
                    value={peopleQuery}
                    onChangeText={searchPeople}
                    placeholder="Find another listener"
                    accessibilityLabel="Find another listener"
                    className="h-10 w-full rounded-xl border border-separator bg-surface-secondary/40 pl-9 pr-3 text-[13px] text-foreground"
                    placeholderTextColorClassName="text-faint-foreground"
                  />
                </View>
                <SectionTitle>On the dock</SectionTitle>
                {people.map((person) => (
                  <View key={person.id} className={ROW}>
                    <Avatar person={person} online={isOnline(person.id)} />
                    <View className="min-w-0 flex-1">
                      {/* RN Text does not inherit the row's text-[13px]/tone, so
                          each Text carries the web's effective style. */}
                      <Text className="text-[13px] font-semibold text-foreground" numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text className="text-[11px] text-muted" numberOfLines={1}>
                        {person.online
                          ? "Online now"
                          : person.lastSeenAt
                            ? `Last seen ${formatStamp(person.lastSeenAt)}`
                            : "No thread yet"}
                      </Text>
                    </View>
                    <View className="flex-none">
                      {person.relation === "conversation" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const thread = conversations.find((item) => item.user.id === person.id);
                            if (thread) selectConversation(thread.id);
                          }}
                        >
                          Open
                        </Button>
                      ) : person.relation === "outgoing" ? (
                        <Text className="text-[11px] font-medium text-muted">Request sent</Text>
                      ) : person.relation === "incoming" ? (
                        <Text className="text-[11px] font-semibold text-brand">Wants to chat</Text>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          loading={askBusy === person.id}
                          onClick={() => {
                            setAskBusy(person.id);
                            void askToChat(person.id).finally(() => setAskBusy(null));
                          }}
                        >
                          Ask to chat
                        </Button>
                      )}
                    </View>
                  </View>
                ))}
                {!people.length && !loading ? (
                  <Text className="px-2.5 py-6 text-center text-[12px] text-muted">
                    No other listeners here yet. Ask a friend to sign up — the community is only as
                    good as its company.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {rail === "requests" ? (
              <View className="flex-col gap-4">
                <View>
                  <SectionTitle>Waiting for you</SectionTitle>
                  {requests.incoming.length ? (
                    requests.incoming.map((request) => (
                      <View key={request.id} className={ROW}>
                        <Avatar person={request.user} online={isOnline(request.user.id)} />
                        <View className="min-w-0 flex-1">
                          <Text className="text-[13px] font-semibold text-foreground" numberOfLines={1}>
                            {request.user.name}
                          </Text>
                          <Text className="text-[11px] text-muted" numberOfLines={1}>
                            Asked {formatStamp(request.createdAt)}
                          </Text>
                          <View className="mt-2 flex-row gap-1.5">
                            <Button size="sm" onClick={() => void respondTo(request.id, true)}>
                              Accept
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void respondTo(request.id, false)}>
                              Decline
                            </Button>
                          </View>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text className="px-2.5 py-4 text-[12px] text-muted">Nobody is waiting.</Text>
                  )}
                </View>

                <View>
                  <SectionTitle>Asked by you</SectionTitle>
                  {requests.outgoing.length ? (
                    requests.outgoing.map((request) => (
                      <View key={request.id} className={cn(ROW, "items-center")}>
                        <Presence online={isOnline(request.user.id)} />
                        <Text className="min-w-0 flex-1 text-[13px] text-muted" numberOfLines={1}>
                          {request.user.name}
                        </Text>
                        <Text className="flex-none text-[11px] text-muted">Pending</Text>
                      </View>
                    ))
                  ) : (
                    <Text className="px-2.5 py-4 text-[12px] text-muted">
                      You have not asked anyone yet.
                    </Text>
                  )}
                </View>
              </View>
            ) : null}

            {rail === "threads" ? (
              <View className="flex-col gap-1">
                <SectionTitle>Threads</SectionTitle>
                {conversations.length ? (
                  conversations.map((thread) => (
                    <Pressable
                      key={thread.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activeId === thread.id }}
                      onPress={() => selectConversation(thread.id)}
                      className={cn(
                        ROW,
                        activeId === thread.id
                          ? "bg-surface-secondary text-foreground"
                          : "text-muted"
                      )}
                    >
                      <Avatar person={thread.user} online={isOnline(thread.user.id)} />
                      <View className="min-w-0 flex-1">
                        <View className="flex-row gap-2">
                          <Text className="min-w-0 flex-1 text-[13px] font-semibold text-foreground" numberOfLines={1}>
                            {thread.user.name}
                          </Text>
                          <Text className="flex-none text-[10px] tabular-nums text-faint-foreground">
                            {formatStamp(thread.updatedAt)}
                          </Text>
                        </View>
                        <View className="mt-1 flex-row items-center gap-2">
                          <Text className="min-w-0 flex-1 text-[11.5px] text-muted" numberOfLines={1}>
                            {thread.lastMessage
                              ? `${thread.lastMessage.from === user?.id ? "You: " : ""}${thread.lastMessage.text}`
                              : "Say hello"}
                          </Text>
                          {thread.unread ? (
                            <View className="size-5 flex-none items-center justify-center rounded-full bg-accent">
                              <Text className="text-[10px] font-bold text-accent-foreground tabular-nums">
                                {thread.unread > 9 ? "9+" : thread.unread}
                              </Text>
                            </View>
                          ) : (
                            <Presence online={isOnline(thread.user.id)} size="sm" />
                          )}
                        </View>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text className="px-2.5 py-6 text-[12px] text-muted">
                    No threads yet. Find someone on the <Text className="font-bold">People</Text> tab and
                    ask to chat — a thread opens the moment they accept.
                  </Text>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {/* Thread */}
      {activeId ? (
        <View className="min-h-0 flex-1 flex-col bg-surface-secondary/20">
          {activeConversation ? (
            <>
              <View className="flex-none flex-row items-center gap-3 border-b border-separator px-3 py-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to the list"
                  onPress={() => selectConversation(null)}
                  className="size-9 flex-none items-center justify-center rounded-lg"
                >
                  {/* The web draws a right-chevron rotated 180°; the same glyph
                      is the kit's left chevron. */}
                  <Icon name="chevron-left" className="size-4 text-muted" strokeWidth={2} />
                </Pressable>
                <Avatar person={activeConversation.user} online={isOnline(activeConversation.user.id)} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px] font-semibold text-foreground" numberOfLines={1}>
                    {activeConversation.user.name}
                  </Text>
                  <Text
                    className={cn("text-[11px]", typingLabel ? "text-brand" : "text-muted")}
                    numberOfLines={1}
                  >
                    {typingLabel ??
                      (activeConversation.user.online
                        ? "Online now"
                        : activeConversation.user.lastSeenAt
                          ? `Last seen ${formatStamp(activeConversation.user.lastSeenAt)}`
                          : "Offline")}
                  </Text>
                </View>
              </View>

              <View className="min-h-0 flex-1">
                <FlatList
                  ref={listRef}
                  data={rows}
                  inverted
                  keyExtractor={(row) => row.key}
                  renderItem={({ item: row }) =>
                    row.kind === "day" ? (
                      <Text className="py-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
                        {row.day}
                      </Text>
                    ) : (
                      <View
                        className={cn(
                          "flex-row py-1",
                          row.message.mine ? "justify-end" : "justify-start",
                          row.message.pending && "opacity-60"
                        )}
                      >
                        <View
                          className={cn(
                            "max-w-[86%] rounded-2xl px-3.5 py-2.5",
                            row.message.mine ? "bg-accent" : "border border-separator bg-background"
                          )}
                        >
                          <Text
                            className={cn(
                              "text-[13.5px] leading-relaxed",
                              row.message.mine ? "text-accent-foreground" : "text-foreground"
                            )}
                          >
                            {row.message.text}
                          </Text>
                          {/* The web colours the whole stamp row; RN paints only
                              Text, so each piece carries its own tone class. */}
                          <View className="mt-1 flex-row items-center justify-end gap-1.5">
                            <Text
                              className={cn(
                                "text-[10px]",
                                row.message.mine ? "text-accent-foreground/75" : "text-faint-foreground"
                              )}
                            >
                              {formatTime(row.message.createdAt)}
                            </Text>
                            {row.message.pending ? (
                              <Text
                                className={cn(
                                  "text-[10px]",
                                  row.message.mine ? "text-accent-foreground/75" : "text-faint-foreground"
                                )}
                              >
                                sending…
                              </Text>
                            ) : row.message.failed ? (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => retryMessage(row.message.clientId)}
                              >
                                <Text className="text-[10px] font-semibold text-danger underline">
                                  failed — retry
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    )
                  }
                  onScroll={onThreadScroll}
                  onMomentumScrollEnd={onThreadScroll}
                  scrollEventThrottle={16}
                  contentContainerClassName="flex-col px-3 py-4"
                  style={{ flex: 1 }}
                  ListFooterComponent={
                    olderLoading ? (
                      <Text className="pb-3 text-center text-[11px] text-muted">
                        Loading older messages…
                      </Text>
                    ) : undefined
                  }
                  ListEmptyComponent={
                    !loading ? (
                      <View className="flex-1">
                        <Text className="pt-8 text-center text-[12px] text-muted">
                          Nothing said yet. Break it — what are you listening to?
                        </Text>
                      </View>
                    ) : undefined
                  }
                />
              </View>

              <View className="flex-none border-t border-separator px-3 py-3">
                <View className="flex-row items-end gap-2">
                  <TextInput
                    ref={composerRef}
                    value={draft}
                    multiline
                    maxLength={MAX_CHAT_MESSAGE}
                    accessibilityLabel={`Message to ${activeConversation.user.name}`}
                    placeholder="Write a message…"
                    onChangeText={(text) => {
                      // The provider throttles reportTyping; keep the web's
                      // hard clamp as well as the maxLength attribute.
                      setDraft(text.slice(0, MAX_CHAT_MESSAGE));
                      reportTyping();
                    }}
                    // Enter-to-send arrives as the keyboard's Send key
                    // (`submitBehavior="submit"` + keyboardReturnKey="send");
                    // the web's Enter-without-Shift keydown listener is
                    // dropped. Shift+Enter starting a line is not a thing on
                    // native soft keyboards — the field stays multiline so
                    // long drafts wrap and pasted text keeps its line breaks.
                    submitBehavior="submit"
                    returnKeyType="send"
                    onSubmitEditing={() => void submit()}
                    blurOnSubmit={false}
                    className="max-h-32 min-h-11 flex-1 rounded-xl border border-separator bg-background px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground"
                    placeholderTextColorClassName="text-faint-foreground"
                    textAlignVertical="top"
                  />
                  <Button
                    size="icon"
                    onClick={() => void submit()}
                    // The web only blanks on an empty draft; native also waits
                    // for the live socket before a send can look trustworthy.
                    disabled={!draft.trim() || !connected}
                    loading={sending}
                    title="Send"
                  >
                    <Icon name="send" className="size-4" strokeWidth={2.1} />
                  </Button>
                </View>
                <View className="flex-row items-center justify-between px-1 pt-1.5">
                  <Text className="text-[10px] text-faint-foreground">
                    Enter sends · Shift+Enter starts a line · text only
                  </Text>
                  {draft.length > MAX_CHAT_MESSAGE - 200 ? (
                    <Text className="text-[10px] tabular-nums text-faint-foreground">
                      {draft.length}/{MAX_CHAT_MESSAGE}
                    </Text>
                  ) : null}
                </View>
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The (app)/chat route wraps this with `{ onClose }` for the modal dismiss. */
export default ChatPanel;
