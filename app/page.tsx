import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import LandingPage from './LandingPage';

export default async function Home() {
  const { userId } = await auth();

  // If logged in, go straight to orchestrator
  if (userId) {
    redirect('/autonomous');
  }

  // Show landing page for non-logged-in users
  return <LandingPage />;
}
