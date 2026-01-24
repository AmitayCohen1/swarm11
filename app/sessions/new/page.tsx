import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import SessionView from '@/components/sessions/SessionView';

export default async function NewSessionPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  return <SessionView />;
}
