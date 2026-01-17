#!/bin/bash

# Test Orchestrator Setup Script
# This script verifies that the orchestrator is set up correctly

echo "🔍 Testing Orchestrator Setup..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

# Function to check
check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
  fi
}

# Test 1: Check if .env.local exists
echo "1. Checking environment file..."
if [ -f .env.local ]; then
  check "Found .env.local"
else
  echo -e "${RED}✗${NC} .env.local not found"
  ((FAILED++))
fi

# Test 2: Check required env vars
echo ""
echo "2. Checking required environment variables..."

if grep -q "PERPLEXITY_API_KEY=" .env.local 2>/dev/null && [ -n "$(grep PERPLEXITY_API_KEY= .env.local | cut -d'=' -f2)" ]; then
  check "PERPLEXITY_API_KEY is set"
else
  echo -e "${RED}✗${NC} PERPLEXITY_API_KEY not set"
  ((FAILED++))
fi

if grep -q "ANTHROPIC_API_KEY=" .env.local 2>/dev/null && [ -n "$(grep ANTHROPIC_API_KEY= .env.local | cut -d'=' -f2)" ]; then
  check "ANTHROPIC_API_KEY is set"
else
  echo -e "${RED}✗${NC} ANTHROPIC_API_KEY not set"
  ((FAILED++))
fi

if grep -q "DATABASE_URL=" .env.local 2>/dev/null && [ -n "$(grep DATABASE_URL= .env.local | cut -d'=' -f2)" ]; then
  check "DATABASE_URL is set"
else
  echo -e "${RED}✗${NC} DATABASE_URL not set"
  ((FAILED++))
fi

# Test 3: Check if required files exist
echo ""
echo "3. Checking orchestrator files..."

FILES=(
  "lib/agents/orchestrator-agent.ts"
  "lib/tools/research-tool.ts"
  "app/api/orchestrator/start/route.ts"
  "app/orchestrator/page.tsx"
  "components/orchestrator/OrchestratorChat.tsx"
  "hooks/useOrchestrator.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    check "Found $file"
  else
    echo -e "${RED}✗${NC} Missing $file"
    ((FAILED++))
  fi
done

# Test 4: Check if legacy files are removed
echo ""
echo "4. Verifying legacy code removal..."

LEGACY_FILES=(
  "app/api/research/start/route.ts"
  "lib/agents/research-agent.ts"
  "lib/tools/web-search.ts"
)

for file in "${LEGACY_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    check "Removed $file"
  else
    echo -e "${YELLOW}⚠${NC} Legacy file still exists: $file"
  fi
done

# Test 5: Check dependencies
echo ""
echo "5. Checking dependencies..."

if [ -f package.json ]; then
  if grep -q "@ai-sdk/anthropic" package.json; then
    check "Found @ai-sdk/anthropic"
  else
    echo -e "${RED}✗${NC} Missing @ai-sdk/anthropic"
    ((FAILED++))
  fi

  if grep -q "@anthropic-ai/sdk" package.json; then
    check "Found @anthropic-ai/sdk"
  else
    echo -e "${RED}✗${NC} Missing @anthropic-ai/sdk"
    ((FAILED++))
  fi
fi

# Summary
echo ""
echo "=================================="
echo "📊 Test Summary"
echo "=================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $FAILED${NC}"
fi
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  echo ""
  echo "🚀 Next steps:"
  echo "1. Run: npm run dev"
  echo "2. Navigate to: http://localhost:3000/orchestrator"
  echo "3. Try asking: 'What are the latest AI breakthroughs?'"
  echo ""
else
  echo -e "${RED}❌ Some tests failed. Please fix the issues above.${NC}"
  echo ""
  echo "📚 See CLEANUP_SUMMARY.md for troubleshooting"
  exit 1
fi
