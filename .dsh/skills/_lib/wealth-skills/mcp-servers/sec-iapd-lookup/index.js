#!/usr/bin/env node

/**
 * MCP Server: sec-iapd-lookup
 * Investment adviser registration and disclosure lookups in the SEC's IAPD compilation files
 * (https://adviserinfo.sec.gov/compilation). The files are downloaded by the operator; the server reads
 * them from disk. It never queries FINRA BrokerCheck, whose terms prohibit automated access.
 *
 * Set WEALTH_SKILLS_IAPD_FEED to a default file so an agent does not have to know the path.
 */

import { startStdioServer, isMainModule } from '../lib/stdio-server.js';
import { lookupAdviserRegistration } from '../../src/engines/registration.js';
import { withAuditMetadata, LIBRARY_VERSION } from '../../src/engines/audit.js';
import { withGuidance } from '../../src/engines/guidance.js';

export const server = {
  name: 'sec-iapd-lookup',
  version: LIBRARY_VERSION,
  tools: [
    {
      name: 'lookup_adviser_registration',
      command: 'compliance lookup',
      description: 'Looks up an investment adviser firm or representative by CRD number or name in an SEC IAPD compilation file (SEC firms, state firms, or representatives), returning registration status, notice filings or state registrations, employers, exams and whether disclosures are reported. Covers investment adviser registration only: broker-dealer registrations and FINRA disclosures are not in these files, and a miss does not mean someone is unregistered. Results carry the file date and a stale flag.',
      inputSchema: {
        type: 'object',
        properties: {
          feedPath: { type: 'string', description: 'Path to an IAPD compilation file (.xml, .xml.gz or .xml.zip). Defaults to WEALTH_SKILLS_IAPD_FEED.' },
          crd: { type: 'string', description: 'Exact CRD number, e.g. "283882"' },
          name: { type: 'string', description: 'Case-insensitive name search when the CRD is unknown' },
          limit: { type: 'integer', description: 'Maximum name matches (default 10)' },
          asOf: { type: 'string', description: 'Date to judge the file age against, YYYY-MM-DD (default today)' },
          maxAgeDays: { type: 'number', description: 'Flag the file as stale beyond this many days (default 7)' }
        },
        required: []
      },
      handler: async (args) => {
        const result = await lookupAdviserRegistration({ ...args, feedPath: args.feedPath ?? process.env.WEALTH_SKILLS_IAPD_FEED });
        return withAuditMetadata(withGuidance(result, 'compliance lookup'), {
          skillPack: 'wealth-compliance',
          tool: 'lookup_adviser_registration',
          engineFunction: 'lookupAdviserRegistration',
          methodology: 'Streaming exact-CRD or name match over an SEC IAPD compilation file',
          dataSources: [`SEC IAPD compilation file ${result.feed.file} generated ${result.feed.generatedOn}`]
        });
      }
    }
  ]
};

if (isMainModule(import.meta.url)) startStdioServer(server);
