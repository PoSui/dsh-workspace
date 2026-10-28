/**
 * Wealth Audit Engine - Structured audit metadata, attached at the tool boundary (CLI and MCP).
 */

// Kept in step with package.json; tests/audit.test.js asserts that they match.
export const LIBRARY_VERSION = '0.1.0';

export function buildAuditMetadata({ skillPack, tool = null, engineFunction, methodology = null, dataSources = [], requiresHumanApproval = false } = {}) {
  if (!skillPack || !engineFunction) {
    throw new Error('Audit metadata requires skillPack and engineFunction.');
  }

  return {
    skill_pack: skillPack,
    tool,
    engine_function: engineFunction,
    methodology,
    data_sources: [...dataSources],
    requires_human_approval: Boolean(requiresHumanApproval),
    library_version: LIBRARY_VERSION,
    generated_at: new Date().toISOString()
  };
}

// An engine's own requiresHumanApproval flag can raise the requirement but never clear it.
export function withAuditMetadata(result, meta) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return result;

  return {
    ...result,
    auditMetadata: buildAuditMetadata({
      ...meta,
      requiresHumanApproval: Boolean(meta?.requiresHumanApproval) || result.requiresHumanApproval === true
    })
  };
}
