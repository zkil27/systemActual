"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import {
  AI_TOPICS,
  MAX_ANSWER,
  MAX_HANDOVER,
  MAX_LABEL,
  SHOP_ANSWER_TOPICS,
  type AiMode,
  type AiTopic,
  type ShopAnswerTopic,
} from "@/lib/ai/settings";
import type { AiSettingsView, ShopAnswerView } from "@/lib/ai/settings-store";

const rowClass = "flex min-h-[52px] items-center justify-between gap-4 px-4";
const rowLinkClass = `${rowClass} group pressable-row w-full text-left hover:bg-surface-subtle active:bg-surface-muted`;

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 pb-2 pt-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">{children}</h2>;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "No connection. Try again." } };
  }
}

const MODE_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "draft", label: "Draft" },
  { id: "auto", label: "Auto" },
] as const;
const DRAFT_ONLY = [
  { id: "off", label: "Off" },
  { id: "draft", label: "Draft" },
] as const;

const topicLabel = (id: string) => SHOP_ANSWER_TOPICS.find((t) => t.id === id)?.label ?? "Other";

export default function AssistantSettingsPage() {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [testAutosendCount, setTestAutosendCount] = useState(0);
  const [answers, setAnswers] = useState<ShopAnswerView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [handover, setHandover] = useState("");
  const [editing, setEditing] = useState<Partial<ShopAnswerView> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
      setTestAutosendCount(typeof data.testAutosendCount === "number" ? data.testAutosendCount : 0);
      setAnswers(data.answers);
      setLabel(data.settings.autoLabel);
      setHandover(data.settings.handoverText);
      setError(null);
    } catch {
      setError("Couldn't load the assistant settings. Pull down to try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(partial: Record<string, unknown>, done?: string) {
    const prev = settings;
    if (prev) setSettings({ ...prev, ...partial } as AiSettingsView);
    const { ok, data } = await post({ action: "update_settings", settings: partial });
    if (ok) {
      setSettings(data.settings as AiSettingsView);
      if (done) toast(done);
    } else {
      setSettings(prev);
      toast((data.error as string) || "Couldn't save", "error");
    }
  }

  function setMode(topic: AiTopic, mode: AiMode) {
    if (!settings) return;
    void save({ topicModes: { ...settings.topicModes, [topic]: mode } });
  }

  const textDirty = settings && (label.trim() !== settings.autoLabel || handover.trim() !== settings.handoverText);

  return (
    <AppShell title="Chats assistant" onRefresh={load}>
      <div className="space-y-8">
        {error && (
          <p role="alert" className="px-1 text-[15px] font-semibold text-missing-ink">
            {error}
          </p>
        )}

        <section>
          <Group className="divide-y divide-hairline">
            <div className={`${rowClass} py-3`}>
              <span className="min-w-0">
                <span className="block text-[17px] text-ink">Assistant</span>
                <span className="block text-[13px] text-ink-3">
                  Writes reply drafts in Chats. You can also send /aioff or /aion on Telegram.
                </span>
              </span>
              <Switch
                label="Chats assistant"
                checked={settings?.enabled ?? false}
                disabled={!settings}
                onChange={(on) => void save({ enabled: on }, on ? "Assistant on" : "Assistant off")}
              />
            </div>

            <div className={`${rowClass} py-3`}>
              <span className="min-w-0">
                <span className="block text-[17px] text-ink">Reply to buyers from Kyna Ops</span>
                <span className="block text-[13px] text-ink-3">
                  Sends your replies to TikTok buyers. Shopee chats stay Coming soon until live approval.
                </span>
              </span>
              <Switch
                label="Reply to buyers from Kyna Ops"
                checked={settings?.chatSendEnabled ?? false}
                disabled={!settings}
                onChange={(on) =>
                  void save(
                    { chatSendEnabled: on, ...(!on ? { autoSendEnabled: false } : {}) },
                    on ? "Chat sending on" : "Chat sending off"
                  )
                }
              />
            </div>

            <div className={`${rowClass} py-3`}>
              <span className="min-w-0">
                <span className="block text-[17px] text-ink">Automatic replies (all buyers)</span>
                <span className="block text-[13px] text-ink-3">
                  Sends by itself only for topics set to Auto. Returns, refunds and complaints stay person-only.
                </span>
              </span>
              <Switch
                label="Automatic replies"
                checked={settings?.autoSendEnabled ?? false}
                disabled={!settings || !settings.enabled || !settings.chatSendEnabled}
                onChange={(on) =>
                  void save({ autoSendEnabled: on }, on ? "Automatic replies on" : "Automatic replies off")
                }
              />
            </div>

            <div className={`${rowClass} py-3`}>
              <span className="min-w-0">
                <span className="block text-[17px] text-ink">Approval queue &amp; Telegram 1-tap</span>
                <span className="block text-[13px] text-ink-3">
                  Sends draft or uncertain replies to Approvals and Telegram so you can approve with one tap.
                </span>
              </span>
              <Switch
                label="Approval queue and Telegram 1-tap"
                checked={settings?.approvalQueueEnabled ?? true}
                disabled={!settings || !settings.enabled || !settings.chatSendEnabled}
                onChange={(on) =>
                  void save({ approvalQueueEnabled: on }, on ? "Approval queue on" : "Approval queue off")
                }
              />
            </div>
          </Group>
          <p className="px-4 pt-2 text-[13px] text-ink-3">
            {testAutosendCount > 0 && !settings?.autoSendEnabled
              ? `Test buyer allowlist active (${testAutosendCount} chat): topics set to Auto will reply automatically only to your test account while Automatic replies is off.`
              : "Every automatic reply carries your label and stays logged. Replying yourself pauses the assistant on that chat for 2 hours."}
          </p>
        </section>

        <section>
          <GroupLabel>What it may do</GroupLabel>
          <Group className="divide-y divide-hairline">
            {AI_TOPICS.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[16px] text-ink">{t.label}</span>
                <div className="w-full sm:w-64">
                  <SegmentedControl
                    size="sm"
                    label={t.label}
                    options={t.canAuto ? MODE_OPTIONS : DRAFT_ONLY}
                    value={settings ? settings.topicModes[t.id] : null}
                    onChange={(m) => setMode(t.id, m)}
                  />
                </div>
              </div>
            ))}
          </Group>
          <p className="px-4 pt-2 text-[13px] text-ink-3">
            Draft: waits for you in Chats and Approvals. Auto: sends automatically when Automatic replies (or your test
            allowlist) is on. Returns, refunds and complaints always go to you.
          </p>
        </section>

        <section>
          <GroupLabel>Wording</GroupLabel>
          <Group className="divide-y divide-hairline">
            <label className="block px-4 py-3">
              <span className="block text-[15px] text-ink-2">Label on automatic replies</span>
              <input
                value={label}
                maxLength={MAX_LABEL}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1 h-11 w-full rounded-[10px] bg-surface-muted px-3 text-[17px] text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
            <label className="block px-4 py-3">
              <span className="block text-[15px] text-ink-2">When a person needs to take over</span>
              <textarea
                value={handover}
                maxLength={MAX_HANDOVER}
                rows={2}
                onChange={(e) => setHandover(e.target.value)}
                className="mt-1 w-full resize-none rounded-[10px] bg-surface-muted px-3 py-2.5 text-[17px] leading-snug text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
          </Group>
          {textDirty && (
            <div className="flex justify-end gap-2 pt-3">
              <Button
                variant="plain"
                onClick={() => {
                  setLabel(settings.autoLabel);
                  setHandover(settings.handoverText);
                }}
              >
                Undo
              </Button>
              <Button
                disabled={!label.trim() || !handover.trim()}
                onClick={() => void save({ autoLabel: label.trim(), handoverText: handover.trim() }, "Saved")}
              >
                Save
              </Button>
            </div>
          )}
        </section>

        <section>
          <GroupLabel>Shop answers</GroupLabel>
          <Group className="divide-y divide-hairline">
            {answers.length === 0 && (
              <p className="px-4 py-4 text-[15px] text-ink-3">
                Add your rules here: COD, shipping times, returns, sizes, live sales, and what never to promise. The
                assistant only uses what you write here.
              </p>
            )}
            {answers.map((a) => (
              <button key={a.id} type="button" onClick={() => setEditing(a)} className={rowLinkClass}>
                <span className="min-w-0">
                  <span className={`block truncate text-[16px] ${a.active ? "text-ink" : "text-ink-3 line-through"}`}>
                    {a.title}
                  </span>
                  <span className="block truncate text-[13px] text-ink-3">
                    {topicLabel(a.topic)} · {a.answer}
                  </span>
                </span>
                <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-ink-3" />
              </button>
            ))}
            <button type="button" onClick={() => setEditing({ topic: "cod", active: true })} className={rowLinkClass}>
              <span className="text-[17px] text-brand">Add a shop answer</span>
              <Plus className="h-5 w-5 text-brand" />
            </button>
          </Group>
        </section>
      </div>

      <AnswerSheet
        answer={editing}
        onClose={() => setEditing(null)}
        onSaved={(list) => {
          setAnswers(list);
          setEditing(null);
        }}
        current={answers}
      />
    </AppShell>
  );
}

