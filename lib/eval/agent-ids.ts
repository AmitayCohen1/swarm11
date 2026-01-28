/**
 * Observatory Agent IDs
 *
 * Centralized registry of all tracked agent IDs.
 * See OBSERVATORY.md for evaluation philosophy.
 */

export const AGENT_IDS = {
  /** Classifies incoming user messages (research vs chat vs follow-up) */
  INTAKE: 'yuaWX5V_M-U4',

  /** Decides what research actions to take next */
  BRAIN_EVALUATE: 'cSZaU3rjiQxw',

  /** Synthesizes final research report from all findings */
  BRAIN_FINISH: 'Uy4dSnQuHdzi',

  /** Runs individual research questions, extracts insights */
  RESEARCHER_EVALUATE: 'vveyd_AC0xrt',

  /** Summarizes findings for a single research question */
  RESEARCHER_FINISH: 's98-GcuqAXIl',

  /** Sends queries to Perplexity */
  WEB_SEARCH: 'HUP_QEr0v0IX',
} as const;

export type AgentId = typeof AGENT_IDS[keyof typeof AGENT_IDS];
