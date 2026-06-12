import { useLiveQuery } from 'dexie-react-hooks';
import { MessageSquare } from 'lucide-react';
import { db } from '../db/db.ts';
import type { MessageRow } from '../db/types.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  composerDraftSet,
  userMessageSubmitted,
} from '../store/slices/chatSlice.ts';
import {
  approvalResolved,
  approvalDismissed,
  approvalEdited,
} from '../store/slices/approvalsSlice.ts';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { MessageBubble } from './chat/MessageBubble.tsx';
import { ApprovalCard } from './chat/ApprovalCard.tsx';
import { ChatComposer } from './chat/ChatComposer.tsx';

export default function ChatScreen() {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((state) => state.chat.composerDraft);
  const activeConversationId = useAppSelector(
    (state) => state.chat.activeConversationId,
  );
  const approvalQueue = useAppSelector((state) => state.approvals.queue);
  const pendingApprovals = approvalQueue.filter((a) => a.status === 'pending');

  const messages =
    useLiveQuery(
      () =>
        activeConversationId
          ? db.messages
              .where('conversationId')
              .equals(activeConversationId)
              .sortBy('createdAt')
          : Promise.resolve<MessageRow[]>([]),
      [activeConversationId],
    ) ?? [];

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    let conversationId = activeConversationId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      await db.conversations.put({
        id: conversationId,
        title: text.slice(0, 48),
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.messages.put({
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content: text,
      createdAt: now,
    });
    dispatch(userMessageSubmitted({ conversationId, text }));
  }

  function resolve(id: string, status: 'approved' | 'rejected') {
    dispatch(approvalResolved({ id, status }));
    dispatch(approvalDismissed(id));
  }

  const isEmpty = messages.length === 0 && pendingApprovals.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-bold text-text">Chat / Workbench</h1>
        <p className="text-sm text-muted">Your local-first AI agent console.</p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {isEmpty ? (
            <EmptyState
              icon={<MessageSquare className="size-5" />}
              title="Start a conversation"
              description="Ask anything or give a command. Side-effectful actions appear as approval cards you review before they run."
            />
          ) : (
            <>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  at={message.createdAt}
                />
              ))}
              {pendingApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onApprove={(id) => resolve(id, 'approved')}
                  onReject={(id) => resolve(id, 'rejected')}
                  onEdit={(id, payloadPreview) =>
                    dispatch(approvalEdited({ id, payloadPreview }))
                  }
                />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            value={draft}
            onChange={(value) => dispatch(composerDraftSet(value))}
            onSend={() => {
              void handleSend();
            }}
          />
        </div>
      </div>
    </div>
  );
}
