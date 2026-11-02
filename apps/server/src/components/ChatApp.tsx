'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Menu, Trash2, X } from 'lucide-react';
import { ApiKeyPanel, ClosedPanel, PROVIDER_COPY } from './ApiKeyPanel';
import { ChatView } from './ChatView';
import { coachSeen, markCoachSeen } from './CoachMark';
import { ConfirmDialog } from './ConfirmDialog';
import { Composer } from './Composer';
import { SetupCard } from './SetupCard';
import { Sidebar } from './Sidebar';
import { ACCEPT } from './UploadZone';
import { useChat } from './hooks/useChat';
import { useDocuments } from './hooks/useDocuments';
import {
  clearStoredApiKey,
  deleteDocument,
  embedOrigin,
  fetchModels,
  getSessionId,
  getStoredApiKey,
  getStoredProvider,
  resetSessionId,
  type VisitorProvider,
} from '@/lib/client';
import { DEFAULT_SETTINGS, normaliseSettings, type ChatSettings } from '@/lib/settings';
import type { DocumentRecord, PublicConfig } from '@/lib/types';

interface SetupStatus {
  configured: boolean;
  missing: string[];
  tracing?: boolean;
}

const SETTINGS_KEY = 'ragfolio-settings';

/** Longest question a parent page may hand in. */
const MAX_PARENT_PROMPT = 2000;

