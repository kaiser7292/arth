/**
 * v15.5.0 — Module-level store for the in-progress SMS template draft.
 *
 * Rationale: the tagging flow spans 3 screens (new → tag → save/back),
 * and we want to preserve:
 *   - the pasted SMS body
 *   - the user's current spans
 *   - the bank name / tx_type / label
 *   - the optional created_from_sms_id
 *
 * ...even if the user taps Back. React navigation params are fine for
 * small strings but awkward for arrays of objects. A module-local
 * singleton keeps the screens clean and stateless between themselves.
 *
 * Lifecycle:
 *   - startDraft() called when entering "Teach Artha" or "Edit existing"
 *   - updateDraft() called from each screen as the user edits
 *   - clearDraft() called after save, or from the list screen as safety
 */

import type { TaggedSpan } from "./template-compiler";
import type { UserTxType, SenderMatchMode } from "./user-sms-templates";

export interface TemplateDraft {
  /** Set when editing an existing user template; null for a fresh create. */
  editingId: string | null;
  smsBody: string;
  spans: TaggedSpan[];
  bankName: string;
  txType: UserTxType;
  label: string;
  createdFromSmsId?: string | null;
  /** v15.11.0 — sender-based routing */
  senderPattern: string;
  senderMatchMode: SenderMatchMode;
}

let current: TemplateDraft | null = null;

export function getDraft(): TemplateDraft | null {
  return current;
}

export function startDraft(init: Partial<TemplateDraft> = {}): TemplateDraft {
  current = {
    editingId: init.editingId ?? null,
    smsBody: init.smsBody ?? "",
    spans: init.spans ?? [],
    bankName: init.bankName ?? "",
    txType: init.txType ?? "debit",
    label: init.label ?? "",
    createdFromSmsId: init.createdFromSmsId ?? null,
    senderPattern: init.senderPattern ?? "",
    senderMatchMode: init.senderMatchMode ?? "code",
  };
  return current;
}

export function updateDraft(patch: Partial<TemplateDraft>): TemplateDraft {
  if (!current) current = startDraft();
  current = { ...current, ...patch };
  return current;
}

export function clearDraft(): void {
  current = null;
}
