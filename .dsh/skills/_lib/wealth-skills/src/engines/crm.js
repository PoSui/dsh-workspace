/**
 * Wealth CRM Engine - Self-Contained Transcript Parsing & CRM Sync Logic
 */

// Word boundaries keep "will" from matching "willing" or "William", and "action" from matching
// "transaction".
const ACTION_PATTERNS = [/\bwill\b/, /\bfollow[\s-]?up\b/, /\bsend\b/, /\bprepare\b/, /\baction\b/, /\btask\b/, /\bschedule\b/];
const DECISION_PATTERNS = [/\bagreed\b/, /\bdecided\b/, /\bapproved\b/, /\bconfirmed\b/, /\bchose\b/, /\bselected\b/];

export function parseMeetingTranscript(transcriptText) {
  const lines = String(transcriptText ?? '').split('\n');
  const actionItems = [];
  const keyDecisions = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    // A line can be both: "Client approved the plan; advisor will send the paperwork" is a
    // decision AND a follow-up. These were an if/else, which silently dropped the action item.
    if (DECISION_PATTERNS.some(re => re.test(lower))) {
      keyDecisions.push(trimmed);
    }

    if (ACTION_PATTERNS.some(re => re.test(lower))) {
      actionItems.push({
        task: trimmed,
        priority: lower.includes('urgent') || lower.includes('asap') ? 'High' : 'Normal',
        dueDateDaysOut: lower.includes('next week') ? 7 : 3
      });
    }
  }

  return {
    parsedAt: new Date().toISOString(),
    extractedDecisionsCount: keyDecisions.length,
    extractedActionItemsCount: actionItems.length,
    keyDecisions,
    actionItems
  };
}

export function buildCrmPayload(crmType = 'Salesforce_FSC', householdId, meetingDate, actionItems) {
  const payload = {
    crmPlatform: crmType,
    householdId,
    meetingDate: meetingDate || new Date().toISOString().split('T')[0],
    tasks: actionItems.map((item, idx) => ({
      externalId: `TASK-${Date.now()}-${idx}`,
      subject: typeof item === 'string' ? item : item.task,
      priority: item.priority || 'Normal',
      status: 'Not Started',
      dueDate: new Date(Date.now() + (item.dueDateDaysOut || 7) * 86400000).toISOString().split('T')[0]
    }))
  };

  return payload;
}
