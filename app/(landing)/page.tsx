'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Minimal Header */}
      <header className="absolute top-0 w-full z-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="text-2xl font-bold text-gray-900">
              Research
            </div>
            <div className="flex items-center gap-4">
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    Sign in
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <Link href="/chat" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                  Dashboard
                </Link>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section - Centered */}
      <main className="flex items-center justify-center min-h-screen px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight text-gray-900 mb-8">
            AI does the
            <br />
            research for you
          </h1>

          <p className="text-xl sm:text-2xl text-gray-600 mb-12 max-w-2xl mx-auto">
            Autonomous agent that searches, synthesizes, and reviews.
            <br />
            You just provide the topic.
          </p>

          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-8 py-4 text-lg font-medium text-white bg-black rounded-full hover:bg-gray-800 transition-all">
                Start researching
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link href="/chat" className="inline-block px-8 py-4 text-lg font-medium text-white bg-black rounded-full hover:bg-gray-800 transition-all">
              Go to dashboard
            </Link>
          </SignedIn>

          <p className="mt-6 text-sm text-gray-500">
            100 free credits • No credit card
          </p>
        </div>
      </main>
    </div>
  );
}
