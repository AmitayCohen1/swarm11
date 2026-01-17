'use client';

import { useCredits } from '@/hooks/useCredits';

export function CreditBalance() {
  const { credits, isLoading } = useCredits();

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-sm text-gray-600">
        <div className="h-4 w-20 bg-gray-200 animate-pulse rounded"></div>
      </div>
    );
  }

  const isLow = credits < 200;

  return (
    <div className="flex items-center space-x-2 text-sm">
      <svg
        className={`h-5 w-5 ${isLow ? 'text-red-500' : 'text-gray-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className={isLow ? 'text-red-600 font-medium' : 'text-gray-900'}>
        {credits.toLocaleString()} credits
      </span>
    </div>
  );
}