function AnswerSheet({
  answer,
  current,
  onClose,
  onSaved,
}: {
  answer: Partial<ShopAnswerView> | null;
  current: ShopAnswerView[];
  onClose: () => void;
  onSaved: (list: ShopAnswerView[]) => void;
}) {
  const [topic, setTopic] = useState<ShopAnswerTopic>("cod");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const { confirm, sheet } = useConfirm();

  useEffect(() => {
    if (!answer) return;
    setTopic((answer.topic as ShopAnswerTopic) ?? "cod");
    setTitle(answer.title ?? "");
    setText(answer.answer ?? "");
    setActive(answer.active ?? true);
  }, [answer]);

  async function run(body: Record<string, unknown>, done: string, apply: (d: Record<string, unknown>) => ShopAnswerView[]) {
    setBusy(true);
    const { ok, data } = await post(body);
    setBusy(false);
    if (!ok) return toast((data.error as string) || "Couldn't save", "error");
    toast(done);
    onSaved(apply(data));
  }

  const upsert = (d: Record<string, unknown>) => {
    const a = d.answer as ShopAnswerView;
    return current.some((x) => x.id === a.id) ? current.map((x) => (x.id === a.id ? a : x)) : [...current, a];
  };

  return (
    <>
      <Sheet open={answer !== null} onClose={onClose} title={answer?.id ? "Edit shop answer" : "New shop answer"}>
        <div className="space-y-4 pt-1">
          <label className="block">
            <span className="block pb-1 text-[15px] text-ink-2">Topic</span>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value as ShopAnswerTopic)}
              className="h-11 w-full rounded-[10px] bg-surface-muted px-3 text-[17px] text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {SHOP_ANSWER_TOPICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block pb-1 text-[15px] text-ink-2">Short name</span>
            <input
              value={title}
              maxLength={80}
              placeholder="e.g. COD available"
              onChange={(e) => setTitle(e.target.value)}
              className="h-11 w-full rounded-[10px] bg-surface-muted px-3 text-[17px] text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="block">
            <span className="block pb-1 text-[15px] text-ink-2">Answer</span>
            <textarea
              value={text}
              maxLength={MAX_ANSWER}
              rows={5}
              placeholder="e.g. Yes po, COD is available nationwide."
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-none rounded-[10px] bg-surface-muted px-3 py-2.5 text-[17px] leading-snug text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[16px] text-ink">Use this answer</span>
            <Switch label="Use this answer" checked={active} onChange={setActive} />
          </div>
          <Button
            full
            disabled={busy || !title.trim() || !text.trim()}
            onClick={() =>
              void run(
                { action: "save_answer", answer: { id: answer?.id, topic, title: title.trim(), answer: text.trim(), active } },
                "Saved",
                upsert
              )
            }
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          {answer?.id && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                disabled={busy || !answer.canUndo}
                onClick={() => void run({ action: "undo_answer", id: answer.id }, "Previous answer restored", upsert)}
              >
                Undo last edit
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete this answer?",
                    message: "The assistant won't use it anymore.",
                    confirmLabel: "Delete",
                  });
                  if (ok) {
                    void run({ action: "delete_answer", id: answer.id }, "Deleted", () =>
                      current.filter((x) => x.id !== answer.id)
                    );
                  }
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </Sheet>
      {sheet}
    </>
  );
}