export function ChatApp({
  initialConfig,
  tracing,
  trustedOrigins,
}: {
  /** Server-rendered config for first paint; replaced by the live value once documents load. */
  initialConfig: PublicConfig;
  tracing: boolean;
  trustedOrigins: string[];
}) {
  const [sessionId, setSessionId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [confirmNewSession, setConfirmNewSession] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  /** True when opened by the embed script (`?embed=1`): header gets a close control, theme is the parent's. */
  const [embedded, setEmbedded] = useState(false);
  const [themePinned, setThemePinned] = useState(false);
  /**
   * The visitor's own provider key, when the public URL requires one. Empty
   * string means "none stored"; `keyRejected` carries the server's explanation
   * when a previously working key has stopped working.
   */
  const [apiKey, setApiKey] = useState('');
  /** Vendor of the visitor's stored key; drives the model list and placeholder copy. */
  const [keyProvider, setKeyProvider] = useState<VisitorProvider>(initialConfig.provider);
  const [keyRejected, setKeyRejected] = useState<string | null>(null);
  /** Set when the visitor reopens the panel to replace a key that still works. */
  const [editingKey, setEditingKey] = useState(false);
  /** True when the key panel was opened from the stepper, so it says "Step 1 of 3". */
  const [keyFromStepper, setKeyFromStepper] = useState(false);
  /** Vendor picked in the stepper before the panel opened. */
  const [stepperProvider, setStepperProvider] = useState<VisitorProvider | undefined>(undefined);
  /** The last successful upload, for the sidebar's "Ask about it" row. */
  const [justIndexed, setJustIndexed] = useState<{ document: DocumentRecord; notes: string[] } | null>(null);
  const [pasteRequest, setPasteRequest] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const [coachDone, setCoachDone] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionId(getSessionId());
    setApiKey(getStoredApiKey());
    setKeyProvider(getStoredProvider(initialConfig.provider));
    const params = new URLSearchParams(window.location.search);
    setEmbedded(params.get('embed') === '1');
    setThemePinned(params.has('theme'));
    setCoachDone(coachSeen());

    // Restored through the same clamp the server applies. Only the model choice
    // survives: the retrieval knobs have no UI, and settings nobody can see or
    // change should not be silently shaping answers.
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) setSettings({ ...DEFAULT_SETTINGS, model: normaliseSettings(JSON.parse(saved)).model });
    } catch {
      /* corrupt or unavailable storage — defaults stand */
    }

    void fetch('/api/status')
      .then((r) => r.json())
      .then(setSetup)
      .catch(() => setSetup({ configured: false, missing: ['unreachable'] }));
  }, [initialConfig.provider]);

  const updateSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* private browsing */
    }
  }, []);

  /**
   * A key that was accepted can still be revoked later. When the server says a
   * request needs a working key, drop the stored one and show the panel with
   * the reason — otherwise every question fails identically.
   */
  const onKeyRequired = useCallback((message: string) => {
    clearStoredApiKey();
    setApiKey('');
    setKeyRejected(message);
    // In trial mode the panel is not shown by default; a used-up trial opens it.
    setEditingKey(true);
  }, []);

  const docs = useDocuments(sessionId, initialConfig, onKeyRequired);
  const chat = useChat(sessionId, settings, onKeyRequired);
  const config = docs.config;

  /** Uploads this visitor owns — the preloaded documents are not theirs to lose. */
  const ownedDocuments = docs.documents.filter((doc) => !doc.is_public);

  const ingest = useCallback(
    async (input: File | { text: string; title: string }) => {
      const result = await docs.ingest(input);
      if (result.document) setJustIndexed({ document: result.document, notes: result.notes ?? [] });
    },
    [docs],
  );

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const openPaste = useCallback(() => {
    setSidebarOpen(true);
    setPasteRequest((n) => n + 1);
  }, []);

  /** A first question for a document, from its outline when it has one. */
  const questionFor = useCallback((doc: DocumentRecord) => {
    const heading = doc.outline?.find((entry) => entry.heading && !entry.heading.startsWith('Not indexed'))?.heading;
    return heading ? `What does “${heading}” in ${doc.filename} cover?` : `Summarise ${doc.filename} in five bullets.`;
  }, []);

  const askAbout = useCallback(
    (doc: DocumentRecord) => {
      setInput(questionFor(doc));
      setJustIndexed(null);
      setSidebarOpen(false);
      setFocusKey((n) => n + 1);
    },
    [questionFor],
  );

  /**
   * First-answer hints: shown once, on the first answer that has both a trace
   * and sources, and retired when dismissed or once a second answer exists.
   */
  const assistantAnswers = chat.messages.filter((m) => m.role === 'assistant' && m.content && !m.error).length;
  const coachMessageId = useMemo(() => {
    if (coachDone) return null;
    const target = chat.messages.find((m) => m.role === 'assistant' && m.trace?.length && m.citations?.length);
    return target?.id ?? null;
  }, [chat.messages, coachDone]);
  const dismissCoach = useCallback(() => {
    markCoachSeen();
    setCoachDone(true);
  }, []);
  useEffect(() => {
    if (!coachDone && assistantAnswers >= 2) dismissCoach();
  }, [assistantAnswers, coachDone, dismissCoach]);

  // The picker lists the vendor the answer will actually run on: the owner's
  // provider through a trusted origin, the visitor's own choice otherwise.
  useEffect(() => {
    const provider = docs.loaded && !docs.trusted && apiKey ? keyProvider : undefined;
    void fetchModels(provider)
      .then(setModels)
      .catch(() => setModels([]));
  }, [docs.loaded, docs.trusted, apiKey, keyProvider]);

  const submit = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content) return;
      setInput('');
      void chat.send(content).then(() => docs.noteChat());
    },
    [chat, docs, input],
  );

  // submit changes with every keystroke (it closes over `input`); read it
  // through a ref so typing does not re-run the handshake below.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  /**
   * Parent handoff. A trusted framing page may show its own composer and post
   * the visitor's first question here, so it is not typed twice. Only the
   * framing page may post, and only from an origin on the trusted list. Once a
   * session id exists we tell the parent we are ready; asking earlier would
   * fail with a 400 for the missing session.
   */
  useEffect(() => {
    if (!sessionId || window.parent === window) return;
    const parentOrigin = embedOrigin();
    if (!trustedOrigins.includes(parentOrigin)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const data = event.data as { type?: unknown; prompt?: unknown } | null;
      if (data?.type !== 'ragfolio:ask' || typeof data.prompt !== 'string') return;
      const prompt = data.prompt.trim().slice(0, MAX_PARENT_PROMPT);
      if (prompt) submitRef.current(prompt);
    };

    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'ragfolio:ready' }, parentOrigin);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId, trustedOrigins]);

  const closeEmbed = useCallback(() => {
    if (window.parent === window) return;
    const parentOrigin = embedOrigin();
    if (!trustedOrigins.includes(parentOrigin)) return;
    window.parent.postMessage({ type: 'ragfolio:close' }, parentOrigin);
  }, [trustedOrigins]);

  const startNewSession = useCallback(async () => {
    setConfirmNewSession(false);

    // Delete this session's uploads before rotating the id. Rotating alone would
    // leave the rows in Postgres addressable by nobody. Preloaded documents are
    // untouched: deletes are scoped to this session.
    if (sessionId) await deleteDocument(sessionId).catch(() => undefined);

    setSessionId(resetSessionId());
    chat.reset();
    setSidebarOpen(false);
    void docs.refresh();
  }, [chat, docs, sessionId]);

  /** Only worth interrupting someone when there is something to lose. */
  const requestNewSession = useCallback(() => {
    if (ownedDocuments.length === 0) {
      void startNewSession();
      return;
    }
    setConfirmNewSession(true);
  }, [ownedDocuments.length, startNewSession]);

  const configWarning = Boolean(setup && !setup.configured);

  /** The public URL is closed to visitors without a trusted origin. */
  const closed = docs.loaded && !docs.trusted && docs.access === 'closed';

  /** A free trial on the owner's key is what is paying right now. */
  const trialActive = docs.loaded && !docs.trusted && docs.access === 'trial' && !apiKey;

  /**
   * Whose quota this visitor is spending. Trust is the same signal that gates
   * the preloaded documents: through the owner's site the app runs on the
   * owner's key. Gated on `docs.loaded` so the panel does not flash before the
   * answer is known, and on the server being configured, since an unconfigured
   * server cannot verify a key.
   */
  const needsOwnKey = docs.loaded && !docs.trusted && docs.access === 'byok' && !apiKey;
  const showKeyPanel = !closed && !configWarning && docs.loaded && !docs.trusted && (needsOwnKey || editingKey);

  /**
   * Whether the visitor's own key is the one actually paying for answers. Not
   * the same as "a key is stored": someone who used the public URL once keeps
   * their key, and if they later arrive through the owner's site the owner's
   * key serves them instead.
   */
  const ownKeyInUse = docs.loaded && !docs.trusted && Boolean(apiKey);

  const removeKey = () => {
    clearStoredApiKey();
    setApiKey('');
    setKeyRejected(null);
    setEditingKey(false);
    setSidebarOpen(false);
  };

  const sidebarProps = {
    config,
    documents: docs.documents,
    loaded: docs.loaded,
    uploading: docs.uploading,
    error: docs.error,
    notices: docs.notices,
    onDismissNotices: docs.dismissNotices,
    trusted: docs.trusted,
    apiKey: ownKeyInUse ? apiKey : undefined,
    trial: trialActive ? docs.trial : null,
    keyProviderName: PROVIDER_COPY[keyProvider]?.name,
    onChangeKey: () => {
      setEditingKey(true);
      setSidebarOpen(false);
    },
    onRemoveKey: removeKey,
    onFile: (file: File) => void ingest(file),
    onText: (text: string, title: string) => void ingest({ text, title }),
    justIndexed,
    onAskAbout: askAbout,
    onDismissJustIndexed: () => setJustIndexed(null),
    pasteRequest,
    onDelete: (id: string) => void docs.remove(id),
    onNewSession: requestNewSession,
    onDismissError: () => docs.setError(null),
    hideThemeToggle: embedded || themePinned,
  };

  const placeholder = configWarning
    ? 'Finish server setup to start'
    : closed
      ? 'Unavailable here'
      : showKeyPanel || needsOwnKey
        ? 'Add your API key first (step 1)…'
        : // The unloaded document list must not assert anything about the corpus.
          !docs.loaded
          ? 'Loading…'
          : docs.documents.length === 0
            ? 'Add a document first, then ask…'
            : ownedDocuments.length > 0
              ? `Ask about ${ownedDocuments[0].filename}…`
              : config.ownerName
                ? `Ask about ${config.ownerName}'s documents…`
                : 'Ask about the indexed documents…';

  const onboarding = {
    config,
    documents: docs.documents,
    trusted: docs.trusted,
    keyRequired: docs.loaded && !docs.trusted && docs.access === 'byok',
    trial: trialActive ? docs.trial : null,
    hasKey: Boolean(apiKey),
    keyProvider,
    onKeyProviderChange: (provider: VisitorProvider) => setStepperProvider(provider),
    onOpenKeyPanel: () => {
      setKeyFromStepper(true);
      setEditingKey(true);
    },
    onOpenFilePicker: openFilePicker,
    onOpenPaste: openPaste,
    onAsk: (prompt: string) => submit(prompt),
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-page)]">
      {/* Desktop sidebar */}
      <div className="hidden w-72 shrink-0 lg:block">
        <Sidebar {...sidebarProps} />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-xs">
            <Sidebar {...sidebarProps} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-card)] bg-[var(--nav-bg)] px-3 py-2.5 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            {/*
              Same gate as the landing copy, and for the same reason. Until the
              document list arrives, "No documents indexed" is not a fact — it is
              a guess that is wrong for every visitor arriving through the
              owner's site, and it is the one line they read first.
            */}
            {docs.loaded ? (
              <p className="truncate text-xs font-bold text-[var(--text-title)]">
                {docs.documents.length === 0
                  ? 'No documents indexed'
                  : ownedDocuments.length === 0 && docs.trusted && config.ownerName
                    ? `${config.ownerName} — indexed documents`
                    : `${docs.documents.length} document${docs.documents.length === 1 ? '' : 's'} indexed`}
              </p>
            ) : (
              <div aria-hidden className="h-4 w-52 animate-pulse rounded bg-[var(--bg-card)]" />
            )}
            <p className="truncate text-[0.65rem] text-[var(--text-muted)]">
              tool-calling retrieval agent · answers cite the passages they used
            </p>
          </div>

          {chat.messages.length > 0 && (
            <button
              type="button"
              onClick={chat.reset}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.7rem] font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--color-danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear chat</span>
            </button>
          )}

          {embedded && (
            <button
              type="button"
              onClick={closeEmbed}
              aria-label="Close chat"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-title)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void ingest(file);
            event.target.value = '';
          }}
        />

        {configWarning && setup ? (
          <div className="flex-1 overflow-y-auto">
            <SetupCard missing={setup.missing} />
          </div>
        ) : closed ? (
          <div className="flex-1 overflow-y-auto">
            <ClosedPanel config={config} />
          </div>
        ) : showKeyPanel ? (
          <div className="flex-1 overflow-y-auto">
            <ApiKeyPanel
              sessionId={sessionId}
              config={config}
              reason={keyRejected}
              stepLabel={keyFromStepper ? 'Step 1 of 3' : undefined}
              initialProvider={stepperProvider}
              onAddDocument={openFilePicker}
              onSaved={(key, provider) => {
                const switched = provider !== keyProvider && ownedDocuments.length > 0;
                setKeyProvider(provider);
                setApiKey(key);
                setKeyRejected(null);
                setEditingKey(false);
                setKeyFromStepper(false);
                setStepperProvider(undefined);
                // Passages embedded with one vendor's model are not comparable to
                // a query embedded with the other's. Start clean on a switch.
                if (switched) void startNewSession();
              }}
              onCancel={
                editingKey && (apiKey || (trialActive && !keyRejected))
                  ? () => {
                      setEditingKey(false);
                      setKeyFromStepper(false);
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <ChatView
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            documentsLoaded={docs.loaded}
            coachMessageId={coachMessageId}
            onDismissCoach={dismissCoach}
            onboarding={onboarding}
          />
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => submit()}
          onStop={chat.stop}
          isStreaming={chat.isStreaming}
          disabled={!sessionId || configWarning || showKeyPanel || closed || !docs.loaded}
          placeholder={placeholder}
          model={settings.model}
          models={models}
          onModelChange={(model) => updateSettings({ ...settings, model })}
          // Server value first, so the disclosure is in the initial HTML; OR-ing in
          // the live status means adding Langfuse keys later shows the notice too.
          tracing={tracing || Boolean(setup?.tracing)}
          ownKeyInUse={ownKeyInUse}
          focusKey={focusKey}
        />

        <ConfirmDialog
          open={confirmNewSession}
          title="Start a new session?"
          confirmLabel="Delete and start over"
          onConfirm={() => void startNewSession()}
          onCancel={() => setConfirmNewSession(false)}
          body={
            <>
              <p>
                Starting a new session removes the{' '}
                <strong className="text-[var(--text-title)]">
                  {ownedDocuments.length} document{ownedDocuments.length === 1 ? '' : 's'}
                </strong>{' '}
                you uploaded and clears this conversation.
              </p>
              <ul className="mt-3 space-y-1.5">
                {ownedDocuments.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-inner)] px-2.5 py-1.5"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-cyan)]" />
                    <span className="min-w-0 flex-1 truncate text-[0.72rem] font-semibold text-[var(--text-title)]">
                      {doc.filename}
                    </span>
                    <span className="shrink-0 font-mono text-[0.62rem] text-[var(--text-muted)]">
                      {doc.chunk_count} passages
                    </span>
                  </li>
                ))}
              </ul>
            </>
          }
        />
      </main>
    </div>
  );
}
