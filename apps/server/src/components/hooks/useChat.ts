'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiKeyNeededError, streamChat } from '@/lib/client';
import { DEFAULT_SETTINGS, type ChatSettings } from '@/lib/settings';
import type { ChatMessage, TraceStep } from '@/lib/types';

function mergeTrace(trace: TraceStep[] | undefined, step: TraceStep): TraceStep[] {
  const existing = trace ?? [];
  const index = existing.findIndex((s) => s.id === step.id);
  if (index === -1) return [...existing, step];
  const next = [...existing];
  next[index] = { ...next[index], ...step };
  return next;
}

export function useChat(
  sessionId: string,
  settings: ChatSettings = DEFAULT_SETTINGS,
  /**
   * Called when the server refuses the request for want of a working key —
   * typically a key that was valid when saved and has since been revoked. The
   * message still lands in the transcript; this reopens the setup panel.
   */
  onKeyRequired?: (message: string) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = useCallback((patch: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) => {
      if (!previous.length) return previous;
      const next = [...previous];
      next[next.length - 1] = patch(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || isStreaming || !sessionId) return;

      const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: Date.now() };
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        trace: [],
      };

      // Snapshot the wire history before the empty assistant turn is appended.
      const history = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));

      setMessages((previous) => [...previous, userMessage, assistantMessage]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        for await (const event of streamChat(sessionId, history, settings, controller.signal)) {
          switch (event.type) {
            case 'text':
              patchLast((m) => ({ ...m, content: m.content + event.delta }));
              break;
            case 'trace':
              patchLast((m) => ({ ...m, trace: mergeTrace(m.trace, event.step) }));
              break;
            case 'meta':
              patchLast((m) => ({ ...m, model: event.model }));
              break;
            case 'citations':
              patchLast((m) => ({ ...m, citations: event.citations }));
              break;
            case 'error':
              patchLast((m) => ({ ...m, content: m.content || event.message, error: true }));
              break;
            case 'done':
              break;
          }
        }
      } catch (cause) {
        if (cause instanceof ApiKeyNeededError) onKeyRequired?.(cause.message);
        if ((cause as Error)?.name !== 'AbortError') {
          patchLast((m) => ({
            ...m,
            content: m.content || (cause instanceof Error ? cause.message : 'Something went wrong. Try again.'),
            error: true,
          }));
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        // An aborted or empty turn leaves a blank bubble behind.
        patchLast((m) => (m.role === 'assistant' && !m.content ? { ...m, content: '_Stopped._', error: true } : m));
      }
    },
    [isStreaming, messages, onKeyRequired, patchLast, sessionId, settings],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, send, stop, reset };
}
