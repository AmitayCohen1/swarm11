import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import LandingPage from './LandingPage';

export default async function Home() {
  const { userId } = await auth();

  // If logged in, go straight to chat
  if (userId) {
    redirect('/chat');
  }

  // Show landing page for non-logged-in users
  return <LandingPage />;
}
