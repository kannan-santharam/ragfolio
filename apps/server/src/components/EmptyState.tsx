'use client';

import { Sparkles } from 'lucide-react';
import { GetStarted, type GetStartedProps } from './GetStarted';

/**
 * The landing screen: a heading, the owner's welcome line, and a stepper that
 * tells the visitor exactly what to do next and does it for them.
 */
export function EmptyState(props: GetStartedProps) {
  const { config, documents, trusted } = props;
  const owner = config.ownerName;
  const owned = documents.filter((doc) => !doc.is_public);
  const onlyPreloaded = documents.length > 0 && owned.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-10 text-center">
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl">
        <span className="tech-gradient-bg absolute inset-0" />
        <Sparkles className="relative h-6 w-6 text-white" />
      </div>

      <h2 className="text-brand-gradient text-2xl font-extrabold sm:text-3xl">
        {onlyPreloaded && trusted && owner ? `Ask anything about ${owner}` : 'Ask anything about your documents'}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--text-sub)]">
        {onlyPreloaded && trusted
          ? config.welcome
          : documents.length > 0
            ? 'Your knowledge base is indexed. The agent decides when to search, searches again when results are weak, and cites every passage it used.'
            : 'Three short steps and you can ask. Answers come only from what you provide, with a citation for every claim.'}
      </p>

      <GetStarted {...props} />
    </div>
  );
}
