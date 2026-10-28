import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingTranscript, buildCrmPayload } from '../src/engines/crm.js';

test('CRM Engine: Transcript Parsing', () => {
  const transcript = "Client agreed to rebalance into bonds.\nAdvisor will send proposal next week.";
  const result = parseMeetingTranscript(transcript);

  assert.equal(result.extractedDecisionsCount, 1);
  assert.equal(result.extractedActionItemsCount, 1);
  assert.equal(result.actionItems[0].task, "Advisor will send proposal next week.");
});

test('CRM Engine: A Line Can Be Both A Decision And An Action Item', () => {
  const result = parseMeetingTranscript('Client approved the plan; advisor will send the paperwork.');

  assert.equal(result.extractedDecisionsCount, 1);
  assert.equal(result.extractedActionItemsCount, 1);
});

test('CRM Engine: Keywords Match Whole Words Only', () => {
  const result = parseMeetingTranscript('William is willing to wait.\nThe transaction settled.');
  assert.equal(result.extractedActionItemsCount, 0);
});

test('CRM Engine: Salesforce Payload Builder', () => {
  const tasks = [{ task: "Send IRA rollover form", priority: "High" }];
  const result = buildCrmPayload('Salesforce_FSC', 'HH-100', '2026-09-09', tasks);

  assert.equal(result.crmPlatform, 'Salesforce_FSC');
  assert.equal(result.tasks[0].subject, 'Send IRA rollover form');
  assert.equal(result.tasks[0].priority, 'High');
});
