import { useLiveQuery } from 'dexie-react-hooks';
import { MessageSquare, PlugZap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../db/db.ts';
import type { MessageRow } from '../db/types.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  composerDraftSet,
  activeSkillSet,
  userMessageSubmitted,
} from '../store/slices/chatSlice.ts';
import { isProviderConfigured } from '../providers/registry.ts';
import { appConfig } from '../config/appConfig.ts';
import {
  approvalResolved,
  approvalDismissed,
  approvalEdited,
} from '../store/slices/approvalsSlice.ts';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { ErrorState } from '../components/ui/ErrorState.tsx';
import { Select } from '../components/ui/Select.tsx';
import { MessageBubble } from './chat/MessageBubble.tsx';
import { ApprovalCard } from './chat/ApprovalCard.tsx';
import { ScriptApprovalCard } from './chat/ScriptApprovalCard.tsx';

/** The two script-runtime approval kinds use the richer script card (G2). */
const SCRIPT_APPROVAL_KINDS = new Set(['plan', 'sandbox_script']);
import { ChatComposer } from './chat/ChatComposer.tsx';

export default function ChatScreen() {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((state) => state.chat.composerDraft);
  const activeConversationId = useAppSelector(
    (state) => state.chat.activeConversationId,
  );
  const approvalQueue = useAppSelector((state) => state.approvals.queue);
  const pendingApprovals = approvalQueue.filter((a) => a.status === 'pending');
  const activeSkillId = useAppSelector((state) => state.chat.activeSkillId);
  // Enabled skills can be made the conversation's active skill; their declared
  // tools are then the only ones a tool call may use (fail closed otherwise).
  const enabledSkills =
    useLiveQuery(() => db.skills.filter((s) => s.enabled).toArray(), []) ?? [];
  const activeProviderId = useAppSelector(
    (state) => state.providers.activeProviderId,
  );
  const providerReady = isProviderConfigured(
    activeProviderId,
    appConfig.isMockProviderAllowed,
  );
  const chatError = useAppSelector((state) => state.chat.error);

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
    if (!providerReady) return;
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
          {!providerReady ? (
            <EmptyState
              icon={<PlugZap className="size-5" />}
              title="No provider configured"
              description="Connect an AI provider before you can chat. Add and test a provider in the Models screen."
              action={
                <Link
                  to="/models"
                  data-testid="chat-setup-cta"
                  className="inline-flex h-9 items-center justify-center rounded-button bg-primary px-4 text-sm font-medium text-surface transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Set up a provider
                </Link>
              }
            />
          ) : isEmpty ? (
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
              {pendingApprovals.map((approval) =>
                SCRIPT_APPROVAL_KINDS.has(approval.kind) ? (
                  <ScriptApprovalCard
                    key={approval.id}
                    approval={approval}
                    onApprove={(id) => resolve(id, 'approved')}
                    onReject={(id) => resolve(id, 'rejected')}
                  />
                ) : (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onApprove={(id) => resolve(id, 'approved')}
                    onReject={(id) => resolve(id, 'rejected')}
                    onEdit={(id, payloadPreview) =>
                      dispatch(approvalEdited({ id, payloadPreview }))
                    }
                  />
                ),
              )}
            </>
          )}
          {chatError && (
            <div data-testid="chat-error">
              <ErrorState
                title="The provider could not respond"
                description={chatError.message}
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {enabledSkills.length > 0 && (
            <Select
              label="Active skill"
              className="w-56"
              value={activeSkillId ?? ''}
              onChange={(event) =>
                dispatch(activeSkillSet(event.target.value || null))
              }
            >
              <option value="">No skill (tools disabled)</option>
              {enabledSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </Select>
          )}
          <ChatComposer
            value={draft}
            onChange={(value) => dispatch(composerDraftSet(value))}
            onSend={() => {
              void handleSend();
            }}
            disabled={!providerReady}
          />
        </div>
      </div>
    </div>
  );
}
