'use client';

import ResearchProgress from '@/components/sessions/ResearchProgress';

// Dummy data showing a research tree with SHORT, FOCUSED questions
// Using varied examples to show it's a general-purpose tool
const demoDoc = {
  version: 2,
  objective: "What are the best growth channels for a B2B SaaS startup targeting mid-market companies?",
  successCriteria: [
    "Identify at least 5 proven growth channels",
    "Include cost/effort analysis for each",
    "Prioritize by ROI potential"
  ],
  questions: [
    {
      id: "node_1",
      parentId: null,
      question: "What channels do top B2B SaaS companies use?",
      description: "By learning what works for successful companies, we can model proven strategies → answers 'which channels to consider'",
      goal: "Map out proven channels",
      status: "done" as const,
      cycles: 4,
      maxCycles: 15,
      confidence: "high" as const,
      memory: [
        { type: "search" as const, query: "B2B SaaS growth channels 2024 benchmark" },
        { type: "result" as const, answer: "Top B2B SaaS growth channels by effectiveness:\n\n1. **Content marketing + SEO** - 67% of B2B buyers consume 3+ pieces before talking to sales\n2. **LinkedIn outbound** - Highest response rates for mid-market\n3. **Partner/integration marketplaces** - Growing 40% YoY\n4. **Paid search (Google Ads)** - High intent but expensive\n5. **Events & webinars** - 73% of marketers say webinars generate quality leads", sources: [{ url: "https://example.com/b2b-growth", title: "B2B SaaS Benchmark 2024" }] },
        { type: "reflect" as const, thought: "Good overview of channels. Need to dig deeper on cost/effort for each to help prioritize." },
        { type: "search" as const, query: "B2B SaaS customer acquisition cost by channel" },
        { type: "result" as const, answer: "Average CAC by channel:\n- **Organic/SEO**: $200-500 (long payback but compounds)\n- **LinkedIn outbound**: $300-800\n- **Google Ads**: $500-2000 (varies by keyword competition)\n- **Events**: $1000-3000 per lead\n- **Partner referrals**: $100-300 (lowest but hardest to scale)", sources: [] },
        { type: "reflect" as const, thought: "Clear cost picture. SEO and partnerships look most efficient. Need to understand effort/timeline tradeoffs." },
      ],
      document: {
        answer: "Top B2B SaaS channels are: SEO/content (lowest CAC, compounds over time), LinkedIn outbound (good for mid-market), partnerships (cheapest but hard to scale), paid search (high intent, expensive), and events/webinars (good for enterprise). CAC ranges from $200-3000 depending on channel.",
        keyFindings: ["SEO has lowest long-term CAC", "Partnerships hardest to scale"],
        sources: [{ url: "https://example.com", title: "Source", contribution: "Benchmark data" }],
        limitations: "Varies significantly by industry vertical"
      },
      suggestedFollowups: [
        { question: "Which SaaS verticals have lowest CAC on LinkedIn?", reason: "By learning which verticals work best, we can validate if our segment fits → answers 'should we invest in LinkedIn'" },
        { question: "What content formats drive most B2B conversions?", reason: "By knowing what converts, we can prioritize content production → answers 'how to execute SEO strategy'" }
      ]
    },
    {
      id: "node_2",
      parentId: null,
      question: "What defines 'mid-market' company size?",
      description: "By defining our target precisely, we can filter channels that reach them → answers 'who exactly are we targeting'",
      goal: "Define target segment",
      status: "done" as const,
      cycles: 2,
      maxCycles: 15,
      confidence: "high" as const,
      memory: [
        { type: "search" as const, query: "mid-market company definition employee revenue range" },
        { type: "result" as const, answer: "Mid-market typically defined as:\n\n- **Employees**: 100-1000\n- **Revenue**: $10M-$1B annually\n- **Characteristics**: Have budget but not enterprise complexity, faster decision cycles than enterprise, often underserved by both SMB and enterprise solutions", sources: [] },
        { type: "reflect" as const, thought: "Clear definition. This helps us understand they have real budgets but want simplicity - affects our channel messaging." },
      ],
      document: {
        answer: "Mid-market = 100-1000 employees, $10M-$1B revenue. They have budget but want simplicity, and make faster decisions than enterprise. Often underserved by solutions targeting SMB or enterprise extremes.",
        keyFindings: ["100-1000 employees is the sweet spot", "Faster buying cycles than enterprise"],
        sources: [],
      }
    },
    {
      id: "node_3",
      parentId: "node_1",
      question: "How long does SEO take to show results?",
      description: "By knowing the timeline, we can plan cash flow and parallel channels → answers 'can we afford to wait for SEO'",
      goal: "Understand SEO timeline",
      status: "running" as const,
      cycles: 2,
      maxCycles: 15,
      confidence: null,
      memory: [
        { type: "search" as const, query: "B2B SaaS SEO timeline results months" },
        { type: "result" as const, answer: "Typical B2B SaaS SEO timeline:\n\n- **Months 1-3**: Technical setup, content strategy, initial content\n- **Months 4-6**: First rankings appearing, minimal traffic\n- **Months 7-12**: Traffic growth accelerates, first conversions\n- **Year 2+**: Compounding returns, becomes primary channel\n\nMost see meaningful pipeline impact at 9-12 months.", sources: [] },
        { type: "reflect" as const, thought: "9-12 months is a long wait. Need to find what to run in parallel to bridge the gap." },
        { type: "search" as const, query: "quick win growth channels B2B SaaS while building SEO" },
      ],
      document: undefined
    },
    {
      id: "node_4",
      parentId: "node_1",
      question: "What makes LinkedIn outbound effective for mid-market?",
      description: "By understanding what works, we can execute better → answers 'how to actually do LinkedIn well'",
      goal: "LinkedIn playbook insights",
      status: "done" as const,
      cycles: 2,
      maxCycles: 15,
      confidence: "medium" as const,
      memory: [
        { type: "search" as const, query: "LinkedIn outbound best practices B2B 2024" },
        { type: "result" as const, answer: "**What works on LinkedIn outbound:**\n- Personalization beyond {{firstName}} - reference their content/company news\n- 3-touch sequences (not 10+)\n- Value-first messaging (insight, not pitch)\n- Targeting: Director+ titles at companies showing buying signals\n\n**Average metrics:**\n- Connection accept: 30-40%\n- Reply rate: 10-20%\n- Meeting rate: 2-5% of outreach", sources: [] },
        { type: "reflect" as const, thought: "2-5% meeting rate is decent. Need to calculate how many prospects needed to hit growth targets." },
      ],
      document: {
        answer: "LinkedIn outbound works for mid-market when highly personalized, using short sequences (3 touches), leading with value not pitch. Target Director+ titles. Expect 30-40% connection rate, 10-20% replies, 2-5% meetings.",
        keyFindings: ["Personalization is key", "2-5% meeting rate is realistic"],
        sources: [],
      },
      suggestedFollowups: [
        { question: "What tools automate LinkedIn personalization?", reason: "By finding tools, we can scale outbound without losing quality → answers 'how to execute at volume'" }
      ]
    },
    {
      id: "node_5",
      parentId: "node_2",
      question: "Where do mid-market buyers research solutions?",
      description: "By learning where they look, we can be present there → answers 'where to focus our presence'",
      goal: "Buyer research behavior",
      status: "pending" as const,
      cycles: 0,
      maxCycles: 15,
      confidence: null,
      memory: [],
      document: undefined
    },
    {
      id: "node_6",
      parentId: "node_3",
      question: "Best short-term channels while SEO builds?",
      description: "By finding quick wins, we can generate revenue while waiting for SEO → answers 'how to survive months 1-12'",
      goal: "Bridge strategy",
      status: "pending" as const,
      cycles: 0,
      maxCycles: 15,
      confidence: null,
      memory: [],
      document: undefined
    },
  ],
  brainLog: [],
  status: "running" as const,
  finalAnswer: undefined
};

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 pb-6 border-b border-white/10">
          <h1 className="text-2xl font-bold text-white mb-2">Research Progress Demo</h1>
          <p className="text-slate-400 text-sm">
            Demo with dummy data. Click any box to see details.
          </p>
        </div>

        <ResearchProgress doc={demoDoc} />
      </div>
    </div>
  );
}
