import { useEffect, useState } from 'react';

interface UseCreditsResult {
  credits: number;
  lifetimeCreditsUsed: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCredits(): UseCreditsResult {
  const [credits, setCredits] = useState(0);
  const [lifetimeCreditsUsed, setLifetimeCreditsUsed] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = async () => {
    try {
      const response = await fetch('/api/credits');

      if (!response.ok) {
        throw new Error('Failed to fetch credits');
      }

      const data = await response.json();
      setCredits(data.credits);
      setLifetimeCreditsUsed(data.lifetimeCreditsUsed);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();

    // Poll every 5 seconds for credit updates
    const interval = setInterval(fetchCredits, 5000);

    return () => clearInterval(interval);
  }, []);

  return { credits, lifetimeCreditsUsed, isLoading, error, refetch: fetchCredits };
}
