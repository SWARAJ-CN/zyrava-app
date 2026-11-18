import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "heroui-native";
import { usePanelBackHandler } from "@/hooks/usePanelBackHandler";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCommunity } from "@/components/providers/CommunityProvider";
import { MAX_CHAT_MESSAGE, type ChatPerson, type MessageItem } from "@/lib/community";

type Rail = "threads" | "people" | "requests";
const RAILS = [
  { value: "threads", label: "Chats" },
  { value: "people", label: "People" },
  { value: "requests", label: "Requests" },
] as const;
const ROW = "min-h-20 flex-row items-center gap-3 py-4";

function Presence({ online }: { online: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      className={cn("size-2 rounded-full", online ? "bg-success" : "bg-muted/50")}
    />
  );
}
function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => [...part][0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}
function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return formatDate(value, { day: "numeric", month: "short" });
}

export function lastActiveLabel(value: string | null, now: number): string {
  if (!value) return "Last active unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last active unavailable";
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 1) return "Last active just now";
  if (minutes < 60) return `Last active ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `Last active ${formatDate(value, { day: "numeric", month: "short" })} at ${formatTime(value)}`;
}
function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDate(value, { day: "numeric", month: "short", year: "numeric" });
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <Text className="pb-2 pt-4 text-sm font-semibold text-foreground">{children}</Text>;
}
function Avatar({ person, online }: { person: ChatPerson; online: boolean }) {
  return (
    <View className="relative shrink-0">
      <View className="size-12 items-center justify-center rounded-full bg-accent-soft">
        <Text className="text-base font-semibold text-accent-soft-foreground">
          {initials(person.name)}
        </Text>
      </View>
      <View className="absolute bottom-0 right-0 rounded-full bg-background p-1">
        <Presence online={online} />
      </View>
    </View>
  );
}
function EmptyChat({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center gap-3 px-5 py-12">
      <View className="mb-2 size-16 items-center justify-center rounded-full bg-accent-soft">
        <Icon name="message" size={25} className="text-accent-soft-foreground" />
      </View>
      <Text className="text-center text-lg font-semibold text-foreground">{title}</Text>
      <Text className="max-w-72 text-center text-sm leading-6 text-muted">{description}</Text>
      {action ? <View className="mt-3">{action}</View> : null}
    </View>
  );
}

type ChatRow =
  | { key: string; kind: "day"; day: string }
  | { key: string; kind: "message"; message: MessageItem };

/** Inverted rows put each date above its oldest message, not between replies. */
export function buildChatRows(messages: MessageItem[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    rows.push({ key: `message:${message.id}`, kind: "message", message });
    const day = new Date(message.createdAt).toDateString();
    if (index === 0 || day !== new Date(messages[index - 1].createdAt).toDateString()) {
      rows.push({ key: `day:${day}`, kind: "day", day: dayLabel(message.createdAt) });
    }
  }
  return rows;
}

const MessageBubble = memo(function MessageBubble({
  message,
  retry,
}: {
  message: MessageItem;
  retry: (clientId: string) => void;
}) {
  return (
    <View className={cn("flex-row py-1.5", message.mine ? "justify-end" : "justify-start")}>
      <View
        className={cn(
          "max-w-[86%] rounded-2xl px-4 py-3",
          message.mine ? "rounded-br-md bg-accent-soft" : "rounded-bl-md bg-surface-secondary"
        )}
      >
        <Text
          selectable
          className={cn(
            "text-[15px] leading-6",
            message.mine ? "text-accent-soft-foreground" : "text-foreground"
          )}
        >
          {message.text}
        </Text>
        <View className="mt-1.5 flex-row items-center justify-end gap-2">
          <Text className="text-[10px] text-muted">{formatTime(message.createdAt)}</Text>
          {message.pending ? (
            <Text accessibilityLiveRegion="polite" className="text-[10px] text-muted">
              Sending…
            </Text>
          ) : message.failed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry failed message"
              onPress={() => retry(message.clientId)}
              className="min-h-8 justify-center px-1"
            >
              <Text className="text-xs font-semibold text-danger">Retry send</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/** Native inbox and conversation share one header and a keyboard-aware surface. */
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
  const backgroundColor = useThemeColor("background");
  const foregroundColor = useThemeColor("foreground");
  const mutedColor = useThemeColor("muted");
  const accentColor = useThemeColor("accent");
  const [presenceTime, setPresenceTime] = useState(() => Date.now());
  useEffect(() => {
    if (!chatOpen) return;
    const refresh = setTimeout(() => setPresenceTime(Date.now()), 0);
    const tick = setInterval(() => setPresenceTime(Date.now()), 30_000);
    return () => {
      clearTimeout(refresh);
      clearInterval(tick);
    };
  }, [chatOpen]);
  const [rail, setRail] = useState<Rail>("threads");
  const [chatQuery, setChatQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = `${user?.id ?? ""}:${activeId ?? ""}`;
  const draft = drafts[draftKey] ?? "";
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionBusy = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatRow> | null>(null);
  const nearBottom = useRef(true);

  const closePanel = useCallback(() => {
    Keyboard.dismiss();
    reportTypingStop();
    onClose?.();
    closeChat();
  }, [reportTypingStop, onClose, closeChat]);
  const backToInbox = useCallback(() => {
    Keyboard.dismiss();
    reportTypingStop();
    selectConversation(null);
  }, [reportTypingStop, selectConversation]);
  usePanelBackHandler(chatOpen, activeId ? backToInbox : closePanel);

  const openConversation = (id: string) => {
    nearBottom.current = true;
    selectConversation(id);
  };
  useEffect(() => {
    if (chatOpen && activeId && nearBottom.current)
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [messages, activeId, chatOpen]);

  const onThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      nearBottom.current = contentOffset.y < 160;
      if (contentSize.height - layoutMeasurement.height - contentOffset.y <= 48 && !olderLoading)
        loadOlder();
    },
    [loadOlder, olderLoading]
  );

  const submit = async () => {
    const text = draft.trim();
    if (!text || !activeId || !connected || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setActionError(null);
    reportTypingStop();
    try {
      if (await sendText(text)) {
        // A late response must not erase edits or a different conversation's draft.
        setDrafts((current) =>
          current[draftKey] === draft ? { ...current, [draftKey]: "" } : current
        );
      }
    } catch {
      setActionError("Your message couldn’t be sent. Please try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const runAction = async (key: string, action: () => Promise<void>) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusyId(key);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      actionBusy.current = false;
      setBusyId(null);
    }
  };

  const unread = useMemo(
    () => conversations.reduce((total, item) => total + item.unread, 0),
    [conversations]
  );
  const threads = useMemo(
    () =>
      conversations.filter((thread) =>
        thread.user.name.toLocaleLowerCase().includes(chatQuery.trim().toLocaleLowerCase())
      ),
    [conversations, chatQuery]
  );
  const rows = useMemo(() => buildChatRows(messages), [messages]);
  const isOnline = (person: ChatPerson) => connected && (onlineIds.has(person.id) || person.online);
  const presenceLabel = (person: ChatPerson) =>
    isOnline(person) ? "Online now" : lastActiveLabel(person.lastSeenAt, presenceTime);
  const typing = !!activeConversation && typingUsers.includes(activeConversation.user.id);
  const railCounts: Record<Rail, number> = {
    threads: unread,
    requests: requests.incoming.length,
    people: 0,
  };

  if (!chatOpen) return null;
  const searchValue = rail === "people" ? peopleQuery : chatQuery;
  const changeSearch = rail === "people" ? searchPeople : setChatQuery;
  return (
    <KeyboardAvoidingView
      accessibilityViewIsModal
      accessibilityLabel="ZYRAVA community chat"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[StyleSheet.absoluteFill, { zIndex: 60, backgroundColor, paddingTop: insets.top }]}
    >
      <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 8) }}>
        <View
          style={{
            flexShrink: 0,
            backgroundColor,
            minHeight: 80,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          {activeId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to conversations"
              onPress={backToInbox}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="chevron-left" size={24} color={foregroundColor} />
            </Pressable>
          ) : null}
          {activeConversation ? (
            <Avatar person={activeConversation.user} online={isOnline(activeConversation.user)} />
          ) : null}
          <View style={{ minWidth: 0, flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: foregroundColor,
                fontFamily: "Inter_700Bold",
                fontSize: activeId ? 16 : 24,
                lineHeight: activeId ? 24 : 32,
              }}
              className={cn(
                "font-bold text-foreground",
                activeId ? "text-base" : "text-2xl tracking-tight"
              )}
            >
              {activeConversation?.user.name ?? (activeId ? "Conversation" : "Community")}
            </Text>
            <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Presence
                online={connected && (!activeConversation || isOnline(activeConversation.user))}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: typing && connected ? accentColor : mutedColor,
                  fontSize: 12,
                  lineHeight: 18,
                  flexShrink: 1,
                }}
                className={cn("text-xs", typing && connected ? "text-accent" : "text-muted")}
              >
                {typing && connected
                  ? "Typing…"
                  : activeConversation
                    ? presenceLabel(activeConversation.user)
                    : connected
                      ? "Chat with fellow listeners"
                      : "Reconnecting…"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close community"
            onPress={closePanel}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="x" size={22} color={foregroundColor} />
          </Pressable>
        </View>
        {error || actionError ? (
          <View className="mx-4 mb-2 rounded-xl bg-danger-soft px-4 py-3">
            <Text
              accessibilityRole="alert"
              className="text-xs leading-5 text-danger-soft-foreground"
            >
              {actionError || error}
            </Text>
          </View>
        ) : null}

        {!activeId ? (
          <View className="min-h-0 flex-1">
            <View
              accessibilityRole="tablist"
              style={{
                flexDirection: "row",
                flexShrink: 0,
                minHeight: 52,
                marginHorizontal: 16,
                backgroundColor,
              }}
            >
              {RAILS.map((item) => {
                const selected = rail === item.value;
                const count = railCounts[item.value];
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected }}
                    onPress={() => setRail(item.value)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 52,
                      paddingHorizontal: 4,
                      paddingVertical: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottomWidth: 2,
                      borderBottomColor: selected ? accentColor : "transparent",
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 14,
                        lineHeight: 22,
                        textAlign: "center",
                        color: selected ? foregroundColor : mutedColor,
                      }}
                    >
                      {item.label}
                      {count ? ` ${count > 99 ? "99+" : count}` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {rail !== "requests" ? (
              <View className="mx-4 mb-2 mt-4 min-h-12 flex-row items-center gap-3 rounded-2xl bg-surface-secondary px-4">
                <Icon name="search" size={18} className="text-muted" />
                <TextInput
                  value={searchValue}
                  onChangeText={changeSearch}
                  placeholder={rail === "people" ? "Find a listener" : "Find a conversation"}
                  accessibilityLabel={rail === "people" ? "Find a listener" : "Find a conversation"}
                  placeholderTextColor={mutedColor}
                  selectionColor={accentColor}
                  autoCorrect={false}
                  maxLength={80}
                  className="min-h-12 min-w-0 flex-1 text-sm text-foreground"
                />
                {searchValue ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => changeSearch("")}
                    className="size-11 items-center justify-center"
                  >
                    <Icon name="x" size={16} className="text-muted" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {rail === "threads" ? (
              <FlatList
                data={threads}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                initialNumToRender={12}
                windowSize={7}
                ListEmptyComponent={
                  loading ? (
                    <LoadingChat />
                  ) : (
                    <EmptyChat
                      title={chatQuery ? "No conversations found" : "Start a conversation"}
                      description={
                        chatQuery
                          ? "Try another listener’s name."
                          : "Find a listener, say hello, and talk about the music you love."
                      }
                      action={
                        !chatQuery ? (
                          <Button onClick={() => setRail("people")}>Find people</Button>
                        ) : undefined
                      }
                    />
                  )
                }
                renderItem={({ item: thread }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Chat with ${thread.user.name}${thread.unread ? `, ${thread.unread} unread messages` : ""}`}
                    onPress={() => openConversation(thread.id)}
                    className={cn(ROW, "active:opacity-60")}
                  >
                    <Avatar person={thread.user} online={isOnline(thread.user)} />
                    <View className="min-w-0 flex-1 gap-1.5">
                      <View className="flex-row items-center gap-2">
                        <Text
                          numberOfLines={1}
                          className="min-w-0 flex-1 text-base font-semibold text-foreground"
                        >
                          {thread.user.name}
                        </Text>
                        <Text className="text-[11px] text-muted">
                          {formatStamp(thread.updatedAt)}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={{ color: mutedColor, fontSize: 11, lineHeight: 16 }}
                      >
                        {presenceLabel(thread.user)}
                      </Text>
                      <View className="flex-row items-center gap-3">
                        <Text
                          numberOfLines={1}
                          className={cn(
                            "flex-1 text-sm",
                            thread.unread ? "font-medium text-foreground" : "text-muted"
                          )}
                        >
                          {thread.lastMessage
                            ? `${thread.lastMessage.from === user?.id ? "You: " : ""}${thread.lastMessage.text}`
                            : "Say hello"}
                        </Text>
                        {thread.unread ? (
                          <View className="min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5">
                            <Text className="text-[10px] font-bold text-accent-foreground">
                              {thread.unread > 99 ? "99+" : thread.unread}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                )}
              />
            ) : null}
            {rail === "people" ? (
              <FlatList
                data={people}
                keyExtractor={(person) => person.id}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                initialNumToRender={12}
                windowSize={7}
                ListEmptyComponent={
                  loading ? (
                    <LoadingChat />
                  ) : (
                    <EmptyChat
                      title={peopleQuery ? "No listeners found" : "Meet your next music friend"}
                      description={
                        peopleQuery
                          ? "Try a different name or clear your search."
                          : "Other listeners will appear here when they join the community."
                      }
                    />
                  )
                }
                renderItem={({ item: person }) => (
                  <View className={ROW}>
                    <Avatar person={person} online={isOnline(person)} />
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
                        {person.name}
                      </Text>
                      <Text numberOfLines={1} className="mt-1 text-xs text-muted">
                        {presenceLabel(person)}
                      </Text>
                    </View>
                    {person.relation === "conversation" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const thread = conversations.find((item) => item.user.id === person.id);
                          if (thread) openConversation(thread.id);
                        }}
                      >
                        Chat
                      </Button>
                    ) : person.relation === "outgoing" ? (
                      <Text className="text-xs text-muted">Requested</Text>
                    ) : person.relation === "incoming" ? (
                      <Button variant="secondary" size="sm" onClick={() => setRail("requests")}>
                        Review
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId !== null}
                        loading={busyId === person.id}
                        onClick={() => void runAction(person.id, () => askToChat(person.id))}
                      >
                        Say hello
                      </Button>
                    )}
                  </View>
                )}
              />
            ) : null}
            {rail === "requests" ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
              >
                <SectionTitle>Waiting for you</SectionTitle>
                {requests.incoming.length ? (
                  requests.incoming.map((request) => (
                    <View key={request.id} className={cn(ROW, "items-start")}>
                      <Avatar person={request.user} online={isOnline(request.user)} />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                          {request.user.name}
                        </Text>
                        <Text className="mt-1 text-xs text-muted">Would like to chat with you</Text>
                        <View className="mt-3 flex-row gap-2">
                          <Button
                            size="sm"
                            disabled={busyId !== null}
                            loading={busyId === request.id}
                            onClick={() =>
                              void runAction(request.id, () => respondTo(request.id, true))
                            }
                          >
                            Accept
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() =>
                              void runAction(request.id, () => respondTo(request.id, false))
                            }
                          >
                            Decline
                          </Button>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text className="py-5 text-sm text-muted">You’re all caught up.</Text>
                )}
                <SectionTitle>Sent requests</SectionTitle>
                {requests.outgoing.length ? (
                  requests.outgoing.map((request) => (
                    <View key={request.id} className={ROW}>
                      <Avatar person={request.user} online={isOnline(request.user)} />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
                          {request.user.name}
                        </Text>
                        <Text className="mt-1 text-xs text-muted">Waiting for a reply</Text>
                      </View>
                      <Text className="text-xs text-muted">Pending</Text>
                    </View>
                  ))
                ) : (
                  <Text className="py-5 text-sm text-muted">
                    Your invitations will appear here.
                  </Text>
                )}
              </ScrollView>
            ) : null}
          </View>
        ) : activeConversation ? (
          <View className="min-h-0 flex-1">
            <FlatList
              key={activeId}
              ref={listRef}
              data={rows}
              inverted
              keyExtractor={(row) => row.key}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              showsVerticalScrollIndicator={false}
              initialNumToRender={20}
              maxToRenderPerBatch={12}
              windowSize={7}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScroll={onThreadScroll}
              onMomentumScrollEnd={onThreadScroll}
              scrollEventThrottle={32}
              renderItem={({ item }) =>
                item.kind === "day" ? (
                  <View className="items-center py-4">
                    <View className="rounded-full bg-surface-secondary px-3 py-1.5">
                      <Text className="text-[11px] font-medium text-muted">{item.day}</Text>
                    </View>
                  </View>
                ) : (
                  <MessageBubble message={item.message} retry={retryMessage} />
                )
              }
              ListFooterComponent={
                olderLoading ? <LoadingChat label="Loading earlier messages" /> : undefined
              }
              ListEmptyComponent={
                loading ? (
                  <LoadingChat />
                ) : (
                  <EmptyChat
                    title={`Say hello to ${activeConversation.user.name.split(" ")[0]}`}
                    description="A favorite song is a good place to start."
                  />
                )
              }
            />
            <View className="px-4 pb-2 pt-3">
              <View className="flex-row items-end gap-2 rounded-3xl bg-surface-secondary p-1.5 pl-4">
                <TextInput
                  value={draft}
                  multiline
                  maxLength={MAX_CHAT_MESSAGE}
                  accessibilityLabel={`Message to ${activeConversation.user.name}`}
                  placeholder="Write a message…"
                  placeholderTextColor={mutedColor}
                  selectionColor={accentColor}
                  onChangeText={(text) => {
                    const next = text.slice(0, MAX_CHAT_MESSAGE);
                    setDrafts((current) => ({ ...current, [draftKey]: next }));
                    if (next.trim()) reportTyping();
                    else reportTypingStop();
                  }}
                  onBlur={reportTypingStop}
                  submitBehavior="submit"
                  returnKeyType="send"
                  onSubmitEditing={() => void submit()}
                  textAlignVertical="top"
                  className="max-h-32 min-h-11 min-w-0 flex-1 py-2.5 text-[15px] leading-6 text-foreground"
                />
                <Button
                  size="icon"
                  className="size-11 rounded-full"
                  onClick={() => void submit()}
                  disabled={!draft.trim() || !connected || sending}
                  loading={sending}
                  accessibilityLabel="Send message"
                >
                  <Icon name="send" size={18} />
                </Button>
              </View>
              {!connected || draft.length > MAX_CHAT_MESSAGE - 200 ? (
                <View className="mt-2 flex-row justify-between px-3">
                  <Text className="flex-1 text-[11px] text-muted">
                    {!connected ? "Reconnecting… Your draft stays here." : ""}
                  </Text>
                  {draft.length > MAX_CHAT_MESSAGE - 200 ? (
                    <Text className="text-[11px] tabular-nums text-muted">
                      {draft.length}/{MAX_CHAT_MESSAGE}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : loading ? (
          <LoadingChat />
        ) : (
          <EmptyChat
            title="Conversation unavailable"
            description="Return to your chats and try opening it again."
            action={
              <Button variant="secondary" onClick={backToInbox}>
                Back to chats
              </Button>
            }
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
function LoadingChat({ label = "Loading…" }: { label?: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="items-center gap-3 py-8"
    >
      <ActivityIndicator />
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}
export default ChatPanel;
