'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCredits } from '@/hooks/useCredits';
import { CreditBalance } from '@/components/CreditBalance';
import { UserButton } from '@clerk/nextjs';
import { CREDIT_PACKAGES } from '@/lib/stripe/client';

function CreditsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { credits, lifetimeCreditsUsed, refetch } = useCredits();
  const [loadingPackage, setLoadingPackage] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setShowSuccess(true);
      refetch();
      // Remove query params
      router.replace('/credits');
    }
  }, [searchParams, refetch, router]);

  const handlePurchase = async (packageId: string) => {
    setLoadingPackage(packageId);

    try {
      const response = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Purchase error:', error);
      alert(error instanceof Error ? error.message : 'Failed to start checkout');
      setLoadingPackage(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/chat')}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </button>
              <h1 className="text-xl font-semibold text-gray-900">Buy Credits</h1>
            </div>
            <div className="flex items-center space-x-4">
              <CreditBalance />
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {showSuccess && (
          <div className="mb-8 rounded-md bg-green-50 p-4">
            <div className="flex">
              <svg
                className="h-5 w-5 text-green-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="ml-3 text-sm text-green-800">
                Credits purchased successfully! Your balance has been updated.
              </p>
            </div>
          </div>
        )}

        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">Choose Your Credit Package</h2>
          <p className="mt-4 text-lg text-gray-600">
            1 credit = $0.01 USD • Web searches cost ~1 credit • Research iterations cost ~200 credits
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Your Credits</h3>
              <p className="mt-1 text-sm text-gray-600">
                Lifetime credits used: {lifetimeCreditsUsed.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {credits.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {CREDIT_PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white rounded-lg shadow-sm border-2 border-gray-200 p-8 flex flex-col"
            >
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900">{pkg.name}</h3>
                {pkg.discount && (
                  <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {pkg.discount}
                  </span>
                )}

                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">${pkg.price}</span>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center text-gray-600">
                    <svg
                      className="h-5 w-5 text-green-500 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {pkg.credits.toLocaleString()} credits
                  </div>
                  <div className="flex items-center text-gray-600">
                    <svg
                      className="h-5 w-5 text-green-500 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    ~{Math.floor(pkg.credits / 200)} research iterations
                  </div>
                  <div className="flex items-center text-gray-600">
                    <svg
                      className="h-5 w-5 text-green-500 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    No expiration
                  </div>
                </div>
              </div>

              <button
                onClick={() => handlePurchase(pkg.id)}
                disabled={loadingPackage === pkg.id}
                className="mt-8 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingPackage === pkg.id ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </>
                ) : (
                  'Purchase Credits'
                )}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900 mb-4">How Credits Work</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start">
              <svg className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Web searches cost approximately 1 credit per search</span>
            </li>
            <li className="flex items-start">
              <svg className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Research iterations (Claude API) cost approximately 200 credits</span>
            </li>
            <li className="flex items-start">
              <svg className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Credits never expire and can be used at any time</span>
            </li>
            <li className="flex items-start">
              <svg className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Research sessions automatically stop when credits run low</span>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>}>
      <CreditsPageContent />
    </Suspense>
  );
}
