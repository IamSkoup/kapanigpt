"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createUserWithEmailAndPassword, getIdToken, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { ArrowUp, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Clipboard, Code2, Download, FileCode2, FileText, Menu, MessageCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, WandSparkles, X, Crown, LockKeyhole, BrainCircuit, Wallet, LogIn, LoaderCircle, Zap, Gift } from "lucide-react";
import { auth, database } from "@/lib/firebase";
import { MODEL_CHOICES, PLANS, REASONING, TOKEN_PACKS, type ChatMode, type Plan, type Reasoning, type TokenPack } from "@/lib/kapani";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/lib/preferences-config";
import { type GeneratedFile } from "@/lib/response-files";

type Attachment = { name: string; type: string; size: number; data?: string; text?: string };
type WebSource = { title: string; url: string; snippet: string };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: number; attachments?: Attachment[]; generatedFiles?: GeneratedFile[]; sources?: WebSource[] };
type Chat = { id: string; title: string; updatedAt: number; pinned?: boolean; mode: ChatMode };
const DEFAULT_MODEL = "kapani-1";
type Usage = { plan: Plan; providerConfigured: boolean; remainingPercent: number; remainingFiveHourPercent: number; fiveHourBudget: number; weeklyBudget: number; tokensBalance: number; fiveHourResetsAt: number; imagesLeft: number; imagesMax: number; nickname: string | null; balance: number | null; expiresAt: string | null; promoEligible: boolean; promoClaimed: boolean; promoStartsAt: string | null; promoExpiresAt: string | null };
const EMPTY_USAGE: Usage = { plan: "free", providerConfigured: true, remainingPercent: 100, remainingFiveHourPercent: 100, fiveHourBudget: 30, weeklyBudget: 100, tokensBalance: 0, fiveHourResetsAt: 0, imagesLeft: 1, imagesMax: 1, nickname: null, balance: null, expiresAt: null, promoEligible: false, promoClaimed: false, promoStartsAt: null, promoExpiresAt: null };
const CHAT_REASONING: Reasoning[] = ["off", "light", "medium", "high"];
const WORK_REASONING: Reasoning[] = ["off", "light", "medium", "high", "very-high", "maximum"];
type KapaniSession = { accessToken: string; expiresAt: number };
type KapaniBank = { nickname: string; balance: number };
const makeId = () => globalThis.crypto?.randomUUID?.() || "msg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
function niceDate(time: number) {
  const date = new Date(time), today = new Date();
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function prettySize(bytes: number) { return bytes < 1024 ? bytes + " Б" : bytes < 1048576 ? Math.round(bytes / 1024) + " КБ" : (bytes / 1048576).toFixed(1) + " МБ"; }
function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => { try { const raw = localStorage.getItem(key); if (raw) setValue(JSON.parse(raw)); } catch {} }, [key]);
  const change = useCallback((next: T) => { setValue(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} }, [key]);
  return [value, change] as const;
}
function inlineText(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> :
    part.startsWith("`") && part.endsWith("`") ? <code key={i} className="inline-code">{part.slice(1, -1)}</code> : part);
}
function renderText(content: string) {
  return content.split(/(```[\s\S]*?```)/g).map((block, index) => {
    if (block.startsWith("```")) {
      const match = block.match(/^```([^\n]*)\n?([\s\S]*?)```$/), language = match?.[1]?.trim() || "Код", code = match?.[2] || block.slice(3, -3);
      return <div className="code-block" key={index}><div className="code-head"><span>{language}</span><button onClick={() => navigator.clipboard.writeText(code)}><Clipboard size={13} /> Копировать</button></div><pre><code>{code}</code></pre></div>;
    }
    return <div className="prose-lines" key={index}>{block.split("\n").map((line, i) => {
      const heading = line.match(/^(#{1,3})\s+(.+)/);
      if (heading) return <div key={i} className="prose-heading">{heading[2]}</div>;
      if (/^[-*] /.test(line)) return <div key={i} className="prose-bullet"><span>•</span>{inlineText(line.slice(2))}</div>;
      if (/^\d+\. /.test(line)) return <div key={i} className="prose-bullet"><span>{line.match(/^\d+/)?.[0]}.</span>{inlineText(line.replace(/^\d+\. /, ""))}</div>;
      return <div key={i} className={line ? "prose-line" : "prose-spacer"}>{inlineText(line)}</div>;
    })}</div>;
  });
}
async function prepareAttachment(file: File): Promise<Attachment> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Максимальный размер файла — 8 МБ.");
  if (file.type.startsWith("image/")) {
    const image = await createImageBitmap(file), ratio = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    let data = canvas.toDataURL("image/jpeg", 0.72);
    if (data.length > 580000) data = canvas.toDataURL("image/jpeg", 0.45);
    if (data.length > 750000) throw new Error("Изображение слишком большое даже после сжатия.");
    return { name: file.name, type: "image/jpeg", size: file.size, data };
  }
  const textual = /^(text\/|application\/(json|xml|javascript|x-javascript))/.test(file.type) || /\.(txt|md|csv|json|js|ts|tsx|jsx|py|html|css|xml|yaml|yml|log|sql)$/i.test(file.name);
  if (!textual) throw new Error("Поддерживаются изображения и текстовые файлы. PDF и архивы пока не разбираются.");
  return { name: file.name, type: file.type || "text/plain", size: file.size, text: (await file.text()).slice(0, 50000) };
}

export default function Home() {
  const [uid, setUid] = useState<string | null>(null), [authError, setAuthError] = useState(""), [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState(""), [authPassword, setAuthPassword] = useState(""), [authNickname, setAuthNickname] = useState(""), [authBusy, setAuthBusy] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]), [chatId, setChatId] = useState<string | null>(null), [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState(""), [attachments, setAttachments] = useState<Attachment[]>([]), [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState(false), [streamedText, setStreamedText] = useState(""), [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true), [mobileSidebar, setMobileSidebar] = useState(false);
  const [search, setSearch] = useState(""), [searchOpen, setSearchOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false), [menuId, setMenuId] = useState<string | null>(null);
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null), [editingMessageText, setEditingMessageText] = useState("");
  const [messageConfirm, setMessageConfirm] = useState<{ id: string; kind: "rewind" | "edit" | "remove"; text?: string } | null>(null);
  const [messageBusy, setMessageBusy] = useState(false), [messageNotice, setMessageNotice] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null), [renameValue, setRenameValue] = useState(""), [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [model, setModel] = useLocalState("kapani-horde-model", DEFAULT_MODEL);
  const [reasoning, setReasoning] = useState<Reasoning>("off"), [reasoningOpen, setReasoningOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("chat"), [temporaryChatStarted, setTemporaryChatStarted] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [settingsTab, setSettingsTab] = useState<"account" | "personal" | "privacy" | "limits" | "appearance">("account");
  const [preferencesSaving, setPreferencesSaving] = useState(false), [preferencesMessage, setPreferencesMessage] = useState("");
  const [compact, setCompact] = useLocalState("kapani-compact-ui", false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false), [deletingAll, setDeletingAll] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState("Думаю…");
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);
  const [claimingPromo, setClaimingPromo] = useState(false), [promoError, setPromoError] = useState("");
  const [shopOpen, setShopOpen] = useState(false), [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null), [buying, setBuying] = useState(false);
  const [shopTab, setShopTab] = useState<"plans" | "tokens">("plans");
  const [checkoutPack, setCheckoutPack] = useState<TokenPack | null>(null), [buyingTokens, setBuyingTokens] = useState(false);
  const [unlockSteps, setUnlockSteps] = useState<string[]>([]), [unlockIndex, setUnlockIndex] = useState(0);
  const [kapaniSession, setKapaniSession] = useState<KapaniSession | null>(null);
  const [kapaniBank, setKapaniBank] = useState<KapaniBank | null>(null);
  const [loginNick, setLoginNick] = useState(""), [loginPassword, setLoginPassword] = useState(""), [loggingIn, setLoggingIn] = useState(false), [shopError, setShopError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null), inputRef = useRef<HTMLTextAreaElement>(null), bottomRef = useRef<HTMLDivElement>(null);
  const lastAuthUid = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null), activeRef = useRef<string | null>(null), messagesRef = useRef<ChatMessage[]>([]);
  const modelName = MODEL_CHOICES.find(m => m.id === model)?.name || "KapaniGPT 1";
  const tier = PLANS[usage.plan];
  const isFree = usage.plan === "free";
  const modeLocked = !!chatId || temporaryChatStarted || streaming;
  const activeRemaining = usage.remainingFiveHourPercent;
  const activeWeeklyRemaining = usage.remainingPercent;
  const reasoningOptions = chatMode === "work" ? WORK_REASONING : CHAT_REASONING;
  const reasoningIndex = Math.max(0, reasoningOptions.indexOf(reasoning));

  // React controls the textarea's value, so resize after *every* value change,
  // including send, new chat, voice input, paste and programmatic draft edits.
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = prompt ? Math.min(textarea.scrollHeight, 210) + "px" : "";
    textarea.style.overflowY = textarea.scrollHeight > 210 ? "auto" : "hidden";
  }, [prompt, uid]);

  // Previous builds persisted a Kapani refresh token in sessionStorage.
  // Bank credentials must no longer survive checkout or page reloads.
  useEffect(() => { try { sessionStorage.removeItem("kapani-ai-login"); } catch {} }, []);
  const authorizationHeaders = useCallback(async (): Promise<Record<string, string>> => {
    // KapaniGPT chat, usage and entitlements always belong to Firebase.
    // A temporary Kapani bank login must never switch the current user.
    const user = auth.currentUser;
    if (!user) throw new Error("Firebase ещё подключается. Подожди секунду.");
    return { "x-firebase-token": await getIdToken(user) };
  }, []);
  const refreshUsage = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const response = await fetch("/api/usage", { headers: await authorizationHeaders(), cache: "no-store" });
      const data = await response.json() as Usage & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить лимиты");
      setUsage(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить лимиты"); }
  }, [authorizationHeaders]);

  async function claimOpeningPromo() {
    if (!uid || claimingPromo || !usage.promoEligible) return;
    setClaimingPromo(true); setPromoError("");
    try {
      const response = await fetch("/api/promo/claim", { method: "POST", cache: "no-store",
        headers: await authorizationHeaders() });
      const result = await response.json() as { success?: boolean; startsAt?: string; expiresAt?: string; error?: string };
      if (!response.ok || !result.success || !result.startsAt || !result.expiresAt)
        throw new Error(result.error || "Не удалось получить подарок.");
      await refreshUsage();
      const scheduled = new Date(result.startsAt).getTime() > Date.now() + 2000;
      setUnlockSteps(scheduled
        ? ["Неделя Kapani AI plus за тобой!", "Она начнётся " + new Date(result.startsAt).toLocaleDateString("ru-RU") + ", когда закончится текущая подписка."]
        : ["Kapani AI plus бесплатно на 7 дней!", "Открыты режим «Работа» и все модели KapaniGPT", "Подписка действует до " + new Date(result.expiresAt).toLocaleDateString("ru-RU")]);
      setUnlockIndex(0);
      setSettingsOpen(false); setMobileSidebar(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось активировать акцию.";
      setPromoError(message);
      if (message.includes("уже забрал")) await refreshUsage();
    } finally { setClaimingPromo(false); }
  }

  useEffect(() => { if (uid) refreshUsage(); }, [uid, refreshUsage]);
  useEffect(() => { if (!uid) return; const timer = setInterval(refreshUsage, 60000); return () => clearInterval(timer); }, [uid, refreshUsage]);
  useEffect(() => {
    if (chatMode === "chat" && !["off", "light", "medium", "high"].includes(reasoning)) setReasoning("off");
    if (isFree && chatMode === "chat" && !["off", "medium"].includes(reasoning)) setReasoning("off");
  }, [chatMode, isFree, reasoning]);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/preferences", { headers: await authorizationHeaders(), cache: "no-store" });
        if (!response.ok) throw new Error("Не удалось загрузить персонализацию");
        const data = await response.json() as UserPreferences;
        if (!cancelled) setPreferences(data);
      } catch { if (!cancelled) setPreferences(DEFAULT_PREFERENCES); }
    })();
    return () => { cancelled = true; };
  }, [uid, authorizationHeaders]);
  async function persistPreferences() {
    setPreferencesSaving(true); setPreferencesMessage("");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json", ...await authorizationHeaders() }, body: JSON.stringify(preferences) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Не удалось сохранить настройки");
      setPreferencesMessage("Настройки сохранены в аккаунте.");
    } catch (error) { setPreferencesMessage(error instanceof Error ? error.message : "Ошибка сохранения."); }
    finally { setPreferencesSaving(false); }
  }

  async function loginKapani() {
    if (!loginNick.trim() || !loginPassword) { setShopError("Введи ник и пароль от «Капани»."); return; }
    setLoggingIn(true); setShopError("");
    try {
      // All bank requests go through our same-origin server. Direct browser
      // access to *.supabase.co can fail in regions where Cloudflare is blocked.
      const response = await fetch("/api/kapani/login", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...await authorizationHeaders() },
        body: JSON.stringify({ login: loginNick.trim(), password: loginPassword }) });
      const data = await response.json() as KapaniBank & { accessToken?: string; expiresIn?: number; error?: string };
      if (!response.ok || !data.accessToken) throw new Error(data.error || "Не удалось войти в банк Капаней.");
      setKapaniBank({ nickname: data.nickname, balance: data.balance });
      // The wallet token lives only in memory while the checkout is open.
      setKapaniSession({ accessToken: data.accessToken, expiresAt: Date.now() + (data.expiresIn || 3600) * 1000 });
      setLoginPassword("");
    } catch (e) { setShopError(e instanceof Error ? e.message : "Не удалось войти."); }
    finally { setLoggingIn(false); }
  }
  async function buyPlan(plan: Plan) {
    if (plan === "free" || !kapaniSession || !uid) return;
    setBuying(true); setShopError("");
    try {
      if (kapaniSession.expiresAt < Date.now() + 15000) throw new Error("Банковская сессия истекла. Отключи счёт и войди заново.");
      const key = "kapani-gpt-pending-purchase:" + uid;
      let pending: { id: string; plan: Plan } | null = null;
      try { pending = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* invalid old cache */ }
      if (pending && pending.plan !== plan) throw new Error("Сначала заверши предыдущую покупку " + PLANS[pending.plan].name + ".");
      const purchaseId = pending?.id || crypto.randomUUID();
      localStorage.setItem(key, JSON.stringify({ id: purchaseId, plan }));
      const response = await fetch("/api/kapani/purchase", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...await authorizationHeaders(), "x-kapani-token": kapaniSession.accessToken },
        body: JSON.stringify({ plan, purchaseId }) });
      const purchase = await response.json() as { success?: boolean; balance?: number; expiresAt?: string; error?: string };
      if (!response.ok || !purchase.success) throw new Error(purchase.error || "Платёж не подтверждён сервером Капани.");
      localStorage.removeItem(key);
      const steps = ["Подписка " + PLANS[plan].name + " активирована", "Открыты режим «Работа» и все модели KapaniGPT", "Доступны три уровня рассуждения в чате"];
      if (purchase.balance != null) steps.push("Баланс после покупки — " + purchase.balance.toLocaleString("ru-RU") + " капанёвских ₽");
      setUnlockSteps(steps); setUnlockIndex(0); setCheckoutPlan(null); setShopOpen(false);
      setKapaniSession(null); setKapaniBank(null); setLoginNick("");
      await refreshUsage();
    } catch (e) { setShopError(e instanceof Error ? e.message : "Ошибка оплаты"); }
    finally { setBuying(false); }
  }

  async function buyTokenPack(pack: TokenPack) {
    if (!kapaniSession || !uid || buyingTokens) return;
    setBuyingTokens(true); setShopError("");
    try {
      if (kapaniSession.expiresAt < Date.now() + 15000)
        throw new Error("Банковская сессия истекла. Войди в банк Капаней заново.");
      const key = "kapani-gpt-pending-tokens:" + uid;
      let pending: { id: string; pack: TokenPack } | null = null;
      try { pending = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* retry from server */ }
      if (pending && pending.pack !== pack)
        throw new Error("Сначала заверши прежнюю покупку токенов. Её данные сохранены для безопасного повтора.");
      const headers = { "Content-Type": "application/json", ...await authorizationHeaders(), "x-kapani-token": kapaniSession.accessToken };
      if (!pending) {
        const started = await fetch("/api/kapani/tokens", { method: "POST", cache: "no-store", headers,
          body: JSON.stringify({ action: "start", pack }) });
        const checkout = await started.json() as { purchaseId?: string; error?: string };
        if (!started.ok || !checkout.purchaseId) throw new Error(checkout.error || "Не удалось начать покупку.");
        pending = { id: checkout.purchaseId, pack };
        localStorage.setItem(key, JSON.stringify(pending));
      }
      const response = await fetch("/api/kapani/tokens", { method: "POST", cache: "no-store", headers,
        body: JSON.stringify({ action: "confirm", pack, purchaseId: pending.id }) });
      const purchase = await response.json() as { success?: boolean; tokensAdded?: number; tokensBalance?: number; bankBalance?: number; error?: string };
      if (!response.ok || !purchase.success) throw new Error(purchase.error || "Банк не подтвердил покупку токенов.");
      localStorage.removeItem(key);
      setUnlockSteps([`Зачислено ${purchase.tokensAdded ?? TOKEN_PACKS[pack].tokens} токенов KapaniGPT`,
        `Остаток токенов — ${(purchase.tokensBalance || 0).toLocaleString("ru-RU")}. Они не сгорают.`]);
      setUnlockIndex(0); setCheckoutPack(null); setShopOpen(false);
      setKapaniSession(null); setKapaniBank(null); setLoginNick("");
      await refreshUsage();
    } catch (e) { setShopError(e instanceof Error ? e.message : "Ошибка покупки токенов."); }
    finally { setBuyingTokens(false); }
  }

  useEffect(() => onAuthStateChanged(auth, user => {
    if (lastAuthUid.current !== (user?.uid || null)) {
      setKapaniSession(null); setKapaniBank(null);
      setUsage(EMPTY_USAGE);
      setPromoError("");
      setPreferences(DEFAULT_PREFERENCES);
      lastAuthUid.current = user?.uid || null;
    }
    if (user?.isAnonymous) {
      setUid(null); setAuthReady(true);
      signOut(auth).catch(e => setAuthError(e.message));
      return;
    }
    setUid(user?.uid || null); setAuthReady(true);
    if (user) setAuthError("");
    else { setChats([]); setMessages([]); setChatId(null); setChatMode("chat"); setTemporaryChatStarted(false); messagesRef.current = []; setKapaniSession(null); setKapaniBank(null); }
  }, e => { setAuthError(e.message); setAuthReady(true); }), []);
  useEffect(() => {
    if (!streaming) return;
    const phrases = model === "kapani-sky"
      ? ["Думаю над запросом…", "Собираю данные из контекста…", "Анализирую детали…", "Проверяю выводы…", "Уточняю формулировки…", "Готовлю ответ…"]
      : model === "kapani-grass" || reasoning !== "off"
        ? ["Думаю…", "Анализирую запрос…", "Собираю данные из контекста…", "Проверяю ответ…", "Формулирую мысль…"]
        : ["Думаю…", "Готовлю ответ…"];
    let index = 0;
    setThinkingStatus(phrases[0]);
    const timer = setInterval(() => { index = (index + 1) % phrases.length; setThinkingStatus(phrases[index]); }, model === "kapani-sky" ? 2900 : 2300);
    return () => clearInterval(timer);
  }, [streaming, model, reasoning]);
  async function submitFirebaseAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authPassword.length < 6) { setAuthError("Пароль должен содержать хотя бы 6 символов."); return; }
    if (authMode === "register" && authNickname.trim().length < 2) { setAuthError("Придумай ник хотя бы из двух символов."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      if (authMode === "register") {
        const created = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        await updateProfile(created.user, { displayName: authNickname.trim().slice(0, 40) });
      } else await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      setAuthPassword("");
    } catch (e) {
      const code = (e as {code?:string}).code || "";
      setAuthError(code === "auth/email-already-in-use" ? "На эту почту уже зарегистрирован аккаунт. Войди."
        : code === "auth/invalid-credential" || code === "auth/wrong-password" ? "Почта или пароль неверные."
        : code === "auth/invalid-email" ? "Проверь адрес электронной почты."
        : code === "auth/operation-not-allowed" ? "В Firebase проекта нужно включить вход Email/Password."
        : code === "auth/too-many-requests" ? "Слишком много попыток. Подожди немного."
        : e instanceof Error ? e.message : "Не удалось войти.");
    } finally { setAuthBusy(false); }
  }
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(query(collection(database, "users", uid, "chats"), orderBy("updatedAt", "desc")), snap => {
      setChats(snap.docs.map(d => ({ id: d.id, title: String(d.data().title || "Новый чат"), updatedAt: d.data().updatedAt?.toMillis?.() || Date.now(), pinned: !!d.data().pinned, mode: d.data().mode === "work" ? "work" : "chat" })));
    }, e => setAuthError("Firestore: " + e.message));
  }, [uid]);
  useEffect(() => {
    activeRef.current = chatId;
    if (!uid || !chatId) { setMessages([]); messagesRef.current = []; return; }
    return onSnapshot(query(collection(database, "users", uid, "chats", chatId, "messages"), orderBy("createdAt", "asc")), snap => {
      const rows = snap.docs.map(d => ({ ...(d.data() as Omit<ChatMessage, "id">), id: d.id }));
      messagesRef.current = rows; setMessages(rows);
    }, e => setAuthError("Сообщения: " + e.message));
  }, [uid, chatId]);
  useEffect(() => {
    setMessageMenuId(null); setEditingMessageId(null); setMessageConfirm(null); setMessageNotice("");
  }, [chatId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, streamedText, streaming, chatId]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") { setSettingsOpen(false); setModelOpen(false); setMenuId(null); setMessageMenuId(null); setEditingMessageId(null); setMobileSidebar(false); setSearchOpen(false); }
    };
    document.addEventListener("keydown", keys); return () => document.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    if (!messageMenuId) return;
    const closeOnOutside = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".message-actions-wrap")) setMessageMenuId(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [messageMenuId]);

  function newChat() { abortRef.current?.abort(); setChatId(null); setChatMode("chat"); setReasoning("off"); setTemporaryChatStarted(false); setMessages([]); messagesRef.current = []; setPrompt(""); setAttachments([]); setMessageMenuId(null); setEditingMessageId(null); setMessageConfirm(null); setMessageNotice(""); setError(""); setStreamedText(""); setStreaming(false); setMobileSidebar(false); setTimeout(() => inputRef.current?.focus(), 40); }
  function changeMode(next: ChatMode) { if (modeLocked || (next === "work" && isFree)) return; setChatMode(next); setReasoning("off"); setModelOpen(false); setReasoningOpen(false); }
  async function editChat(id: string, changes: Record<string, unknown>) { if (!uid) return; await updateDoc(doc(database, "users", uid, "chats", id), { ...changes, updatedAt: serverTimestamp() }); }
  async function removeChat(id: string) {
    if (!uid) return;
    const base = doc(database, "users", uid, "chats", id), rows = await getDocs(collection(base, "messages"));
    for (let i = 0; i < rows.docs.length; i += 400) { const batch = writeBatch(database); rows.docs.slice(i, i + 400).forEach(row => batch.delete(row.ref)); await batch.commit(); }
    await deleteDoc(base); if (chatId === id) newChat(); setDeleteTarget(null);
  }
  async function deleteAllChats() {
    if (!uid || deletingAll) return;
    setDeletingAll(true);
    try {
      const all = await getDocs(collection(database, "users", uid, "chats"));
      for (const chat of all.docs) {
        const rows = await getDocs(collection(chat.ref, "messages"));
        for (let i = 0; i < rows.docs.length; i += 400) {
          const batch = writeBatch(database);
          rows.docs.slice(i, i + 400).forEach(row => batch.delete(row.ref));
          await batch.commit();
        }
        await deleteDoc(chat.ref);
      }
      newChat(); setConfirmDeleteAll(false); setPreferencesMessage("История удалена.");
    } catch (e) { setPreferencesMessage(e instanceof Error ? e.message : "Ошибка удаления истории."); }
    finally { setDeletingAll(false); }
  }
  async function addFiles(list: FileList | File[]) {
    setUploading(true); setError("");
    try { const files = Array.from(list).slice(0, 4 - attachments.length), prepared = await Promise.all(files.map(prepareAttachment)); setAttachments(old => [...old, ...prepared].slice(0, 4)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось прочитать файл."); }
    finally { setUploading(false); }
  }
  function openSettings() { setSettingsOpen(true); }
  function stopGeneration() { abortRef.current?.abort(); setStreaming(false); }

  async function askAI(textOverride?: string) {
    const text = (textOverride ?? prompt).trim();
    if ((!text && !attachments.length) || streaming || !uid || uploading) return;
    if (!text && attachments.every(a => a.data)) { setError("Текущая модель пока не умеет смотреть изображения. Напиши вопрос текстом или прикрепи текстовый файл."); return; }
    const userMessage: ChatMessage = { id: makeId(), role: "user", content: text, createdAt: Date.now(), attachments: [...attachments] };
    const history = messagesRef.current.slice(-24), previousId = activeRef.current, currentChat = previousId || doc(collection(database, "users", uid, "chats")).id;
    const saveHistory = preferences.historyEnabled;
    setError(""); setPrompt(""); setAttachments([]); setStreamedText("");
    if (saveHistory) {
      try {
        if (!previousId) {
          const title = text.replace(/\s+/g, " ").slice(0, 45) || attachments[0]?.name || "Новый чат";
          await setDoc(doc(database, "users", uid, "chats", currentChat), { title, mode: chatMode, pinned: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          setChatId(currentChat);
        } else await editChat(currentChat, {});
        await setDoc(doc(database, "users", uid, "chats", currentChat, "messages", userMessage.id), userMessage);
      } catch (e) { setError("Не удалось сохранить чат в Firebase: " + (e instanceof Error ? e.message : "")); return; }
    } else {
      setTemporaryChatStarted(true);
      const next = [...messagesRef.current, userMessage]; messagesRef.current = next; setMessages(next);
    }
    const controller = new AbortController(); abortRef.current = controller; setStreaming(true);
    const prior = [...history, userMessage].map(msg => {
      const context = msg.attachments?.filter(a => a.text).map(a => "\n\n[Файл " + a.name + "]\n" + a.text!.slice(0, 1600)).join("") || "";
      const imageNotice = msg.attachments?.some(a => a.data) ? "\n[Прикреплено изображение, которое модель не видит. Не выдумывай его содержимое.]" : "";
      return { role: msg.role, content: msg.content + context + imageNotice || "Вложение без текста" };
    });
    let complete = "";
    let generatedFiles: GeneratedFile[] = [];
    let sources: WebSource[] = [];
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...await authorizationHeaders() }, body: JSON.stringify({ messages: prior, mode: chatMode, model: chatMode === "work" ? model : DEFAULT_MODEL, reasoning }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || "Ошибка сервера " + response.status); }
      const initial = await response.json() as { usage?: Usage; choices?: Array<{ message?: { content?: string; files?: GeneratedFile[]; sources?: WebSource[] } }> };
      if (initial.usage) setUsage(initial.usage);
      complete = initial.choices?.[0]?.message?.content || "";
      generatedFiles = initial.choices?.[0]?.message?.files || [];
      sources = initial.choices?.[0]?.message?.sources || [];
      if (!complete.trim() && !generatedFiles.length) throw new Error("Модель вернула пустой ответ. Попробуй другую модель.");
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Ошибка генерации."); }
    finally {
      if (complete.trim() || generatedFiles.length) {
        const assistantMessage: ChatMessage = { id: makeId(), role: "assistant", content: complete, generatedFiles, sources, createdAt: Date.now() + 1 };
        if (saveHistory) {
          try { await setDoc(doc(database, "users", uid, "chats", currentChat, "messages", assistantMessage.id), assistantMessage); } catch {}
        } else {
          const next = [...messagesRef.current, assistantMessage]; messagesRef.current = next; setMessages(next);
        }
      }
      setStreaming(false); setStreamedText(""); abortRef.current = null;
      refreshUsage();
    }
  }
  async function copyMessage(message: ChatMessage) { await navigator.clipboard.writeText(message.content); setCopiedId(message.id); setTimeout(() => setCopiedId(null), 1500); }
  function quoteMessage(message: ChatMessage) {
    const quoted = message.content.trim().slice(0, 650).split("\n").map(line => "> " + line).join("\n");
    setPrompt(old => (old.trim() ? old.trimEnd() + "\n\n" : "") + quoted + "\n\n");
    setMessageMenuId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function beginMessageEdit(message: ChatMessage) {
    if (streaming || messageBusy || message.role !== "user") return;
    setEditingMessageId(message.id); setEditingMessageText(message.content); setMessageMenuId(null); setMessageNotice("");
  }
  function askToRewind(message: ChatMessage, laterCount: number) {
    setMessageMenuId(null);
    if (!laterCount) {
      document.getElementById("msg-" + message.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setMessageConfirm({ id: message.id, kind: "rewind" });
  }
  function submitMessageEdit(message: ChatMessage, laterCount: number) {
    const text = editingMessageText.trim();
    if (!text) { setError("Сообщение не может быть пустым."); return; }
    if (text === message.content) { setEditingMessageId(null); return; }
    const action = { id: message.id, kind: "edit" as const, text };
    if (laterCount) setMessageConfirm(action);
    else void applyMessageAction(action);
  }
  async function applyMessageAction(action: { id: string; kind: "rewind" | "edit" | "remove"; text?: string }) {
    if (!uid || streaming || messageBusy) return;
    const source = messagesRef.current;
    const selected = source.findIndex(message => message.id === action.id);
    if (selected < 0) { setMessageConfirm(null); setError("Не удалось найти это сообщение. Обнови чат."); return; }
    if (action.kind === "edit" && (source[selected].role !== "user" || !action.text?.trim())) return;
    const sourceChatId = activeRef.current;
    setMessageBusy(true); setMessageNotice(""); setError("");
    try {
      if (sourceChatId) {
        const thread = doc(database, "users", uid, "chats", sourceChatId);
        const saved = await getDocs(query(collection(thread, "messages"), orderBy("createdAt", "asc")));
        const found = saved.docs.findIndex(row => row.id === action.id);
        if (found >= 0) {
          const remove = action.kind === "remove" ? [saved.docs[found]] : action.kind === "rewind" || action.kind === "edit" ? saved.docs.slice(found + 1) : [];
          if (remove.length === 0 && action.kind === "edit") {
            await updateDoc(saved.docs[found].ref, { content: action.text!.trim(), editedAt: Date.now() });
          } else {
            // Firebase permits at most 500 writes per batch. Include the edit
            // alongside the first deletion, so a retry can't create two edits.
            for (let i = 0; i < remove.length; i += 400) {
              const batch = writeBatch(database);
              if (i === 0 && action.kind === "edit") batch.update(saved.docs[found].ref, { content: action.text!.trim(), editedAt: Date.now() });
              remove.slice(i, i + 400).forEach(row => batch.delete(row.ref));
              await batch.commit();
            }
          }
          await updateDoc(thread, { updatedAt: serverTimestamp() });
        }
      }
      if (sourceChatId === activeRef.current) {
        const next = action.kind === "remove"
          ? source.filter(message => message.id !== action.id)
          : source.slice(0, selected + 1).map(message => message.id === action.id && action.kind === "edit"
            ? { ...message, content: action.text!.trim(), editedAt: Date.now() } : message);
        messagesRef.current = next; setMessages(next);
        setMessageNotice(action.kind === "edit" ? "Сообщение изменено. Поздние ответы удалены — можно продолжать переписку."
          : action.kind === "rewind" ? "Вернулись к выбранному сообщению. Более поздняя часть переписки удалена."
          : "Сообщение удалено.");
      }
      setEditingMessageId(null); setMessageMenuId(null); setMessageConfirm(null);
    } catch (error) { setError(error instanceof Error ? "Не получилось изменить переписку: " + error.message : "Ошибка изменения переписки."); }
    finally { setMessageBusy(false); }
  }
  function downloadGeneratedFile(file: GeneratedFile) {
    const fileName = file.name.replace(/[\\/]/g, "_");
    const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function exportChat() {
    const title = chats.find(c => c.id === chatId)?.title || "KapaniGPT", md = "# " + title + "\n\n" + messages.map(m => "## " + (m.role === "user" ? "Вы" : "KapaniGPT") + "\n\n" + m.content + "\n").join("\n");
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" })), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "KapaniGPT-chat.md"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function speakMessage(text: string) { if (!("speechSynthesis" in window)) return; speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "ru-RU"; speechSynthesis.speak(utterance); }
  function recordVoice() {
    type Recognition = new () => { lang: string; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; start: () => void; onerror: (() => void) | null };
    const speechWindow = window as unknown as { SpeechRecognition?: Recognition; webkitSpeechRecognition?: Recognition }, SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError("Голосовой ввод не поддерживается этим браузером."); return; }
    const recognition = new SpeechRecognition(); recognition.lang = "ru-RU"; recognition.onresult = event => setPrompt(value => [value, event.results[0][0].transcript].filter(Boolean).join(" ")); recognition.onerror = () => setError("Не удалось распознать речь."); recognition.start();
  }
  const groupedChats = chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase())), pinnedChats = groupedChats.filter(c => c.pinned), recentChats = groupedChats.filter(c => !c.pinned), activeTitle = chats.find(c => c.id === chatId)?.title;
  function renderChatItem(chat: Chat) {
    return <div className={"chat-item " + (chatId === chat.id ? "active" : "")} key={chat.id}>
      <button className="chat-open" onClick={() => { setChatId(chat.id); setChatMode(chat.mode); setTemporaryChatStarted(false); setReasoning("off"); setError(""); setMobileSidebar(false); }}><MessageCircle size={15} /><span>{chat.title}</span>{chat.mode === "work" && <span className="chat-mode-dot" title="Работа"/>}</button>
      <button className="chat-menu-button" aria-label="Действия с чатом" onClick={() => setMenuId(menuId === chat.id ? null : chat.id)}><MoreHorizontal size={17} /></button>
      {menuId === chat.id && <div className="chat-menu"><button onClick={() => { setRenameValue(chat.title); setRenaming(chat.id); setMenuId(null); }}><Pencil size={14} /> Переименовать</button><button onClick={() => { editChat(chat.id, { pinned: !chat.pinned }); setMenuId(null); }}><Pin size={14} /> {chat.pinned ? "Открепить" : "Закрепить"}</button><button className="delete-item" onClick={() => { setDeleteTarget(chat.id); setMenuId(null); }}><Trash2 size={14} /> Удалить</button></div>}
      {renaming === chat.id && <div className="rename-overlay"><input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { editChat(chat.id, { title: renameValue.trim() || chat.title }); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }} /><button onClick={() => { editChat(chat.id, { title: renameValue.trim() || chat.title }); setRenaming(null); }}><Check size={15} /></button></div>}
    </div>;
  }

  function renderMessageItem(m: ChatMessage, index: number) {
    const laterCount = messages.length - index - 1;
    const editing = editingMessageId === m.id && m.role === "user";
    return <article id={"msg-" + m.id} key={m.id} className={"message message-" + m.role + (messageMenuId === m.id ? " message-menu-open" : "")}>
      <div className="message-inner">
        {m.role === "assistant" && <div className="assistant-mark"><Sparkles size={16}/></div>}
        <div className="message-body">
          {m.attachments?.length ? <div className="message-attachments">{m.attachments.map((a,i) => a.data
            ? <div className="sent-image" key={i}><img src={a.data} alt={a.name}/><span>{a.name}</span></div>
            : <div className="sent-file" key={i}><FileText size={18}/><span>{a.name}</span></div>)}</div> : null}
          {editing ? <div className="message-inline-edit">
            <textarea autoFocus rows={Math.min(8, Math.max(3, editingMessageText.split("\n").length))} maxLength={16000}
              value={editingMessageText} onChange={e => setEditingMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitMessageEdit(m, laterCount); } }}/>
            <div className="message-edit-footer"><span>Ctrl+Enter — сохранить</span><button onClick={() => setEditingMessageId(null)}>Отмена</button>
              <button className="message-edit-save" disabled={messageBusy || !editingMessageText.trim()} onClick={() => submitMessageEdit(m, laterCount)}><Check size={14}/> Сохранить</button></div>
          </div> : m.content && <div className={m.role === "user" ? "user-bubble" : "assistant-copy"}>{m.role === "user" ? m.content : renderText(m.content)}</div>}
          {!!m.sources?.length && <div className="web-sources"><strong>Источники из интернета</strong><div>{m.sources.map((source, i) => <a key={i} href={source.url} target="_blank" rel="noopener noreferrer" title={source.snippet}><span>[{i + 1}]</span> {source.title}</a>)}</div></div>}
          {!!m.generatedFiles?.length && <div className="generated-files">{m.generatedFiles.map((file, i) => <button className="generated-file" key={m.id + i} title={"Скачать " + file.name} onClick={() => downloadGeneratedFile(file)}><span className="generated-file-icon"><FileCode2 size={19}/></span><span className="generated-file-name"><strong>{file.name}</strong><small>Готовый файл · {prettySize(new Blob([file.content]).size)}</small></span><Download size={17}/></button>)}</div>}
          {!editing && <div className="message-actions">
            <button aria-label="Копировать сообщение" title="Копировать" onClick={() => void copyMessage(m)}>{copiedId === m.id ? <Check size={15}/> : <Clipboard size={15}/>}</button>
            {m.role === "assistant" && <button aria-label="Прочитать вслух" title="Прочитать вслух" onClick={() => speakMessage(m.content)}><AudioLines size={15}/></button>}
            <div className={"message-actions-wrap " + (laterCount < 2 ? "menu-above" : "")}><button aria-label="Ещё действия с сообщением" aria-expanded={messageMenuId === m.id} title="Действия с сообщением" disabled={streaming || messageBusy}
              onClick={() => setMessageMenuId(messageMenuId === m.id ? null : m.id)}><MoreHorizontal size={17}/></button>
              {messageMenuId === m.id && <div className="message-action-menu">
                <button onClick={() => { void copyMessage(m); setMessageMenuId(null); }}><Clipboard size={15}/> Копировать</button>
                <button onClick={() => quoteMessage(m)}><MessageCircle size={15}/> Цитировать в ответе</button>
                {m.role === "user" && <button onClick={() => beginMessageEdit(m)}><Pencil size={15}/> Редактировать</button>}
                <button onClick={() => askToRewind(m, laterCount)}><Pin size={15}/> {laterCount ? "Продолжить отсюда" : "Перейти к сообщению"}</button>
                <button className="danger-menu-action" onClick={() => { setMessageMenuId(null); setMessageConfirm({ id: m.id, kind: "remove" }); }}><Trash2 size={15}/> Удалить сообщение</button>
              </div>}
            </div>
          </div>}
        </div>
      </div>
    </article>;
  }

  if (!authReady || !uid) return <div className="auth-page">
    <div className="auth-orb auth-orb-a"/><div className="auth-orb auth-orb-b"/>
    <div className="auth-card">
      <div className="auth-brand"><span className="auth-brand-symbol"><Sparkles size={22}/></span><span>Kapani<span>GPT</span></span></div>
      {authReady ? <>
        <h1>{authMode === "register" ? "Создай свой аккаунт" : "С возвращением"}</h1>
        <p className="auth-subtitle">Личные чаты, история и модели KapaniGPT. Войти нужно один раз — дальше сессия сохранится.</p>
        <div className="auth-tabs"><button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Вход</button><button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>Регистрация</button></div>
        <form className="auth-form" onSubmit={submitFirebaseAuth}>
          {authMode === "register" && <label>Никнейм<input value={authNickname} onChange={e => setAuthNickname(e.target.value)} placeholder="Как тебя называть" minLength={2} maxLength={40} required autoComplete="nickname"/></label>}
          <label>Электронная почта<input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="you@example.com" type="email" required autoComplete="email"/></label>
          <label>Пароль<input value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Не менее 6 символов" type="password" minLength={6} required autoComplete={authMode === "register" ? "new-password" : "current-password"}/></label>
          {authError && <div className="auth-error"><CircleHelp size={15}/>{authError}</div>}
          <button className="auth-submit" disabled={authBusy}>{authBusy ? <LoaderCircle size={18} className="spinning"/> : <ArrowUp size={18}/>} {authMode === "register" ? "Зарегистрироваться" : "Войти в KapaniGPT"}</button>
        </form>
        {authMode === "register" && <p className="auth-opening-note"><Gift size={15}/> После регистрации можно забрать Kapani AI plus на 7 дней бесплатно — в честь открытия.</p>}
        <p className="auth-footnote">Аккаунт защищён Firebase Authentication. У каждого пользователя отдельная история переписки.</p>
      </> : <div className="auth-loading"><LoaderCircle size={22} className="spinning"/> Проверяю сессию…</div>}
    </div>
  </div>;

  return <div className={"app-shell " + (compact ? "compact-ui" : "")} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
    {mobileSidebar && <div className="mobile-scrim" onClick={() => setMobileSidebar(false)} />}
    <aside className={"sidebar " + (!sidebar ? "sidebar-closed " : "") + (mobileSidebar ? "mobile-open" : "")}>
      <div className="sidebar-head"><button className="brand" onClick={newChat}><span className="brand-symbol"><Sparkles size={17} strokeWidth={2.2} /></span><span>Kapani<span className="brand-gpt">GPT</span></span><ChevronDown size={13} className="brand-chev" /></button><button className="icon-button mobile-close" aria-label="Закрыть меню" onClick={() => setMobileSidebar(false)}><X size={18} /></button><button className="icon-button collapse-button" aria-label="Скрыть панель" onClick={() => setSidebar(false)}><PanelLeftClose size={18} /></button></div>
      <div className="sidebar-top-actions"><button className="side-nav new-chat" onClick={newChat}><Pencil size={17} /><span>Новый чат</span><span className="shortcut">⌘⇧O</span></button><button className="side-nav" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Поиск чатов</span><span className="shortcut">⌘K</span></button></div>
      <div className="sidebar-divider" />
      <div className="sidebar-scroll">{!!pinnedChats.length && <section className="chat-section"><div className="section-caption">Закреплённые</div>{pinnedChats.map(renderChatItem)}</section>}<section className="chat-section"><div className="section-caption">Недавние <span className="count-chip">{recentChats.length}</span></div>{recentChats.length ? recentChats.map(renderChatItem) : <div className="empty-history">Твои диалоги появятся здесь</div>}</section></div>
      <div className="sidebar-bottom">
        {usage.promoEligible && <div className="opening-offer"><div className="opening-offer-top"><Gift size={18}/><span>Подарок к открытию</span></div><strong>7 дней Kapani AI plus</strong><p>Бесплатно. Один раз на аккаунт. Без привязки карты.</p><button onClick={claimOpeningPromo} disabled={claimingPromo}>{claimingPromo ? <LoaderCircle size={15} className="spinning"/> : <Crown size={15}/>} {claimingPromo ? "Активируем…" : "Забрать бесплатно"}<ChevronRight size={15}/></button>{promoError && <small className="opening-offer-error">{promoError}</small>}</div>}
        <button className="upgrade-side" onClick={() => setShopOpen(true)}><Crown size={17}/><span>{usage.plan === "free" ? "Улучшить тариф" : tier.name}</span><ChevronRight size={15}/></button><button className="profile" onClick={openSettings}><span className="avatar">K</span><span className="profile-text"><b>{auth.currentUser?.displayName || auth.currentUser?.email || "KapaniGPT"}</b><small>{tier.name}</small></span><Settings2 size={17} /></button></div>
    </aside>
    <main className={"main-area " + (!sidebar ? "wide-area" : "")}>
      <header className="topbar"><div className="topbar-left">
        {!sidebar && <button className="icon-button desktop-show" aria-label="Открыть панель" onClick={() => setSidebar(true)}><PanelLeftOpen size={20} /></button>}
        <button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={() => setMobileSidebar(true)}><Menu size={21} /></button>
        {isFree ? <span className="top-brand-name">KapaniGPT</span> : <div className="mode-switch" title={modeLocked ? "Режим закреплён за этой перепиской. Создай новый чат, чтобы его сменить." : "Выбери режим для нового чата"}>
          <button className={chatMode === "chat" ? "active" : ""} disabled={modeLocked} onClick={() => changeMode("chat")}><MessageCircle size={15}/> Чат</button>
          <button className={chatMode === "work" ? "active" : ""} disabled={modeLocked} onClick={() => changeMode("work")}><Code2 size={15}/> Работа</button>
          {modeLocked && <LockKeyhole size={13} className="mode-lock"/>}
        </div>}
      </div><div className="topbar-right">{usage.promoEligible && <button className="mobile-promo-button" onClick={claimOpeningPromo} disabled={claimingPromo} title="7 дней Kapani AI plus бесплатно"><Gift size={16}/> Plus на 7 дней</button>}<button className="usage-chip" onClick={() => { setSettingsTab("limits"); setSettingsOpen(true); }} title="Общий лимит и токены"><span className="usage-chip-track"><span style={{ width: activeRemaining + "%" }}/></span>{activeRemaining}%{usage.tokensBalance > 0 && <span className="token-counter"><Zap size={12}/>{usage.tokensBalance}</span>}</button><button className="icon-button" title="Настройки" onClick={openSettings}><Settings2 size={19}/></button>{chatId && <button className="icon-button export-button" title="Экспорт чата" onClick={exportChat}><Download size={18}/></button>}</div></header>
      <div className={"chat-viewport " + (!messages.length && !streaming ? "is-home" : "")}>
        {!messages.length && !streaming ? <div className="home-content"><div className="hero-emblem"><Sparkles size={27} strokeWidth={1.7} /></div><h1>{chatMode === "work" ? "С чем поработаем?" : "С чего начнём?"}</h1><p>{chatMode === "work" ? "Код, документы и сложные задачи." : "Просто напиши, что нужно."}</p><div className="suggestions"><button onClick={() => { setPrompt("Придумай интересную идею для нового проекта и распиши, как её реализовать."); inputRef.current?.focus(); }}><WandSparkles size={16} /> Идея <ChevronRight size={14} /></button><button onClick={() => { setPrompt("Помоги мне написать чистый и понятный код."); inputRef.current?.focus(); }}><Code2 size={16} /> Код <ChevronRight size={14} /></button><button onClick={() => { setPrompt("Объясни сложную тему простыми словами, с примером."); inputRef.current?.focus(); }}><CircleHelp size={16} /> Разобраться <ChevronRight size={14} /></button></div></div>
        : <div className="conversation"><div className="conversation-title">{activeTitle || "Новый чат"}</div>
          {messages.map(renderMessageItem)}
          {streaming && <article className="message message-assistant"><div className="message-inner"><div className="assistant-mark"><Sparkles size={16} /></div><div className="message-body">{streamedText ? <div className="assistant-copy">{renderText(streamedText)}<span className="stream-cursor" /></div> : <div className="thinking"><span /><span /><span /><em>{thinkingStatus}</em></div>}</div></div></article>}
          {messageNotice && <div className="message-feedback"><Check size={15}/><span>{messageNotice}</span><button onClick={() => setMessageNotice("")} aria-label="Скрыть"><X size={14}/></button></div>}
          <div ref={bottomRef}/>
        </div>}
      </div>
      <div className={"composer-dock " + (!messages.length && !streaming ? "home-composer" : "")}><div className="composer-wrap">{error && <div className="error-banner"><CircleHelp size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}{authError && <div className="error-banner"><CircleHelp size={16} /><span>{authError}</span></div>}<div className={"composer " + (streaming ? "is-generating" : "")}>{!!attachments.length && <div className="attachment-list">{attachments.map((a,i) => <div className="attachment-chip" key={i}>{a.data ? <img src={a.data} alt="" /> : <span className="file-square"><FileCode2 size={17} /></span>}<div><b title={a.name}>{a.name}</b><small>{prettySize(a.size)}</small></div><button aria-label={"Убрать " + a.name} onClick={() => setAttachments(old => old.filter((_, index) => index !== i))}><X size={14} /></button></div>)}</div>}
        <textarea ref={inputRef} rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); askAI(); } }} placeholder="Спроси что угодно" aria-label="Сообщение для KapaniGPT" />
        <div className="composer-toolbar"><div className="tool-left">
          <input ref={fileRef} type="file" hidden multiple accept="image/*,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.log,.sql" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <button className="tool-icon" title="Прикрепить файл" onClick={() => fileRef.current?.click()} disabled={uploading || attachments.length >= 4}><Plus size={21}/></button>
          <span className="toolbar-divider"/>
          {chatMode === "work" && !isFree && <div className="model-trigger composer-model-trigger"><button className="model-pill model-selector" onClick={() => { setModelOpen(!modelOpen); setReasoningOpen(false); }}><Sparkles size={14}/><span>{modelName}</span><ChevronDown size={13}/></button>{modelOpen && <div className="model-dropdown composer-model-dropdown"><div className="dropdown-label">Модель KapaniGPT</div>{MODEL_CHOICES.map((m, index) => <button key={m.id} style={{ animationDelay: index * 55 + "ms" }} className={"model-option animated-choice " + (model === m.id ? "selected" : "")} onClick={() => { setModel(m.id); setModelOpen(false); }}><span className="model-option-mark"><Sparkles size={17}/></span><span><b>{m.name}</b><small>{m.detail}</small></span>{model === m.id && <Check size={16}/>}</button>)}</div>}</div>}
          <div className="reasoning-wrapper"><button className={"tool-mode reasoning-mode animated-choice " + (reasoning !== "off" ? "activated " : "") + (reasoning === "maximum" && chatMode === "work" ? "max-reasoning" : "")} onClick={() => {
            if (isFree) setReasoning(reasoning === "off" ? "medium" : "off");
            else { setReasoningOpen(!reasoningOpen); setModelOpen(false); }
          }}><BrainCircuit size={15}/><span className={reasoning === "maximum" && chatMode === "work" ? "max-reasoning-label" : ""}>{reasoning === "off" ? "Без рассуждения" : isFree ? "Рассуждение · вкл" : REASONING.find(r => r.id === reasoning)?.name}</span>{!isFree && <ChevronDown size={12}/>}</button>
            {reasoningOpen && !isFree && <div className={"reasoning-menu reasoning-panel " + (reasoning === "maximum" && chatMode === "work" ? "max-active" : "")}>
              <div className="reasoning-heading">{chatMode === "work" ? "Глубина рассуждений · Работа" : "Уровень рассуждения"}</div>
              <div className={"reasoning-current " + (reasoning === "maximum" && chatMode === "work" ? "max-reasoning-label" : "")}>{reasoning === "off" ? "Выключено" : REASONING.find(r => r.id === reasoning)?.name}</div>
              <input aria-label="Уровень рассуждения" type="range" min={0} max={reasoningOptions.length - 1} step={1} value={reasoningIndex} style={{ "--range-progress": (reasoningIndex / (reasoningOptions.length - 1) * 100) + "%" } as React.CSSProperties} onChange={e => setReasoning(reasoningOptions[Number(e.target.value)])}/>
              <div className="reasoning-range-labels">{(chatMode === "work" ? ["Выкл.", "Низк.", "Средн.", "Выс.", "Очень", "Макс."] : ["Выкл.", "Низкий", "Средний", "Высокий"]).map((label, i) => <span key={label} className={reasoningIndex === i ? "selected" : ""} onClick={() => setReasoning(reasoningOptions[i])}>{label}</span>)}</div>
            </div>}
          </div>
          {chatMode === "work" && <span className="composer-work-label"><Code2 size={13}/><span>Работа</span></span>}
        </div><div className="tool-right"><button className="tool-icon mic" title="Голосовой ввод" onClick={recordVoice}><AudioLines size={18}/></button>{streaming ? <button className="send-button" title="Остановить" onClick={stopGeneration}><Square size={14} fill="currentColor"/></button> : <button className="send-button" title="Отправить" disabled={(!prompt.trim() && !attachments.length) || !uid || uploading} onClick={() => askAI()}><ArrowUp size={19} strokeWidth={2.5}/></button>}</div></div></div><p className="composer-note">Общий лимит · {activeRemaining}% на 5 ч · {activeWeeklyRemaining}% на неделю{usage.tokensBalance > 0 ? ` · ${usage.tokensBalance} токенов` : ""}{!preferences.historyEnabled ? " · Без сохранения истории" : ""} <button className="composer-buy-tokens" onClick={() => { setShopTab("tokens"); setShopOpen(true); }}>Пополнить</button></p></div></div>
    </main>
    {shopOpen && <div className="overlay" onClick={() => { setShopOpen(false); setCheckoutPlan(null); setCheckoutPack(null); setShopError(""); }}><div className="shop-dialog" onClick={e => e.stopPropagation()}>
      <div className="shop-head"><span className="shop-eyebrow"><Sparkles size={15}/> Kapani AI</span><button className="icon-button" onClick={() => { setShopOpen(false); setCheckoutPlan(null); setCheckoutPack(null); }}><X size={20}/></button><h2>Больше возможностей.<br/><span>Твой выбор.</span></h2><p>Одна шкала лимита для чата и работы. Когда он закончится, помогут купленные токены.</p></div>
      <div className="shop-tabs"><button className={shopTab === "plans" ? "active" : ""} onClick={() => { setShopTab("plans"); setCheckoutPack(null); setShopError(""); }}><Crown size={16}/> Подписки</button><button className={shopTab === "tokens" ? "active" : ""} onClick={() => { setShopTab("tokens"); setCheckoutPlan(null); setShopError(""); }}><Zap size={16}/> Купить токены</button></div>
      {shopTab === "plans" && <>
      <div className="limit-panel"><div className="limit-label"><span>Пятичасовой лимит</span><b>{usage.remainingFiveHourPercent}% осталось</b></div><div className="limit-track"><span style={{ width: usage.remainingFiveHourPercent + "%" }}/></div><div className="limit-label secondary"><span>Недельный лимит</span><b>{usage.remainingPercent}% осталось</b></div><div className="limit-track"><span style={{ width: usage.remainingPercent + "%" }}/></div><div className="limit-meta">Пятичасовой лимит обновится {usage.fiveHourResetsAt ? new Date(usage.fiveHourResetsAt).toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"}) : "скоро"} · Тариф {tier.name}{usage.expiresAt && usage.plan !== "free" ? " до " + new Date(usage.expiresAt).toLocaleDateString("ru-RU") : ""}</div></div>
      {usage.nickname && <div className="balance-line"><Wallet size={17}/><span>Баланс {usage.nickname}</span><strong>{(usage.balance || 0).toLocaleString("ru-RU")} ₽</strong></div>}
      <div className="plans-grid">{(["free", "plus", "ultra", "prime"] as Plan[]).map(plan => <div key={plan} className={"plan-card plan-" + plan + (usage.plan === plan ? " current" : "")}>
        <div className="plan-card-top"><span className="plan-icon">{plan === "free" ? <Sparkles size={17}/> : <Crown size={17}/>}</span>{usage.plan === plan && <span className="current-tag">Текущий</span>}</div><h3>{PLANS[plan].name}</h3><div className="plan-price">{plan === "free" ? "0 ₽" : PLANS[plan].price.toLocaleString("ru-RU") + " ₽"}<small>{plan === "free" ? "навсегда" : "/ неделю"}</small></div><div className="plan-perks"><span><Check size={13}/> {plan === "free" ? "Обычный чат" : "Режим «Работа» и все модели"}</span><span><Check size={13}/> {plan === "free" ? "Рассуждение вкл./выкл." : "Ползунки рассуждения, включая максимум"}</span><span><Zap size={13}/> Общий лимит · {PLANS[plan].fiveHourBudget} ед./5 ч</span><span><Check size={13}/> Чат расходует меньше, чем работа</span></div><button className="plan-choose" disabled={plan === "free" || usage.plan === plan} onClick={() => { setCheckoutPlan(plan); setShopError(""); }}>{usage.plan === plan ? "Ваш тариф" : plan === "free" ? "Бесплатно" : "Подключить"}</button>
      </div>)}</div>
      {checkoutPlan && checkoutPlan !== "free" && <div className="checkout-panel"><div className="checkout-heading"><h3>Оплата {PLANS[checkoutPlan].name}</h3><button onClick={() => setCheckoutPlan(null)}><X size={17}/></button></div><p>Разовое списание {PLANS[checkoutPlan].price} капанёвских рублей за 7 дней. Подписка зачисляется на аккаунт KapaniGPT {auth.currentUser?.email}. Автопродления нет.</p><div className="checkout-new"><strong>Что откроется после покупки</strong><span><Code2 size={14}/> Режим «Работа» и выбор всех моделей KapaniGPT</span><span><BrainCircuit size={14}/> Ползунок глубины рассуждений до максимума</span><span><Zap size={14}/> Общий лимит {PLANS[checkoutPlan].fiveHourBudget} ед./5 ч и {PLANS[checkoutPlan].weeklyBudget} ед./нед.</span></div>{!kapaniSession ? <div className="login-box"><div className="login-description"><LogIn size={17}/> Авторизуйся для оплаты со счёта сайта «Капани»</div><input value={loginNick} onChange={e => setLoginNick(e.target.value)} placeholder="Ник или e-mail в Капани" autoComplete="username"/><input value={loginPassword} onChange={e => setLoginPassword(e.target.value)} type="password" placeholder="Пароль Капани" autoComplete="current-password" onKeyDown={e => { if (e.key === "Enter") loginKapani(); }}/><button className="pay-button" onClick={loginKapani} disabled={loggingIn}>{loggingIn ? <LoaderCircle className="spinning" size={16}/> : <LogIn size={16}/>} Проверить счёт</button></div> : <div className="checkout-confirm"><div className="checkout-account"><Wallet size={17}/> Банк Капаней · {kapaniBank?.nickname || "Счёт подтверждается"} · {kapaniBank == null ? "Баланс загружается" : kapaniBank.balance.toLocaleString("ru-RU") + " ₽"}</div><button className="pay-button" disabled={buying} onClick={() => buyPlan(checkoutPlan)}>{buying ? <LoaderCircle className="spinning" size={16}/> : <Check size={16}/>} Оплатить {PLANS[checkoutPlan].price} ₽</button></div>}{shopError && <div className="checkout-error">{shopError}</div>}</div>}
      </>}
      {shopTab === "tokens" && <>
        <div className="token-balance-hero"><div className="token-orb"><Zap size={22}/></div><div><small>Твой запас</small><strong>{usage.tokensBalance.toLocaleString("ru-RU")} токенов</strong><p>После исчерпания общего лимита запросы автоматически оплачиваются отсюда. Токены не имеют срока действия.</p></div></div>
        <div className="token-packs">{(Object.keys(TOKEN_PACKS) as TokenPack[]).map(pack => <div key={pack} className={"token-pack " + (checkoutPack === pack ? "selected" : "")}><div className="token-pack-icon"><Zap size={20}/></div><small>{TOKEN_PACKS[pack].name} пакет</small><h3>{TOKEN_PACKS[pack].tokens.toLocaleString("ru-RU")} <span>токенов</span></h3><div className="token-pack-price">{TOKEN_PACKS[pack].price.toLocaleString("ru-RU")} капанёвских ₽</div><button className="plan-choose" onClick={() => { setCheckoutPack(pack); setShopError(""); }}>Выбрать пакет</button></div>)}</div>
        {checkoutPack && <div className="checkout-panel"><div className="checkout-heading"><h3>Покупка {TOKEN_PACKS[checkoutPack].tokens} токенов</h3><button onClick={() => setCheckoutPack(null)}><X size={17}/></button></div><p>С банковского счёта Капаней спишется {TOKEN_PACKS[checkoutPack].price} ₽. Токены зачислятся на аккаунт KapaniGPT {auth.currentUser?.email}. Подписка не меняется.</p><p className="receipt-disclosure">В банковской истории операция отображается как «{PLANS[TOKEN_PACKS[checkoutPack].bankPlan].name}», потому что банк использует его фиксированный платёж. Это покупка токенов, а не тарифа.</p>
          {!kapaniSession ? <div className="login-box"><div className="login-description"><LogIn size={17}/> Войди в банк Капаней для оплаты</div><input value={loginNick} onChange={e => setLoginNick(e.target.value)} placeholder="Ник или e-mail в Капани" autoComplete="username"/><input value={loginPassword} onChange={e => setLoginPassword(e.target.value)} type="password" placeholder="Пароль Капани" autoComplete="current-password" onKeyDown={e => { if (e.key === "Enter") loginKapani(); }}/><button className="pay-button" onClick={loginKapani} disabled={loggingIn}>{loggingIn ? <LoaderCircle className="spinning" size={16}/> : <LogIn size={16}/>} Проверить счёт</button></div> : <div className="checkout-confirm"><div className="checkout-account"><Wallet size={17}/> {kapaniBank?.nickname || "Счёт"} · {kapaniBank == null ? "Баланс загружается" : kapaniBank.balance.toLocaleString("ru-RU") + " ₽"}</div><button className="pay-button" disabled={buyingTokens} onClick={() => buyTokenPack(checkoutPack)}>{buyingTokens ? <LoaderCircle className="spinning" size={16}/> : <Zap size={16}/>} Оплатить {TOKEN_PACKS[checkoutPack].price} ₽</button></div>}{shopError && <div className="checkout-error">{shopError}</div>}
        </div>}
        <p className="token-shop-note">Токен здесь означает единицу внутреннего лимита KapaniGPT, а не токен текста нейросети. Обычный чат расходует 1–3 единицы за ответ, работа — больше в зависимости от модели и уровня рассуждения.</p>
      </>}
      <div className="shop-footer">Расход лимитов приблизительный и зависит от выбранного профиля. Ответы создают бесплатные модели Kilo AI, поэтому у провайдера есть собственный предел нагрузки независимо от подписки KapaniGPT.</div>
    </div></div>}
    {unlockSteps.length > 0 && <div className="overlay unlock-overlay"><div className="unlock-dialog" key={unlockIndex}><div className="unlock-aura"><Gift size={31}/></div><span className="unlock-count">{unlockIndex + 1} из {unlockSteps.length}</span><h2>{unlockSteps[unlockIndex]}</h2><p>Новые возможности уже доступны в KapaniGPT.</p><button className="pay-button" onClick={() => { if (unlockIndex >= unlockSteps.length - 1) { setUnlockSteps([]); setUnlockIndex(0); } else setUnlockIndex(unlockIndex + 1); }}>{unlockIndex === unlockSteps.length - 1 ? "Начать пользоваться" : "Продолжить"}<ChevronRight size={16}/></button></div></div>}
    {searchOpen && <div className="overlay" onClick={() => setSearchOpen(false)}><div className="search-dialog" onClick={e => e.stopPropagation()}><div className="search-field"><Search size={20} /><input autoFocus placeholder="Поиск по истории чатов…" value={search} onChange={e => setSearch(e.target.value)} /><button onClick={() => setSearchOpen(false)}><X size={18} /></button></div><div className="search-results">{groupedChats.length ? groupedChats.map(c => <button key={c.id} onClick={() => { setChatId(c.id); setChatMode(c.mode); setTemporaryChatStarted(false); setReasoning("off"); setSearchOpen(false); setMobileSidebar(false); }}><MessageCircle size={16} /><span>{c.title}</span><small>{niceDate(c.updatedAt)}</small></button>) : <p>Совпадений пока нет</p>}</div><div className="search-hint">Esc — закрыть</div></div></div>}
    {settingsOpen && <div className="overlay" onClick={() => setSettingsOpen(false)}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-top"><span className="dialog-icon"><Settings2 size={20}/></span><div><h2>Настройки</h2><p>KapaniGPT · {tier.name}</p></div><button onClick={() => setSettingsOpen(false)} aria-label="Закрыть"><X size={19}/></button></div>
        <div className="settings-main">
          <nav className="settings-tabs" aria-label="Раздел настроек">
            <button className={settingsTab === "account" ? "active" : ""} onClick={() => setSettingsTab("account")}><ShieldCheck size={16}/> Аккаунт</button>
            <button className={settingsTab === "personal" ? "active" : ""} onClick={() => setSettingsTab("personal")}><Sparkles size={16}/> Персонализация</button>
            <button className={settingsTab === "privacy" ? "active" : ""} onClick={() => setSettingsTab("privacy")}><LockKeyhole size={16}/> Конфиденциальность</button>
            <button className={settingsTab === "limits" ? "active" : ""} onClick={() => setSettingsTab("limits")}><Zap size={16}/> Лимиты</button>
            <button className={settingsTab === "appearance" ? "active" : ""} onClick={() => setSettingsTab("appearance")}><Settings2 size={16}/> Интерфейс</button>
          </nav>
          <div className="settings-content">
            {settingsTab === "account" && <div className="settings-section"><h3>Аккаунт</h3><div className="settings-account-card"><span className="avatar">K</span><div><strong>{auth.currentUser?.displayName || "Пользователь"}</strong><small>{auth.currentUser?.email}</small></div></div>{usage.promoEligible && <div className="opening-offer account-offer"><div className="opening-offer-top"><Gift size={18}/><span>В честь открытия KapaniGPT</span></div><strong>Kapani AI plus на неделю бесплатно</strong><p>Забери подарок один раз. Оплата не нужна.</p><button onClick={claimOpeningPromo} disabled={claimingPromo}>{claimingPromo ? "Активируем…" : "Получить бесплатно"}<ChevronRight size={15}/></button>{promoError && <small className="opening-offer-error">{promoError}</small>}</div>}<div className="settings-row"><div><strong>Подписка</strong><small>{usage.expiresAt ? "До " + new Date(usage.expiresAt).toLocaleDateString("ru-RU") : "Бессрочная бесплатная"}</small></div><span className="settings-value">{tier.name}</span></div>{usage.promoClaimed && usage.promoStartsAt && <div className="settings-row"><div><strong>Подарочная неделя Plus</strong><small>{new Date(usage.promoStartsAt).getTime() > Date.now() ? "Начнётся " + new Date(usage.promoStartsAt).toLocaleDateString("ru-RU") : "Уже получена"}</small></div><span className="settings-value">Использована</span></div>}<button className="settings-plan-button" onClick={() => { setSettingsOpen(false); setShopOpen(true); }}><Crown size={16}/> Подписки и оплата <ChevronRight size={16}/></button>{kapaniSession && <button className="settings-logout" onClick={() => { setKapaniSession(null); setKapaniBank(null); }}>Отключить банк Капаней</button>}<button className="settings-logout" onClick={() => { stopGeneration(); setSettingsOpen(false); signOut(auth).catch(e => setAuthError(e.message)); }}>Выйти из аккаунта</button></div>}
            {settingsTab === "personal" && <div className="settings-section"><h3>Персонализация</h3><p className="settings-intro">KapaniGPT учтёт твои предпочтения во всех новых ответах.</p><label className="settings-field">Что ИИ стоит знать о тебе<textarea rows={4} maxLength={1500} value={preferences.about} onChange={e => setPreferences(old => ({ ...old, about: e.target.value }))} placeholder="Интересы, занятия, контекст…"/></label><label className="settings-field">Как лучше отвечать<textarea rows={4} maxLength={3000} value={preferences.instructions} onChange={e => setPreferences(old => ({ ...old, instructions: e.target.value }))} placeholder="Тон, длина ответов, любимый стиль…"/></label><label className="settings-field">Манера общения<select value={preferences.tone} onChange={e => setPreferences(old => ({ ...old, tone: e.target.value as UserPreferences["tone"] }))}><option value="balanced">Обычная</option><option value="direct">Коротко и прямо</option><option value="creative">Творческая</option></select></label></div>}
            {settingsTab === "privacy" && <div className="settings-section"><h3>Конфиденциальность</h3><div className="settings-row"><div><strong>Сохранять историю чатов</strong><small>Если выключить, новые сообщения останутся только до перезагрузки страницы. Старые чаты не удаляются.</small></div><button role="switch" aria-checked={preferences.historyEnabled} className={"settings-toggle " + (preferences.historyEnabled ? "on" : "")} onClick={() => setPreferences(old => ({ ...old, historyEnabled: !old.historyEnabled }))}><span/></button></div><div className="settings-row"><div><strong>Удалить сохранённые чаты</strong><small>Все диалоги и сообщения из Firebase. Восстановить нельзя.</small></div><button className="settings-danger" onClick={() => setConfirmDeleteAll(true)}>Удалить</button></div><div className="privacy-note"><ShieldCheck size={17}/><p>Тексты запросов передаются внешнему ИИ-провайдеру для ответа. Выключение истории влияет на хранение в KapaniGPT, а не на обработку у провайдера. Пароли сюда отправлять не стоит.</p></div></div>}
            {settingsTab === "limits" && <div className="settings-section"><h3>Общие лимиты</h3><p className="settings-intro">Один запас на «Чат» и «Работу». Чат тратит всего 1–3 единицы, работа расходует больше в зависимости от модели и рассуждений.</p><div className="quota-card"><div className="quota-heading"><Zap size={16}/><strong>Общий лимит · {tier.name}</strong></div><div className="quota-line"><span>На 5 часов</span><b>{usage.remainingFiveHourPercent}% осталось</b></div><div className="limit-track"><span style={{ width: usage.remainingFiveHourPercent + "%" }}/></div><small>Всего {usage.fiveHourBudget} единиц</small><div className="quota-line"><span>На неделю</span><b>{usage.remainingPercent}% осталось</b></div><div className="limit-track"><span style={{ width: usage.remainingPercent + "%" }}/></div><small>Всего {usage.weeklyBudget} единиц</small></div><div className="quota-card token-quota"><div className="quota-heading"><Wallet size={16}/><strong>Купленные токены</strong></div><div className="token-quota-amount">{usage.tokensBalance.toLocaleString("ru-RU")}</div><p className="settings-intro">Не сгорают. После окончания лимита списываются автоматически, при ошибке модели возвращаются.</p><button className="settings-plan-button" onClick={() => { setSettingsOpen(false); setShopTab("tokens"); setShopOpen(true); }}><Zap size={16}/> Купить токены <ChevronRight size={16}/></button></div><p className="settings-intro">Пятичасовой лимит обновится {usage.fiveHourResetsAt ? new Date(usage.fiveHourResetsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "скоро"}. У ИИ-провайдера есть собственные ограничения нагрузки.</p><button className="settings-plan-button" onClick={() => { setSettingsOpen(false); setShopTab("plans"); setShopOpen(true); }}><Crown size={16}/> Сменить тариф <ChevronRight size={16}/></button></div>}
            {settingsTab === "appearance" && <div className="settings-section"><h3>Интерфейс</h3><div className="settings-row"><div><strong>Компактный режим</strong><small>Меньше отступов и декоративных элементов.</small></div><button role="switch" aria-checked={compact} className={"settings-toggle " + (compact ? "on" : "")} onClick={() => setCompact(!compact)}><span/></button></div><div className="settings-row"><div><strong>Цветовая схема</strong><small>Тёмная основа, зелёные градиенты.</small></div><span className="settings-value">Чёрно-зелёная</span></div></div>}
          </div>
        </div>
        <div className="dialog-footer">{preferencesMessage && <span className="settings-feedback">{preferencesMessage}</span>}{(settingsTab === "personal" || settingsTab === "privacy") && <button className="primary-button" onClick={persistPreferences} disabled={preferencesSaving}>{preferencesSaving ? "Сохраняю…" : "Сохранить"}<Check size={16}/></button>}</div>
      </div>
    </div>}
    {confirmDeleteAll && <div className="overlay confirm-top" onClick={() => setConfirmDeleteAll(false)}><div className="confirm-dialog" onClick={e => e.stopPropagation()}><div className="confirm-icon"><Trash2 size={20}/></div><h2>Удалить всю историю?</h2><p>Все сохранённые переписки исчезнут навсегда. Это действие нельзя отменить.</p><div><button className="secondary-button" onClick={() => setConfirmDeleteAll(false)}>Отмена</button><button className="danger-button" disabled={deletingAll} onClick={deleteAllChats}>{deletingAll ? "Удаляю…" : "Да, удалить всё"}</button></div></div></div>}
    {deleteTarget && <div className="overlay" onClick={() => setDeleteTarget(null)}><div className="confirm-dialog" onClick={e => e.stopPropagation()}><div className="confirm-icon"><Trash2 size={20} /></div><h2>Удалить этот чат?</h2><p>Сообщения будут удалены из Firebase без возможности восстановления.</p><div><button className="secondary-button" onClick={() => setDeleteTarget(null)}>Отмена</button><button className="danger-button" onClick={() => removeChat(deleteTarget)}>Удалить навсегда</button></div></div></div>}
    {messageConfirm && <div className="overlay confirm-top" onClick={() => { if (!messageBusy) setMessageConfirm(null); }}>
      <div className="confirm-dialog message-confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-icon"><Trash2 size={20}/></div>
        <h2>{messageConfirm.kind === "edit" ? "Изменить старый запрос?" : messageConfirm.kind === "rewind" ? "Вернуться к этому сообщению?" : "Удалить сообщение?"}</h2>
        <p>{messageConfirm.kind === "remove" ? "Будет удалено только выбранное сообщение. Остальная переписка останется."
          : `Сообщения после выбранного ${messageConfirm.kind === "edit" ? "запроса" : "места"} будут удалены (${Math.max(0, messages.findIndex(m => m.id === messageConfirm.id) < 0 ? 0 : messages.length - messages.findIndex(m => m.id === messageConfirm.id) - 1)} шт.). Предыдущая часть чата останется. Отменить удаление нельзя.`}</p>
        <div><button className="secondary-button" disabled={messageBusy} onClick={() => setMessageConfirm(null)}>Отмена</button>
          <button className="danger-button" disabled={messageBusy} onClick={() => void applyMessageAction(messageConfirm)}>{messageBusy ? <LoaderCircle className="spinning" size={15}/> : null}{messageConfirm.kind === "edit" ? "Изменить и очистить" : messageConfirm.kind === "rewind" ? "Удалить последующие" : "Удалить"}</button></div>
      </div>
    </div>}
  </div>;
}
