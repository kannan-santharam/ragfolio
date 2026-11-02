'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { EmptyState } from './EmptyState';
import { EmptyStateSkeleton } from './EmptyStateSkeleton';
import type { GetStartedProps } from './GetStarted';
import { Message } from './Message';
import type { ChatMessage } from '@/lib/types';

export function ChatView({
  messages,
  isStreaming,
  documentsLoaded,
  coachMessageId,
  onDismissCoach,
  onboarding,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** False until the document list has arrived from the server. */
  documentsLoaded: boolean;
  /** The assistant message that gets the first-answer hints, if any. */
  coachMessageId?: string | null;
  onDismissCoach?: () => void;
  onboarding: GetStartedProps;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only while the reader is already at the bottom; scrolling up to
  // re-read an earlier answer must not be yanked back by the next token.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {messages.length === 0 ? (
        <div className="flex min-h-full items-center justify-center">
          {/*
            The landing copy depends on what is indexed and whether the origin is
            trusted, which only the document fetch can tell us. Held behind a
            skeleton — not behind nothing, which reads as a broken page inside an
            iframe.
          */}
          {documentsLoaded ? <EmptyState {...onboarding} /> : <EmptyStateSkeleton />}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
              isStreaming={isStreaming}
              coach={coachMessageId === message.id}
              onDismissCoach={onDismissCoach}
            />
          ))}
        </div>
      )}
    </div>
  );
}
