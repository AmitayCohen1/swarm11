'use client';

import { SignInButton } from '@clerk/nextjs';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      {/* Minimal Header */}
      <header className="absolute top-0 left-0 right-0">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-20">
            <div className="text-xl font-semibold text-white">
              Research
            </div>
            <div className="flex items-center gap-4">
              <SignInButton mode="modal">
                <button className="text-sm text-gray-400 hover:text-white">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-4xl mx-auto text-center">
        <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight text-white mb-8 leading-tight">
          Research<br />without limits
        </h1>

        <p className="text-xl sm:text-2xl text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed">
          Autonomous agent that searches, synthesizes, and reviews.<br />
          You just provide the topic.
        </p>

        <SignInButton mode="modal">
          <button className="px-8 py-4 text-base font-medium text-black bg-white rounded-full hover:bg-gray-100 transition-all">
            Start researching
          </button>
        </SignInButton>

        <p className="mt-8 text-sm text-gray-500">
          100 free credits • No credit card required
        </p>
      </main>
    </div>
  );
}
